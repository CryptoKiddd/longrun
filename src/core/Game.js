import { PHYSICS, SPEED, TRACK } from '../config.js';
import { GameLoop } from './GameLoop.js';
import { StateMachine, State } from './GameState.js';
import { InputManager } from './InputManager.js';
import { AudioManager } from './AudioManager.js';
import { SafeStorage } from './Storage.js';
import { Simulation } from './Simulation.js';
import { randomSeed } from './rng.js';
import { ProgressionSystem } from '../systems/ProgressionSystem.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { GhostPlayback } from '../systems/GhostSystem.js';
import { Renderer, PALETTE, PC, tierColor } from '../rendering/Renderer.js';
import { HUD, formatInt } from '../ui/HUD.js';
import { UI } from '../ui/UI.js';
import { loadFonts } from '../ui/fonts.js';
import { createPlatformAdapter } from '../platform/PlatformAdapter.js';

const SAVE_KEY = 'pulse-one-more-run.v1';
const GAME_OVER_DELAY = 0.75; // s before the results panel appears
const TRAIL_SIZE = 14;
const TEXT_POOL = 14;
const HINT_RUNS = 3; // show tutorial hints during the first few runs

/**
 * Wires the DOM, input, audio, platform, simulation and rendering together and
 * owns the top-level state machine. Gameplay logic lives in Simulation.
 */
