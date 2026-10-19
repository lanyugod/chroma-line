import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uAberration: { value: 0 },
    uShock: { value: 0 },
    uFlash: { value: 0 },
    uSpeed: { value: 0 },
    uInk: { value: 0 },
    uPaper: { value: 1 },
    uFlashColor: { value: new THREE.Color("#ffffff") },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uProgress;
    uniform float uAberration;
    uniform float uShock;
    uniform float uFlash;
    uniform float uSpeed;
    uniform float uInk;
    uniform float uPaper;
    uniform vec3 uFlashColor;

    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 center = vec2(0.5);
      vec2 delta = vUv - center;
      float dist = length(delta);
      float radial = dist * 2.0;

      // Fold shockwave: a quick radial glass ripple.
      float shock = sin((dist - (1.0 - uShock) * 0.82) * 46.0) * uShock;
      vec2 uvShock = vUv - normalize(delta + 0.0001) * shock * 0.014 * smoothstep(0.8, 1.4, radial);

      // Speed pulls the image gently toward the vanishing point.
      vec2 blurDir = delta * (0.0007 + uSpeed * 0.0032) * smoothstep(0.12, 0.8, radial);
      vec3 color = vec3(0.0);
      float total = 0.0;
      for (int i = 0; i < 4; i++) {
        float f = float(i) / 3.0;
        float w = 1.0 - f * 0.42;
        vec2 uv = uvShock - blurDir * f;
        color += texture2D(tDiffuse, uv).rgb * w;
        total += w;
      }
      color /= total;

      // Lens chromatic separation.
      float ab = uAberration * 0.0024 + 0.00018;
      vec2 abDir = normalize(delta + 0.0001) * ab * (0.3 + radial);
      vec3 split;
      split.r = texture2D(tDiffuse, uvShock + abDir).r;
      split.g = texture2D(tDiffuse, uvShock).g;
      split.b = texture2D(tDiffuse, uvShock - abDir).b;
      color = mix(color, split, 0.55);

      // Filmic contrast + very restrained split-tone.
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, 1.08);
      color = (color - 0.5) * 1.035 + 0.5;
      color += vec3(0.012, 0.0, 0.026) * smoothstep(0.4, 1.0, 1.0 - luma);
      color += vec3(0.0, 0.016, 0.02) * smoothstep(0.4, 1.0, luma) * (1.0 - uPaper);
      color = max(color, vec3(0.0));

      // Paper is not a flat colour: screen-space fibres and pencil grain.
      float grain = hash12(gl_FragCoord.xy + vec2(uTime * 17.3, uTime * 9.7));
      float fibres = sin((vUv.x * uResolution.x + vUv.y * uResolution.y * 0.35) * 0.35);
      color += (grain - 0.5) * mix(0.04, 0.016, uPaper);
      color += fibres * 0.0035 * uPaper;

      // Vignette.
      float vig = smoothstep(0.82, 0.18, radial);
      color *= mix(0.72, 1.0, vig);
      color *= 1.0 - smoothstep(0.96, 1.38, radial) * 0.48;

      // Flash + shock bloom.
      float ringGlow = exp(-abs(dist - (1.0 - uShock) * 0.82) * 30.0) * uShock;
      color += uFlashColor * (uFlash * 0.72 + ringGlow * 0.1);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.55,
      0.62,
      0.76
    );
    this.composer.addPass(this.bloom);

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.uniforms = this.grade.uniforms;
  }

  setSize(width, height, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    this.bloom.setSize(width * pixelRatio, height * pixelRatio);
  }

  update(dt, state) {
    const u = this.uniforms;
    u.uTime.value = state.time;
    u.uProgress.value = state.progress;
    u.uPaper.value = state.paper;
    u.uInk.value = 1 - state.progress;
    u.uSpeed.value = state.speedNorm || 0;
    u.uAberration.value = state.aberration || 0;
    u.uShock.value = Math.max(0, state.shock || 0);
    u.uFlash.value = Math.max(0, state.flash || 0);
    if (state.flashColor) u.uFlashColor.value.copy(state.flashColor);

    this.bloom.strength =
      0.025 + Math.pow(state.progress, 1.35) * 0.34 + (state.boosting ? 0.1 : 0) + (state.complete ? 0.14 : 0);
    this.bloom.radius = 0.28 + state.progress * 0.26;
    this.bloom.threshold = 0.96 - state.progress * 0.14;
  }

  render(dt) {
    this.composer.render(dt);
  }
}
