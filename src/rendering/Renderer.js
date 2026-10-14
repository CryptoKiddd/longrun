import { RENDER, TRACK } from '../config.js';
import { GATE_HEIGHT, GATE_POST_WIDTH } from '../world/Track.js';
import { Camera } from './Camera.js';
import { glowSprite, ballSprite, withAlpha, mix, hslToHex } from './sprites.js';

/**
 * Canvas 2D pseudo-3D renderer. A read-only view of the simulation:
 * it interpolates and projects, but never writes gameplay state.
 */

export const PALETTE = Object.freeze({
  skyTop: '#02040f',
  skyMid: '#071033',
  horizon: '#1b1250',
  void: '#03050f',
  trackA: '#0d1a47',
  trackB: '#0a1539',
  fog: '#140f3c',
  rail: '#22e4ff',
  lane: '#3b5bd6',
  danger: '#ff2e88',
  dangerSoft: '#ff6aa8',
  mover: '#ff8a3d',
  gate: '#a77bff',
  orb: '#ffc23d',
  perfect: '#7ffcff',
  good: '#c49bff',
  ok: '#8aa0d0',
  miss: '#ff4d6d',
  white: '#ffffff',
});

const THEME_TINT = { '': null, precision: '#2a1a6e', risk: '#4a1d5e' };
const FOG_LEVELS = 16;
const PARTICLE_COLORS = ['#22e4ff', '#ffc23d', '#ff2e88', '#a77bff', '#ffffff', '#ff8a3d'];
export const PC = Object.freeze({ CYAN: 0, AMBER: 1, MAGENTA: 2, VIOLET: 3, WHITE: 4, ORANGE: 5 });

const FAR = TRACK.VIEW_AHEAD;
const MAX_SLICES = Math.ceil(FAR / RENDER.SLICE) + 4;
const QUALITY_SCALE = [0.7, 0.85, 1];

