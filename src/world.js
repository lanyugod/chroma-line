import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  clamp,
  lerp,
  smoothstep,
  mulberry32,
  makeNoiseTexture,
} from "./utils.js";

const MONO = {
  paper: new THREE.Color("#f1eee6"),
  paperDeep: new THREE.Color("#dbd6ca"),
  ink: new THREE.Color("#0b0b0c"),
  building: new THREE.Color("#f8f5ee"),
};

const COLOR = {
  skyTop: new THREE.Color("#03040b"),
  skyBottom: new THREE.Color("#160b2e"),
  horizon: new THREE.Color("#ff3f96"),
  fog: new THREE.Color("#090713"),
  asphalt: new THREE.Color("#08080e"),
  cyan: new THREE.Color("#62f6ff"),
  magenta: new THREE.Color("#ff3cb4"),
  orange: new THREE.Color("#ff5a1f"),
  lime: new THREE.Color("#c8ff45"),
};

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;
  uniform float uProgress;
  uniform float uTime;
  uniform vec3 uPaperTop;
  uniform vec3 uPaperBottom;
  uniform vec3 uInk;
  uniform vec3 uColorTop;
  uniform vec3 uColorBottom;
  uniform vec3 uHorizon;

  varying vec3 vDir;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    float upper = smoothstep(0.5, 1.0, h);

    vec3 paper = mix(uPaperBottom, uPaperTop, upper);
    float fiber = hash(floor((d.xz + 1.0) * 760.0)) - 0.5;
    paper += fiber * 0.024;

    float horizonLine = 1.0 - smoothstep(0.0, 0.006, abs(d.y - 0.035));
    paper = mix(paper, uInk, horizonLine * 0.18);
    float strata = smoothstep(0.88, 1.0, sin(d.y * 210.0 + d.x * 6.0 + uTime * 0.02) * 0.5 + 0.5);
    paper -= strata * 0.015;

    vec3 col = mix(uColorBottom, uColorTop, smoothstep(0.28, 0.94, h));
    float glow = exp(-abs(d.y - 0.045) * 11.0);
    col += uHorizon * glow * 0.42;

    float aurora = sin(d.x * 3.4 + d.y * 7.5 + uTime * 0.045) * 0.5 + 0.5;
    aurora = pow(aurora, 7.0) * smoothstep(-0.1, 0.35, d.y);
    col += vec3(0.10, 0.012, 0.20) * aurora;

    float starField = step(0.9965, hash(floor(d.xz * 1750.0) + floor(d.y * 320.0)));
    col += vec3(0.7, 0.9, 1.0) * starField * smoothstep(0.2, 0.8, h) * 0.75;

    vec3 sunDir = normalize(vec3(-0.43, 0.19, -1.0));
    float sd = dot(d, sunDir);
    float disc = smoothstep(0.9978, 0.9993, sd);
    float ring = 1.0 - smoothstep(0.0007, 0.0042, abs(sd - 0.986));
    float ring2 = 1.0 - smoothstep(0.0004, 0.0022, abs(sd - 0.972));
    vec3 sunCol = mix(uHorizon, vec3(1.0, 0.78, 0.52), 0.2);
    paper = mix(paper, uInk, ring * 0.56 + ring2 * 0.24);
    col += sunCol * (disc * 0.55 + ring * 0.9 + ring2 * 0.35);

    float skyMix = smoothstep(0.02, 0.7, uProgress);
    vec3 finalColor = mix(paper, col, skyMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

const ROAD_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ROAD_FRAG = /* glsl */ `
  precision highp float;
  uniform float uProgress;
  uniform float uTime;
  uniform float uOffset;
  uniform vec3 uPaper;
  uniform vec3 uInk;
  uniform vec3 uAsphalt;
  uniform vec3 uCyan;
  uniform vec3 uMagenta;
  uniform vec3 uOrange;
  uniform vec3 uFog;

  varying vec3 vWorld;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    float x = vWorld.x;
    float z = vWorld.z;

    float edge = 1.0 - smoothstep(0.025, 0.11, abs(abs(x) - 8.25));

    float dashPhase = fract((z - uOffset) / 9.0);
    float dash = smoothstep(0.0, 0.025, dashPhase) * (1.0 - smoothstep(0.41, 0.47, dashPhase));

    float lanes = 0.0;
    for (int i = -1; i <= 1; i++) {
      float lx = float(i) * 4.5;
      lanes += (1.0 - smoothstep(0.03, 0.12, abs(x - lx))) * dash;
    }

    float seamPhase = fract((z - uOffset * 0.52) / 23.0);
    float seam = 1.0 - smoothstep(0.0, 0.012, abs(seamPhase - 0.5));
    seam *= smoothstep(0.0, 0.05, abs(seamPhase - 0.5));

    vec3 paper = uPaper;
    paper -= 0.028 * (0.5 + 0.5 * sin(x * 2.1 + z * 0.72));
    float grain = hash(floor(vec2(x * 1.7, (z - uOffset) * 0.7)));
    paper += (grain - 0.5) * 0.022;

    vec3 asphalt = uAsphalt;
    asphalt += (hash(floor(vec2(x * 2.0, (z - uOffset) * 0.5))) - 0.5) * 0.03;

    float streakPhase = sin(x * 3.7 + sin(z * 0.18 + uTime * 0.22) * 1.8) * 0.5 + 0.5;
    float streak = smoothstep(0.52, 0.97, streakPhase) * (1.0 - smoothstep(0.35, 0.9, abs(x) / 8.5));
    asphalt += mix(uCyan, uMagenta, 0.5 + 0.5 * sin(x * 0.5)) * streak * 0.075;

    float centreGlow = exp(-pow(x / 2.1, 2.0) - pow(z / 12.0, 2.0));
    asphalt += uCyan * centreGlow * 0.05;

    vec3 mono = paper;
    mono = mix(mono, uInk, edge * 0.72 + lanes * 0.6 + seam * 0.2);

    vec3 color = asphalt;
    color += uCyan * edge * 1.35;
    color += (uCyan * 0.55 + uMagenta * 0.55) * lanes * 1.05;
    color += uOrange * seam * 0.16;
    color += uCyan * centreGlow * 0.16;

    float roadMix = smoothstep(0.02, 0.62, uProgress);
    vec3 finalColor = mix(mono, color, roadMix);

    float dist = length(vWorld - cameraPosition);
    float fogFactor = 1.0 - exp(-pow(dist * 0.0085, 2.0));
    finalColor = mix(finalColor, uFog, clamp(fogFactor, 0.0, 0.96));

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

const GROUND_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const GROUND_FRAG = /* glsl */ `
  precision highp float;
  uniform float uProgress;
  uniform float uTime;
  uniform float uOffset;
  uniform vec3 uPaper;
  uniform vec3 uInk;
  uniform vec3 uDark;
  uniform vec3 uCyan;
  uniform vec3 uMagenta;
  uniform vec3 uFog;

  varying vec3 vWorld;

  float gridLine(float v, float width) {
    return 1.0 - smoothstep(0.0, width, abs(fract(v) - 0.5));
  }

  void main() {
    vec2 p = vWorld.xz;
    p.y -= uOffset;

    float gx = gridLine(p.x / 6.0, 0.018);
    float gz = gridLine(p.y / 6.0, 0.018);
    float grid = max(gx, gz);

    float fine = max(gridLine(p.x / 1.5, 0.006), gridLine(p.y / 1.5, 0.006));

    vec3 paper = uPaper;
    paper -= 0.025 * (0.5 + 0.5 * sin(p.x * 0.2 + p.y * 0.3));
    paper = mix(paper, uInk, grid * 0.09 + fine * 0.025);

    vec3 dark = uDark;
    dark += mix(uCyan, uMagenta, 0.5 + 0.5 * sin(vWorld.x * 0.08)) * grid * 0.5;
    dark += uCyan * fine * 0.06;
    dark += uMagenta * exp(-abs(vWorld.x) * 0.03) * 0.015;

    vec3 col = mix(paper, dark, uProgress);
    float dist = length(vWorld - cameraPosition);
    float fogFactor = 1.0 - exp(-pow(dist * 0.0065, 2.0));
    col = mix(col, uFog, clamp(fogFactor, 0.0, 0.95));
    gl_FragColor = vec4(col, 1.0);
  }
`;

function createWindowTexture(seed) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const rand = mulberry32(seed);

  const cols = 4 + Math.floor(rand() * 3);
  const rows = 14 + Math.floor(rand() * 8);
  const padX = 10;
  const padY = 12;
  const cw = (canvas.width - padX * 2) / cols;
  const ch = (canvas.height - padY * 2) / rows;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (rand() > 0.56) {
        const a = 0.25 + rand() * 0.75;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        const h = ch * (0.25 + rand() * 0.35);
        ctx.fillRect(
          padX + x * cw + cw * 0.22,
          padY + y * ch + ch * 0.2,
          cw * 0.52,
          h
        );
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

function createEnvironment(renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  const base = ctx.createLinearGradient(0, 0, 0, canvas.height);
  base.addColorStop(0, "#06060d");
  base.addColorStop(0.5, "#0d0a18");
  base.addColorStop(0.62, "#24102e");
  base.addColorStop(0.72, "#130b1d");
  base.addColorStop(1, "#050509");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.filter = "blur(28px)";
  const blobs = [
    ["#ff2f9f", 190, 290, 280, 100],
    ["#4bebff", 720, 300, 330, 90],
    ["#ff6a1f", 470, 330, 180, 75],
    ["#6f4dff", 880, 180, 200, 120],
  ];
  for (const [color, x, y, w, h] of blobs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, w);
    g.addColorStop(0, color);
    g.addColorStop(0.5, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Architectural reflection panels.
  ctx.filter = "blur(3px)";
  for (let i = 0; i < 16; i++) {
    const x = (i / 16) * canvas.width + 12;
    const w = 4 + (i % 3) * 4;
    const h = 80 + ((i * 47) % 180);
    ctx.fillStyle = i % 2 ? "rgba(160,245,255,0.42)" : "rgba(255,80,190,0.3)";
    ctx.fillRect(x, 210 - h * 0.3, w, h);
  }

  ctx.filter = "none";
  const glow = ctx.createLinearGradient(0, 300, 0, 380);
  glow.addColorStop(0, "rgba(255,80,190,0)");
  glow.addColorStop(0.45, "rgba(255,80,190,0.48)");
  glow.addColorStop(1, "rgba(80,240,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 300, canvas.width, 80);

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose();
  pmrem.dispose();
  return env;
}

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = 0;
    this.speed = 24;
    this.progress = 0;
    this.offset = 0;
    this.rand = mulberry32(20260214);
    this.tmpColor = new THREE.Color();
    this.tmpColor2 = new THREE.Color();

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.cityItems = [];
    this.gates = [];
    this.specimens = [];

    this.buildEnvironment();
    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildRoad();
    this.buildTrackFurniture();
    this.buildCity();
    this.buildGates();
    this.buildSpecimens();
    this.buildSpeedStreaks();
    this.buildDust();
  }

  buildEnvironment() {
    this.scene.environment = createEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.06;
    this.scene.fog = new THREE.FogExp2(MONO.paperDeep.clone(), 0.0032);
  }

  buildSky() {
    this.skyUniforms = {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uPaperTop: { value: MONO.paper.clone() },
      uPaperBottom: { value: MONO.paperDeep.clone() },
      uInk: { value: MONO.ink.clone() },
      uColorTop: { value: COLOR.skyTop.clone() },
      uColorBottom: { value: COLOR.skyBottom.clone() },
      uHorizon: { value: COLOR.horizon.clone() },
    };
    const geo = new THREE.SphereGeometry(420, 48, 32);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: true,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1000;
    this.scene.add(this.sky);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xa8a397, 1.55);
    this.scene.add(this.hemi);

    this.keyLight = new THREE.DirectionalLight(0xfff6e8, 2.3);
    this.keyLight.position.set(-8, 14, 8);
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.rimCyan = new THREE.PointLight(COLOR.cyan, 0, 55, 2);
    this.rimCyan.position.set(-5, 2.2, 2.5);
    this.scene.add(this.rimCyan);

    this.rimMagenta = new THREE.PointLight(COLOR.magenta, 0, 55, 2);
    this.rimMagenta.position.set(5, 2.5, 3.5);
    this.scene.add(this.rimMagenta);

    this.rimOrange = new THREE.PointLight(COLOR.orange, 0, 35, 2);
    this.rimOrange.position.set(0, 1.3, 5.5);
    this.scene.add(this.rimOrange);
  }

  buildGround() {
    this.groundUniforms = {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uOffset: { value: 0 },
      uPaper: { value: MONO.paper.clone() },
      uInk: { value: MONO.ink.clone() },
      uDark: { value: new THREE.Color("#08070d") },
      uCyan: { value: COLOR.cyan.clone() },
      uMagenta: { value: COLOR.magenta.clone() },
      uFog: { value: MONO.paperDeep.clone() },
    };
    const geo = new THREE.PlaneGeometry(900, 900, 1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.groundUniforms,
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      fog: false,
    });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(0, -0.62, -200);
    this.group.add(this.ground);
  }

  buildRoad() {
    this.roadUniforms = {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uOffset: { value: 0 },
      uPaper: { value: MONO.paper.clone() },
      uInk: { value: MONO.ink.clone() },
      uAsphalt: { value: COLOR.asphalt.clone() },
      uCyan: { value: COLOR.cyan.clone() },
      uMagenta: { value: COLOR.magenta.clone() },
      uOrange: { value: COLOR.orange.clone() },
      uFog: { value: MONO.paperDeep.clone() },
    };

    const geo = new THREE.PlaneGeometry(18, 360, 1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.roadUniforms,
      vertexShader: ROAD_VERT,
      fragmentShader: ROAD_FRAG,
      fog: false,
    });
    this.road = new THREE.Mesh(geo, mat);
    this.road.rotation.x = -Math.PI / 2;
    this.road.position.set(0, 0, -158);
    this.road.renderOrder = 1;
    this.group.add(this.road);

    // Thin physical edge rails give the road a little weight from the chase cam.
    const railMat = new THREE.MeshStandardMaterial({
      color: MONO.paper.clone(),
      roughness: 0.8,
      metalness: 0,
    });
    this.railMat = railMat;
    this.railTarget = new THREE.Color("#1a1824");
    const railGeo = new THREE.BoxGeometry(0.16, 0.2, 360);

    this.rails = [];
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(side * 8.48, 0.06, -158);
      this.group.add(rail);
      this.rails.push(rail);
    }
  }

  buildTrackFurniture() {
    this.postMat = new THREE.MeshStandardMaterial({
      color: MONO.building.clone(),
      roughness: 0.62,
      metalness: 0.08,
    });
    this.postTarget = new THREE.Color("#1b1926");
    this.postGlowMat = new THREE.MeshBasicMaterial({
      color: COLOR.cyan.clone(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    const postGeo = new THREE.BoxGeometry(0.12, 1.1, 0.12);
    const glowGeo = new THREE.BoxGeometry(0.24, 0.05, 0.24);
    this.posts = [];
    const count = 38;
    for (let i = 0; i < count; i++) {
      const z = 18 - (i / count) * 340;
      for (const side of [-1, 1]) {
        const g = new THREE.Group();
        const body = new THREE.Mesh(postGeo, this.postMat);
        body.position.y = 0.55;
        const glow = new THREE.Mesh(glowGeo, this.postGlowMat);
        glow.position.y = 1.13;
        g.add(body, glow);
        g.position.set(side * 9.15, 0, z);
        this.group.add(g);
        this.posts.push(g);
      }
    }

    // Dashed neon line floating alongside the rails.
    const dashGeo = new THREE.BoxGeometry(0.035, 0.02, 1.6);
    this.railDashMat = new THREE.MeshBasicMaterial({
      color: COLOR.magenta.clone(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.railDashes = [];
    for (let i = 0; i < 26; i++) {
      const z = 10 - i * 13.5;
      for (const side of [-1, 1]) {
        const m = new THREE.Mesh(dashGeo, this.railDashMat);
        m.position.set(side * 8.75, 0.18, z);
        this.group.add(m);
        this.railDashes.push(m);
      }
    }
  }

  buildCity() {
    this.cityGroup = new THREE.Group();
    this.group.add(this.cityGroup);

    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const faceShades = [0.58, 0.58, 0.96, 0.32, 0.8, 0.8];
    const shadeColors = new Float32Array(this.boxGeo.attributes.position.count * 3);
    for (let i = 0; i < this.boxGeo.attributes.position.count; i++) {
      const shade = faceShades[Math.floor(i / 4)];
      shadeColors[i * 3] = shade;
      shadeColors[i * 3 + 1] = shade;
      shadeColors[i * 3 + 2] = shade;
    }
    this.boxGeo.setAttribute("color", new THREE.BufferAttribute(shadeColors, 3));
    this.edgesGeo = new THREE.EdgesGeometry(this.boxGeo, 22);
    this.edgeMat = new THREE.LineBasicMaterial({
      color: MONO.ink.clone(),
      transparent: true,
      opacity: 0.82,
    });

    this.windowTextures = [
      createWindowTexture(11),
      createWindowTexture(29),
      createWindowTexture(71),
    ];
    this.windowMats = [
      new THREE.MeshBasicMaterial({
        map: this.windowTextures[0],
        color: COLOR.cyan.clone(),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      new THREE.MeshBasicMaterial({
        map: this.windowTextures[1],
        color: COLOR.magenta.clone(),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      new THREE.MeshBasicMaterial({
        map: this.windowTextures[2],
        color: new THREE.Color("#ffb35c"),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    ];
    this.windowInkMats = this.windowTextures.map(
      (map) =>
        new THREE.MeshBasicMaterial({
          map,
          color: new THREE.Color("#0a0a0b"),
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
          alphaTest: 0.02,
        })
    );
    this.neonEdgeMats = [
      new THREE.LineBasicMaterial({
        color: COLOR.cyan.clone(),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      new THREE.LineBasicMaterial({
        color: COLOR.magenta.clone(),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      new THREE.LineBasicMaterial({
        color: new THREE.Color("#ffb35c"),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    ];

    const rand = this.rand;
    const makeBuilding = (side, z, near) => {
      const width = near ? 4.5 + rand() * 8 : 8 + rand() * 16;
      const height = near ? 8 + rand() * 44 : 25 + rand() * 75;
      const depth = near ? 5 + rand() * 10 : 10 + rand() * 20;
      const drift = near ? 11 + rand() * 25 : 36 + rand() * 54;
      const x = side * (drift + width * 0.5);

      const tintTarget = new THREE.Color().setHSL(
        (rand() > 0.55 ? 0.51 : 0.87) + (rand() - 0.5) * 0.08,
        0.5 + rand() * 0.26,
        0.09 + rand() * 0.14
      );
      if (rand() > 0.8) {
        tintTarget.setHSL(0.075 + rand() * 0.06, 0.72, 0.18);
      }

      const mat = new THREE.MeshStandardMaterial({
        color: MONO.building.clone(),
        roughness: 0.92,
        metalness: 0,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0,
        vertexColors: true,
      });

      const mesh = new THREE.Mesh(this.boxGeo, mat);
      mesh.scale.set(width, height, depth);
      mesh.position.set(x, height * 0.5 - 0.62, z);

      const edges = new THREE.LineSegments(this.edgesGeo, this.edgeMat);
      edges.scale.copy(mesh.scale);
      edges.position.copy(mesh.position);

      const winIdx = Math.floor(rand() * this.windowMats.length);
      const winMat = this.windowMats[winIdx];
      const winInkMat = this.windowInkMats[winIdx];
      const winPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), winMat);
      const inkPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), winInkMat);
      const faceX = x - side * width * 0.5;
      const winDepth = depth * 0.8;
      const winHeight = height * 0.72;
      winPlane.position.set(faceX - side * 0.035, height * 0.5 - 0.62, z);
      winPlane.scale.set(winDepth, winHeight, 1);
      winPlane.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      winPlane.renderOrder = 2;
      inkPlane.position.set(faceX - side * 0.026, height * 0.5 - 0.62, z);
      inkPlane.scale.copy(winPlane.scale);
      inkPlane.rotation.copy(winPlane.rotation);
      inkPlane.renderOrder = 2;

      let accentLine = null;
      if (near && rand() > 0.38) {
        const edgeIdx = Math.floor(rand() * this.neonEdgeMats.length);
        const edgeMat = this.neonEdgeMats[edgeIdx];
        const edgeGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(faceX, -0.62, -winDepth * 0.5),
          new THREE.Vector3(faceX, height - 0.62, -winDepth * 0.5),
          new THREE.Vector3(faceX, -0.62, winDepth * 0.5),
          new THREE.Vector3(faceX, height - 0.62, winDepth * 0.5),
        ]);
        accentLine = new THREE.LineSegments(edgeGeo, edgeMat);
        accentLine.position.z = z;
        accentLine.renderOrder = 3;
        this.cityGroup.add(accentLine);
      }

      this.cityGroup.add(mesh, edges, winPlane, inkPlane);
      this.cityItems.push({
        mesh,
        edges,
        winPlane,
        inkPlane,
        accentLine,
        mat,
        baseZ: z,
        threshold: near ? rand() * 0.32 : 0.18 + rand() * 0.35,
        tint: tintTarget,
        height,
        x,
      });
    };

    for (let i = 0; i < 22; i++) {
      const z = 18 - i * 14.4 - rand() * 5;
      makeBuilding(-1, z, true);
      makeBuilding(1, z - 6.8, true);
    }

    for (let i = 0; i < 13; i++) {
      const z = 5 - i * 25 - rand() * 8;
      makeBuilding(-1, z, false);
      makeBuilding(1, z - 11.5, false);
    }

    // Three signature towers with an extra neon spine.
    this.spineMat = new THREE.LineBasicMaterial({
      color: COLOR.magenta.clone(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.spines = [];
    for (let i = 0; i < 3; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const height = 54 + i * 9;
      const x = side * (17 + i * 8);
      const z = -95 - i * 62;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0, z),
        new THREE.Vector3(x, height, z),
      ]);
      const line = new THREE.Line(geo, this.spineMat);
      this.group.add(line);
      this.spines.push(line);
    }
  }

  buildGates() {
    this.gateMonoMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#16151b"),
      roughness: 0.45,
      metalness: 0.35,
      emissive: new THREE.Color("#000000"),
    });
    this.gateGlowMat = new THREE.MeshBasicMaterial({
      color: COLOR.cyan.clone(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    const gateGeo = new THREE.TorusGeometry(10.6, 0.2, 8, 76, Math.PI);
    const ringGeo = new THREE.TorusGeometry(10.93, 0.035, 6, 76, Math.PI);

    for (let i = 0; i < 6; i++) {
      const group = new THREE.Group();
      const gate = new THREE.Mesh(gateGeo, this.gateMonoMat);
      const ring = new THREE.Mesh(ringGeo, this.gateGlowMat);
      group.add(gate, ring);
      group.position.set(0, 0.15, -22 - i * 52);
      this.group.add(group);
      this.gates.push({ group, phase: i * 1.7, ring });
    }
  }

  buildSpecimens() {
    this.specimenMat = new THREE.LineBasicMaterial({
      color: MONO.ink.clone(),
      transparent: true,
      opacity: 0.5,
    });
    const geos = [
      new THREE.IcosahedronGeometry(2.2, 1),
      new THREE.OctahedronGeometry(2.6, 0),
      new THREE.TorusKnotGeometry(1.5, 0.22, 60, 8),
    ].map((g) => new THREE.EdgesGeometry(g, 12));

    for (let i = 0; i < 7; i++) {
      const geo = geos[i % geos.length];
      const mesh = new THREE.LineSegments(geo, this.specimenMat);
      const side = i % 2 === 0 ? -1 : 1;
      mesh.position.set(
        side * (14 + this.rand() * 16),
        7 + this.rand() * 16,
        -30 - this.rand() * 190
      );
      mesh.rotation.set(this.rand() * 3, this.rand() * 3, this.rand() * 3);
      const scale = 0.55 + this.rand() * 1.6;
      mesh.scale.setScalar(scale);
      this.group.add(mesh);
      this.specimens.push({
        mesh,
        baseY: mesh.position.y,
        spin: new THREE.Vector3(
          0.04 + this.rand() * 0.12,
          0.07 + this.rand() * 0.18,
          0.02
        ),
        phase: this.rand() * 6.28,
      });
    }
  }

  buildSpeedStreaks() {
    const count = 190;
    this.streakData = [];
    const positions = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 36;
      const y = 0.4 + Math.random() * 20;
      const z = -Math.random() * 260 + 10;
      const len = 1.4 + Math.random() * 9;
      this.streakData.push({ x, y, z, len, speed: 0.8 + Math.random() * 0.9 });
      positions[i * 6] = x;
      positions[i * 6 + 1] = y;
      positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x;
      positions[i * 6 + 4] = y;
      positions[i * 6 + 5] = z - len;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.streakGeo = geo;
    this.streakMat = new THREE.LineBasicMaterial({
      color: MONO.ink.clone(),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.streaks = new THREE.LineSegments(geo, this.streakMat);
    this.streaks.frustumCulled = false;
    this.group.add(this.streaks);
  }

  buildDust() {
    const count = 420;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = [COLOR.cyan, COLOR.magenta, COLOR.orange, COLOR.lime];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 50;
      positions[i * 3 + 1] = Math.random() * 25;
      positions[i * 3 + 2] = -Math.random() * 260;
      const c = palette[Math.floor(Math.random() * palette.length)];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.dustGeo = geo;
    this.dustMat = new THREE.PointsMaterial({
      size: 0.075,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  update(dt, time, speed, carX, progress, boosting) {
    this.time = time;
    this.speed = speed;
    this.progress = progress;
    const move = speed * dt;
    this.offset += move;

    this.skyUniforms.uTime.value = time;
    this.skyUniforms.uProgress.value = progress;
    this.sky.position.x = carX * 0.35;

    this.roadUniforms.uTime.value = time;
    this.roadUniforms.uOffset.value = this.offset;
    this.roadUniforms.uProgress.value = progress;
    this.roadUniforms.uFog.value.copy(this.scene.fog.color);

    this.groundUniforms.uTime.value = time;
    this.groundUniforms.uOffset.value = this.offset * 0.72;
    this.groundUniforms.uProgress.value = progress;
    this.groundUniforms.uFog.value.copy(this.scene.fog.color);

    // Sky, fog and global lights.
    this.scene.fog.color.copy(MONO.paperDeep).lerp(COLOR.fog, smoothstep(0.08, 0.82, progress));
    this.scene.fog.density = lerp(0.0032, 0.0052, progress);
    this.scene.environmentIntensity = lerp(0.05, 2.1, smoothstep(0.12, 0.8, progress));

    this.hemi.color.copy(new THREE.Color("#ffffff")).lerp(COLOR.horizon, progress * 0.45);
    this.hemi.groundColor.copy(new THREE.Color("#b0aba0")).lerp(new THREE.Color("#160e25"), progress);
    this.hemi.intensity = lerp(1.55, 0.48, progress);
    this.keyLight.intensity = lerp(2.25, 1.15, progress);
    this.keyLight.color.copy(new THREE.Color("#fff7e9")).lerp(new THREE.Color("#8fa7ff"), progress * 0.55);
    this.keyLight.position.set(carX - 8, 15, 8);
    this.keyLight.target.position.set(carX, 0, -8);
    this.keyLight.target.updateMatrixWorld();

    this.rimCyan.position.set(carX - 4.6, 2.1, 2.2);
    this.rimMagenta.position.set(carX + 4.6, 2.6, 3.3);
    this.rimOrange.position.set(carX, 1.1, 5.7);
    this.rimCyan.intensity = progress * (9 + (boosting ? 6 : 0));
    this.rimMagenta.intensity = progress * (6 + (boosting ? 4 : 0));
    this.rimOrange.intensity = progress * 3.5;

    // Moving city.
    for (const item of this.cityItems) {
      item.mesh.position.z += move;
      const zNow = item.mesh.position.z;
      item.edges.position.z = zNow;
      item.winPlane.position.z = zNow;
      item.inkPlane.position.z = zNow;
      if (item.accentLine) item.accentLine.position.z = zNow;
      if (zNow > 38) {
        const shift = 368;
        item.mesh.position.z -= shift;
        item.edges.position.z = item.mesh.position.z;
        item.winPlane.position.z = item.mesh.position.z;
        item.inkPlane.position.z = item.mesh.position.z;
        if (item.accentLine) item.accentLine.position.z = item.mesh.position.z;
      }

      const threshold = item.threshold;
      const localP = smoothstep(threshold, threshold + 0.38, progress);
      item.mat.color.copy(MONO.building).lerp(item.tint, localP);
      item.mat.roughness = lerp(0.92, 0.42, localP);
      item.mat.metalness = lerp(0, 0.4, localP);
      item.mat.emissive.copy(item.tint).multiplyScalar(0.16);
      item.mat.emissiveIntensity = localP * 0.28;
    }
    this.edgeMat.opacity = lerp(0.9, 0.34, smoothstep(0.15, 0.75, progress));
    for (const mat of this.windowMats) {
      mat.opacity = smoothstep(0.2, 0.7, progress) * 0.95;
    }
    for (const mat of this.windowInkMats) {
      mat.opacity = lerp(0.46, 0.03, smoothstep(0.18, 0.72, progress));
    }
    for (const mat of this.neonEdgeMats) {
      mat.opacity = smoothstep(0.24, 0.72, progress) * 0.62;
    }
    this.spineMat.opacity = smoothstep(0.3, 0.8, progress) * 0.7;

    this.gateMonoMat.color.copy(new THREE.Color("#16151b")).lerp(new THREE.Color("#25212e"), progress);
    this.gateMonoMat.emissive.copy(COLOR.cyan).multiplyScalar(0.05);
    this.gateMonoMat.emissiveIntensity = progress;
    this.gateGlowMat.opacity = smoothstep(0.22, 0.72, progress) * 0.85;

    for (const gate of this.gates) {
      gate.group.position.z += move;
      if (gate.group.position.z > 35) gate.group.position.z -= 312;
      gate.ring.rotation.z = Math.sin(time * 0.4 + gate.phase) * 0.04;
    }

    for (const spec of this.specimens) {
      spec.mesh.position.z += move * 0.82;
      if (spec.mesh.position.z > 30) spec.mesh.position.z -= 300;
      spec.mesh.rotation.x += spec.spin.x * dt;
      spec.mesh.rotation.y += spec.spin.y * dt;
      spec.mesh.rotation.z += spec.spin.z * dt;
      spec.mesh.position.y = spec.baseY + Math.sin(time * 0.55 + spec.phase) * 1.3;
    }
    this.specimenMat.color.copy(MONO.ink).lerp(COLOR.cyan, progress * 0.8);
    this.specimenMat.opacity = lerp(0.5, 0.78, progress);

    for (const post of this.posts) {
      post.position.z += move;
      if (post.position.z > 28) post.position.z -= 348;
    }
    this.postMat.color.copy(MONO.building).lerp(this.postTarget, progress);
    this.postMat.roughness = lerp(0.62, 0.3, progress);
    this.postMat.metalness = lerp(0.08, 0.55, progress);
    this.postGlowMat.opacity = smoothstep(0.25, 0.7, progress) * 0.95;

    for (const dash of this.railDashes) {
      dash.position.z += move * 1.06;
      if (dash.position.z > 24) dash.position.z -= 351;
    }
    this.railDashMat.opacity = smoothstep(0.2, 0.65, progress) * 0.8;

    this.railMat.color.copy(MONO.paper).lerp(this.railTarget, progress);
    this.railMat.roughness = lerp(0.8, 0.26, progress);
    this.railMat.metalness = lerp(0, 0.6, progress);

    // Speed streaks.
    const positions = this.streakGeo.attributes.position.array;
    for (let i = 0; i < this.streakData.length; i++) {
      const s = this.streakData[i];
      s.z += move * 1.65 * s.speed;
      if (s.z > 18) {
        s.z = -260 - Math.random() * 40;
        s.x = (Math.random() - 0.5) * 38;
        s.y = 0.4 + Math.random() * 20;
      }
      positions[i * 6 + 2] = s.z;
      positions[i * 6 + 5] = s.z - s.len * (1 + speed * 0.012);
    }
    this.streakGeo.attributes.position.needsUpdate = true;
    this.streakMat.color.copy(MONO.ink).lerp(COLOR.cyan, progress * 0.72);
    this.streakMat.opacity = lerp(0.14, 0.4, progress) + (boosting ? 0.18 : 0);

    const dustPositions = this.dustGeo.attributes.position.array;
    for (let i = 0; i < dustPositions.length / 3; i++) {
      dustPositions[i * 3 + 2] += move * (0.62 + (i % 5) * 0.08);
      if (dustPositions[i * 3 + 2] > 20) {
        dustPositions[i * 3 + 2] = -260 - Math.random() * 30;
        dustPositions[i * 3] = (Math.random() - 0.5) * 50;
        dustPositions[i * 3 + 1] = Math.random() * 25;
      }
    }
    this.dustGeo.attributes.position.needsUpdate = true;
    this.dustMat.opacity = smoothstep(0.32, 0.85, progress) * 0.55;

    for (const spine of this.spines) spine.material = this.spineMat;
  }
}