export class Game {
  constructor({ canvas, doc = document, win = window }) {
    this.canvas = canvas;
    this.doc = doc;
    this.win = win;

    this.fsm = new StateMachine(State.INITIALIZING);
    this.sim = new Simulation();
    this.progression = new ProgressionSystem(new SafeStorage(SAVE_KEY));
    this.audio = new AudioManager();
    this.platform = createPlatformAdapter();
    this.renderer = new Renderer(canvas);
    this.hud = new HUD();
    this.particles = new ParticleSystem();
    this.ghost = new GhostPlayback();
    this.input = new InputManager({ keyTarget: win, surface: canvas, jumpButton: doc.getElementById('btn-jump'), dashButton: doc.getElementById('btn-dash'), doc, win });
    this.ui = new UI(doc, {
      play: () => this.startRun(),
      resume: () => this.resume(),
      restart: () => this.startRun(),
      menu: () => this.toMenu(),
      pause: () => this.pause(),
      mute: () => this.toggleMute(),
      skin: (id) => this.selectSkin(id),
      setting: (k, v) => this.changeSetting(k, v),
    });
    this.loop = new GameLoop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      frameUpdate: (dt, alpha) => this.frameUpdate(dt, alpha),
    });

    this.intent = { steer: 0, jump: false, dash: false, dashDir: 0 };
    this.time = 0;
    this.trail = { x: new Float32Array(TRAIL_SIZE), y: new Float32Array(TRAIL_SIZE), z: new Float32Array(TRAIL_SIZE), head: 0, count: 0, size: TRAIL_SIZE, lastZ: -1 };
    this.texts = Array.from({ length: TEXT_POOL }, () => ({ text: '', color: '#fff', x: 0, y: 0, z: 0, life: 0, maxLife: 1, scale: 1 }));
    this.playerMarker = { z: 0 };
    this.hudModel = { score: 0, best: 0, multiplier: 1, streak: 0, distance: 0, speed: 0, toast: '', toastAlpha: 0, hint: '', hintAlpha: 0 };
    this.view = { track: this.sim.track, particles: this.particles, texts: this.texts, trail: this.trail, playerMarker: this.playerMarker, radius: PHYSICS.PLAYER_RADIUS };
    this.resetVisuals();
    this.frameTimes = { avg: 1 / 60, slowFor: 0, last: 0 };
    this.onResize = () => this.resize();
  }

  // ---- lifecycle ------------------------------------------------------------

  async init() {
    this.progression.load();
    const st = this.progression.settings;
    this.audio.setMuted(st.muted);
    this.audio.setVolume(st.volume);
    this.ui.renderMenu(this.progression);
    this.ui.setTouchMode(this.isCoarsePointer());

    this.input.attach();
    this.input.onAction((a) => this.handleAction(a));
    this.win.addEventListener('resize', this.onResize);
    this.win.addEventListener('orientationchange', this.onResize);
    this.resize();

    // Unlock audio on the first gesture anywhere (autoplay policy).
    const unlock = () => this.audio.unlock();
    this.win.addEventListener('pointerdown', unlock, { once: true, capture: true });
    this.win.addEventListener('keydown', unlock, { once: true, capture: true });

    // Bundled fonts (local files); never blocks startup for more than ~1.5 s.
    await Promise.all([loadFonts(this.doc), this.platform.init().catch(() => null)]);

    this.sim.reset(randomSeed());
    this.fsm.transition(State.READY);
    this.ui.show('menu');
    this.loop.start();
  }

  destroy() {
    this.loop.stop();
    this.input.detach();
    this.win.removeEventListener('resize', this.onResize);
    this.win.removeEventListener('orientationchange', this.onResize);
  }

  isCoarsePointer() {
    try {
      return !!(this.win.matchMedia && this.win.matchMedia('(pointer: coarse)').matches);
    } catch {
      return false;
    }
  }

  resize() {
    const w = this.win.innerWidth || this.canvas.clientWidth || 800;
    const h = this.win.innerHeight || this.canvas.clientHeight || 600;
    this.renderer.resize(w, h, this.win.devicePixelRatio || 1);
  }

  // ---- state transitions ------------------------------------------------------

  handleAction(action) {
    const s = this.fsm.current;
    switch (action) {
      case 'confirm':
        if (s === State.READY && this.ui.current === 'menu') this.startRun();
        else if (s === State.GAME_OVER && this.ui.current === 'over') this.startRun();
        else if (s === State.PAUSED) this.resume();
        break;
      case 'pause':
        if (s === State.PLAYING) this.pause();
        else if (s === State.PAUSED) this.resume();
        break;
      case 'mute':
        this.toggleMute();
        break;
      case 'blur':
        if (s === State.PLAYING) this.pause();
        break;
      default:
        break;
    }
  }

  startRun() {
    // Restarting from pause abandons the run: PAUSED -> READY -> PLAYING.
    if (this.fsm.is(State.PAUSED)) this.fsm.transition(State.READY);
    if (!this.fsm.can(State.PLAYING)) return;
    this.audio.unlock();
    this.audio.click();
    this.sim.reset(randomSeed(), this.progression.activeChallenges());
    this.ghost.load(this.progression.settings.ghost ? this.progression.data.ghost : null);
    this.particles.clear();
    this.resetVisuals();
    this.input.clear();
    this.runIndex = this.progression.data.totalRuns;
    this.bestAtStart = this.progression.data.bestScore;
    this.passedBestNotified = false;
    this.fsm.transition(State.PLAYING);
    this.ui.show(null);
    this.loop.resetTiming();
    this.platform.gameplayStart();
  }

  pause() {
    if (!this.fsm.transition(State.PAUSED)) return;
    this.input.clear();
    this.ui.show('pause');
    this.platform.gameplayStop();
  }

  resume() {
    if (!this.fsm.is(State.PAUSED)) return;
    this.input.clear();
    this.fsm.transition(State.PLAYING);
    this.ui.show(null);
    this.loop.resetTiming(); // never simulate the time spent paused
    this.audio.resume();
    this.platform.gameplayStart();
  }

  toMenu() {
    if (!this.fsm.transition(State.READY)) return;
    this.sim.reset(randomSeed());
    this.particles.clear();
    this.resetVisuals();
    this.ui.renderMenu(this.progression);
    this.ui.show('menu');
    this.platform.gameplayStop();
  }

  endRun() {
    if (!this.fsm.transition(State.GAME_OVER)) return;
    const sim = this.sim;
    const p = sim.player;
    const fx = !this.progression.settings.reducedEffects;
    const skin = this.progression.skin;
    this.audio.crash();
    if (sim.crashCause === 'obstacle') {
      this.particles.burst(p.x, p.y + p.radius, p.z, 46, 9, 0.9, 0.5, PC.WHITE, p.vz * 0.15, 10);
      this.particles.burst(p.x, p.y + p.radius, p.z, 40, 7, 1.1, 0.7, skinParticle(skin), p.vz * 0.1, 6);
      this.playerVisible = false;
    } else {
      this.particles.burst(p.x, 0, p.z, 30, 5, 0.9, 0.5, PC.MAGENTA, 0, 4);
      this.fallFade = true;
    }
    if (fx) {
      this.shake = 1;
      this.flash = 0.45;
      this.flashColor = PALETTE.danger;
    }

    // Persist the run record (never lowers records). Challenges were saved as they completed.
    const unlockedNow = this.unlockedThisRun;
    const summary = sim.score.summary();
    const ghostData = sim.ghost.export(summary.score);
    const result = this.progression.recordRun(summary, this.progression.settings.ghost ? ghostData : null);
    if (result.newBest && this.bestAtStart > 0) this.audio.record();
    this.platform.submitScore(summary.score).catch(() => false);
    this.platform.gameplayStop();

    let extra = '';
    if (unlockedNow.length) extra = `Unlocked ball: ${unlockedNow.map((s) => s.name).join(', ')}`;
    else if (sim.completedChallenges.length) extra = `Challenges completed: ${sim.completedChallenges.length}`;
    else if (!result.newBest && this.progression.data.bestScore > 0) {
      const gap = this.progression.data.bestScore - summary.score;
      extra = `${formatInt(gap)} points from your best`;
    }
    this.ui.renderGameOver(summary, result, this.progression.data.bestScore, sim.crashCause, extra);
    this.gameOverTimer = GAME_OVER_DELAY;
  }

  toggleMute() {
    const muted = !this.progression.settings.muted;
    this.changeSetting('muted', muted);
    if (!muted) {
      this.audio.unlock();
      this.audio.click();
    }
  }

  changeSetting(key, value) {
    this.progression.setSetting(key, value);
    if (key === 'muted') {
      this.audio.setMuted(value);
      this.ui.setMuted(value);
    }
  }

  selectSkin(id) {
    if (this.progression.selectSkin(id)) {
      this.audio.unlock();
      this.audio.click();
      this.ui.renderMenu(this.progression);
    }
  }

  // ---- simulation ---------------------------------------------------------------

  fixedUpdate(dt) {
    if (!this.fsm.simulating) return;
    this.intent.steer = this.input.steer;
    this.intent.jump = this.input.consumeJump();
    const dashDir = this.input.dashDir;
    this.intent.dash = this.input.consumeDash();
    this.intent.dashDir = this.intent.dash ? dashDir : 0;
    this.sim.step(dt, this.intent);
    this.processNotices();
    if (this.sim.over) this.endRun();
  }

  processNotices() {
    const notices = this.sim.notices;
    if (!notices.length) return;
    const p = this.sim.player;
    const fx = !this.progression.settings.reducedEffects;
    for (const n of notices) {
      switch (n.kind) {
        case 'orb':
          this.audio.orb();
          this.particles.burst(n.x, n.y, n.z, 12, 4, 0.45, 0.35, PC.AMBER, p.vz * 0.85);
          this.spawnText(`+${n.points}`, PALETTE.orb, n.x, n.y + 0.6, n.z + 2, 0.7, 0.8);
          break;
        case 'gate': {
          this.audio.gate(n.tier);
          const color = tierColor(n.tier);
          const label = n.tier === 'MISS' ? 'MISS' : `${n.tier}  +${n.points}`;
          this.spawnText(label, color, n.x, n.y, n.z + 3, 1.0, n.tier === 'PERFECT' ? 1.15 : 1);
          if (n.tier !== 'MISS') this.particles.burst(n.x, 1.4, n.z, n.tier === 'PERFECT' ? 26 : 12, 6, 0.6, 0.4, n.tier === 'PERFECT' ? PC.CYAN : PC.VIOLET, p.vz * 0.8);
          if (n.tier === 'PERFECT' && fx) {
            this.flash = 0.12;
            this.flashColor = PALETTE.perfect;
          }
          break;
        }
        case 'jump':
          this.audio.jump();
          this.jumpedThisRun = true;
          this.particles.burst(p.x, p.y + 0.05, p.z, 6, 2, 0.35, 0.3, PC.CYAN, p.vz * 0.6);
          break;
        case 'dash': {
          this.audio.dash();
          this.dashedThisRun = true;
          this.particles.burst(p.x - n.dir * 0.4, p.y + p.radius, p.z, 16, 4, 0.35, 0.35, PC.WHITE, p.vz * 0.85);
          if (fx) this.shake = Math.max(this.shake, 0.1);
          break;
        }
        case 'slam':
          this.audio.slam();
          this.particles.burst(p.x, p.y + p.radius, p.z, 12, 3, 0.4, 0.35, PC.CYAN, p.vz * 0.8);
          break;
        case 'launch':
          this.audio.launch();
          this.particles.burst(p.x, p.y + 0.1, p.z, 14, 3, 0.5, 0.35, PC.WHITE, p.vz * 0.7);
          if (fx) this.shake = Math.max(this.shake, 0.12);
          break;
        case 'land':
          this.squash = Math.min(1, n.speed / 8);
          this.audio.land(this.squash);
          this.particles.burst(p.x, p.y + 0.05, p.z, 8 + Math.round(this.squash * 10), 2.5 + this.squash * 3, 0.35, 0.3, PC.CYAN, p.vz * 0.6);
          if (fx && this.squash > 0.6) this.shake = Math.max(this.shake, 0.2 * this.squash);
          break;
        case 'rail':
          this.audio.rail();
          if (fx) this.shake = Math.max(this.shake, 0.18);
          break;
        case 'challenge':
          this.audio.challenge();
          this.unlockedThisRun.push(...this.progression.completeChallenge(n.challenge.id));
          this.progression.save();
          this.showToast(`Challenge complete: ${n.challenge.label}  +${n.points}`);
          break;
        default:
          break;
      }
    }
    notices.length = 0;
  }

  // ---- per-frame visuals -----------------------------------------------------------

  resetVisuals() {
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#fff';
    this.squash = 0;
    this.roll = 0;
    this.bank = 0;
    this.playerVisible = true;
    this.playerAlpha = 1;
    this.fallFade = false;
    this.fallOffset = 0;
    this.gameOverTimer = 0;
    this.toastTime = 0;
    this.jumpedThisRun = false;
    this.dashedThisRun = false;
    this.unlockedThisRun = [];
    this.trail.count = 0;
    this.trail.head = 0;
    this.trail.lastZ = -1;
    for (const t of this.texts) t.life = 0;
    this.dustTimer = 0;
  }

  spawnText(text, color, x, y, z, life, scale) {
    let slot = this.texts[0];
    for (const t of this.texts) {
      if (t.life <= 0) {
        slot = t;
        break;
      }
      if (t.life < slot.life) slot = t;
    }
    slot.text = text;
    slot.color = color;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.life = life;
    slot.maxLife = life;
    slot.scale = scale;
  }

  showToast(text) {
    this.hudModel.toast = text;
    this.toastTime = 3;
  }

  frameUpdate(dt, alpha) {
    this.time += dt;
    this.monitorPerformance();
    this.ui.setTouchMode(this.input.usingTouch || this.isCoarsePointerCached());

    const sim = this.sim;
    const p = sim.player;
    const state = this.fsm.current;
    const playing = state === State.PLAYING;
    const fx = !this.progression.settings.reducedEffects;

    // Interpolate between the last two physics states for smooth motion.
    let px = p.x, py = p.y, pz = p.z;
    if (playing) {
      px = p.prevX + (p.x - p.prevX) * alpha;
      py = p.prevY + (p.y - p.prevY) * alpha;
      pz = p.prevZ + (p.z - p.prevZ) * alpha;
    }
    if (state === State.READY) {
      // Attract mode: idle hover on the start line.
      px = Math.sin(this.time * 0.6) * 0.8;
      py = sim.track.heightAt(pz);
    }

    // Visual-only timers.
    this.particles.update(dt);
    for (const t of this.texts) if (t.life > 0) t.life -= dt;
    for (const g of sim.track.gates) if (g.flash > 0) g.flash = Math.max(0, g.flash - dt * 2.5);
    for (const o of sim.track.obstacles) if (o.hitFlash > 0) o.hitFlash = Math.max(0, o.hitFlash - dt * 3);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.squash = Math.max(0, this.squash - dt * 5);
    if (playing) this.roll += (p.vz * dt) / p.radius;
    this.bank = fx && playing ? -p.vx * 0.006 : this.bank * 0.9;
    if (this.toastTime > 0) this.toastTime -= dt;

    if (state === State.GAME_OVER) {
      if (this.fallFade) {
        this.fallOffset -= dt * 6;
        this.playerAlpha = Math.max(0, this.playerAlpha - dt * 2.5);
      }
      if (this.gameOverTimer > 0) {
        this.gameOverTimer -= dt;
        if (this.gameOverTimer <= 0) this.ui.show('over');
      }
    }

    if (playing) {
      this.pushTrail(px, py, pz);
      this.spawnSpeedDust(dt, pz, p.vz);
    }

    this.renderer.camera.follow(px, py, pz, dt, state === State.READY, sim.track);
    const speed01 = playing ? Math.max(0, Math.min(1, (p.vz - SPEED.MIN) / (SPEED.MAX - SPEED.MIN))) : 0;
    const dashing = playing && p.dashTime > 0;
    this.renderer.camera.setFov(fx ? 1 - 0.1 * speed01 - (dashing ? 0.07 : 0) : 1, dt);

    // Ghost of the best run (same distance as the player).
    if (playing && this.progression.settings.ghost) this.ghost.sample(pz);
    else this.ghost.visible = false;

    const v = this.view;
    v.track = sim.track;
    v.time = this.time;
    v.px = px;
    v.py = py + this.fallOffset;
    v.pz = pz;
    v.groundY = sim.track.heightAt(pz);
    v.playerMarker.z = pz;
    v.skin = this.progression.skin;
    v.reducedEffects = !fx;
    v.speed01 = speed01;
    v.dashing = dashing;
    v.squash = this.squash;
    v.roll = this.roll;
    v.bank = this.bank;
    v.playerVisible = this.playerVisible;
    v.playerAlpha = this.playerAlpha;
    v.shadow = this.playerVisible && !p.falling && sim.track.isSupported(px, pz);
    v.ghostVisible = this.ghost.visible;
    v.ghostX = this.ghost.x;
    v.ghostY = this.ghost.y;
    v.bestDistance = state === State.READY ? 0 : this.progression.data.bestDistance;
    v.flash = this.flash;
    v.flashColor = this.flashColor;
    v.shake = this.shake;
    if (this.shake > 0) {
      const amp = 14 * this.shake * this.shake;
      v.shakeX = (Math.random() * 2 - 1) * amp;
      v.shakeY = (Math.random() * 2 - 1) * amp;
    }
    this.renderer.render(v);

    if (state === State.PLAYING || state === State.PAUSED || (state === State.GAME_OVER && this.gameOverTimer > 0)) {
      this.updateHudModel(pz);
      const r = this.renderer;
      this.hud.draw(r.ctx, r.cssW, r.cssH, this.hudModel);
    }
  }

  isCoarsePointerCached() {
    if (this.coarse === undefined) this.coarse = this.isCoarsePointer();
    return this.coarse;
  }

  pushTrail(x, y, z) {
    const t = this.trail;
    if (z - t.lastZ < 0.45) return;
    t.lastZ = z;
    t.x[t.head] = x;
    t.y[t.head] = y;
    t.z[t.head] = z;
    t.head = (t.head + 1) % t.size;
    t.count = Math.min(t.count + 1, t.size);
  }

  /** Static motes beside the track that streak past: a cheap speed cue. */
  spawnSpeedDust(dt, pz, vz) {
    if (this.renderer.quality === 0) return;
    this.dustTimer -= dt;
    const rate = 0.02 + 0.06 * (1 - (vz - SPEED.MIN) / (SPEED.MAX - SPEED.MIN));
    while (this.dustTimer <= 0) {
      this.dustTimer += rate;
      const side = Math.random() < 0.5 ? -1 : 1;
      const dz = pz + 30 + Math.random() * 50;
      this.particles.spawn(side * (TRACK.HALF_WIDTH + 1 + Math.random() * 7), this.sim.track.heightAt(dz) - 2 + Math.random() * 6, dz, 0, 0, 0, 6, 0.12, Math.random() < 0.7 ? PC.VIOLET : PC.CYAN);
    }
  }

  updateHudModel(pz) {
    const sim = this.sim;
    const sc = sim.score;
    const h = this.hudModel;
    h.score = sc.total;
    h.best = this.bestAtStart || 0;
    h.multiplier = sc.multiplier;
    h.streak = sc.streak;
    h.distance = sc.distance;
    h.speed = sim.player.vz;
    h.dash01 = 1 - sim.player.dashCooldown / PHYSICS.DASH_COOLDOWN;
    h.dashKey = this.ui.touch ? 'FLICK' : 'SHIFT';
    this.ui.setDashReady(sim.player.dashCooldown <= 0);
    h.toastAlpha = this.toastTime > 0 ? Math.min(1, this.toastTime * 2, (3 - this.toastTime) * 4) : 0;

    if (!this.passedBestNotified && this.bestAtStart > 0 && sc.total > this.bestAtStart && this.fsm.is(State.PLAYING)) {
      this.passedBestNotified = true;
      this.showToast('New personal best — keep going!');
    }

    // Contextual tutorial hints for the first few runs.
    h.hint = '';
    h.hintAlpha = 0;
    h.hintHigh = this.renderer.cssH > this.renderer.cssW; // portrait: hint goes in the sky, clear of JUMP
    if (this.runIndex >= HINT_RUNS || !this.fsm.is(State.PLAYING)) return;
    const touch = this.ui.touch;
    const track = sim.track;
    const lookahead = sim.player.vz * 2.2;
    if (sim.time < 5) {
      h.hint = touch ? 'Drag left / right to steer' : 'Steer with  ← →  or  A  D';
      h.hintAlpha = Math.min(1, sim.time * 2, (5 - sim.time) * 2);
    } else if (!this.jumpedThisRun && (track.upcoming('hole', pz, lookahead) || track.upcoming('hurdle', pz, lookahead))) {
      h.hint = touch ? 'Tap JUMP to leap' : 'Press  SPACE  to jump';
      h.hintAlpha = 1;
    } else if (sc.gatesTotal === 0 && track.gates.some((g) => g.z > pz && g.z < pz + lookahead)) {
      h.hint = 'Fly through the centre of gates';
      h.hintAlpha = 1;
    } else if (!this.dashedThisRun && sim.time > 8 && sim.time < 14) {
      h.hint = touch ? 'Flick sideways or tap DASH to dash' : 'SHIFT + \u2190 / \u2192  to dash';
      h.hintAlpha = Math.min(1, (sim.time - 8) * 2, (14 - sim.time) * 2);
    }
  }

  /** Auto quality: step down if frames are consistently slow. */
  monitorPerformance() {
    const now = performance.now();
    const ft = this.frameTimes;
    if (ft.last) {
      const dt = Math.min(0.25, (now - ft.last) / 1000);
      ft.avg += (dt - ft.avg) * 0.05;
      if (this.fsm.is(State.PLAYING) && ft.avg > 1 / 42) ft.slowFor += dt;
      else ft.slowFor = Math.max(0, ft.slowFor - dt);
      if (ft.slowFor > 2.5 && this.renderer.quality > 0) {
        this.renderer.setQuality(this.renderer.quality - 1);
        this.particles.limit = this.renderer.quality === 0 ? 140 : 280;
        ft.slowFor = 0;
        ft.avg = 1 / 60;
      }
    }
    ft.last = now;
  }
}

function skinParticle(skin) {
  return { violet: PC.VIOLET, solar: PC.ORANGE, lime: PC.WHITE, ice: PC.WHITE, prism: PC.MAGENTA }[skin.id] ?? PC.CYAN;
}

