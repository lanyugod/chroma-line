import * as THREE from "three";
import { clamp, lerp, mulberry32, colorToCss } from "./utils.js";

const PAPER = new THREE.Color("#f2eee4");
const PAPER_DEEP = new THREE.Color("#e2dccf");
const INK = new THREE.Color("#111112");
const CAR_TARGET = new THREE.Color("#ff4a16");
const CYAN = new THREE.Color("#5ef4ff");
const MAGENTA = new THREE.Color("#ff3cb4");
const AMBER = new THREE.Color("#ffb52d");
const LIME = new THREE.Color("#c8ff45");
const VIOLET = new THREE.Color("#9c7bff");
const CITY_COLORS = [CYAN, MAGENTA, AMBER, VIOLET, LIME];

function makeGrainCanvas(size = 160) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const rand = mulberry32(99);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rand() > 0.75 ? 25 : 245;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = rand() * 30;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeHatchCanvas(size = 12) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.strokeStyle = "rgba(15,15,16,0.11)";
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(-2, size + 2);
  ctx.lineTo(size + 2, -2);
  ctx.stroke();
  return c;
}

export class Ink2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.scroll = 0;
    this.time = 0;
    this.boilSeed = 1;
    this.splashes = [];
    this.layout = {
      horizon: 0.2,
      bottom: 0.98,
      farZ: -118,
      nearZ: 12,
    };
    this.grainPattern = null;
    this.hatchPattern = null;
    this.paperPattern = null;
    this.initPatterns();
    this.resize();
  }

  initPatterns() {
    const grain = makeGrainCanvas();
    const hatch = makeHatchCanvas();
    this.grainCanvas = grain;
    this.hatchCanvas = hatch;
  }

  resize() {
    // clientWidth/clientHeight are layout values and stay correct while the
    // canvas is folded behind a CSS 3D transform. getBoundingClientRect()
    // would report the projected, wildly stretched plane.
    this.width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    this.height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.grainPattern = this.ctx.createPattern(this.grainCanvas, "repeat");
    this.hatchPattern = this.ctx.createPattern(this.hatchCanvas, "repeat");
  }

  addSplash(worldX, worldZ, color) {
    const p = this.screenPoint(worldX, worldZ);
    if (!p) return;
    const rand = mulberry32(Math.floor(this.time * 1000) + 7);
    const droplets = [];
    for (let i = 0; i < 9; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = 8 + rand() * 55;
      droplets.push({
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist * 0.8,
        r: 1.5 + rand() * 6,
      });
    }
    this.splashes.push({
      x: p.x,
      y: p.y,
      color: color.clone(),
      life: 1,
      maxLife: 1,
      droplets,
      rot: rand() * Math.PI,
    });
    if (this.splashes.length > 18) this.splashes.shift();
  }

  halfAt(p) {
    return lerp(this.width * 0.045, this.width * 0.315, p);
  }

  layoutForZ(z) {
    const t = clamp(
      (z - this.layout.farZ) / (this.layout.nearZ - this.layout.farZ),
      0,
      1
    );
    const p = Math.pow(t, 1.6);
    const horizon = this.height * this.layout.horizon;
    const bottom = this.height * this.layout.bottom;
    return {
      p,
      t,
      y: lerp(horizon, bottom, p),
      half: this.halfAt(p),
      scale: lerp(0.18, 1.06, p),
    };
  }

  screenPoint(x, z) {
    const l = this.layoutForZ(z);
    return {
      x: this.width * 0.5 + (x / 8.4) * l.half,
      y: l.y,
      scale: l.scale,
      p: l.p,
    };
  }

  random() {
    // Cheap deterministic boil: changes 9 times a second.
    this.boilSeed = (this.boilSeed * 1664525 + 1013904223) >>> 0;
    return this.boilSeed / 4294967296;
  }

  roughStroke(points, opts = {}) {
    const {
      close = false,
      color = "rgba(15,15,16,0.72)",
      width = 1.2,
      passes = 2,
      jitter = 1.1,
      alpha = 1,
    } = opts;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let pass = 0; pass < passes; pass++) {
      ctx.globalAlpha = alpha * (pass === 0 ? 1 : 0.42);
      ctx.lineWidth = width * (pass === 0 ? 1 : 0.62);
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const jx = (this.random() - 0.5) * jitter * (pass === 0 ? 1 : 1.8);
        const jy = (this.random() - 0.5) * jitter * (pass === 0 ? 1 : 1.8);
        if (i === 0) ctx.moveTo(p[0] + jx, p[1] + jy);
        else {
          const prev = points[i - 1];
          const mx = (prev[0] + p[0]) * 0.5 + (this.random() - 0.5) * jitter;
          const my = (prev[1] + p[1]) * 0.5 + (this.random() - 0.5) * jitter;
          ctx.quadraticCurveTo(mx, my, p[0] + jx, p[1] + jy);
        }
      }
      if (close) ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  roughPoly(points, opts = {}) {
    const {
      fill = null,
      stroke = "rgba(15,15,16,0.78)",
      width = 1.8,
      passes = 2,
      jitter = 1.3,
      alpha = 1,
      close = true,
    } = opts;
    const ctx = this.ctx;
    if (fill) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      if (close) ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    }
    if (stroke) {
      this.roughStroke(points, { close, color: stroke, width, passes, jitter, alpha });
    }
  }

  render(state) {
    this.time = state.time;
    this.boilSeed = (Math.floor(state.time * 9) + 19) >>> 0;
    this.scroll += state.speed * state.dt * 0.92;
    this.layout.farZ = -118;
    this.layout.nearZ = 12;

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    this.drawPaper(state);
    this.drawSkyline(state);
    this.drawCity(state);
    this.drawRoad(state);
    this.drawSpeedLines(state);
    this.drawItems(state);
    this.drawCar(state);
    this.drawSplashes(state);
    this.drawPaperGrain(state);
    this.drawFrame(state);
  }

  drawPaper(state) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.fillStyle = "#f2eee4";
    ctx.fillRect(0, 0, w, h);

    // Watercolour stains arrive with the collected colour.
    if (state.progress > 0.02) {
      ctx.save();
      ctx.globalAlpha = state.progress * 0.2;
      const blobs = [
        [w * 0.08, h * 0.12, w * 0.3, MAGENTA],
        [w * 0.92, h * 0.28, w * 0.34, CYAN],
        [w * 0.78, h * 0.9, w * 0.24, AMBER],
      ];
      for (const [x, y, r, color] of blobs) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, colorToCss(color, 0.8));
        g.addColorStop(0.65, colorToCss(color, 0.12));
        g.addColorStop(1, colorToCss(color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.restore();
    }

    // Warm/cool paper stains at the edges.
    ctx.save();
    const edge = ctx.createRadialGradient(
      w * 0.5,
      h * 0.48,
      h * 0.1,
      w * 0.5,
      h * 0.48,
      Math.max(w, h) * 0.72
    );
    edge.addColorStop(0, "rgba(255,255,255,0)");
    edge.addColorStop(0.72, "rgba(138,117,91,0.035)");
    edge.addColorStop(1, "rgba(96,74,55,0.1)");
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  drawSkyline(state) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const horizon = h * this.layout.horizon;

    // Hand-drawn sun / portal disc behind the vanishing point.
    const cx = w * 0.5;
    const sunY = horizon - h * 0.06;
    const sunR = h * 0.075;
    const sunColor = CYAN.clone().lerp(MAGENTA, 0.34 + Math.sin(this.time * 0.2) * 0.1);
    ctx.save();
    if (state.progress > 0.08) {
      ctx.globalAlpha = state.progress * 0.42;
      const glow = ctx.createRadialGradient(cx, sunY, 0, cx, sunY, sunR * 3.2);
      glow.addColorStop(0, colorToCss(sunColor, 0.7));
      glow.addColorStop(0.4, colorToCss(sunColor, 0.12));
      glow.addColorStop(1, colorToCss(sunColor, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(cx - sunR * 3.4, sunY - sunR * 3.4, sunR * 6.8, sunR * 6.8);
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, sunY, sunR, 0, Math.PI * 2);
    ctx.fillStyle =
      state.progress > 0.1
        ? colorToCss(sunColor, 0.18 + state.progress * 0.14)
        : "rgba(242,238,228,0.35)";
    ctx.fill();
    ctx.restore();
    this.roughStroke(
      Array.from({ length: 30 }, (_, i) => {
        const a = (i / 30) * Math.PI * 2;
        return [cx + Math.cos(a) * sunR, sunY + Math.sin(a) * sunR];
      }),
      { close: true, width: 1.5, passes: 2, jitter: 1.6, color: "rgba(15,15,16,0.58)" }
    );
    // Second orbit ring.
    this.roughStroke(
      Array.from({ length: 26 }, (_, i) => {
        const a = (i / 26) * Math.PI * 2;
        return [cx + Math.cos(a) * sunR * 1.42, sunY + Math.sin(a) * sunR * 1.16];
      }),
      { close: true, width: 0.7, passes: 1, jitter: 2.2, color: "rgba(15,15,16,0.22)" }
    );

    // Distant skyline silhouette in loose elevation.
    const rand = mulberry32(914);
    const buildings = [];
    let x = -10;
    while (x < w + 20) {
      const bw = 18 + rand() * 58;
      const bh = 14 + rand() * (h * 0.075);
      buildings.push({ x, w: bw, h: bh, hue: rand() });
      x += bw + 4 + rand() * 8;
    }

    for (const b of buildings) {
      const y = horizon - b.h;
      const color = CITY_COLORS[Math.floor(b.hue * CITY_COLORS.length)];
      const localP = clamp((state.progress - b.hue * 0.35) * 1.6, 0, 1);
      const fill = colorToCss(PAPER, 0.7 - localP * 0.28);
      this.roughPoly(
        [
          [b.x, horizon],
          [b.x, y],
          [b.x + b.w, y],
          [b.x + b.w, horizon],
        ],
        {
          fill: localP > 0.08 ? colorToCss(color, 0.16 * localP) : fill,
          stroke: "rgba(15,15,16,0.42)",
          width: 0.8,
          passes: 1,
          jitter: 0.8,
        }
      );
      // Sparse windows.
      ctx.save();
      ctx.globalAlpha = 0.16 + localP * 0.32;
      const rows = Math.max(1, Math.floor(b.h / 13));
      const cols = Math.max(1, Math.floor(b.w / 13));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rand() > 0.72) {
            ctx.fillStyle = localP > 0.2 ? colorToCss(color, 0.8) : "rgba(15,15,16,0.35)";
            ctx.fillRect(b.x + 4 + c * 12, y + 5 + r * 12, 3.4, 4.2);
          }
        }
      }
      ctx.restore();
    }

    // Horizon line is deliberately imperfect.
    this.roughStroke(
      Array.from({ length: 15 }, (_, i) => [
        (i / 14) * w,
        horizon + Math.sin(i * 1.7) * 0.8,
      ]),
      { width: 0.8, passes: 1, jitter: 0.9, color: "rgba(15,15,16,0.35)" }
    );
  }

  drawCity(state) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const horizon = h * this.layout.horizon;
    const layers = 8;
    const phase = (this.scroll / 1080) % 1;

    for (let layer = 0; layer < layers; layer++) {
      const q = (layer / layers + phase) % 1;
      const y = horizon + q * (h - horizon + 160) - 40;
      if (y < horizon - 20 || y > h + 80) continue;
      const p = clamp((y - horizon) / (h - horizon), 0.02, 1);
      const scale = 0.26 + p * 1.16;
      const half = this.halfAt(p);

      for (const side of [-1, 1]) {
        const rand = mulberry32(layer * 97 + (side > 0 ? 13 : 71) + 5);
        const bw = (130 + rand() * 150) * scale;
        const bh = (92 + rand() * 125) * scale;
        const gap = (8 + rand() * 18) * scale;
        const edge = w * 0.5 + side * (half + gap);
        const x = side < 0 ? edge - bw : edge;
        const by = y - bh * 0.5;
        const hue = rand();
        const localP = clamp((state.progress - hue * 0.38) * 2.4, 0, 1);
        const cityColor = CITY_COLORS[Math.floor(hue * CITY_COLORS.length)];

        // A wider, further-out block adds density behind the first rank.
        if (rand() > 0.48) {
          const bw2 = bw * (0.66 + rand() * 0.4);
          const bh2 = bh * (0.7 + rand() * 0.4);
          const x2 = side < 0 ? x - bw2 * 0.86 : x + bw * 0.92;
          const y2 = by + (rand() - 0.5) * 24 * scale;
          ctx.save();
          ctx.globalAlpha = 0.2 + p * 0.14;
          ctx.fillStyle = colorToCss(cityColor, 0.45 * localP);
          ctx.fillRect(x2, y2, bw2, bh2);
          ctx.restore();
          this.roughPoly(
            [
              [x2, y2],
              [x2 + bw2, y2],
              [x2 + bw2, y2 + bh2],
              [x2, y2 + bh2],
            ],
            {
              fill: "rgba(246,242,233,0.18)",
              stroke: "rgba(15,15,16,0.36)",
              width: 0.7 + scale * 0.8,
              passes: 1,
              jitter: 1.6,
              alpha: 0.65,
            }
          );
        }

        // Drop shadow cast toward the road.
        ctx.save();
        ctx.globalAlpha = 0.12 + p * 0.1;
        ctx.fillStyle = "#111";
        ctx.beginPath();
        ctx.ellipse(
          x + bw * 0.5 - side * bw * 0.12,
          by + bh * 0.58,
          bw * 0.54,
          bh * 0.25,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.restore();

        // Watercolour fill appears building by building.
        if (localP > 0.02) {
          ctx.save();
          ctx.globalAlpha = 0.18 + localP * 0.36;
          ctx.fillStyle = colorToCss(cityColor, 1);
          ctx.fillRect(x + 2, by + 2, bw - 4, bh - 4);
          ctx.restore();
          // Loose pigment bleed at the edge.
          ctx.save();
          ctx.globalAlpha = localP * 0.16;
          ctx.fillStyle = colorToCss(cityColor, 1);
          ctx.beginPath();
          ctx.ellipse(x + bw * 0.5, by + bh * 0.48, bw * 0.58, bh * 0.57, 0.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        this.roughPoly(
          [
            [x, by],
            [x + bw, by],
            [x + bw, by + bh],
            [x, by + bh],
          ],
          {
            fill: "rgba(244,240,231,0.42)",
            stroke: "rgba(15,15,16,0.84)",
            width: 1.6 + scale * 1.7,
            passes: 2,
            jitter: 1.2 + scale * 1.5,
            alpha: 0.84,
          }
        );

        // Inset floor plan.
        const inset = Math.max(4, 9 * scale);
        this.roughPoly(
          [
            [x + inset, by + inset],
            [x + bw * 0.63, by + inset * 1.15],
            [x + bw - inset * 1.1, by + bh * 0.4],
            [x + bw - inset, by + bh - inset],
            [x + inset * 1.15, by + bh - inset * 1.1],
          ],
          {
            fill: null,
            stroke: "rgba(15,15,16,0.22)",
            width: 0.7 + scale * 0.6,
            passes: 1,
            jitter: 1.2,
          }
        );

        // Rooftop hatch, vents and skylights.
        ctx.save();
        ctx.globalAlpha = 0.16 + p * 0.1;
        ctx.strokeStyle = "rgba(15,15,16,0.75)";
        ctx.lineWidth = 0.6 + scale * 0.25;
        const hatches = Math.floor(4 + 7 * p);
        for (let i = 0; i < hatches; i++) {
          const yy = by + inset * 1.6 + i * ((bh - inset * 3) / Math.max(1, hatches));
          ctx.beginPath();
          ctx.moveTo(x + bw * 0.14, yy);
          ctx.lineTo(x + bw * (0.25 + (i % 3) * 0.04), yy + bh * 0.045);
          ctx.stroke();
        }
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.32 + p * 0.28;
        ctx.strokeStyle = "rgba(15,15,16,0.8)";
        ctx.fillStyle = "rgba(242,238,228,0.5)";
        ctx.lineWidth = 0.8 + scale * 0.5;
        const machines = 2 + (layer % 2);
        for (let i = 0; i < machines; i++) {
          const vx = x + bw * (0.4 + i * 0.14);
          const vy = by + bh * (0.2 + i * 0.16);
          const vw = (7 + i * 4) * scale;
          const vh = (5 + i * 3) * scale;
          ctx.fillRect(vx, vy, vw, vh);
          ctx.strokeRect(vx, vy, vw, vh);
        }
        ctx.restore();

        if (localP > 0.32) {
          ctx.save();
          ctx.globalAlpha = (localP - 0.32) * 0.6;
          ctx.strokeStyle = colorToCss(cityColor, 0.9);
          ctx.lineWidth = 1.2 + scale;
          ctx.beginPath();
          ctx.moveTo(side < 0 ? x + bw : x, by + bh * 0.48);
          ctx.lineTo(side < 0 ? x + bw + 26 * scale : x - 26 * scale, by + bh * 0.48);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  drawRoad(state) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const horizon = h * this.layout.horizon;
    const bottom = h * 1.02;
    const topHalf = this.halfAt(0);
    const bottomHalf = this.halfAt(1);
    const progress = state.progress;

    // Road surface: paper grey in the sketch, near-black after colour.
    ctx.save();
    const roadGrad = ctx.createLinearGradient(0, horizon, 0, bottom);
    const topMono = "#e7e2d6";
    const bottomMono = "#f0ece2";
    roadGrad.addColorStop(0, topMono);
    roadGrad.addColorStop(0.55, bottomMono);
    roadGrad.addColorStop(1, "#e6e0d4");
    ctx.fillStyle = roadGrad;
    ctx.beginPath();
    ctx.moveTo(w * 0.5 - topHalf, horizon);
    ctx.lineTo(w * 0.5 + topHalf, horizon);
    ctx.lineTo(w * 0.5 + bottomHalf, bottom);
    ctx.lineTo(w * 0.5 - bottomHalf, bottom);
    ctx.closePath();
    ctx.fill();

    if (progress > 0.01) {
      const dark = ctx.createLinearGradient(0, horizon, 0, bottom);
      dark.addColorStop(0, colorToCss(new THREE.Color("#0a0912"), progress * 0.62));
      dark.addColorStop(0.5, colorToCss(new THREE.Color("#08080e"), progress * 0.9));
      dark.addColorStop(1, colorToCss(new THREE.Color("#0c0a11"), progress * 0.94));
      ctx.fillStyle = dark;
      ctx.fill();
    }
    ctx.restore();

    // Hatching across the sketch road.
    if (progress < 0.92) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(w * 0.5 - topHalf, horizon);
      ctx.lineTo(w * 0.5 + topHalf, horizon);
      ctx.lineTo(w * 0.5 + bottomHalf, bottom);
      ctx.lineTo(w * 0.5 - bottomHalf, bottom);
      ctx.closePath();
      ctx.clip();
      ctx.globalAlpha = (1 - progress) * 0.18;
      ctx.strokeStyle = "rgba(15,15,16,0.42)";
      ctx.lineWidth = 0.6;
      for (let i = 0; i < 50; i++) {
        const x = (i / 50) * w;
        ctx.beginPath();
        ctx.moveTo(x, horizon);
        ctx.lineTo(x - w * 0.18, bottom);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Coloured reflected light on wet asphalt.
    if (progress > 0.25) {
      ctx.save();
      ctx.globalAlpha = (progress - 0.25) * 0.34;
      ctx.globalCompositeOperation = "screen";
      const glow = ctx.createRadialGradient(
        w * 0.5,
        h * 0.82,
        0,
        w * 0.5,
        h * 0.82,
        w * 0.54
      );
      glow.addColorStop(0, colorToCss(CYAN, 0.5));
      glow.addColorStop(0.45, colorToCss(MAGENTA, 0.16));
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.moveTo(w * 0.5 - topHalf, horizon);
      ctx.lineTo(w * 0.5 + topHalf, horizon);
      ctx.lineTo(w * 0.5 + bottomHalf, bottom);
      ctx.lineTo(w * 0.5 - bottomHalf, bottom);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Road edges, curbs and lane markings.
    const edges = [];
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const p = i / 12;
        const y = lerp(horizon, bottom, p);
        const half = this.halfAt(p);
        pts.push([w * 0.5 + side * half, y]);
      }
      edges.push(pts);
      this.roughStroke(pts, {
        width: lerp(1.2, 3.2, progress),
        passes: 2,
        jitter: 1.1,
        color:
          progress > 0.3
            ? colorToCss(side < 0 ? CYAN : MAGENTA, 0.32 + progress * 0.6)
            : "rgba(15,15,16,0.72)",
      });
      this.roughStroke(pts, {
        width: 0.7,
        passes: 1,
        jitter: 2.4,
        color: "rgba(15,15,16,0.25)",
      });
    }

    // Lane dashes.
    const laneXs = [-4.05, 0, 4.05];
    for (const laneX of laneXs) {
      for (let z = this.layout.farZ; z < 10; z += 7.2) {
        const a = this.layoutForZ(z);
        const b = this.layoutForZ(z + 3.8);
        if (b.y < horizon + 1) continue;
        const xa = w * 0.5 + (laneX / 8.4) * a.half;
        const xb = w * 0.5 + (laneX / 8.4) * b.half;
        ctx.save();
        if (progress > 0.2) {
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = colorToCss(
            laneX === 0 ? CYAN : laneX < 0 ? CYAN : MAGENTA,
            0.22 + progress * 0.58
          );
          ctx.shadowColor = colorToCss(laneX < 0 ? CYAN : MAGENTA, 0.7);
          ctx.shadowBlur = 3 + progress * 8;
          ctx.lineWidth = 1.2 + progress * 2.6;
        } else {
          ctx.strokeStyle = "rgba(15,15,16,0.44)";
          ctx.lineWidth = 1.2;
        }
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(xa, a.y);
        ctx.lineTo(xb, b.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Curb ticks.
    for (const side of [-1, 1]) {
      for (let z = this.layout.farZ; z < 12; z += 6) {
        const a = this.layoutForZ(z);
        if (a.p < 0.05) continue;
        const x = w * 0.5 + side * (a.half + 2);
        const len = 2 + a.p * 14;
        ctx.save();
        ctx.globalAlpha = 0.22 + a.p * 0.38;
        ctx.strokeStyle = progress > 0.2 ? colorToCss(side < 0 ? CYAN : MAGENTA, 0.7) : "rgba(15,15,16,0.5)";
        ctx.lineWidth = 0.8 + a.p * 1.2;
        ctx.beginPath();
        ctx.moveTo(x, a.y);
        ctx.lineTo(x + side * len, a.y + len * 0.16);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Central vanishing scribble.
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "rgba(15,15,16,0.6)";
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(w * 0.5 - 70 + i * 13, horizon + 2);
      ctx.lineTo(w * 0.5 - 25 + i * 6, horizon + 9);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSpeedLines(state) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const speedNorm = clamp((state.speed - 35) / 105, 0, 1);
    if (speedNorm <= 0.02) return;
    const progress = state.progress;
    const rand = mulberry32(83 + Math.floor(this.time * 6));
    ctx.save();
    ctx.globalCompositeOperation = progress > 0.2 ? "lighter" : "source-over";
    for (let i = 0; i < 26; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = w * 0.5 + side * (this.halfAt(0.2 + rand() * 0.8) + 20 + rand() * w * 0.3);
      const y = h * 0.3 + rand() * h * 0.7;
      const len = (20 + rand() * 110) * (0.4 + speedNorm);
      ctx.globalAlpha = (0.08 + rand() * 0.24) * (0.4 + speedNorm);
      ctx.strokeStyle =
        progress > 0.2
          ? colorToCss(i % 3 === 0 ? MAGENTA : CYAN, 0.9)
          : "rgba(15,15,16,0.8)";
      ctx.lineWidth = 0.7 + rand() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawItems(state) {
    const ctx = this.ctx;
    const items = state.items || [];
    for (const item of items) {
      if (!item.active) continue;
      if (item.z < this.layout.farZ - 8 || item.z > 16) continue;
      const p = this.screenPoint(item.x, item.z);
      if (!p) continue;
      const size = (9 + p.p * 19) * (item.type === "shard" ? 1.28 : 1);
      const bob = Math.sin(this.time * 3.2 + item.phase) * 2.4 * p.scale;
      const y = p.y + bob;
      const color = item.color;

      // Trailing pencil lines.
      ctx.save();
      ctx.globalAlpha = 0.18 + p.p * 0.32;
      ctx.strokeStyle = colorToCss(color, 0.7);
      ctx.lineWidth = 0.8 + p.p * 1.1;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(p.x - size * 0.3, y + size * (0.8 + i * 0.8));
        ctx.lineTo(p.x - size * 0.1, y + size * (1.6 + i * 0.8));
        ctx.stroke();
      }
      ctx.restore();

      if (item.type === "shard") {
        ctx.save();
        ctx.translate(p.x, y);
        ctx.rotate(this.time * 0.8 + item.phase);
        ctx.shadowColor = colorToCss(color, 0.9);
        ctx.shadowBlur = 10 + p.p * 24;
        const pts = [
          [0, -size * 1.25],
          [size * 0.7, 0],
          [0, size * 1.15],
          [-size * 0.58, 0],
        ];
        this.roughPoly(pts, {
          fill: colorToCss(color, 0.7),
          stroke: "rgba(15,15,16,0.9)",
          width: 1.2 + p.p * 1.2,
          passes: 2,
          jitter: 0.9,
        });
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.65);
        ctx.lineTo(size * 0.24, 0);
        ctx.strokeStyle = "rgba(255,255,255,0.84)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      } else {
        // Orb glow.
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const glow = ctx.createRadialGradient(p.x, y, 0, p.x, y, size * 2.6);
        glow.addColorStop(0, colorToCss(color, 0.55));
        glow.addColorStop(0.4, colorToCss(color, 0.16));
        glow.addColorStop(1, colorToCss(color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(p.x - size * 2.8, y - size * 2.8, size * 5.6, size * 5.6);
        ctx.restore();

        ctx.save();
        const orbGrad = ctx.createRadialGradient(
          p.x - size * 0.28,
          y - size * 0.32,
          size * 0.05,
          p.x,
          y,
          size
        );
        orbGrad.addColorStop(0, "rgba(255,255,255,0.95)");
        orbGrad.addColorStop(0.32, colorToCss(color, 0.96));
        orbGrad.addColorStop(1, colorToCss(color.clone().multiplyScalar(0.62), 0.9));
        ctx.fillStyle = orbGrad;
        ctx.shadowColor = colorToCss(color, 0.8);
        ctx.shadowBlur = 8 + p.p * 18;
        ctx.beginPath();
        ctx.arc(p.x, y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        this.roughStroke(
          Array.from({ length: 14 }, (_, i) => {
            const a = (i / 14) * Math.PI * 2;
            return [p.x + Math.cos(a) * size, y + Math.sin(a) * size];
          }),
          {
            close: true,
            color: "rgba(15,15,16,0.72)",
            width: 1 + p.p,
            passes: 1,
            jitter: 1.1,
          }
        );

        // Orbit ring.
        ctx.save();
        ctx.translate(p.x, y);
        ctx.rotate(-0.35 + Math.sin(this.time * 1.2 + item.phase) * 0.25);
        ctx.strokeStyle = colorToCss(color, 0.7);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 1.55, size * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawSplashes() {
    const ctx = this.ctx;
    this.splashes = this.splashes.filter((s) => s.life > 0);
    for (const s of this.splashes) {
      const t = s.life / s.maxLife;
      const age = 1 - t;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot + age * 0.5);
      ctx.globalAlpha = Math.min(1, t * 1.8) * 0.9;
      ctx.fillStyle = colorToCss(s.color, 0.74);
      const r = 8 + age * 24;
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const rr = r * (0.6 + ((i * 37) % 11) / 18);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr * 0.8;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      for (const d of s.droplets) {
        const dist = age * 1.7;
        ctx.beginPath();
        ctx.arc(d.dx * dist, d.dy * dist, d.r * (1 - age * 0.55), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawCar(state) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const p = this.screenPoint(state.x, 0.55);
    const carY = this.height * 0.825;
    const carP = clamp((carY - h * this.layout.horizon) / (h - h * this.layout.horizon), 0, 1);
    const carHalf = this.halfAt(carP);
    const carX = w * 0.5 + (state.x / 8.4) * carHalf;
    const s = clamp(this.width / 1500, 0.8, 1.4) * 96;
    const progress = state.progress;
    const steer = state.steer || 0;

    // Ground shadow.
    ctx.save();
    ctx.globalAlpha = 0.15 + progress * 0.1;
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.ellipse(carX, carY + s * 0.38, s * 1.05, s * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(carX, carY);
    ctx.rotate(steer * 0.045 + Math.sin(this.time * 4.1) * 0.004);
    ctx.translate(0, Math.sin(this.time * 7.4) * 1.2);

    // Body local points: nose at -1.55s, rear at +1.28s.
    const body = [
      [0, -1.62 * s],
      [0.24 * s, -1.5 * s],
      [0.47 * s, -1.16 * s],
      [0.57 * s, -0.55 * s],
      [0.61 * s, 0.28 * s],
      [0.58 * s, 0.86 * s],
      [0.45 * s, 1.16 * s],
      [0.24 * s, 1.27 * s],
      [0, 1.3 * s],
      [-0.24 * s, 1.27 * s],
      [-0.45 * s, 1.16 * s],
      [-0.58 * s, 0.86 * s],
      [-0.61 * s, 0.28 * s],
      [-0.57 * s, -0.55 * s],
      [-0.47 * s, -1.16 * s],
      [-0.24 * s, -1.5 * s],
    ];

    // Base body: unfinished paper.
    const bodyBase = "#f7f4eb";
    this.roughPoly(body, {
      fill: bodyBase,
      stroke: "rgba(15,15,16,0.9)",
      width: 2.2,
      passes: 2,
      jitter: 1.2,
    });

    // Partial colour fill rising from the rear of the car.
    if (progress > 0.015) {
      const fillFront = 1.34 * s - progress * (1.34 + 1.66) * s;
      ctx.save();
      ctx.beginPath();
      ctx.rect(-s * 0.9, fillFront, s * 1.8, 1.34 * s - fillFront + s * 0.3);
      ctx.clip();
      const carGrad = ctx.createLinearGradient(-s * 0.4, -s, s * 0.5, s * 1.3);
      carGrad.addColorStop(0, colorToCss(CAR_TARGET.clone().offsetHSL(-0.02, 0.05, 0.08), 1));
      carGrad.addColorStop(0.5, colorToCss(CAR_TARGET, 1));
      carGrad.addColorStop(1, colorToCss(CAR_TARGET.clone().offsetHSL(0.02, 0.1, -0.12), 1));
      ctx.fillStyle = carGrad;
      ctx.beginPath();
      for (let i = 0; i < body.length; i++) {
        const pt = body[i];
        if (i === 0) ctx.moveTo(pt[0], pt[1]);
        else ctx.lineTo(pt[0], pt[1]);
      }
      ctx.closePath();
      ctx.fill();

      // Liquid metal highlights.
      ctx.globalAlpha = progress * 0.55;
      ctx.strokeStyle = "rgba(255,241,220,0.8)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-s * 0.42, fillFront + s * 0.1);
      ctx.quadraticCurveTo(-s * 0.1, fillFront - s * 0.12, s * 0.34, fillFront + s * 0.3);
      ctx.stroke();
      ctx.restore();

      // Re-assert the ink contour over the colour.
      this.roughStroke(body, {
        close: true,
        color: "rgba(15,15,16,0.9)",
        width: 2.2,
        passes: 2,
        jitter: 1.2,
      });

      // Glowing fill boundary.
      if (progress < 0.985) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.strokeStyle = colorToCss(CYAN, 0.9);
        ctx.shadowColor = colorToCss(CYAN, 0.8);
        ctx.shadowBlur = 12;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-s * 0.58, fillFront);
        ctx.quadraticCurveTo(0, fillFront + s * 0.12, s * 0.58, fillFront);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Rear wing.
    this.roughPoly(
      [
        [-0.68 * s, 0.98 * s],
        [0.68 * s, 0.94 * s],
        [0.7 * s, 1.12 * s],
        [-0.66 * s, 1.18 * s],
      ],
      {
        fill: progress > 0.2 ? "rgba(20,18,18,0.92)" : "rgba(42,40,44,0.42)",
        stroke: "rgba(15,15,16,0.9)",
        width: 1.5,
        passes: 2,
        jitter: 0.8,
      }
    );
    // Wing accent.
    if (progress > 0.3) {
      ctx.save();
      ctx.strokeStyle = colorToCss(MAGENTA, 0.82 * progress);
      ctx.shadowColor = colorToCss(MAGENTA, 0.6);
      ctx.shadowBlur = 9;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-0.5 * s, 1.03 * s);
      ctx.lineTo(0.54 * s, 0.99 * s);
      ctx.stroke();
      ctx.restore();
    }

    // Wheels / tyres, drawn as four black scribbled blocks.
    for (const [wx, wy] of [
      [-0.58, -0.78],
      [0.58, -0.78],
      [-0.62, 0.7],
      [0.62, 0.7],
    ]) {
      ctx.save();
      ctx.translate(wx * s, wy * s);
      ctx.rotate((wx > 0 ? 1 : -1) * 0.1);
      this.roughPoly(
        [
          [-0.19 * s, -0.3 * s],
          [0.19 * s, -0.32 * s],
          [0.21 * s, 0.3 * s],
          [-0.17 * s, 0.32 * s],
        ],
        {
          fill: "rgba(10,10,11,0.94)",
          stroke: "rgba(10,10,11,0.96)",
          width: 1.3,
          passes: 2,
          jitter: 0.7,
        }
      );
      ctx.strokeStyle = "rgba(244,241,232,0.58)";
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 4; i++) {
        const yy = (-0.2 + i * 0.13) * s + Math.sin(this.time * 9 + i + wx) * 1.4;
        ctx.beginPath();
        ctx.moveTo(-0.13 * s, yy);
        ctx.lineTo(0.13 * s, yy);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Canopy / cockpit.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, -0.9 * s);
    ctx.lineTo(0.29 * s, -0.51 * s);
    ctx.lineTo(0.32 * s, 0.08 * s);
    ctx.lineTo(0.24 * s, 0.42 * s);
    ctx.lineTo(0, 0.5 * s);
    ctx.lineTo(-0.24 * s, 0.42 * s);
    ctx.lineTo(-0.32 * s, 0.08 * s);
    ctx.lineTo(-0.29 * s, -0.51 * s);
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = "rgba(242,238,228,0.8)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(-0.35 * s + i * 0.09 * s, -0.95 * s);
      ctx.lineTo(0.1 * s + i * 0.06 * s, 0.55 * s);
      ctx.stroke();
    }
    ctx.restore();

    this.roughPoly(
      [
        [0, -0.9 * s],
        [0.29 * s, -0.51 * s],
        [0.32 * s, 0.08 * s],
        [0.24 * s, 0.42 * s],
        [0, 0.5 * s],
        [-0.24 * s, 0.42 * s],
        [-0.32 * s, 0.08 * s],
        [-0.29 * s, -0.51 * s],
      ],
      {
        fill: progress > 0.6 ? "rgba(8,8,13,0.94)" : "rgba(30,29,34,0.5)",
        stroke: "rgba(15,15,16,0.82)",
        width: 1.2,
        passes: 2,
        jitter: 0.7,
      }
    );

    // Helmet / seat read.
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = progress > 0.6 ? "rgba(255,255,255,0.16)" : "rgba(242,238,228,0.32)";
    ctx.beginPath();
    ctx.ellipse(0, 0.08 * s, 0.14 * s, 0.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Windshield highlight.
    ctx.save();
    ctx.globalAlpha = 0.24 + progress * 0.2;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-0.18 * s, -0.52 * s);
    ctx.lineTo(0.16 * s, -0.38 * s);
    ctx.stroke();
    ctx.restore();

    // Hood centre line and the "07" mark.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "rgba(15,15,16,0.62)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -1.42 * s);
    ctx.lineTo(0, -0.98 * s);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = progress > 0.55 ? "rgba(255,244,225,0.94)" : "rgba(242,238,228,0.62)";
    ctx.font = `italic 700 ${Math.round(s * 0.28)}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("07", 0, -0.74 * s);
    ctx.restore();

    // Hood vents and fender seams.
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = "rgba(15,15,16,0.48)";
    ctx.lineWidth = 0.8;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 0.09 * s, -1.32 * s);
      ctx.quadraticCurveTo(side * 0.2 * s, -0.9 * s, side * 0.36 * s, -0.62 * s);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(side * 0.32 * s, (-0.1 + i * 0.15) * s);
        ctx.lineTo(side * 0.45 * s, (-0.16 + i * 0.15) * s);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Headlight slits.
    for (const side of [-1, 1]) {
      ctx.save();
      if (progress > 0.25) {
        ctx.globalCompositeOperation = "lighter";
        ctx.shadowColor = colorToCss(CYAN, 0.9);
        ctx.shadowBlur = 8;
      }
      ctx.strokeStyle = progress > 0.25 ? colorToCss(CYAN, 0.9) : "rgba(15,15,16,0.7)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(side * 0.13 * s, -1.45 * s);
      ctx.lineTo(side * 0.4 * s, -1.3 * s);
      ctx.stroke();
      ctx.restore();
    }

    // Tail light and exhaust heat.
    ctx.save();
    if (progress > 0.2) {
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = colorToCss(MAGENTA, 0.9);
      ctx.shadowBlur = 14;
      ctx.strokeStyle = colorToCss(MAGENTA, 0.92);
      ctx.lineWidth = 2.2;
    } else {
      ctx.strokeStyle = "rgba(15,15,16,0.65)";
      ctx.lineWidth = 1.4;
    }
    ctx.beginPath();
    ctx.moveTo(-0.34 * s, 1.2 * s);
    ctx.lineTo(0.34 * s, 1.2 * s);
    ctx.stroke();
    ctx.restore();

    // Front splitter and mirrors give the top-down car a clearer silhouette.
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "rgba(15,15,16,0.78)";
    ctx.beginPath();
    ctx.ellipse(0, -1.56 * s, 0.62 * s, 0.07 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 0.58 * s, -0.36 * s, 0.09 * s, 0.18 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Side livery accents.
    if (progress > 0.5) {
      ctx.save();
      ctx.globalAlpha = (progress - 0.5) * 1.6;
      ctx.strokeStyle = colorToCss(CYAN, 0.82);
      ctx.lineWidth = 1.1;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 0.47 * s, -0.76 * s);
        ctx.quadraticCurveTo(side * 0.56 * s, 0.18 * s, side * 0.42 * s, 0.88 * s);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Speed vibration strokes behind the car.
    ctx.save();
    ctx.globalAlpha = 0.2 + clamp((state.speed - 30) / 100, 0, 1) * 0.35;
    ctx.strokeStyle = progress > 0.5 ? colorToCss(CYAN, 0.7) : "rgba(15,15,16,0.6)";
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 6; i++) {
      const sx = (i - 2.5) * s * 0.24;
      ctx.beginPath();
      ctx.moveTo(sx, 1.34 * s + i * 3.5);
      ctx.lineTo(sx * 1.18, 1.34 * s + 10 + i * 5);
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
  }

  drawPaperGrain(state) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = this.grainPattern;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.16 + state.progress * 0.03;
    ctx.fillStyle = this.hatchPattern;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Rough paper edge / vignette.
    ctx.save();
    const edge = ctx.createRadialGradient(
      w * 0.5,
      h * 0.5,
      Math.min(w, h) * 0.36,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.78
    );
    edge.addColorStop(0, "rgba(0,0,0,0)");
    edge.addColorStop(0.76, "rgba(40,31,20,0.05)");
    edge.addColorStop(1, "rgba(27,19,12,0.26)");
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  drawFrame(state) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const ink = "rgba(15,15,16,0.5)";

    ctx.save();
    ctx.strokeStyle = "rgba(15,15,16,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(18, 18, w - 36, h - 36);

    const len = 24;
    ctx.strokeStyle = "rgba(15,15,16,0.5)";
    ctx.lineWidth = 1.2;
    const corners = [
      [18, 18, 1, 1],
      [w - 18, 18, -1, 1],
      [18, h - 18, 1, -1],
      [w - 18, h - 18, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * len);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * len, y);
      ctx.stroke();
    }

    ctx.fillStyle = ink;
    ctx.font = "500 8px 'Space Grotesk', Helvetica, sans-serif";
    if (w > 900) {
      ctx.textAlign = "left";
      ctx.fillText("PAPER / 200 G/M²", 32, h - 32);
      ctx.textAlign = "right";
      ctx.fillText(
        `FOLD ${String(Math.round(state.progress * 100)).padStart(2, "0")} / 100`,
        w - 32,
        h - 32
      );

      ctx.save();
      ctx.translate(w - 34, h * 0.5);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(15,15,16,0.28)";
      ctx.font = "500 7px 'Space Grotesk', Helvetica, sans-serif";
      ctx.fillText("DRAWING IS A KIND OF MEMORY", 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }

  update(dt) {
    for (const s of this.splashes) s.life -= dt;
  }
}
