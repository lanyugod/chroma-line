import { clamp, mulberry32 } from "./utils.js";

/**
 * The line-reassembly overlay that fires when the world folds between
 * dimensions. It is deliberately hand-drawn: no clean vector grids, only
 * ink lines looking for their new coordinates.
 */
export class RitualFX {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.life = 0;
    this.duration = 1.0;
    this.to2d = true;
    this.progress = 0;
    this.resize();
  }

  resize() {
    this.width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    this.height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
  }

  start(to2d, progress) {
    this.to2d = to2d;
    this.progress = progress;
    this.life = this.duration;
    this.canvas.style.opacity = "1";
  }

  update(dt) {
    if (this.life <= 0) {
      if (this.canvas.style.opacity !== "0") this.canvas.style.opacity = "0";
      return;
    }
    this.life = Math.max(0, this.life - dt);
    this.draw();
    if (this.life <= 0) this.canvas.style.opacity = "0";
  }

  draw() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const p = clamp(1 - this.life / this.duration, 0, 1);
    const env = Math.sin(p * Math.PI);
    const t = p;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const maxDim = Math.hypot(w, h) * 0.56;
    const rand = mulberry32(1337 + Math.floor(this.progress * 7));

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = env;

    const bright = this.progress > 0.38;
    const accentA = bright ? "rgba(94,244,255,0.85)" : "rgba(10,10,12,0.58)";
    const accentB = bright ? "rgba(255,60,180,0.8)" : "rgba(10,10,12,0.4)";

    // Lines fly in from the edges and re-register around the fold axis.
    const count = 74;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.14 + p * 0.3;
      const phase = rand();
      const outer = maxDim * (0.35 + phase * 0.72) * (this.to2d ? 1 - t * 0.72 : 0.25 + t * 0.9);
      const inner = outer - maxDim * (0.03 + rand() * 0.22) * (0.5 + env);
      const ax = cx + Math.cos(angle) * inner;
      const ay = cy + Math.sin(angle) * inner;
      const bx = cx + Math.cos(angle) * outer;
      const by = cy + Math.sin(angle) * outer;
      ctx.strokeStyle = i % 7 === 0 ? accentB : i % 5 === 0 ? accentA : bright ? "rgba(240,244,255,0.34)" : "rgba(10,10,12,0.3)";
      ctx.lineWidth = i % 9 === 0 ? 1.8 : 0.8;
      ctx.beginPath();
      const mx = (ax + bx) / 2 + Math.sin(i * 2.1 + p * 9) * 7;
      const my = (ay + by) / 2 + Math.cos(i * 1.7 + p * 8) * 7;
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx, my, bx, by);
      ctx.stroke();
    }

    // Re-composing rings: hand-drawn polygons collapsing to the centre.
    for (let ring = 0; ring < 6; ring++) {
      const rp = clamp(t + ring * 0.04, 0, 1);
      const radius = maxDim * (1.0 - rp) * (0.22 + ring * 0.12);
      if (radius < 8) continue;
      ctx.strokeStyle = ring % 2 === 0 ? accentA : accentB;
      ctx.lineWidth = ring % 2 === 0 ? 1.4 : 0.8;
      ctx.globalAlpha = env * (0.65 - ring * 0.07);
      ctx.beginPath();
      const sides = 10 + ring * 2;
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2 + ring * 0.2 + p * 0.6;
        const jitter = 1 + (rand() - 0.5) * 0.04;
        const x = cx + Math.cos(a) * radius * jitter;
        const y = cy + Math.sin(a) * radius * 0.78 * jitter;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = env;

    // A folding paper crease / axis.
    const crease = Math.sin(p * Math.PI) * 0.5;
    ctx.strokeStyle = bright ? "rgba(255,255,255,0.42)" : "rgba(10,10,12,0.32)";
    ctx.lineWidth = 1;
    ctx.setLineDash([7, 13]);
    ctx.beginPath();
    ctx.moveTo(cx - crease * w * 0.28, 0);
    ctx.lineTo(cx + crease * w * 0.06, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Registration ticks.
    ctx.font = "500 8px 'Space Grotesk', Helvetica, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = bright ? "rgba(240,246,255,0.7)" : "rgba(10,10,12,0.6)";
    ctx.fillText(
      this.to2d ? "FOLDING GEOMETRY / 02" : "RECONSTRUCTING PERSPECTIVE / 01",
      cx,
      h * 0.5 + Math.min(w, h) * 0.26
    );

    ctx.restore();
  }
}
