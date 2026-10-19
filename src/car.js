import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { clamp, lerp, makeGlowTexture, smoothstep } from "./utils.js";

const PAINT_TARGET = new THREE.Color("#ff4a00");
const CARBON_TARGET = new THREE.Color("#101116");
const RIM_TARGET = new THREE.Color("#d7d4c8");
const ACCENT_CYAN = new THREE.Color("#5ef4ff");
const ACCENT_MAGENTA = new THREE.Color("#ff3cb4");

function buildCrossSection(station) {
  const { halfWidth, bottom, top } = station;
  const shape = [
    [-0.72, 0.0],
    [-1.0, 0.14],
    [-1.0, 0.8],
    [-0.62, 1.0],
    [0.62, 1.0],
    [1.0, 0.8],
    [1.0, 0.14],
    [0.72, 0.0],
  ];
  return shape.map(([x, v]) => [x * halfWidth, bottom + (top - bottom) * v]);
}

function buildLoft(stations) {
  const rings = stations.map((s) => buildCrossSection(s));
  const positions = [];
  const indices = [];
  const ringSize = 8;

  for (let r = 0; r < rings.length; r++) {
    for (let i = 0; i < ringSize; i++) {
      positions.push(rings[r][i][0], rings[r][i][1], stations[r].z);
    }
  }

  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < ringSize; i++) {
      const next = (i + 1) % ringSize;
      const a = r * ringSize + i;
      const b = r * ringSize + next;
      const c = (r + 1) * ringSize + i;
      const d = (r + 1) * ringSize + next;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Caps
  const first = stations[0];
  const last = stations[stations.length - 1];
  const frontCenter = positions.length / 3;
  positions.push(0, (first.bottom + first.top) * 0.5, first.z - 0.025);
  const backCenter = positions.length / 3;
  positions.push(0, (last.bottom + last.top) * 0.5, last.z + 0.03);

  for (let i = 0; i < ringSize; i++) {
    const next = (i + 1) % ringSize;
    indices.push(frontCenter, i, next);
    const base = (rings.length - 1) * ringSize;
    indices.push(backCenter, base + next, base + i);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const smooth = geo.toNonIndexed();
  smooth.computeVertexNormals();
  geo.dispose();
  return smooth;
}

function makeSideBadge() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 256);

  ctx.strokeStyle = "rgba(10,10,11,0.9)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(128, 128, 87, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(10,10,11,0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(128, 128, 100, 0.2, Math.PI * 1.65);
  ctx.stroke();

  ctx.fillStyle = "#0a0a0b";
  ctx.font = "italic 700 108px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("07", 128, 116);

  ctx.font = "500 16px Helvetica, Arial, sans-serif";
  ctx.letterSpacing = "5px";
  ctx.fillText("CHROMA", 128, 196);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class Car {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.chassis = new THREE.Group();
    this.root.add(this.chassis);
    this.scene.add(this.root);

    this.wheelSpin = 0;
    this.time = 0;
    this.paintUniforms = {
      uPaintProgress: { value: 0 },
      uTime: { value: 0 },
    };

    this.paintMaterials = [];
    this.edgeMaterials = [];
    this.accentMaterials = [];
    this.glowMaterials = [];
    this.outlineMat = new THREE.MeshBasicMaterial({
      color: 0x08080a,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: true,
    });
    this.fatEdgeMat = new LineMaterial({
      color: 0x09090b,
      linewidth: 2.15,
      transparent: true,
      opacity: 0.9,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
      worldUnits: false,
      dashed: false,
      alphaToCoverage: true,
    });

    this.buildShadow();
    this.buildBody();
    this.buildCabin();
    this.buildAero();
    this.buildDetails();
    this.buildWheels();
    this.buildLights();
  }

  makePaintMaterial(target, options = {}) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: target.clone(),
      metalness: options.metalness ?? 0.78,
      roughness: options.roughness ?? 0.2,
      clearcoat: options.clearcoat ?? 1,
      clearcoatRoughness: options.clearcoatRoughness ?? 0.12,
      envMapIntensity: options.envMapIntensity ?? 2.2,
      iridescence: options.iridescence ?? 0.22,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [120, 420],
      flatShading: true,
    });

    const uniforms = this.paintUniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uPaintProgress = uniforms.uPaintProgress;
      shader.uniforms.uTime = uniforms.uTime;

      shader.vertexShader = `
        varying vec3 vFillWorld;
        varying vec3 vFillNormal;
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vFillWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vFillNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );

      shader.fragmentShader = `
        varying vec3 vFillWorld;
        varying vec3 vFillNormal;
        uniform float uPaintProgress;
        uniform float uTime;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        {
          float threshold = mix(-0.12, 1.5, uPaintProgress);
          float wave = 0.055 * sin(vFillWorld.z * 5.6 + vFillWorld.x * 4.8
            + sin(vFillWorld.y * 17.0 + uTime * 1.15) * 1.35);
          float field = vFillWorld.y + wave;
          float reveal = 1.0 - smoothstep(threshold - 0.02, threshold + 0.065, field);

          vec3 N = normalize(vFillNormal);
          float shade = 0.52 + 0.48 * max(dot(N, normalize(vec3(-0.45, 0.86, 0.35))), 0.0);
          float hatch = step(0.56, fract((gl_FragCoord.x * 0.58 + gl_FragCoord.y * 0.94) * 0.072));
          vec3 mono = vec3(0.1 + shade * 0.47);
          mono *= 1.0 - hatch * 0.11;
          mono = mix(mono, vec3(0.94, 0.93, 0.88), 0.1);

          float seam = 1.0 - smoothstep(0.0, 0.014, abs(field - threshold));
          vec3 seamColor = mix(vec3(0.2, 0.95, 1.0), vec3(1.0, 0.25, 0.7),
            smoothstep(0.0, 1.0, uPaintProgress));

          vec3 V = normalize(cameraPosition - vFillWorld);
          float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          float spec = pow(max(dot(N, normalize(vec3(-0.28, 0.86, 0.42))), 0.0), 28.0);
          float spec2 = pow(max(dot(N, normalize(vec3(0.52, 0.45, 0.62))), 0.0), 42.0);
          vec3 metal = gl_FragColor.rgb;
          metal += vec3(1.0, 0.82, 0.62) * spec * 0.6;
          metal += mix(vec3(0.18, 0.92, 1.0), vec3(1.0, 0.25, 0.68),
            smoothstep(-1.0, 1.0, vFillWorld.x)) * (fresnel * 0.28 + spec2 * 0.35);
          metal = mix(metal, gl_FragColor.rgb, 0.28);

          gl_FragColor.rgb = mix(mono, metal, reveal);
          gl_FragColor.rgb += seamColor * seam * 0.8
            * (1.0 - smoothstep(0.965, 1.0, uPaintProgress));
        }`
      );
    };

    this.paintMaterials.push(mat);
    return mat;
  }

  addEdges(mesh, threshold = 28) {
    const edgeGeo = new THREE.EdgesGeometry(mesh.geometry, threshold);
    const positions = edgeGeo.attributes.position.array;
    const lineGeo = new LineSegmentsGeometry().setPositions(Array.from(positions));
    const line = new LineSegments2(lineGeo, this.fatEdgeMat);
    line.computeLineDistances();
    line.renderOrder = 2;
    mesh.add(line);
    edgeGeo.dispose();
    return line;
  }

  setResolution(width, height) {
    this.fatEdgeMat.resolution.set(width, height);
  }

  addSideContour(stations, side) {
    const pts = [];
    for (const st of stations) {
      pts.push([side * (st.halfWidth * 1.006), st.bottom, st.z]);
    }
    for (let i = stations.length - 1; i >= 0; i--) {
      const st = stations[i];
      pts.push([side * (st.halfWidth * 1.006), st.top, st.z]);
    }
    const positions = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    const geo = new LineSegmentsGeometry().setPositions(positions);
    const line = new LineSegments2(geo, this.fatEdgeMat);
    line.renderOrder = 3;
    this.chassis.add(line);
    return line;
  }

  addOutline(mesh, scale = 1.018) {
    const outline = new THREE.Mesh(mesh.geometry, this.outlineMat);
    outline.scale.setScalar(scale);
    outline.renderOrder = -1;
    mesh.add(outline);
    return outline;
  }

  makeAccent(color = ACCENT_CYAN, opacity = 0) {
    const mat = new THREE.MeshBasicMaterial({
      color: color.clone(),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.accentMaterials.push(mat);
    return mat;
  }

  buildShadow() {
    const glow = makeGlowTexture(128);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: glow,
      color: 0x090908,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.4), this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.012, 0.35);
    this.root.add(shadow);
    this.shadow = shadow;

    this.underGlowMat = new THREE.MeshBasicMaterial({
      map: glow,
      color: ACCENT_CYAN.clone(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const under = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 7.4), this.underGlowMat);
    under.rotation.x = -Math.PI / 2;
    under.position.set(0, 0.018, 0.2);
    this.root.add(under);
    this.underGlow = under;
  }

  buildBody() {
    const stations = [
      { z: -2.28, halfWidth: 0.34, bottom: 0.32, top: 0.42 },
      { z: -2.05, halfWidth: 0.64, bottom: 0.19, top: 0.52 },
      { z: -1.62, halfWidth: 0.88, bottom: 0.16, top: 0.61 },
      { z: -1.02, halfWidth: 0.94, bottom: 0.17, top: 0.71 },
      { z: -0.32, halfWidth: 0.99, bottom: 0.18, top: 0.8 },
      { z: 0.48, halfWidth: 1.02, bottom: 0.2, top: 0.82 },
      { z: 1.25, halfWidth: 0.96, bottom: 0.22, top: 0.76 },
      { z: 1.86, halfWidth: 0.82, bottom: 0.28, top: 0.62 },
      { z: 2.12, halfWidth: 0.72, bottom: 0.33, top: 0.5 },
    ];

    const bodyGeo = buildLoft(stations);
    const bodyMat = this.makePaintMaterial(PAINT_TARGET, {
      metalness: 0.94,
      roughness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.09,
      envMapIntensity: 2.45,
      iridescence: 0.3,
    });
    this.bodyMat = bodyMat;
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    this.chassis.add(body);
    this.body = body;
    this.addOutline(body, 1.055);
    this.addEdges(body, 26);
    this.addSideContour(stations, -1);
    this.addSideContour(stations, 1);

    // Shoulder / side blades add a second, sharper silhouette layer.
    const shoulderMat = this.makePaintMaterial(CARBON_TARGET, {
      metalness: 0.86,
      roughness: 0.28,
      clearcoat: 0.75,
      envMapIntensity: 1.25,
      iridescence: 0.08,
    });
    const shoulderGeo = buildLoft([
      { z: -1.54, halfWidth: 0.9, bottom: 0.35, top: 0.48 },
      { z: -0.78, halfWidth: 1.04, bottom: 0.36, top: 0.54 },
      { z: 0.35, halfWidth: 1.07, bottom: 0.36, top: 0.56 },
      { z: 1.25, halfWidth: 1.0, bottom: 0.35, top: 0.53 },
      { z: 1.78, halfWidth: 0.86, bottom: 0.34, top: 0.46 },
    ]);
    const shoulders = new THREE.Mesh(shoulderGeo, shoulderMat);
    this.chassis.add(shoulders);
    this.addOutline(shoulders, 1.045);
    this.addEdges(shoulders, 24);

    // Front splitter.
    const splitterMat = this.makePaintMaterial(CARBON_TARGET, {
      metalness: 0.72,
      roughness: 0.35,
      clearcoat: 0.6,
    });
    const splitter = new THREE.Mesh(
      new THREE.BoxGeometry(2.22, 0.055, 0.58),
      splitterMat
    );
    splitter.position.set(0, 0.08, -2.03);
    splitter.rotation.x = -0.035;
    this.chassis.add(splitter);
    this.addOutline(splitter, 1.018);
    this.addEdges(splitter, 30);

    // Side skirts.
    for (const side of [-1, 1]) {
      const skirt = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.12, 2.1),
        splitterMat
      );
      skirt.position.set(side * 1.0, 0.17, 0.15);
      this.chassis.add(skirt);
    }

    // Side accent line, dark until the world gains colour.
    for (const side of [-1, 1]) {
      const accent = new THREE.Mesh(
        new THREE.BoxGeometry(0.016, 0.018, 1.72),
        this.makeAccent(side < 0 ? ACCENT_CYAN : ACCENT_MAGENTA, 0)
      );
      accent.position.set(side * 1.082, 0.43, 0.35);
      this.chassis.add(accent);
    }

    // Side number plates.
    const badgeTex = makeSideBadge();
    const badgeMat = new THREE.MeshBasicMaterial({
      map: badgeTex,
      transparent: true,
      depthWrite: false,
      color: 0xffffff,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    for (const side of [-1, 1]) {
      const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.56), badgeMat);
      badge.position.set(side * 1.087, 0.55, 0.42);
      badge.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.chassis.add(badge);
    }
  }

  buildCabin() {
    const canopyGeo = buildLoft([
      { z: -1.1, halfWidth: 0.28, bottom: 0.61, top: 0.67 },
      { z: -0.78, halfWidth: 0.48, bottom: 0.64, top: 0.85 },
      { z: -0.24, halfWidth: 0.61, bottom: 0.67, top: 1.07 },
      { z: 0.3, halfWidth: 0.62, bottom: 0.68, top: 1.12 },
      { z: 0.82, halfWidth: 0.53, bottom: 0.67, top: 0.97 },
      { z: 1.18, halfWidth: 0.36, bottom: 0.65, top: 0.77 },
    ]);
    const glass = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#07070a"),
      metalness: 0.55,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: 2.1,
      flatShading: true,
      transparent: true,
      opacity: 0.97,
    });

    const uniforms = this.paintUniforms;
    glass.onBeforeCompile = (shader) => {
      shader.uniforms.uPaintProgress = uniforms.uPaintProgress;
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader =
        `
        varying vec3 vFillWorld;
        varying vec3 vFillNormal;
      ` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vFillWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vFillNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );
      shader.fragmentShader =
        `
        varying vec3 vFillWorld;
        varying vec3 vFillNormal;
        uniform float uPaintProgress;
        uniform float uTime;
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        {
          float threshold = mix(-0.12, 1.5, uPaintProgress);
          float wave = 0.045 * sin(vFillWorld.z * 7.0 + vFillWorld.x * 5.5);
          float field = vFillWorld.y + wave;
          float reveal = 1.0 - smoothstep(threshold - 0.02, threshold + 0.06, field);
          vec3 N = normalize(vFillNormal);
          float shade = 0.42 + 0.58 * max(dot(N, normalize(vec3(-0.4, 0.9, 0.4))), 0.0);
          vec3 mono = mix(vec3(0.015), vec3(0.32), shade);
          float seam = 1.0 - smoothstep(0.0, 0.012, abs(field - threshold));
          gl_FragColor.rgb = mix(mono, gl_FragColor.rgb, reveal);
          gl_FragColor.rgb += vec3(0.25, 0.95, 1.0) * seam * 0.7
            * (1.0 - smoothstep(0.96, 1.0, uPaintProgress));
        }`
      );
    };
    this.glassMat = glass;
    this.paintMaterials.push(glass);

    const canopy = new THREE.Mesh(canopyGeo, glass);
    this.chassis.add(canopy);
    this.cabin = canopy;
    this.addOutline(canopy, 1.045);
    this.addEdges(canopy, 20);

    // Roof spine / cockpit divider.
    const spine = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.03, 1.66),
      this.makePaintMaterial(CARBON_TARGET, {
        metalness: 0.9,
        roughness: 0.24,
      })
    );
    spine.position.set(0, 1.07, 0.05);
    this.chassis.add(spine);

    // Headrest humps.
    for (const side of [-1, 1]) {
      const hump = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.12, 0.38),
        this.makePaintMaterial(CARBON_TARGET)
      );
      hump.position.set(side * 0.28, 0.99, 0.7);
      this.chassis.add(hump);
    }
  }

  buildAero() {
    const carbon = this.makePaintMaterial(CARBON_TARGET, {
      metalness: 0.82,
      roughness: 0.3,
      clearcoat: 0.7,
      envMapIntensity: 1.2,
    });
    this.wingMat = carbon;

    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.16, 0.06, 0.56), carbon);
    wing.position.set(0, 1.27, 1.92);
    wing.rotation.x = 0.16;
    this.chassis.add(wing);
    this.wing = wing;
    this.addOutline(wing, 1.04);
    this.addEdges(wing, 30);

    for (const side of [-1, 1]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.42, 0.16), carbon);
      pylon.position.set(side * 0.68, 1.06, 1.84);
      this.chassis.add(pylon);

      const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.3, 0.64), carbon);
      endplate.position.set(side * 1.1, 1.24, 1.92);
      this.chassis.add(endplate);
      this.addOutline(endplate, 1.03);
      this.addEdges(endplate, 30);
    }

    // Rear diffuser.
    for (let i = 0; i < 5; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.18, 0.5), carbon);
      fin.position.set((i - 2) * 0.23, 0.2, 2.12);
      this.chassis.add(fin);
    }
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.045, 0.48), carbon);
    diffuser.position.set(0, 0.12, 2.12);
    diffuser.rotation.x = -0.22;
    this.chassis.add(diffuser);

    // Front canards.
    for (const side of [-1, 1]) {
      const canard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.26), carbon);
      canard.position.set(side * 0.96, 0.28, -1.68);
      canard.rotation.z = side * 0.14;
      this.chassis.add(canard);
    }

    // Rear central fin.
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.25, 0.62), carbon);
    fin.position.set(0, 0.78, 1.78);
    fin.rotation.x = 0.2;
    this.chassis.add(fin);

    // Warm neon trailing edge on the wing.
    const wingGlow = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.014, 0.026),
      this.makeAccent(ACCENT_MAGENTA, 0)
    );
    wingGlow.position.set(0, 0.04, 0.285);
    wing.add(wingGlow);

    // Cream racing stripes across the wing.
    const stripeMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#f1e4c5"),
      metalness: 0.55,
      roughness: 0.3,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.3,
      side: THREE.DoubleSide,
    });
    this.liveryMat = stripeMat;
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.008, 0.54), stripeMat);
      stripe.position.set(side * 0.3, 0.045, 0.02);
      wing.add(stripe);
    }

    // Two stripes run down the rear deck.
    const deckStations = [
      { z: 0.58, y: 0.835 },
      { z: 0.94, y: 0.82 },
      { z: 1.28, y: 0.775 },
      { z: 1.6, y: 0.71 },
      { z: 1.86, y: 0.635 },
    ];
    for (const side of [-1, 1]) {
      const positions = [];
      for (let i = 0; i < deckStations.length - 1; i++) {
        const a = deckStations[i];
        const b = deckStations[i + 1];
        const x0 = side * 0.14;
        const x1 = side * 0.2;
        positions.push(
          x0, a.y, a.z,
          x1, a.y, a.z,
          x1, b.y, b.z,
          x0, a.y, a.z,
          x1, b.y, b.z,
          x0, b.y, b.z
        );
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.computeVertexNormals();
      const stripe = new THREE.Mesh(geo, stripeMat);
      this.chassis.add(stripe);
    }
  }

  buildDetails() {
    // Intakes.
    const intakeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#050507"),
      metalness: 0.55,
      roughness: 0.4,
      envMapIntensity: 1.2,
    });
    this.darkTrimMat = intakeMat;
    for (const side of [-1, 1]) {
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.62), intakeMat);
      intake.position.set(side * 1.045, 0.55, 0.86);
      intake.rotation.z = side * 0.05;
      this.chassis.add(intake);

      const intakeBlade = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.025, 0.55),
        this.makeAccent(side < 0 ? ACCENT_CYAN : ACCENT_MAGENTA, 0)
      );
      intakeBlade.position.set(side * 1.075, 0.64, 0.84);
      this.chassis.add(intakeBlade);
    }

    // Hood vents.
    for (const side of [-1, 1]) {
      const vent = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.018, 0.5),
        intakeMat
      );
      vent.position.set(side * 0.34, 0.595, -1.32);
      vent.rotation.x = -0.18;
      this.chassis.add(vent);
    }

    // Black grille and rear heat extractors.
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.09, 0.05), intakeMat);
    grille.position.set(0, 0.27, -2.2);
    this.chassis.add(grille);
    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.018, 0.05), intakeMat);
      slat.position.set(0, 0.755 - i * 0.015, 1.22 + i * 0.12);
      slat.rotation.x = -0.1;
      this.chassis.add(slat);
    }
  }

  buildWheels() {
    const tireMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#08080a"),
      roughness: 0.72,
      metalness: 0.16,
    });
    this.tireMat = tireMat;

    const rimMat = new THREE.MeshPhysicalMaterial({
      color: RIM_TARGET.clone(),
      metalness: 0.95,
      roughness: 0.21,
      clearcoat: 0.7,
      flatShading: true,
      envMapIntensity: 1.4,
    });
    this.rimMat = rimMat;

    const discMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#201d1e"),
      metalness: 0.9,
      roughness: 0.44,
      emissive: new THREE.Color("#ff3b0a"),
      emissiveIntensity: 0,
    });
    this.discMat = discMat;

    const tireGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.27, 28);
    const rimGeo = new THREE.TorusGeometry(0.245, 0.026, 8, 30);
    const discGeo = new THREE.CylinderGeometry(0.185, 0.185, 0.028, 22);
    const spokeGeo = new THREE.BoxGeometry(0.045, 0.35, 0.035);
    const sidewallMat = new THREE.MeshBasicMaterial({
      color: 0xf4f1e8,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    this.sidewallMat = sidewallMat;

    this.wheels = [];
    const positions = [
      [-1.01, 0.375, -1.48, true],
      [1.01, 0.375, -1.48, true],
      [-1.01, 0.385, 1.52, false],
      [1.01, 0.385, 1.52, false],
    ];

    for (const [x, y, z, front] of positions) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      const steer = new THREE.Group();
      pivot.add(steer);

      const spin = new THREE.Group();
      steer.add(spin);

      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.rotation.z = Math.PI / 2;
      spin.add(tire);

      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.y = Math.PI / 2;
      spin.add(rim);

      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.z = Math.PI / 2;
      spin.add(disc);

      for (let i = 0; i < 5; i++) {
        const spoke = new THREE.Mesh(spokeGeo, rimMat);
        spoke.rotation.x = (i / 5) * Math.PI * 2;
        spoke.position.set(x > 0 ? 0.06 : -0.06, 0, 0);
        spoke.rotation.z = 0;
        spin.add(spoke);
      }

      for (const side of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.008, 5, 30), sidewallMat);
        ring.rotation.y = Math.PI / 2;
        ring.position.x = side * 0.137;
        spin.add(ring);
      }

      this.chassis.add(pivot);
      this.wheels.push({ pivot, steer, spin, front });
    }
  }

  buildLights() {
    this.tailMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#0b0b0d"),
      metalness: 0.4,
      roughness: 0.34,
      emissive: new THREE.Color("#ff2a62"),
      emissiveIntensity: 0,
      toneMapped: false,
    });
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.045, 0.05), this.tailMat);
    tail.position.set(0, 0.62, 2.14);
    this.chassis.add(tail);

    const tailSplit = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.18, 0.04),
      this.tailMat
    );
    tailSplit.position.set(0, 0.53, 2.15);
    this.chassis.add(tailSplit);

    this.headMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#0a0a0c"),
      metalness: 0.4,
      roughness: 0.3,
      emissive: new THREE.Color("#5ef4ff"),
      emissiveIntensity: 0,
      toneMapped: false,
    });
    for (const side of [-1, 1]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.035, 0.06), this.headMat);
      head.position.set(side * 0.48, 0.38, -2.17);
      head.rotation.z = side * -0.15;
      this.chassis.add(head);
    }

    // Exhaust cones.
    this.exhaustMat = this.makeAccent(ACCENT_MAGENTA, 0);
    this.exhausts = [];
    for (const side of [-1, 1]) {
      const exhaust = new THREE.Mesh(
        new THREE.ConeGeometry(0.075, 0.6, 12, 1, true),
        this.exhaustMat
      );
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(side * 0.34, 0.34, 2.52);
      exhaust.scale.set(1, 0.3, 1);
      this.chassis.add(exhaust);
      this.exhausts.push(exhaust);
    }

    // Engine glow under the rear.
    this.engineGlowMat = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(64),
      color: ACCENT_MAGENTA.clone(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const engineGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.2), this.engineGlowMat);
    engineGlow.rotation.x = -Math.PI / 2;
    engineGlow.position.set(0, 0.045, 1.95);
    this.chassis.add(engineGlow);
    this.engineGlow = engineGlow;

    // A warm moving key and two narrow fills give the physical paint
    // something to reflect. They live on the car so they travel with it.
    this.carKey = new THREE.PointLight(0xffd8b2, 0, 15, 2);
    this.carKey.position.set(0.4, 4.2, 2.4);
    this.carFill = new THREE.PointLight(0x8defff, 0, 12, 2);
    this.carFill.position.set(-2.6, 1.6, 2.8);
    this.carRim = new THREE.PointLight(0xff6a2a, 0, 12, 2);
    this.carRim.position.set(2.6, 1.9, 1.1);
    this.root.add(this.carKey, this.carFill, this.carRim);

    // Rear racing number, legible from the chase camera.
    const decal = document.createElement("canvas");
    decal.width = 512;
    decal.height = 256;
    const dctx = decal.getContext("2d");
    dctx.clearRect(0, 0, 512, 256);
    dctx.fillStyle = "#ffffff";
    dctx.textAlign = "center";
    dctx.textBaseline = "middle";
    dctx.font = "italic 700 142px Helvetica, Arial, sans-serif";
    dctx.fillText("07", 256, 112);
    dctx.font = "500 24px Helvetica, Arial, sans-serif";
    dctx.letterSpacing = "9px";
    dctx.fillText("CHROMA / LINE", 256, 196);
    const decalTex = new THREE.CanvasTexture(decal);
    decalTex.colorSpace = THREE.SRGBColorSpace;
    decalTex.anisotropy = 8;
    this.rearDecalMat = new THREE.MeshBasicMaterial({
      map: decalTex,
      transparent: true,
      depthWrite: false,
      color: 0x0b0b0c,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const rearDecal = new THREE.Mesh(
      new THREE.PlaneGeometry(1.18, 0.59),
      this.rearDecalMat
    );
    rearDecal.position.set(0, 0.82, 2.205);
    rearDecal.rotation.x = -0.12;
    this.chassis.add(rearDecal);
  }

  update(dt, time, state) {
    this.time = time;
    this.paintUniforms.uTime.value = time;
    this.paintUniforms.uPaintProgress.value = smoothstep(0.02, 0.92, state.progress);

    const steer = state.steer || 0;
    const speedNorm = clamp((state.speed - 45) / 95, 0, 1);
    const boost = state.boosting ? 1 : 0;

    const bob =
      Math.sin(time * 7.5) * 0.006 +
      Math.sin(time * 13.1 + 1.2) * 0.003 +
      speedNorm * 0.006;
    this.chassis.position.y = 0.04 + bob;
    this.chassis.rotation.z = steer * 0.045 + Math.sin(time * 3.2) * 0.004;
    this.chassis.rotation.y = -steer * 0.075;
    this.chassis.rotation.x = -0.005 - boost * 0.008 + Math.sin(time * 5.3) * 0.0025;

    this.wheelSpin += state.speed * dt * 2.4;
    for (const wheel of this.wheels) {
      wheel.spin.rotation.x = -this.wheelSpin;
      wheel.steer.rotation.y = wheel.front ? -steer * 0.28 : 0;
    }

    this.wing.rotation.x = 0.16 + boost * 0.17;
    this.engineGlowMat.opacity = state.progress * (0.08 + boost * 0.12);
    this.engineGlow.scale.setScalar(0.9 + Math.sin(time * 9) * 0.04 + boost * 0.15);

    this.exhaustMat.opacity = state.progress * (0.12 + boost * 0.35);
    for (const exhaust of this.exhausts) {
      exhaust.scale.y = 0.3 + boost * 1.25 + Math.sin(time * 22) * 0.08;
      exhaust.scale.x = 0.8 + boost * 0.35;
      exhaust.scale.z = 0.8 + boost * 0.35;
    }

    this.underGlowMat.opacity = state.progress * (0.09 + boost * 0.1);
    this.underGlow.scale.setScalar(0.95 + boost * 0.12);

    this.tailMat.emissiveIntensity = state.progress * (1.35 + boost * 0.8);
    this.headMat.emissiveIntensity = state.progress * 1.3;
    this.discMat.emissiveIntensity = state.progress * 0.65;
    this.carKey.intensity = state.progress * 30;
    this.carFill.intensity = state.progress * 18;
    this.carRim.intensity = state.progress * (13 + boost * 7);
    this.rearDecalMat.color.copy(new THREE.Color("#0b0b0c")).lerp(new THREE.Color("#f6e7c8"), state.progress);
    this.outlineMat.opacity = lerp(0.9, 0.3, state.progress);

    this.rimMat.color.copy(RIM_TARGET).lerp(new THREE.Color("#ffb14a"), state.progress * 0.35);
    this.rimMat.metalness = lerp(0.35, 0.96, state.progress);
    this.rimMat.roughness = lerp(0.6, 0.19, state.progress);

    this.sidewallMat.opacity = lerp(0.8, 0.1, state.progress);
    this.fatEdgeMat.opacity = lerp(0.95, 0.34, state.progress);
    this.fatEdgeMat.linewidth = lerp(2.15, 0.85, state.progress);

    for (const mat of this.accentMaterials) {
      mat.opacity = smoothstep(0.5, 0.94, state.progress) * (0.78 + boost * 0.4);
    }

    this.shadowMat.opacity = 0.52 - state.progress * 0.2;
    this.shadow.scale.setScalar(1 + speedNorm * 0.06);
    this.root.position.x = state.x;
    this.root.rotation.z = -steer * 0.012;
  }

  setLeap(t) {
    // t: 0 hidden/flat, 1 fully in the world.
    const e = clamp(t, 0, 1);
    this.root.scale.setScalar(lerp(0.42, 1, e));
    this.root.rotation.y = lerp(-1.15, 0, e);
    this.root.position.z = lerp(-2.4, 0, e);
    this.root.position.y = lerp(-0.12, 0, e);
  }
}
