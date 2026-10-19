import { clamp } from "./utils.js";

/**
 * Tiny procedural soundscape. No audio files: the engine, wind, collect
 * chimes and the 2D/3D whoosh are all synthesised in the browser.
 */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineGain = null;
    this.engineOscA = null;
    this.engineOscB = null;
    this.engineFilter = null;
    this.windGain = null;
    this.windFilter = null;
    this.muted = false;
    this.started = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.7;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 4;
    comp.attack.value = 0.008;
    comp.release.value = 0.24;

    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.noiseBuffer = this.createNoise(2.4);

    // Engine layer -----------------------------------------------------
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0001;

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 480;
    this.engineFilter.Q.value = 3.4;

    this.engineOscA = ctx.createOscillator();
    this.engineOscA.type = "sawtooth";
    this.engineOscA.frequency.value = 42;

    this.engineOscB = ctx.createOscillator();
    this.engineOscB.type = "triangle";
    this.engineOscB.frequency.value = 84;

    const oscAGain = ctx.createGain();
    oscAGain.gain.value = 0.28;
    const oscBGain = ctx.createGain();
    oscBGain.gain.value = 0.18;

    this.engineOscA.connect(oscAGain).connect(this.engineFilter);
    this.engineOscB.connect(oscBGain).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);

    // Wind / tyre layer -------------------------------------------------
    this.windSource = ctx.createBufferSource();
    this.windSource.buffer = this.noiseBuffer;
    this.windSource.loop = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 1100;
    this.windFilter.Q.value = 0.42;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0001;

    this.windSource.connect(this.windFilter).connect(this.windGain).connect(this.master);

    // Slow, almost subliminal pad --------------------------------------
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.016;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 620;
    this.padFilter.Q.value = 1.2;
    this.padGain.connect(this.padFilter).connect(this.master);

    [110, 164.81, 220, 329.63].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = freq;
      osc.detune.value = (i - 1.5) * 7;
      const gain = ctx.createGain();
      gain.gain.value = i === 0 ? 0.45 : 0.15;
      osc.connect(gain).connect(this.padGain);
      osc.start();
    });

    this.engineOscA.start();
    this.engineOscB.start();
    this.windSource.start();

    this.applyMute();
  }

  createNoise(seconds) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = 0.985 * last + 0.015 * white;
      data[i] = white * 0.7 + last * 2.2;
    }
    return buffer;
  }

  start() {
    this.init();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.started = true;
    const now = this.ctx.currentTime;
    this.engineGain.gain.cancelScheduledValues(now);
    this.engineGain.gain.setTargetAtTime(0.09, now, 0.7);
    this.windGain.gain.setTargetAtTime(0.018, now, 0.9);
  }

  setSpeed(speed, boosting) {
    if (!this.ctx || !this.started) return;
    const now = this.ctx.currentTime;
    const norm = clamp((speed - 40) / 100, 0, 1);
    const freq = 38 + speed * 0.36 + (boosting ? 18 : 0);
    this.engineOscA.frequency.setTargetAtTime(freq, now, 0.07);
    this.engineOscB.frequency.setTargetAtTime(freq * 2.02, now, 0.07);
    this.engineFilter.frequency.setTargetAtTime(
      390 + speed * 7.2 + (boosting ? 750 : 0),
      now,
      0.12
    );
    this.windGain.gain.setTargetAtTime(0.01 + norm * 0.05 + (boosting ? 0.03 : 0), now, 0.18);
    this.windFilter.frequency.setTargetAtTime(
      780 + speed * 6 + (boosting ? 1300 : 0),
      now,
      0.22
    );
    this.padFilter.frequency.setTargetAtTime(560 + norm * 1400, now, 0.6);
  }

  setMenu() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0.025, now, 0.6);
    this.windGain.gain.setTargetAtTime(0.002, now, 0.6);
  }

  collect(combo = 1, pan = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];
    const idx = Math.min(scale.length - 1, Math.floor((combo - 1) * 0.6));
    const pitch = scale[idx];

    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1) * 0.65;
    panner.connect(this.master);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 1.5, now + 0.06);

    const osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(pitch * 2.01, now);
    osc2.frequency.exponentialRampToValueAtTime(pitch * 3.02, now + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.13, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.0001, now);
    gain2.gain.exponentialRampToValueAtTime(0.045, now + 0.014);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

    osc.connect(gain).connect(panner);
    osc2.connect(gain2).connect(panner);
    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.55);
    osc2.stop(now + 0.32);

    // A tiny ink-like noise tick.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const nf = ctx.createBiquadFilter();
    nf.type = "highpass";
    nf.frequency.value = 3400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.exponentialRampToValueAtTime(0.028, now + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    noise.connect(nf).connect(ng).connect(panner);
    noise.start(now);
    noise.stop(now + 0.11);
  }

  fold(to2d = true) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.6;
    filter.frequency.setValueAtTime(to2d ? 2200 : 280, now);
    filter.frequency.exponentialRampToValueAtTime(to2d ? 180 : 3200, now + 0.55);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);

    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.76);

    const bass = ctx.createOscillator();
    bass.type = "sine";
    bass.frequency.setValueAtTime(to2d ? 150 : 62, now);
    bass.frequency.exponentialRampToValueAtTime(to2d ? 44 : 136, now + 0.5);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, now);
    bg.gain.exponentialRampToValueAtTime(0.16, now + 0.04);
    bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
    bass.connect(bg).connect(this.master);
    bass.start(now);
    bass.stop(now + 0.6);
  }

  complete() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [261.63, 329.63, 392, 523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i > 2 ? "sine" : "triangle";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const start = now + i * 0.09;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.055, start + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 2.8);
      osc.connect(g).connect(this.master);
      osc.start(start);
      osc.stop(start + 3);
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    this.applyMute();
    return this.muted;
  }

  applyMute() {
    if (!this.master || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted ? 0.0001 : 0.7, now, 0.06);
  }
}
