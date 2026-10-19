import * as THREE from "three";
import { World } from "./world.js";
import { Car } from "./car.js";
import { CollectibleField } from "./collectibles.js";
import { PostFX } from "./post.js";
import { Ink2D } from "./ink2d.js";
import { SoundEngine } from "./audio.js";
import { RitualFX } from "./ritual.js";
import {
  clamp,
  damp,
  lerp,
  smoothstep,
  easeOutCubic,
  colorToCss,
  formatNumber,
  formatTime,
} from "./utils.js";

const INK_UI = new THREE.Color("#111110");
const PAPER_UI = new THREE.Color("#f4f1e9");
const DARK_BG = new THREE.Color("#090713");
const PAPER_BG = new THREE.Color("#f1eee6");

const SPEED_BASE = 70;
const SPEED_BOOST = 126;

export class Game {
  constructor() {
    this.canvas3D = document.querySelector("#scene3d");
    this.canvas2D = document.querySelector("#scene2d");
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas3D,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0xf1eee6, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.7);
    this.renderer.setPixelRatio(this.pixelRatio);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 700);
    this.camera.position.set(5.2, 2.5, 6.4);

    this.clock = new THREE.Clock();
    this.time = 0;
    this.dt = 0;
    this.menuTime = 0;
    this.paused = false;
    this.mode2d = false;
    this.toggleTimer = 99;
    this.completeTimer = 0;
    this.completeShown = false;
    this.leapActive = false;
    this.leapT = 1;
    this.shake = 0;
    this.cameraWhip = 0;
    this.audioTimer = 0;
    this.announceTimeout = null;
    this.toastTimeout = null;
    this.started = false;
    this.mutedLabel = false;

    this.state = {
      phase: "menu",
      time: 0,
      progress: 0,
      targetProgress: 0,
      speed: 26,
      speedNorm: 0,
      boosting: false,
      boost: 1,
      steer: 0,
      x: 0,
      fragments: 0,
      combo: 1,
      maxCombo: 1,
      comboTimer: 0,
      distance: 0,
      elapsed: 0,
      cameraMix: 0,
      shock: 0,
      flash: 0,
      aberration: 0,
      flashColor: new THREE.Color("#ffffff"),
      paper: 1,
    };

    this.keys = {
      left: false,
      right: false,
      boost: false,
    };

    this.world = new World(this.scene, this.renderer);
    this.car = new Car(this.scene);
    this.collectibles = new CollectibleField(this.scene, (item, color) =>
      this.handleCollect(item, color)
    );
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    this.ink2d = new Ink2D(this.canvas2D);
    this.ritual = new RitualFX(document.querySelector("#fx-ritual"));
    this.sound = new SoundEngine();

    this.cameraPos = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3();
    this.menuPos = new THREE.Vector3();
    this.menuTarget = new THREE.Vector3();
    this.chasePos = new THREE.Vector3();
    this.chaseTarget = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();

    this.cacheUI();
    this.buildSpeedBars();
    this.bindEvents();
    this.resize();

    this.updateCamera(0.016, true);
    this.render();

    setTimeout(() => {
      document.querySelector("#boot")?.classList.add("is-done");
    }, 800);

    this.clock.start();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  cacheUI() {
    const $ = (id) => document.getElementById(id);
    this.ui = {
      progress: $("progress-value"),
      progressFill: $("progress-fill"),
      progressMarker: $("progress-marker"),
      caption: $("progress-caption"),
      speed: $("speed-value"),
      boostFill: $("boost-fill"),
      bars: $("speed-bars"),
      fragments: $("fragment-count"),
      combo: $("combo-value"),
      distance: $("distance-value"),
      modeLabel: $("mode-label"),
      soundLabel: $("sound-label"),
      startScreen: $("start-screen"),
      completeScreen: $("complete-screen"),
      finalFragments: $("final-fragments"),
      finalCombo: $("final-combo"),
      finalTime: $("final-time"),
      finalDistance: $("final-distance"),
      announce: $("mode-announce"),
      announceIndex: $("announce-index"),
      announceTitle: $("announce-title"),
      announceSub: $("announce-sub"),
      toast: $("collect-toast"),
      toastKicker: $("toast-kicker"),
      toastValue: $("toast-value"),
      flash: $("fx-flash"),
      modeToggle: $("mode-toggle"),
      soundToggle: $("sound-toggle"),
      startButton: $("start-button"),
      restartButton: $("restart-button"),
      touchLeft: $("touch-left"),
      touchRight: $("touch-right"),
      touchBoost: $("touch-boost"),
    };
    this.speedBarEls = [];
  }

  buildSpeedBars() {
    for (let i = 0; i < 24; i++) {
      const bar = document.createElement("i");
      bar.style.height = `${18 + ((i * 37) % 42)}%`;
      this.ui.bars.appendChild(bar);
      this.speedBarEls.push(bar);
    }
  }

  bindEvents() {
    this.ui.startButton.addEventListener("click", () => this.startGame());
    this.ui.restartButton.addEventListener("click", () => this.restart());
    this.ui.modeToggle.addEventListener("click", () => this.toggleMode());
    this.ui.soundToggle.addEventListener("click", () => this.toggleSound());

    const hold = (el, prop) => {
      const on = (e) => {
        e.preventDefault();
        this.keys[prop] = true;
        el.classList.add("is-held");
      };
      const off = (e) => {
        e.preventDefault();
        this.keys[prop] = false;
        el.classList.remove("is-held");
      };
      el.addEventListener("pointerdown", on);
      el.addEventListener("pointerup", off);
      el.addEventListener("pointercancel", off);
      el.addEventListener("pointerleave", off);
    };
    hold(this.ui.touchLeft, "left");
    hold(this.ui.touchRight, "right");
    hold(this.ui.touchBoost, "boost");

    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    window.addEventListener("keyup", (e) => this.onKeyUp(e));
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("blur", () => {
      this.keys.left = false;
      this.keys.right = false;
      this.keys.boost = false;
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state.phase === "playing" && !this.paused) {
        this.setPaused(true);
      }
    });
  }

  onKeyDown(e) {
    if (e.repeat) {
      if (["KeyA", "KeyD", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(e.code)) {
        return;
      }
    }

    switch (e.code) {
      case "ArrowLeft":
      case "KeyA":
        this.keys.left = true;
        break;
      case "ArrowRight":
      case "KeyD":
        this.keys.right = true;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.keys.boost = true;
        break;
      case "Enter":
        e.preventDefault();
        if (this.state.phase === "menu") this.startGame();
        else if (this.state.phase === "complete" && this.completeShown) this.restart();
        break;
      case "KeyF":
        e.preventDefault();
        this.toggleMode();
        break;
      case "KeyM":
        this.toggleSound();
        break;
      case "KeyR":
        if (this.state.phase === "complete") this.restart();
        break;
      case "Escape":
        if (this.state.phase === "playing") this.setPaused(!this.paused);
        break;
      default:
        break;
    }
  }

  onKeyUp(e) {
    switch (e.code) {
      case "ArrowLeft":
      case "KeyA":
        this.keys.left = false;
        break;
      case "ArrowRight":
      case "KeyD":
        this.keys.right = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.keys.boost = false;
        break;
      default:
        break;
    }
  }

  startGame() {
    if (this.state.phase !== "menu") return;
    this.started = true;
    this.state.phase = "playing";
    this.state.speed = Math.max(this.state.speed, 58);
    this.sound.start();
    document.body.classList.add("is-running");
    this.ui.startScreen.classList.add("is-hidden");
    this.ui.completeScreen.setAttribute("aria-hidden", "true");
    this.state.flash = 0.58;
    this.state.shock = 0.72;
    this.state.flashColor.set("#f5f2e9");
    this.shake = 0.55;
    this.flashElement();
    this.showAnnounce("00", "IGNITION", "THE LINE IS ALIVE.", 1700);
  }

  restart() {
    this.state.phase = "playing";
    this.state.targetProgress = 0;
    this.state.progress = 0;
    this.state.fragments = 0;
    this.state.combo = 1;
    this.state.maxCombo = 1;
    this.state.comboTimer = 0;
    this.state.distance = 0;
    this.state.elapsed = 0;
    this.state.boost = 1;
    this.state.speed = 62;
    this.state.x = 0;
    this.state.steer = 0;
    this.state.cameraMix = 1;
    this.state.shock = 0.9;
    this.state.flash = 0.5;
    this.state.flashColor.set("#ffffff");
    this.completeTimer = 0;
    this.completeShown = false;
    this.leapActive = false;
    this.leapT = 1;
    this.paused = false;
    this.mode2d = false;
    this.toggleTimer = 99;
    this.collectibles.reset();
    this.ink2d.splashes.length = 0;
    this.car.root.scale.setScalar(1);
    this.car.root.position.set(0, 0, 0);
    this.car.root.rotation.set(0, 0, 0);
    document.body.classList.remove("is-complete", "is-2d", "is-folding", "is-paused");
    this.ui.modeLabel.textContent = "3D / PERSPECTIVE";
    this.ui.completeScreen.setAttribute("aria-hidden", "true");
    this.ui.startScreen.classList.add("is-hidden");
    this.ui.announce.classList.remove("is-visible");
    this.state.flash = 0.7;
    this.flashElement();
    this.showAnnounce("01", "PERSPECTIVE", "A NEW LINE BEGINS.", 1900);
    this.sound.start();
    this.sound.fold(false);
  }

  toggleMode() {
    if (this.state.phase !== "playing" || this.paused) return;
    const to2d = !this.mode2d;
    this.mode2d = to2d;
    this.toggleTimer = 0;
    document.body.classList.toggle("is-2d", to2d);
    this.ui.modeLabel.textContent = to2d ? "2D / INK PLANE" : "3D / PERSPECTIVE";
    this.state.flash = 0.62;
    this.state.shock = 1.1;
    this.state.aberration = 1.35;
    this.state.flashColor.set(to2d ? "#f7f3e8" : "#7df5ff");
    this.flashElement();

    document.body.classList.remove("is-folding");
    // Force the CSS animation to restart.
    void document.body.offsetWidth;
    document.body.classList.add("is-folding");
    clearTimeout(this.foldTimeout);
    this.foldTimeout = setTimeout(() => {
      document.body.classList.remove("is-folding");
    }, 1200);

    this.ritual.start(to2d, this.state.progress);
    this.sound.fold(to2d);
    this.shake = 0.75;
    this.cameraWhip = 1;

    if (to2d) {
      this.showAnnounce("02", "INK PLANE", "EVERY LINE IS A CHOICE.", 2100);
    } else {
      this.showAnnounce("01", "PERSPECTIVE", "SPACE REMEMBERS ITSELF.", 2100);
      this.leapActive = true;
      this.leapT = 0;
      this.car.root.scale.setScalar(0.42);
    }
  }

  toggleSound() {
    const muted = this.sound.toggleMute();
    this.mutedLabel = muted;
    this.ui.soundLabel.textContent = muted ? "SOUND OFF" : "SOUND ON";
  }

  setPaused(value) {
    this.paused = value;
    document.body.classList.toggle("is-paused", value);
    if (value) this.keys.boost = false;
  }

  handleCollect(item, color) {
    if (this.state.phase !== "playing") return;
    const gotShard = item.type === "shard";
    this.state.comboTimer = 2.6;
    this.state.combo = Math.min(12, this.state.combo + 1);
    this.state.maxCombo = Math.max(this.state.maxCombo, this.state.combo);
    this.state.fragments += 1;

    const value = item.value * (1 + Math.min(this.state.combo, 8) * 0.015);
    this.state.targetProgress = clamp(this.state.targetProgress + value, 0, 1);
    this.state.boost = clamp(this.state.boost + (gotShard ? 0.12 : 0.055), 0, 1);

    this.sound.collect(this.state.combo, item.x / 6);
    this.shake = Math.max(this.shake, gotShard ? 0.48 : 0.26);
    this.state.flash = gotShard ? 0.32 : 0.18;
    this.state.flashColor.copy(color);
    this.flashElement();

    this.ui.toastKicker.textContent = gotShard ? "PIGMENT SHARD" : "COLOUR ABSORBED";
    this.ui.toastValue.textContent = `+${String(Math.round(value * 100)).padStart(2, "0")}%`;
    this.ui.toast.classList.remove("is-active");
    void this.ui.toast.offsetWidth;
    this.ui.toast.classList.add("is-active");
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.ui.toast.classList.remove("is-active");
    }, 800);

    if (this.mode2d) {
      this.ink2d.addSplash(item.x, item.z, color);
    }

    if (this.state.targetProgress >= 0.999) {
      this.completeRun();
    }
  }

  completeRun() {
    if (this.state.phase === "complete") return;
    this.state.phase = "complete";
    this.state.targetProgress = 1;
    this.completeTimer = 0;
    this.completeShown = false;
    this.state.flash = 0.9;
    this.state.shock = 1.4;
    this.state.flashColor.set("#ffffff");
    this.flashElement();
    this.sound.complete();
    this.shake = 1;

    const colors = ["#62f6ff", "#ff3cb4", "#ffb52d", "#c8ff45", "#9c7bff"];
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Color(colors[i % colors.length]);
      this.collectibles.bursts.spawn(
        new THREE.Vector3(
          this.state.x + (Math.random() - 0.5) * 3.4,
          1.2 + Math.random() * 2.2,
          -1 - Math.random() * 2
        ),
        c,
        70,
        1.8
      );
    }
  }

  showAnnounce(index, title, sub, duration = 1800) {
    this.ui.announceIndex.textContent = index;
    this.ui.announceTitle.textContent = title;
    this.ui.announceSub.textContent = sub;
    this.ui.announce.classList.add("is-visible");
    clearTimeout(this.announceTimeout);
    this.announceTimeout = setTimeout(() => {
      this.ui.announce.classList.remove("is-visible");
    }, duration);
  }

  flashElement() {
    const el = this.ui.flash;
    el.classList.remove("is-active");
    void el.offsetWidth;
    el.classList.add("is-active");
  }

  update(dt) {
    this.time += dt;
    this.state.time = this.time;
    this.state.paper = clamp(1 - this.state.progress * 1.3, 0, 1);

    if (this.state.phase === "menu") {
      this.menuTime += dt;
      this.updateMenu(dt);
    } else if (this.state.phase === "playing") {
      this.updatePlaying(dt);
    } else if (this.state.phase === "complete") {
      this.updateComplete(dt);
    }

    this.state.speedNorm = clamp((this.state.speed - 35) / 100, 0, 1);
    this.state.cameraMix = damp(
      this.state.cameraMix,
      this.state.phase === "menu" ? 0 : 1,
      2.2,
      dt
    );

    this.world.update(
      dt,
      this.time,
      this.state.speed,
      this.state.x,
      this.state.progress,
      this.state.boosting
    );

    this.car.update(dt, this.time, {
      progress: this.state.progress,
      speed: this.state.speed,
      steer: this.state.steer,
      boosting: this.state.boosting,
      x: this.state.x,
    });

    if (this.leapActive) {
      this.leapT += dt / 0.92;
      const e = easeOutCubic(clamp(this.leapT, 0, 1));
      this.car.setLeap(e);
      if (this.leapT >= 1.05) {
        this.leapActive = false;
        this.car.root.scale.setScalar(1);
        this.car.root.rotation.y = 0;
        this.car.root.position.z = 0;
        this.car.root.position.y = 0;
      }
    }

    this.collectibles.update(
      dt,
      this.time,
      this.state.speed,
      this.state.x,
      this.state.phase === "playing"
    );

    this.shake = damp(this.shake, 0, 7.5, dt);
    this.cameraWhip = damp(this.cameraWhip, 0, 2.6, dt);
    this.state.shock = Math.max(0, this.state.shock - dt * 1.4);
    this.state.flash = Math.max(0, this.state.flash - dt * 4.6);
    this.state.aberration = damp(
      this.state.aberration,
      this.state.boosting ? 0.32 : 0.06,
      3.5,
      dt
    );

    this.toggleTimer += dt;
    this.completeTimer += dt;

    if (
      this.state.phase === "complete" &&
      !this.completeShown &&
      this.completeTimer > 1.15
    ) {
      this.showCompleteScreen();
    }

    this.updateCamera(dt);
    this.updateUI(dt);

    this.audioTimer += dt;
    if (this.audioTimer > 0.08) {
      this.audioTimer = 0;
      this.sound.setSpeed(this.state.speed, this.state.boosting);
    }

    if (this.mode2d || this.toggleTimer < 1.1) {
      this.ink2d.update(dt);
      this.ink2d.render({
        time: this.time,
        dt,
        speed: this.state.speed,
        x: this.state.x,
        steer: this.state.steer,
        progress: this.state.progress,
        items: this.collectibles.items,
        boosting: this.state.boosting,
      });
    }

    this.ritual.update(dt);
  }

  updateMenu(dt) {
    this.state.speed = damp(this.state.speed, 23, 1.1, dt);
    this.state.steer = 0;
    this.state.x = 0;
    this.state.progress = damp(this.state.progress, 0, 4, dt);
    this.state.targetProgress = 0;
  }

  updatePlaying(dt) {
    const input = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    this.state.steer = damp(this.state.steer, input, 9, dt);

    const canBoost = this.keys.boost && this.state.boost > 0.01;
    this.state.boosting = canBoost;
    if (canBoost) {
      this.state.boost = clamp(this.state.boost - dt * 0.185, 0, 1);
    } else {
      this.state.boost = clamp(this.state.boost + dt * 0.042, 0, 1);
    }

    const targetSpeed = canBoost
      ? SPEED_BOOST + this.state.progress * 10
      : SPEED_BASE + this.state.progress * 14;
    this.state.speed = damp(this.state.speed, targetSpeed, canBoost ? 2.2 : 1.3, dt);

    const lateralSpeed = 7.4 + this.state.speedNorm * 1.8;
    this.state.x = clamp(
      this.state.x + this.state.steer * lateralSpeed * dt,
      -6.55,
      6.55
    );
    if (Math.abs(this.state.x) > 6.5) {
      this.shake = Math.max(this.shake, 0.1);
    }

    this.state.distance += (this.state.speed * dt) / 1000;
    this.state.elapsed += dt;

    if (this.state.comboTimer > 0) {
      this.state.comboTimer -= dt;
      if (this.state.comboTimer <= 0) this.state.combo = 1;
    }

    this.state.progress = damp(
      this.state.progress,
      this.state.targetProgress,
      1.9,
      dt
    );
    if (Math.abs(this.state.progress - this.state.targetProgress) < 0.0005) {
      this.state.progress = this.state.targetProgress;
    }
  }

  updateComplete(dt) {
    this.state.boosting = false;
    this.state.steer = damp(this.state.steer, 0, 4, dt);
    this.state.x = damp(this.state.x, 0, 2, dt);
    this.state.speed = damp(this.state.speed, 38, 1.1, dt);
    this.state.elapsed += dt;
    this.state.distance += (this.state.speed * dt) / 1000;
    this.state.progress = damp(this.state.progress, 1, 2.2, dt);
    if (this.state.progress > 0.9995) this.state.progress = 1;
    this.state.combo = this.state.maxCombo;
  }

  showCompleteScreen() {
    this.completeShown = true;
    this.ui.finalFragments.textContent = formatNumber(this.state.fragments, 3);
    this.ui.finalCombo.textContent = `x${this.state.maxCombo}`;
    this.ui.finalTime.textContent = formatTime(this.state.elapsed);
    this.ui.finalDistance.textContent = this.state.distance.toFixed(2);
    this.ui.completeScreen.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-complete");
    this.state.flash = 0.42;
    this.state.flashColor.set("#ffffff");
    this.flashElement();
  }

  updateCamera(dt, force = false) {
    const s = this.state;
    const speedNorm = clamp((s.speed - 35) / 105, 0, 1);
    const boost = s.boosting ? 1 : 0;
    const portrait = clamp((1 - this.camera.aspect) / 0.58, 0, 1);

    this.menuPos.set(
      5.95 + Math.sin(this.menuTime * 0.16) * 0.42,
      2.86 + Math.sin(this.menuTime * 0.24) * 0.09 + portrait * 1.15,
      7.45 + Math.cos(this.menuTime * 0.12) * 0.2 + portrait * 6.6
    );
    this.menuTarget.set(
      -2.65 + Math.sin(this.menuTime * 0.1) * 0.15,
      0.8 + portrait * 0.1,
      -4.2
    );

    this.chasePos.set(
      s.x * 0.54,
      2.28 + speedNorm * 0.16 + portrait * 0.9,
      8.0 + speedNorm * 0.35 + boost * 0.28 + portrait * 6.8
    );
    this.chaseTarget.set(s.x * 0.44, 0.82 + portrait * 0.08, -13.5);

    const mix = smoothstep(0, 1, s.cameraMix);
    this.cameraPos.lerpVectors(this.menuPos, this.chasePos, mix);
    this.cameraTarget.lerpVectors(this.menuTarget, this.chaseTarget, mix);

    const shake = this.shake * 0.14 + boost * 0.035;
    this.cameraPos.x +=
      Math.sin(this.time * 71) * shake +
      Math.sin(this.time * 37 + 1.7) * shake * 0.5;
    this.cameraPos.y += Math.cos(this.time * 63 + 0.4) * shake * 0.7;
    this.cameraPos.z += Math.cos(this.time * 29) * shake * 0.4;

    this.camera.position.copy(this.cameraPos);
    this.camera.lookAt(this.cameraTarget);

    const whip = this.cameraWhip;
    this.camera.rotation.z +=
      -s.steer * 0.024 +
      Math.sin(this.time * 18) * whip * 0.06 +
      Math.sin(this.time * 54) * shake * 0.012;

    const fovTarget =
      lerp(37, 54, mix) +
      (speedNorm * 6 + boost * 7) * mix +
      whip * 8 +
      portrait * 6.5;
    this.camera.fov = damp(this.camera.fov, fovTarget, 4.2, force ? 1 : dt);
    this.camera.updateProjectionMatrix();
  }

  updateUI(dt) {
    const s = this.state;
    const percent = Math.round(s.progress * 100);
    const percentText = String(percent).padStart(2, "0");
    if (this.ui.progress.textContent !== percentText) {
      this.ui.progress.textContent = percentText;
    }
    this.ui.progressFill.style.width = `${percent}%`;
    this.ui.progressMarker.style.left = `${percent}%`;

    let caption = "UNFINISHED SKETCH";
    if (percent >= 100) caption = "REALITY SYNTHESIS";
    else if (percent >= 88) caption = "FINAL LAYER";
    else if (percent >= 68) caption = "MATERIAL MEMORY";
    else if (percent >= 44) caption = "SURFACE FORMING";
    else if (percent >= 21) caption = "PIGMENT BLEED";
    if (this.ui.caption.textContent !== caption) this.ui.caption.textContent = caption;

    const kmh = String(Math.round(s.speed * 3.6)).padStart(3, "0");
    if (this.ui.speed.textContent !== kmh) this.ui.speed.textContent = kmh;

    const activeBars = Math.round(s.speedNorm * this.speedBarEls.length);
    for (let i = 0; i < this.speedBarEls.length; i++) {
      const bar = this.speedBarEls[i];
      const active = i < activeBars;
      bar.style.opacity = active ? "0.92" : "0.32";
      bar.style.background = active
        ? i > this.speedBarEls.length - 6
          ? "#ff4d1f"
          : "var(--ui)"
        : "var(--ui-line)";
      bar.style.height = `${18 + ((i * 37) % 42) * (active ? 1 : 0.6)}%`;
    }

    this.ui.boostFill.style.transform = `scaleX(${s.boost.toFixed(3)})`;
    this.ui.fragments.textContent = formatNumber(s.fragments, 3);
    this.ui.combo.textContent = `x${s.combo}`;
    this.ui.distance.innerHTML = `${s.distance.toFixed(2)}<small>KM</small>`;

    const uiMix = this.mode2d
      ? 0
      : smoothstep(0.25, 0.62, s.progress);
    const uiColor = INK_UI.clone().lerp(PAPER_UI, uiMix);
    const bgColor = PAPER_BG.clone().lerp(DARK_BG, uiMix);
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--ui", colorToCss(uiColor, 1));
    rootStyle.setProperty("--ui-soft", colorToCss(uiColor, 0.58));
    rootStyle.setProperty("--ui-faint", colorToCss(uiColor, 0.32));
    rootStyle.setProperty("--ui-line", colorToCss(uiColor, 0.22));
    rootStyle.setProperty("--panel-bg", colorToCss(bgColor, 1));

    document.body.classList.toggle(
      "is-color",
      uiMix > 0.55 && !this.mode2d
    );

    const shortMode = window.innerWidth <= 720;
    this.ui.modeLabel.textContent = this.mode2d
      ? shortMode
        ? "2D"
        : "2D / INK PLANE"
      : shortMode
        ? "3D"
        : "3D / PERSPECTIVE";
  }

  render() {
    const show3D = !this.mode2d || this.toggleTimer < 1.05;
    if (show3D) {
      this.postfx.update(this.dt || 0.016, {
        time: this.time,
        progress: this.state.progress,
        paper: this.state.paper,
        speedNorm: this.state.speedNorm,
        boosting: this.state.boosting,
        complete: this.state.phase === "complete",
        aberration: this.state.aberration,
        shock: this.state.shock,
        flash: this.state.flash,
        flashColor: this.state.flashColor,
      });
      this.postfx.render(this.dt || 0.016);
    }
  }

  loop() {
    requestAnimationFrame(this.loop);
    if (this.paused) return;

    const raw = this.clock.getDelta();
    const dt = clamp(raw, 0.001, 0.05);
    this.dt = dt;
    this.update(dt);
    this.render();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.7);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.postfx.setSize(w, h, this.pixelRatio);
    this.ink2d.resize();
    this.ritual.resize();
    this.car.setResolution(w, h);
  }
}
