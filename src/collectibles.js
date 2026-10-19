import * as THREE from "three";
import { makeGlowTexture, mulberry32 } from "./utils.js";

const PALETTE = [
  new THREE.Color("#62f6ff"),
  new THREE.Color("#ff3cb4"),
  new THREE.Color("#ffb52d"),
  new THREE.Color("#c8ff45"),
  new THREE.Color("#9c7bff"),
];

export const LANES = [-5.4, -2.7, 0, 2.7, 5.4];

class Bursts {
  constructor(scene) {
    this.scene = scene;
    this.count = 360;
    this.cursor = 0;
    this.rand = mulberry32(444);
    this.positions = new Float32Array(this.count * 3);
    this.colors = new Float32Array(this.count * 3);
    this.alphas = new Float32Array(this.count);
    this.sizes = new Float32Array(this.count);
    this.velocities = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);
    this.maxLife = new Float32Array(this.count);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aAlpha;
        attribute float aSize;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (40.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.08, d);
          gl_FragColor = vec4(vColor, a * vAlpha);
        }
      `,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.geo = geo;
    scene.add(this.points);

    const glow = makeGlowTexture(128);
    this.rings = [];
    for (let i = 0; i < 7; i++) {
      const sm = new THREE.SpriteMaterial({
        map: glow,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const sprite = new THREE.Sprite(sm);
      sprite.scale.setScalar(1);
      sprite.visible = false;
      scene.add(sprite);
      this.rings.push({ sprite, mat: sm, life: 0, maxLife: 0.5, size: 1 });
    }
    this.ringCursor = 0;
  }

  spawn(position, color, amount = 34, power = 1) {
    for (let n = 0; n < amount; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;

      const angle = this.rand() * Math.PI * 2;
      const elevation = (this.rand() - 0.25) * 1.5;
      const speed = (1.4 + this.rand() * 5.6) * power;
      const dx = Math.cos(angle) * Math.cos(elevation) * speed;
      const dy = Math.sin(elevation) * speed + 2.2 * power;
      const dz = Math.sin(angle) * Math.cos(elevation) * speed;

      this.positions[i * 3] = position.x + (this.rand() - 0.5) * 0.2;
      this.positions[i * 3 + 1] = position.y + (this.rand() - 0.5) * 0.2;
      this.positions[i * 3 + 2] = position.z + (this.rand() - 0.5) * 0.2;

      const c = color.clone().offsetHSL((this.rand() - 0.5) * 0.1, 0, (this.rand() - 0.5) * 0.18);
      this.colors[i * 3] = c.r;
      this.colors[i * 3 + 1] = c.g;
      this.colors[i * 3 + 2] = c.b;

      this.velocities[i * 3] = dx;
      this.velocities[i * 3 + 1] = dy;
      this.velocities[i * 3 + 2] = dz;

      this.maxLife[i] = 0.45 + this.rand() * 0.75;
      this.life[i] = this.maxLife[i];
      this.alphas[i] = 1;
      this.sizes[i] = 1.2 + this.rand() * 2.8;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;

    const ring = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    ring.sprite.position.copy(position);
    ring.mat.color.copy(color);
    ring.mat.opacity = 0.85;
    ring.sprite.visible = true;
    ring.life = 0.5;
    ring.maxLife = 0.5;
    ring.size = 1.0 + power * 0.75;
  }

  update(dt) {
    let changed = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      changed = true;
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alphas[i] = t * t;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      this.velocities[i * 3 + 1] -= 4.6 * dt;
      this.velocities[i * 3] *= 0.985;
      this.velocities[i * 3 + 2] *= 0.985;
    }
    if (changed) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
    }

    for (const ring of this.rings) {
      if (ring.life <= 0) continue;
      ring.life -= dt;
      const t = Math.max(0, ring.life / ring.maxLife);
      const grow = (1 - t) * ring.size * 3.2 + ring.size * 0.5;
      ring.sprite.scale.setScalar(grow);
      ring.mat.opacity = t * 0.75;
      ring.sprite.position.z += dt * 2.4;
      if (ring.life <= 0) ring.sprite.visible = false;
    }
  }

  reset() {
    this.life.fill(0);
    this.alphas.fill(0);
    this.geo.attributes.aAlpha.needsUpdate = true;
    for (const ring of this.rings) {
      ring.life = 0;
      ring.sprite.visible = false;
    }
  }
}

export class CollectibleField {
  constructor(scene, onCollect) {
    this.scene = scene;
    this.onCollect = onCollect;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.rand = mulberry32(7777);
    this.spawnAccumulator = 0;
    this.spawnDistance = 40;
    this.items = [];
    this.menuMode = true;
    this.bursts = new Bursts(scene);

    this.buildPalette();
    this.buildPool();
  }

  buildPalette() {
    const glow = makeGlowTexture(128);
    this.palette = PALETTE.map((color) => {
      const core = new THREE.MeshBasicMaterial({
        color,
        toneMapped: false,
        fog: false,
      });
      const wire = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      const ring = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      const sprite = new THREE.SpriteMaterial({
        map: glow,
        color,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      const beam = new THREE.SpriteMaterial({
        map: glow,
        color,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      const crystal = new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.9,
        metalness: 0.5,
        roughness: 0.18,
        flatShading: true,
        envMapIntensity: 1.8,
        toneMapped: true,
        fog: false,
      });
      return { core, wire, ring, sprite, crystal, beam };
    });
  }

  buildPool() {
    const orbGeo = new THREE.IcosahedronGeometry(0.23, 1);
    const wireGeo = new THREE.IcosahedronGeometry(0.48, 1);
    const ringGeo = new THREE.TorusGeometry(0.58, 0.008, 5, 36);
    const shardGeo = new THREE.OctahedronGeometry(0.45, 0);

    for (let i = 0; i < 26; i++) {
      const group = new THREE.Group();
      const beam = new THREE.Sprite();
      beam.position.y = 1.7;
      const halo = new THREE.Sprite();
      halo.scale.setScalar(1.7);
      const core = new THREE.Mesh(orbGeo);
      const wire = new THREE.Mesh(wireGeo);
      const ring = new THREE.Mesh(ringGeo);
      const crystal = new THREE.Mesh(shardGeo);
      group.add(beam, halo, core, wire, ring, crystal);
      group.visible = false;
      this.group.add(group);
      this.items.push({
        group,
        beam,
        halo,
        core,
        wire,
        ring,
        crystal,
        type: "orb",
        active: false,
        x: 0,
        z: 0,
        y: 1.2,
        colorIndex: 0,
        phase: 0,
        value: 0.045,
        spin: 1,
      });
    }
  }

  configure(item, type, colorIndex) {
    const p = this.palette[colorIndex];
    item.type = type;
    item.colorIndex = colorIndex;
    item.halo.material = p.sprite;
    item.beam.material = p.beam;
    item.core.material = p.core;
    item.wire.material = p.wire;
    item.ring.material = p.ring;
    item.crystal.material = p.crystal;

    const isShard = type === "shard";
    item.core.visible = !isShard;
    item.wire.visible = true;
    item.ring.visible = !isShard;
    item.crystal.visible = isShard;
    item.halo.scale.setScalar(isShard ? 2.35 : 1.85);
    item.beam.scale.set(isShard ? 2.1 : 1.55, isShard ? 6.4 : 5.2, 1);
    item.beam.position.y = isShard ? 2.2 : 1.9;
    item.wire.scale.setScalar(isShard ? 1.38 : 1);
    item.crystal.scale.setScalar(1);
    item.value = isShard ? 0.075 : 0.045;
    item.y = isShard ? 1.45 : 1.1 + this.rand() * 0.55;
    item.color = PALETTE[colorIndex];
  }

  spawnAt(x, z, type = "orb", colorIndex = -1) {
    const item = this.items.find((it) => !it.active);
    if (!item) return;
    const idx = colorIndex < 0 ? Math.floor(this.rand() * PALETTE.length) : colorIndex % PALETTE.length;
    this.configure(item, type, idx);
    item.active = true;
    item.x = x;
    item.z = z;
    item.phase = this.rand() * Math.PI * 2;
    item.spin = 0.7 + this.rand() * 1.4;
    item.group.visible = true;
    item.group.position.set(x, item.y, z);
    item.group.scale.setScalar(0.001);
  }

  spawnPattern() {
    const roll = this.rand();
    const laneIndex = Math.floor(this.rand() * LANES.length);
    const lane = LANES[laneIndex];

    if (roll < 0.14) {
      this.spawnAt(lane, -215, "shard");
      return;
    }

    if (roll < 0.46) {
      const ci = Math.floor(this.rand() * PALETTE.length);
      this.spawnAt(lane, -210, "orb", ci);
      return;
    }

    if (roll < 0.72) {
      for (let i = 0; i < 3; i++) {
        this.spawnAt(lane, -206 - i * 5.5, "orb", (laneIndex + i) % PALETTE.length);
      }
      return;
    }

    if (roll < 0.89) {
      const dir = this.rand() > 0.5 ? 1 : -1;
      const start = Math.floor(this.rand() * 3) + 1;
      for (let i = 0; i < 3; i++) {
        const idx = Math.max(0, Math.min(LANES.length - 1, start + i * dir));
        this.spawnAt(LANES[idx], -206 - i * 4.5, "orb", (i + 2) % PALETTE.length);
      }
      return;
    }

    this.spawnAt(lane, -212, "shard");
    this.spawnAt(lane, -204, "orb");
  }

  update(dt, time, speed, carX, collisionsEnabled) {
    this.spawnAccumulator += speed * dt;
    const interval = 40 + Math.sin(time * 0.3) * 6;
    if (this.spawnAccumulator > interval) {
      this.spawnAccumulator -= interval;
      this.spawnPattern();
    }

    for (const item of this.items) {
      if (!item.active) continue;
      item.z += speed * dt;
      const intro = item.group.scale.x;
      item.group.scale.setScalar(intro + (1 - intro) * Math.min(1, dt * 8));
      item.group.position.set(
        item.x,
        item.y + Math.sin(time * 2.1 + item.phase) * 0.12,
        item.z
      );
      item.group.rotation.y += dt * item.spin;
      item.group.rotation.z = Math.sin(time * 1.3 + item.phase) * 0.18;
      if (item.type === "orb") {
        item.ring.rotation.x = Math.PI / 2 + Math.sin(time * 1.7 + item.phase) * 0.5;
        item.ring.rotation.y += dt * 0.6;
        item.wire.rotation.y -= dt * 0.4;
      } else {
        item.crystal.rotation.x += dt * 0.7;
        item.crystal.rotation.z += dt * 1.1;
        item.wire.rotation.y -= dt * 0.8;
      }

      if (item.z > 14) {
        item.active = false;
        item.group.visible = false;
        continue;
      }

      if (collisionsEnabled && item.z > -3.4 && item.z < 3.4 && Math.abs(item.x - carX) < 1.35) {
        item.active = false;
        item.group.visible = false;
        const color = PALETTE[item.colorIndex];
        this.bursts.spawn(
          new THREE.Vector3(item.x, item.y, Math.max(0.2, item.z)),
          color,
          item.type === "shard" ? 56 : 34,
          item.type === "shard" ? 1.5 : 1
        );
        if (this.onCollect) this.onCollect(item, color);
      }
    }

    this.bursts.update(dt);
  }

  reset() {
    for (const item of this.items) {
      item.active = false;
      item.group.visible = false;
    }
    this.spawnAccumulator = 0;
    this.bursts.reset();
  }
}