function pt() {
  return { x: 0, y: 0, s: 0, visible: false };
}

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.camera = new Camera();
    this.quality = 2;
    this.cssW = 1;
    this.cssH = 1;
    this.dpr = 1;
    this.pxRatio = 1;
    this.P = Array.from({ length: 12 }, pt);
    this.q = pt();
    this.list = [];
    this.sliceZ = new Float32Array(MAX_SLICES);
    this.sliceL = new Float32Array(MAX_SLICES);
    this.sliceR = new Float32Array(MAX_SLICES);
    this.sliceY = new Float32Array(MAX_SLICES);
    this.sliceS = new Float32Array(MAX_SLICES);
    this.stars = this.makeStars(140);
    this.ridge = this.makeRidge();
    this.trackColors = this.buildTrackPalette();
    this.particleSprites = PARTICLE_COLORS.map((c) => glowSprite(c, 64));
    this.orbGlow = glowSprite(PALETTE.orb, 96);
    this.orbCore = ballSprite('#fff4d0', '#ffb02e', 64);
  }

  // ---- setup ------------------------------------------------------------

  makeStars(n) {
    const stars = [];
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) stars.push({ x: rnd(), y: rnd() * rnd(), r: 0.5 + rnd() * 1.3, a: 0.25 + rnd() * 0.6, tw: rnd() * 6 });
    return stars;
  }

  makeRidge() {
    const pts = [];
    let s = 777;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const n = 48;
    for (let i = 0; i <= n; i++) pts.push(0.15 + rnd() * 0.85 * (0.5 + 0.5 * Math.sin(i * 0.7)));
    return pts;
  }

  buildTrackPalette() {
    const out = {};
    for (const theme of Object.keys(THEME_TINT)) {
      const tint = THEME_TINT[theme];
      const a = tint ? mix(PALETTE.trackA, tint, 0.45) : PALETTE.trackA;
      const b = tint ? mix(PALETTE.trackB, tint, 0.45) : PALETTE.trackB;
      const levels = [[], []];
      for (let i = 0; i < FOG_LEVELS; i++) {
        const t = i / (FOG_LEVELS - 1);
        levels[0].push(mix(a, PALETTE.fog, t));
        levels[1].push(mix(b, PALETTE.fog, t));
      }
      out[theme] = levels;
    }
    return out;
  }

  /** Resize the backing store, honouring DPR, quality and a pixel budget. */
  resize(cssW, cssH, dpr) {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = dpr || 1;
    let ratio = Math.min(this.dpr, RENDER.MAX_DPR) * QUALITY_SCALE[this.quality];
    const pixels = this.cssW * this.cssH * ratio * ratio;
    if (pixels > RENDER.MAX_PIXELS) ratio *= Math.sqrt(RENDER.MAX_PIXELS / pixels);
    const w = Math.max(1, Math.round(this.cssW * ratio));
    const h = Math.max(1, Math.round(this.cssH * ratio));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.pxRatio = w / this.cssW;
    this.camera.resize(this.cssW, this.cssH);
    const ctx = this.ctx;
    const hz = this.camera.horizon;
    this.skyGrad = ctx.createLinearGradient(0, 0, 0, this.cssH);
    this.skyGrad.addColorStop(0, PALETTE.skyTop);
    this.skyGrad.addColorStop(Math.min(0.95, (hz / this.cssH) * 0.7), PALETTE.skyMid);
    this.skyGrad.addColorStop(Math.min(0.99, hz / this.cssH), PALETTE.horizon);
    this.skyGrad.addColorStop(1, PALETTE.void);
    this.horizonGrad = ctx.createLinearGradient(0, hz - 90, 0, hz + 8);
    this.horizonGrad.addColorStop(0, 'rgba(167,123,255,0)');
    this.horizonGrad.addColorStop(1, 'rgba(167,123,255,0.28)');
    this.vignette = ctx.createRadialGradient(this.cssW / 2, this.cssH * 0.55, Math.min(this.cssW, this.cssH) * 0.35, this.cssW / 2, this.cssH * 0.55, Math.max(this.cssW, this.cssH) * 0.8);
    this.vignette.addColorStop(0, 'rgba(0,0,0,0)');
    this.vignette.addColorStop(1, 'rgba(0,0,8,0.55)');
  }

  setQuality(level) {
    const q = Math.max(0, Math.min(2, level));
    if (q === this.quality) return false;
    this.quality = q;
    this.resize(this.cssW, this.cssH, this.dpr);
    return true;
  }

  // ---- frame ------------------------------------------------------------

  /**
   * @param {object} v view model assembled by Game (see Game.buildView)
   */
  render(v) {
    const ctx = this.ctx;
    const cam = this.camera;
    cam.curveScale = v.reducedEffects ? 0.6 : 1;
    ctx.setTransform(this.pxRatio, 0, 0, this.pxRatio, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    this.drawSky(v.time);

    ctx.save();
    if (v.shake > 0) ctx.translate(v.shakeX, v.shakeY);
    if (v.bank) {
      const pivotY = cam.horizon;
      ctx.translate(cam.cx, pivotY);
      ctx.rotate(v.bank);
      ctx.translate(-cam.cx, -pivotY);
    }
    if (this.quality > 0) this.drawVoidGrid();
    this.drawTrack(v);
    this.drawHoles(v.track);
    if (v.bestDistance > 50) this.drawBestMarker(v.bestDistance);
    this.drawObjects(v);
    this.drawParticles(v.particles);
    this.drawTexts(v.texts);
    ctx.restore();

    if (this.quality > 0) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    if (v.flash > 0.01) {
      ctx.globalAlpha = Math.min(0.6, v.flash);
      ctx.fillStyle = v.flashColor;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.globalAlpha = 1;
    }
  }

  drawSky(time) {
    const ctx = this.ctx;
    const cam = this.camera;
    const w = this.cssW;
    ctx.fillStyle = this.skyGrad;
    ctx.fillRect(0, 0, w, this.cssH);

    // Stars drift opposite to the (cosmetic) curve for a sense of turning.
    const shift = -cam.curve0 * 2.2 - cam.x * 3;
    ctx.fillStyle = '#cfe3ff';
    for (const s of this.stars) {
      let x = (s.x * w + shift) % w;
      if (x < 0) x += w;
      const y = s.y * cam.horizon * 0.95;
      ctx.globalAlpha = s.a * (0.75 + 0.25 * Math.sin(time * 1.3 + s.tw));
      ctx.fillRect(x, y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // Horizon glow.
    const hz = cam.horizon;
    ctx.fillStyle = this.horizonGrad;
    ctx.fillRect(0, hz - 90, w, 98);

    // Distant ridge silhouette with a neon edge (parallax with the curve).
    const n = this.ridge.length - 1;
    const span = w * 1.5;
    let off = (-cam.curve0 * 1.1 - cam.x * 1.5) % span;
    if (off > 0) off -= span;
    ctx.beginPath();
    ctx.moveTo(off, hz);
    for (let rep = 0; rep < 3; rep++) {
      for (let i = 0; i <= n; i++) {
        const x = off + rep * span + (i / n) * span;
        ctx.lineTo(x, hz - this.ridge[i] * 46);
      }
    }
    ctx.lineTo(off + 3 * span, hz);
    ctx.closePath();
    ctx.fillStyle = '#0a0a2a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(167,123,255,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawVoidGrid() {
    const ctx = this.ctx;
    const cam = this.camera;
    const P = this.P;
    const y = -16;
    ctx.strokeStyle = 'rgba(110,80,255,0.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const z0 = Math.ceil((cam.z + 6) / 14) * 14;
    for (let z = z0; z < cam.z + FAR; z += 14) {
      cam.project(cam.x - 90, y, z, P[0]);
      cam.project(cam.x + 90, y, z, P[1]);
      if (!P[0].visible) continue;
      ctx.moveTo(P[0].x, P[0].y);
      ctx.lineTo(P[1].x, P[1].y);
    }
    const base = Math.round(cam.x / 10) * 10;
    for (let k = -9; k <= 9; k++) {
      const x = base + k * 10;
      let first = true;
      for (const dz of [6, 14, 30, 60, 110, FAR]) {
        cam.project(x, y, cam.z + dz, P[0]);
        if (first) ctx.moveTo(P[0].x, P[0].y);
        else ctx.lineTo(P[0].x, P[0].y);
        first = false;
      }
    }
    ctx.stroke();
  }

  /** Two-pass neon stroke of the current path. */
  neon(color, width, alpha = 1) {
    const ctx = this.ctx;
    if (this.quality > 0) {
      ctx.globalAlpha = alpha * 0.22;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * 3.2;
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawTrack(v) {
    const ctx = this.ctx;
    const cam = this.camera;
    const H = TRACK.HALF_WIDTH;
    const track = v.track;
    const S = RENDER.SLICE;
    const nearZ = cam.z + cam.near + 0.05;
    let zFar = Math.floor((cam.z + FAR) / S) * S;

    // Project slice boundaries far -> near.
    let n = 0;
    const P = this.P;
    for (let z = zFar; n < MAX_SLICES; z -= S) {
      const zz = Math.max(z, nearZ);
      cam.project(-H, 0, zz, P[0]);
      cam.project(H, 0, zz, P[1]);
      this.sliceZ[n] = zz;
      this.sliceL[n] = P[0].x;
      this.sliceR[n] = P[1].x;
      this.sliceY[n] = P[0].y;
      this.sliceS[n] = P[0].s;
      n++;
      if (zz <= nearZ) break;
    }

    // Surface quads with stripes, distance fog and zone tint.
    for (let i = 0; i < n - 1; i++) {
      const zf = this.sliceZ[i];
      const zn = this.sliceZ[i + 1];
      const dz = zf - cam.z;
      const fog = Math.max(0, Math.min(1, (dz - 35) / (FAR - 35)));
      const theme = track.themeAt(zn);
      const palette = this.trackColors[theme] || this.trackColors[''];
      const stripe = Math.floor(zn / (S * 3)) & 1;
      ctx.fillStyle = palette[stripe][Math.round(fog * (FOG_LEVELS - 1))];
      ctx.beginPath();
      ctx.moveTo(this.sliceL[i], this.sliceY[i]);
      ctx.lineTo(this.sliceR[i], this.sliceY[i]);
      ctx.lineTo(this.sliceR[i + 1], this.sliceY[i + 1] + 0.5);
      ctx.lineTo(this.sliceL[i + 1], this.sliceY[i + 1] + 0.5);
      ctx.closePath();
      ctx.fill();
    }

    // Lane dashes and cross lines.
    ctx.beginPath();
    for (let i = 0; i < n - 1; i++) {
      if (Math.floor(this.sliceZ[i + 1] / 4) & 1) continue;
      for (const f of [1 / 3, 2 / 3]) {
        ctx.moveTo(this.sliceL[i] + (this.sliceR[i] - this.sliceL[i]) * f, this.sliceY[i]);
        ctx.lineTo(this.sliceL[i + 1] + (this.sliceR[i + 1] - this.sliceL[i + 1]) * f, this.sliceY[i + 1]);
      }
    }
    ctx.strokeStyle = withAlpha(PALETTE.lane, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (Math.abs(this.sliceZ[i] % 12) > 0.01) continue;
      ctx.moveTo(this.sliceL[i], this.sliceY[i]);
      ctx.lineTo(this.sliceR[i], this.sliceY[i]);
    }
    ctx.strokeStyle = withAlpha(PALETTE.rail, 0.12);
    ctx.stroke();

    // Side rails.
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(this.sliceL[i], this.sliceY[i]);
      else ctx.lineTo(this.sliceL[i], this.sliceY[i]);
    }
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(this.sliceR[i], this.sliceY[i]);
      else ctx.lineTo(this.sliceR[i], this.sliceY[i]);
    }
    this.neon(PALETTE.rail, 2, 0.9);
  }

  drawHoles(track) {
    const ctx = this.ctx;
    const cam = this.camera;
    const P = this.P;
    const nearZ = cam.z + cam.near + 0.05;
    for (const h of track.holes) {
      if (h.z1 < nearZ || h.z0 > cam.z + FAR) continue;
      const zA = Math.max(h.z0, nearZ);
      const zB = Math.min(h.z1, cam.z + FAR);
      const steps = Math.max(1, Math.ceil((zB - zA) / 3));
      // Void polygon following the cosmetic curve.
      ctx.beginPath();
      for (let k = 0; k <= steps; k++) {
        const z = zA + ((zB - zA) * k) / steps;
        cam.project(h.x0, 0, z, P[0]);
        if (k === 0) ctx.moveTo(P[0].x, P[0].y);
        else ctx.lineTo(P[0].x, P[0].y);
      }
      for (let k = steps; k >= 0; k--) {
        const z = zA + ((zB - zA) * k) / steps;
        cam.project(h.x1, 0, z, P[0]);
        ctx.lineTo(P[0].x, P[0].y);
      }
      ctx.closePath();
      ctx.fillStyle = PALETTE.void;
      ctx.fill();

      // Far wall of the gap (track thickness), visible from the camera.
      cam.project(h.x0, 0, zB, P[1]);
      cam.project(h.x1, 0, zB, P[2]);
      cam.project(h.x1, -1.4, zB, P[3]);
      cam.project(h.x0, -1.4, zB, P[4]);
      ctx.beginPath();
      ctx.moveTo(P[1].x, P[1].y);
      ctx.lineTo(P[2].x, P[2].y);
      ctx.lineTo(P[3].x, P[3].y);
      ctx.lineTo(P[4].x, P[4].y);
      ctx.closePath();
      ctx.fillStyle = '#1a0d33';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(P[1].x, P[1].y);
      ctx.lineTo(P[2].x, P[2].y);
      this.neon(PALETTE.danger, 2);

      // Near edge + side edges in danger colour.
      ctx.beginPath();
      if (h.z0 >= nearZ) {
        cam.project(h.x0, 0, h.z0, P[5]);
        cam.project(h.x1, 0, h.z0, P[6]);
        ctx.moveTo(P[5].x, P[5].y);
        ctx.lineTo(P[6].x, P[6].y);
      }
      for (const x of [h.x0, h.x1]) {
        if (Math.abs(Math.abs(x) - TRACK.HALF_WIDTH) < 0.01) continue;
        for (let k = 0; k <= steps; k++) {
          const z = zA + ((zB - zA) * k) / steps;
          cam.project(x, 0, z, P[0]);
          if (k === 0) ctx.moveTo(P[0].x, P[0].y);
          else ctx.lineTo(P[0].x, P[0].y);
        }
      }
      this.neon(PALETTE.danger, 2);

      // Warning chevrons on the approach.
      ctx.beginPath();
      const cx = (h.x0 + h.x1) / 2;
      const half = Math.min(1.2, (h.x1 - h.x0) / 2 - 0.2);
      for (let k = 1; k <= 3; k++) {
        const z = h.z0 - k * 3;
        if (z < nearZ) continue;
        cam.project(cx - half, 0, z - 1, P[7]);
        cam.project(cx, 0, z, P[8]);
        cam.project(cx + half, 0, z - 1, P[9]);
        ctx.moveTo(P[7].x, P[7].y);
        ctx.lineTo(P[8].x, P[8].y);
        ctx.lineTo(P[9].x, P[9].y);
      }
      this.neon(PALETTE.dangerSoft, 2, 0.7);
    }
  }

  drawBestMarker(zBest) {
    const cam = this.camera;
    const P = this.P;
    if (zBest < cam.z + cam.near + 0.5 || zBest > cam.z + FAR) return;
    const ctx = this.ctx;
    const alpha = Math.max(0, Math.min(1, (90 - (zBest - cam.z)) / 30));
    if (alpha <= 0) return;
    const H = TRACK.HALF_WIDTH;
    cam.project(-H, 0, zBest, P[0]);
    cam.project(H, 0, zBest, P[1]);
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y);
    ctx.lineTo(P[1].x, P[1].y);
    this.neon(PALETTE.orb, 2.5, alpha);
    const size = Math.max(10, Math.min(22, P[0].s * 0.45));
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = PALETTE.orb;
    ctx.fillText('BEST', (P[0].x + P[1].x) / 2, P[0].y - size * 0.4);
    ctx.globalAlpha = 1;
  }

  // ---- objects ------------------------------------------------------------

  drawObjects(v) {
    const cam = this.camera;
    const track = v.track;
    const list = this.list;
    list.length = 0;
    const nearZ = cam.z + cam.near;
    const farZ = cam.z + FAR;
    for (const o of track.obstacles) if (o.z1 > nearZ && o.z0 < farZ) list.push(o);
    for (const o of track.orbs) if (!o.collected && o.z > nearZ && o.z < farZ) list.push(o);
    for (const g of track.gates) if (g.z > nearZ && g.z < farZ) list.push(g);
    list.push(v.playerMarker);
    list.sort(depthDesc);

    for (const o of list) {
      if (o === v.playerMarker) this.drawPlayer(v);
      else if (o.kind !== undefined) this.drawBox(o, v.time);
      else if (o.collected !== undefined) this.drawOrb(o, v.time);
      else this.drawGateFrame(o);
    }
  }

  fade(z) {
    const dz = z - this.camera.z;
    return Math.max(0, Math.min(1, (FAR - dz) / 30));
  }

  drawBox(o, time) {
    const cam = this.camera;
    const nearZ = cam.z + cam.near + 0.02;
    const alpha = this.fade(o.z0);
    if (alpha <= 0) return;
    let color = PALETTE.danger;
    let fillA = 0.22;
    if (o.kind === 'hurdle') {
      color = PALETTE.dangerSoft;
      fillA = 0.5;
    } else if (o.kind === 'mover') {
      color = PALETTE.mover;
      fillA = 0.4;
    } else if (o.kind === 'post') {
      const g = o.gate;
      color = g && g.resolved ? tierColor(g.result) : PALETTE.gate;
      fillA = 0.55;
    }
    if (o.hitFlash > 0) color = PALETTE.white;
    const x0 = o.x - o.w / 2;
    const x1 = o.x + o.w / 2;
    // Long boxes are split so their edges follow the cosmetic curve.
    const zEnd = o.z1;
    const zStart = Math.max(o.z0, nearZ);
    if (zEnd <= zStart) return;
    const chunks = Math.max(1, Math.ceil((zEnd - zStart) / 4));
    for (let c = chunks - 1; c >= 0; c--) {
      const za = zStart + ((zEnd - zStart) * c) / chunks;
      const zb = zStart + ((zEnd - zStart) * (c + 1)) / chunks;
      this.drawBoxChunk(x0, x1, o.h, za, zb, color, fillA * alpha, alpha, c === 0, o.kind === 'mover' ? time : -1);
    }
  }

  drawBoxChunk(x0, x1, h, zn, zf, color, fillA, alpha, front, pulseTime) {
    const ctx = this.ctx;
    const cam = this.camera;
    const P = this.P;
    const nTL = cam.project(x0, h, zn, P[0]);
    const nTR = cam.project(x1, h, zn, P[1]);
    const nBR = cam.project(x1, 0, zn, P[2]);
    const nBL = cam.project(x0, 0, zn, P[3]);
    const fTL = cam.project(x0, h, zf, P[4]);
    const fTR = cam.project(x1, h, zf, P[5]);
    const fBR = cam.project(x1, 0, zf, P[6]);
    const fBL = cam.project(x0, 0, zf, P[7]);
    if (!nTL.visible || !fTL.visible) return;
    const quad = (a, b, c, d) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
    };
    ctx.fillStyle = color;
    if (fBL.x < nBL.x) {
      quad(nTL, fTL, fBL, nBL);
      ctx.globalAlpha = fillA * 0.7;
      ctx.fill();
    }
    if (fBR.x > nBR.x) {
      quad(nTR, fTR, fBR, nBR);
      ctx.globalAlpha = fillA * 0.7;
      ctx.fill();
    }
    if (cam.y > h) {
      quad(nTL, nTR, fTR, fTL);
      ctx.globalAlpha = Math.min(1, fillA * 1.6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const lw = Math.max(1, Math.min(3, nTL.s * 0.05));
    // Top far edge + verticals give the neon silhouette.
    ctx.beginPath();
    ctx.moveTo(fTL.x, fTL.y);
    ctx.lineTo(fTR.x, fTR.y);
    ctx.moveTo(nTL.x, nTL.y);
    ctx.lineTo(fTL.x, fTL.y);
    ctx.moveTo(nTR.x, nTR.y);
    ctx.lineTo(fTR.x, fTR.y);
    this.neon(color, lw * 0.8, alpha * 0.8);
    if (front) {
      quad(nTL, nTR, nBR, nBL);
      const pulse = pulseTime >= 0 ? 0.08 * Math.sin(pulseTime * 8) : 0;
      ctx.globalAlpha = Math.min(1, fillA + pulse);
      ctx.fill();
      ctx.globalAlpha = 1;
      this.neon(color, lw, alpha);
    }
  }

  drawGateFrame(g) {
    const cam = this.camera;
    const P = this.P;
    const ctx = this.ctx;
    const alpha = this.fade(g.z);
    const off = g.width / 2 + GATE_POST_WIDTH;
    const color = g.resolved ? tierColor(g.result) : PALETTE.gate;
    cam.project(g.x - off, GATE_HEIGHT, g.z, P[0]);
    cam.project(g.x + off, GATE_HEIGHT, g.z, P[1]);
    if (!P[0].visible) return;
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y);
    ctx.lineTo(P[1].x, P[1].y);
    this.neon(color, Math.max(1.5, P[0].s * 0.08), alpha);
    // Centre guide: a small diamond on the floor and a faint centre line.
    cam.project(g.x, 0.02, g.z, P[2]);
    cam.project(g.x, GATE_HEIGHT, g.z, P[3]);
    const d = Math.max(3, P[2].s * 0.18);
    ctx.beginPath();
    ctx.moveTo(P[2].x, P[2].y - d * 0.5);
    ctx.lineTo(P[2].x + d, P[2].y);
    ctx.lineTo(P[2].x, P[2].y + d * 0.5);
    ctx.lineTo(P[2].x - d, P[2].y);
    ctx.closePath();
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = PALETTE.perfect;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(P[2].x, P[2].y);
    ctx.lineTo(P[3].x, P[3].y);
    ctx.globalAlpha = alpha * 0.18;
    ctx.strokeStyle = PALETTE.perfect;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (g.flash > 0) {
      ctx.globalAlpha = g.flash * 0.5;
      ctx.fillStyle = color;
      ctx.fillRect(P[0].x, P[0].y, P[1].x - P[0].x, P[2].y - P[0].y);
      ctx.globalAlpha = 1;
    }
  }

  drawOrb(o, time) {
    const cam = this.camera;
    const q = cam.project(o.x, o.y + 0.1 * Math.sin(time * 4 + o.z * 0.7), o.z, this.q);
    if (!q.visible) return;
    const ctx = this.ctx;
    const alpha = this.fade(o.z);
    const glow = q.s * 1.5 * (1 + 0.08 * Math.sin(time * 6 + o.z));
    ctx.globalAlpha = alpha * 0.9;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.orbGlow, q.x - glow / 2, q.y - glow / 2, glow, glow);
    ctx.globalCompositeOperation = 'source-over';
    const core = q.s * 0.42;
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.orbCore, q.x - core / 2, q.y - core / 2, core, core);
    ctx.globalAlpha = 1;
  }

  // ---- player & ghost ---------------------------------------------------

  skinColors(skin, time) {
    if (skin.glow !== 'prism') return skin;
    const hue = (time * 70) % 360;
    const c = hslToHex(hue, 100, 62);
    return { core: '#ffffff', glow: c, trail: hslToHex((hue + 40) % 360, 100, 65) };
  }

  drawPlayer(v) {
    const ctx = this.ctx;
    const cam = this.camera;
    const r = v.radius;
    const colors = this.skinColors(v.skin, v.time);

    // Ghost of the best run, same depth as the player.
    if (v.ghostVisible) {
      const g = cam.project(v.ghostX, v.ghostY + r, v.pz, this.q);
      if (g.visible) {
        const gr = r * g.s;
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = PALETTE.white;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(g.x, g.y, gr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    if (!v.playerVisible) return;

    // Contact shadow on the floor (only where there is floor).
    if (v.shadow) {
      const sh = cam.project(v.px, 0, v.pz, this.q);
      if (sh.visible) {
        const k = Math.max(0.35, 1 - v.py * 0.35);
        ctx.globalAlpha = 0.45 * k;
        ctx.fillStyle = '#000010';
        ctx.beginPath();
        ctx.ellipse(sh.x, sh.y, r * sh.s * 1.1 * k, r * sh.s * 0.35 * k, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Trail (world-space history).
    const trail = v.trail;
    ctx.globalCompositeOperation = 'lighter';
    const trailSprite = glowSprite(colors.trail, 64);
    for (let i = 0; i < trail.count; i++) {
      const idx = (trail.head - 1 - i + trail.size) % trail.size;
      const tq = cam.project(trail.x[idx], trail.y[idx] + r, trail.z[idx], this.q);
      if (!tq.visible) continue;
      const k = 1 - i / trail.size;
      const sz = r * tq.s * 2.2 * k;
      ctx.globalAlpha = 0.28 * k;
      ctx.drawImage(trailSprite, tq.x - sz / 2, tq.y - sz / 2, sz, sz);
    }

    const q = cam.project(v.px, v.py + r, v.pz, this.q);
    if (!q.visible) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      return;
    }
    const pr = r * q.s;
    const glow = pr * 4.2;
    ctx.globalAlpha = 0.55 * v.playerAlpha;
    ctx.drawImage(glowSprite(colors.glow, 128), q.x - glow / 2, q.y - glow / 2, glow, glow);
    ctx.globalCompositeOperation = 'source-over';

    const sx = pr * (1 + v.squash * 0.25);
    const sy = pr * (1 - v.squash * 0.25);
    ctx.globalAlpha = v.playerAlpha;
    ctx.drawImage(ballSprite(colors.core, colors.glow, 128), q.x - sx, q.y - sy + (pr - sy), sx * 2, sy * 2);

    // Rolling equator band.
    ctx.strokeStyle = withAlpha('#ffffff', 0.55 * v.playerAlpha);
    ctx.lineWidth = Math.max(1, pr * 0.08);
    for (let k = 0; k < 2; k++) {
      const ph = v.roll + k * Math.PI;
      const c = Math.cos(ph);
      if (c <= 0) continue;
      const yo = Math.sin(ph) * sy * 0.8;
      const wv = sx * Math.sqrt(Math.max(0, 1 - (yo / sy) ** 2)) * 0.95;
      ctx.beginPath();
      ctx.ellipse(q.x, q.y + (pr - sy) + yo, wv, Math.max(1, pr * 0.16 * c), 0, 0, Math.PI);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawParticles(ps) {
    if (!ps.count) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const q = this.q;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ps.count; i++) {
      cam.project(ps.x[i], ps.y[i], ps.z[i], q);
      if (!q.visible) continue;
      const sz = Math.min(160, ps.size[i] * q.s);
      if (sz < 0.5) continue;
      ctx.globalAlpha = Math.min(1, ps.life[i] / ps.maxLife[i]) * 0.9;
      ctx.drawImage(this.particleSprites[ps.color[i]], q.x - sz / 2, q.y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawTexts(texts) {
    const ctx = this.ctx;
    const cam = this.camera;
    const q = this.q;
    ctx.textAlign = 'center';
    for (const t of texts) {
      if (t.life <= 0) continue;
      cam.project(t.x, t.y, t.z, q);
      if (!q.visible) continue;
      const k = t.life / t.maxLife;
      const size = Math.round(Math.max(13, Math.min(30, q.s * 0.55)) * t.scale);
      ctx.font = `800 ${size}px system-ui, sans-serif`;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.fillStyle = '#000014';
      const y = q.y - (1 - k) * 46;
      ctx.fillText(t.text, q.x + 1.5, y + 1.5);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, q.x, y);
    }
    ctx.globalAlpha = 1;
  }
}

/** Painter's order: farthest first. Obstacles sort by their near face. */
function depthDesc(a, b) {
  return (b.z0 !== undefined ? b.z0 : b.z) - (a.z0 !== undefined ? a.z0 : a.z);
}

export function tierColor(tier) {
  switch (tier) {
    case 'PERFECT':
      return PALETTE.perfect;
    case 'GOOD':
      return PALETTE.good;
    case 'OK':
      return PALETTE.ok;
    case 'MISS':
      return PALETTE.miss;
    default:
      return PALETTE.gate;
  }
}
