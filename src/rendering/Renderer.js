import { RENDER, TRACK } from '../config.js';
import { GATE_HEIGHT, GATE_POST_WIDTH } from '../world/Track.js';
import { Camera } from './Camera.js';
import { glowSprite, ballSprite, shadowSprite, withAlpha, mix, hslToHex } from './sprites.js';
import { FONT_DISPLAY } from '../ui/fonts.js';

/**
 * Canvas 2D pseudo-3D renderer. A read-only view of the simulation:
 * it interpolates and projects, but never writes gameplay state.
 * Heights of obstacles/orbs are relative to the terrain; the renderer adds
 * the local surface height when projecting.
 */

export const PALETTE = Object.freeze({
  skyTop: '#02030b',
  skyMid: '#070b26',
  horizon: '#1d0f45',
  void: '#02030a',
  trackA: '#0c1640',
  trackB: '#0a1335',
  fog: '#150d3a',
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
const MAX_SLICES = Math.ceil(FAR / RENDER.SLICE) + 24;
const QUALITY_SCALE = [0.7, 0.85, 1];
const RAIL_BUCKETS = 4;
const RAIL_ALPHA = [1, 0.62, 0.32, 0.12];
const H = TRACK.HALF_WIDTH;

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
    // Slice boundaries (far -> near). Far edge of a quad uses the left-limit
    // height (yB); near edge uses the right-limit height (yA): this keeps
    // drop-offs and ramp lips crisp.
    this.sZ = new Float64Array(MAX_SLICES);
    this.sLA = new Float32Array(MAX_SLICES);
    this.sRA = new Float32Array(MAX_SLICES);
    this.sYA = new Float32Array(MAX_SLICES);
    this.sLB = new Float32Array(MAX_SLICES);
    this.sRB = new Float32Array(MAX_SLICES);
    this.sYB = new Float32Array(MAX_SLICES);
    this.sS = new Float32Array(MAX_SLICES);
    this.sCount = 0;
    this.stars = this.makeStars(150);
    this.ridge = this.makeRidge();
    this.trackColors = this.buildTrackPalette();
    this.particleSprites = PARTICLE_COLORS.map((c) => glowSprite(c, 64));
    this.orbGlow = glowSprite(PALETTE.orb, 96);
    this.orbCore = ballSprite('#fff4d0', '#ffb02e', 64);
    this.shadow = shadowSprite(128);
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
    for (let i = 0; i <= 48; i++) pts.push(0.15 + rnd() * 0.85 * (0.5 + 0.5 * Math.sin(i * 0.7)));
    return pts;
  }

  buildTrackPalette() {
    const out = {};
    for (const theme of Object.keys(THEME_TINT)) {
      const tint = THEME_TINT[theme];
      const a = tint ? mix(PALETTE.trackA, tint, 0.4) : PALETTE.trackA;
      const b = tint ? mix(PALETTE.trackB, tint, 0.4) : PALETTE.trackB;
      const levels = [[], []];
      for (let i = 0; i < FOG_LEVELS; i++) {
        const t = Math.pow(i / (FOG_LEVELS - 1), 0.8);
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
    this.horizonGrad = ctx.createLinearGradient(0, hz - 110, 0, hz + 10);
    this.horizonGrad.addColorStop(0, 'rgba(167,123,255,0)');
    this.horizonGrad.addColorStop(0.7, 'rgba(200,90,255,0.16)');
    this.horizonGrad.addColorStop(1, 'rgba(255,80,190,0.3)');
    this.vignette = ctx.createRadialGradient(this.cssW / 2, this.cssH * 0.55, Math.min(this.cssW, this.cssH) * 0.35, this.cssW / 2, this.cssH * 0.55, Math.max(this.cssW, this.cssH) * 0.8);
    this.vignette.addColorStop(0, 'rgba(0,0,0,0)');
    this.vignette.addColorStop(1, 'rgba(0,0,8,0.6)');
  }

  setQuality(level) {
    const q = Math.max(0, Math.min(2, level));
    if (q === this.quality) return false;
    this.quality = q;
    this.resize(this.cssW, this.cssH, this.dpr);
    return true;
  }

  // ---- frame ------------------------------------------------------------

  /** @param {object} v view model assembled by Game (see Game.frameUpdate) */
  render(v) {
    const ctx = this.ctx;
    const cam = this.camera;
    cam.curveScale = v.reducedEffects ? 0.6 : 1;
    ctx.setTransform(this.pxRatio, 0, 0, this.pxRatio, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    if (v.shake > 0) ctx.translate(v.shakeX, v.shakeY);
    if (v.bank) {
      ctx.translate(cam.cx, cam.horizon);
      ctx.rotate(v.bank);
      ctx.translate(-cam.cx, -cam.horizon);
    }
    this.drawSky(v.time);
    if (this.quality > 0) this.drawVoidGrid();
    this.buildSlices(v.track);
    this.drawTrack(v.track);
    this.drawHoles(v.track);
    this.drawLips(v.track);
    if (v.bestDistance > 50) this.drawBestMarker(v.track, v.bestDistance);
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
    const shiftY = cam.horizonEff - cam.horizon;
    ctx.save();
    ctx.translate(0, shiftY);
    ctx.fillStyle = this.skyGrad;
    ctx.fillRect(-60, -Math.abs(shiftY) - 60, w + 120, this.cssH + 2 * Math.abs(shiftY) + 120);

    const shift = -cam.curve0 * 2.2 - cam.x * 3;
    ctx.fillStyle = '#cfe3ff';
    for (const s of this.stars) {
      let x = (s.x * w + shift) % w;
      if (x < 0) x += w;
      ctx.globalAlpha = s.a * (0.75 + 0.25 * Math.sin(time * 1.3 + s.tw));
      ctx.fillRect(x, s.y * cam.horizon * 0.95, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    const hz = cam.horizon;
    ctx.fillStyle = this.horizonGrad;
    ctx.fillRect(-60, hz - 110, w + 120, 120);

    const n = this.ridge.length - 1;
    const span = w * 1.5;
    let off = (-cam.curve0 * 1.1 - cam.x * 1.5) % span;
    if (off > 0) off -= span;
    ctx.beginPath();
    ctx.moveTo(off, hz);
    for (let rep = 0; rep < 3; rep++) {
      for (let i = 0; i <= n; i++) ctx.lineTo(off + rep * span + (i / n) * span, hz - this.ridge[i] * 46);
    }
    ctx.lineTo(off + 3 * span, hz);
    ctx.closePath();
    ctx.fillStyle = '#07061c';
    ctx.fill();
    ctx.restore();
  }

  drawVoidGrid() {
    const ctx = this.ctx;
    const cam = this.camera;
    const P = this.P;
    const y = cam.y - 26;
    ctx.strokeStyle = 'rgba(110,80,255,0.1)';
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
      let first = true;
      for (const dz of [6, 14, 30, 60, 110, FAR]) {
        cam.project(base + k * 10, y, cam.z + dz, P[0]);
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
      ctx.globalAlpha = alpha * 0.2;
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

  // ---- track ------------------------------------------------------------

  /** Project slice boundaries far -> near, splitting at drop-offs. */
  buildSlices(track) {
    const cam = this.camera;
    const terrain = track.terrain;
    const S = RENDER.SLICE;
    const nearZ = cam.z + cam.near + 0.05;
    const P = this.P;
    let n = 0;
    let dropIdx = terrain.drops.length - 1;
    const push = (z) => {
      const yB = terrain.heightBefore(z);
      const yA = terrain.heightAt(z);
      cam.project(-H, yA, z, P[0]);
      cam.project(H, yA, z, P[1]);
      this.sZ[n] = z;
      this.sLA[n] = P[0].x;
      this.sRA[n] = P[1].x;
      this.sYA[n] = P[0].y;
      this.sS[n] = P[0].s;
      if (yB !== yA) {
        cam.project(-H, yB, z, P[0]);
        cam.project(H, yB, z, P[1]);
      }
      this.sLB[n] = P[0].x;
      this.sRB[n] = P[1].x;
      this.sYB[n] = P[0].y;
      n++;
    };
    let z = Math.floor((cam.z + FAR) / S) * S;
    while (n < MAX_SLICES - 2) {
      const zz = Math.max(z, nearZ);
      // Insert any drop-offs between the previous boundary and this one.
      while (dropIdx >= 0 && terrain.drops[dropIdx].z > zz) {
        const dz = terrain.drops[dropIdx].z;
        if (dz < cam.z + FAR && (n === 0 || dz < this.sZ[n - 1])) push(dz);
        dropIdx--;
      }
      push(zz);
      if (zz <= nearZ) break;
      z -= S;
    }
    this.sCount = n;
  }

  drawTrack(track) {
    const ctx = this.ctx;
    const cam = this.camera;
    const n = this.sCount;
    const S = RENDER.SLICE;

    // Surface quads with stripes, distance fog and zone tint.
    for (let i = 0; i < n - 1; i++) {
      const zf = this.sZ[i];
      const zn = this.sZ[i + 1];
      if (zf - zn < 1e-6) continue;
      const fog = Math.max(0, Math.min(1, (zf - cam.z - 30) / (FAR - 30)));
      const palette = this.trackColors[track.themeAt(zn)] || this.trackColors[''];
      const stripe = Math.floor(zn / (S * 3)) & 1;
      ctx.fillStyle = palette[stripe][Math.round(fog * (FOG_LEVELS - 1))];
      ctx.beginPath();
      ctx.moveTo(this.sLB[i], this.sYB[i]);
      ctx.lineTo(this.sRB[i], this.sYB[i]);
      ctx.lineTo(this.sRA[i + 1], this.sYA[i + 1] + 0.6);
      ctx.lineTo(this.sLA[i + 1], this.sYA[i + 1] + 0.6);
      ctx.closePath();
      ctx.fill();
    }

    // Lane dashes.
    ctx.beginPath();
    for (let i = 0; i < n - 1; i++) {
      if (Math.floor(this.sZ[i + 1] / 4) & 1) continue;
      for (const f of [1 / 3, 2 / 3]) {
        ctx.moveTo(this.sLB[i] + (this.sRB[i] - this.sLB[i]) * f, this.sYB[i]);
        ctx.lineTo(this.sLA[i + 1] + (this.sRA[i + 1] - this.sLA[i + 1]) * f, this.sYA[i + 1]);
      }
    }
    ctx.strokeStyle = withAlpha(PALETTE.lane, 0.28);
    ctx.lineWidth = 1;
    ctx.stroke();

    this.drawRails();
  }

  /**
   * Edges as soft light bands in world units (perspective-correct width),
   * fading with distance and blended additively — no hard outlines.
   */
  drawRails() {
    const ctx = this.ctx;
    const cam = this.camera;
    const n = this.sCount;
    const bands = this.quality > 0
      ? [
          [-0.7, 0, 0.05], // halo spilling into the void
          [0, 0.75, 0.07], // inner glow on the deck
          [0, 0.14, 0.42], // bright edge core
        ]
      : [[0, 0.14, 0.45]];
    ctx.globalCompositeOperation = 'lighter';
    for (let b = 0; b < RAIL_BUCKETS; b++) {
      for (const [inA, inB, alpha] of bands) {
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < n - 1; i++) {
          const dz = this.sZ[i] - cam.z;
          const bucket = Math.min(RAIL_BUCKETS - 1, Math.floor((dz / FAR) * RAIL_BUCKETS * 1.15));
          if (bucket !== b || this.sZ[i] - this.sZ[i + 1] < 1e-6) continue;
          any = true;
          // Interpolate band edges across the deck (fraction of full width).
          const fa = inA / (2 * H);
          const fb = inB / (2 * H);
          for (const side of [0, 1]) {
            const lF = side ? this.sRB[i] : this.sLB[i];
            const wF = (this.sRB[i] - this.sLB[i]) * (side ? -1 : 1);
            const lN = side ? this.sRA[i + 1] : this.sLA[i + 1];
            const wN = (this.sRA[i + 1] - this.sLA[i + 1]) * (side ? -1 : 1);
            ctx.moveTo(lF + wF * fa, this.sYB[i]);
            ctx.lineTo(lF + wF * fb, this.sYB[i]);
            ctx.lineTo(lN + wN * fb, this.sYA[i + 1] + 0.5);
            ctx.lineTo(lN + wN * fa, this.sYA[i + 1] + 0.5);
            ctx.closePath();
          }
        }
        if (!any) continue;
        ctx.fillStyle = withAlpha(PALETTE.rail, alpha * RAIL_ALPHA[b]);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Bright edge where the deck ends at a ramp lip or drop-off. */
  drawLips(track) {
    const cam = this.camera;
    const P = this.P;
    const ctx = this.ctx;
    for (const d of track.terrain.drops) {
      if (d.z < cam.z + cam.near + 0.2 || d.z > cam.z + FAR) continue;
      cam.project(-H, d.high, d.z, P[0]);
      cam.project(H, d.high, d.z, P[1]);
      ctx.beginPath();
      ctx.moveTo(P[0].x, P[0].y);
      ctx.lineTo(P[1].x, P[1].y);
      this.neon(PALETTE.perfect, Math.max(1.5, P[0].s * 0.05), this.fade(d.z));
    }
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
      const yAt = (z) => track.heightAt(z);
      ctx.beginPath();
      for (let k = 0; k <= steps; k++) {
        const z = zA + ((zB - zA) * k) / steps;
        cam.project(h.x0, yAt(z), z, P[0]);
        if (k === 0) ctx.moveTo(P[0].x, P[0].y);
        else ctx.lineTo(P[0].x, P[0].y);
      }
      for (let k = steps; k >= 0; k--) {
        const z = zA + ((zB - zA) * k) / steps;
        cam.project(h.x1, yAt(z), z, P[0]);
        ctx.lineTo(P[0].x, P[0].y);
      }
      ctx.closePath();
      ctx.fillStyle = PALETTE.void;
      ctx.fill();

      // Far wall of the gap (deck thickness), visible from the camera.
      const yb = yAt(zB);
      cam.project(h.x0, yb, zB, P[1]);
      cam.project(h.x1, yb, zB, P[2]);
      cam.project(h.x1, yb - 1.4, zB, P[3]);
      cam.project(h.x0, yb - 1.4, zB, P[4]);
      ctx.beginPath();
      ctx.moveTo(P[1].x, P[1].y);
      ctx.lineTo(P[2].x, P[2].y);
      ctx.lineTo(P[3].x, P[3].y);
      ctx.lineTo(P[4].x, P[4].y);
      ctx.closePath();
      ctx.fillStyle = '#170b2e';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(P[1].x, P[1].y);
      ctx.lineTo(P[2].x, P[2].y);
      this.neon(PALETTE.danger, 2);

      // Near edge + inner side edges in danger colour.
      ctx.beginPath();
      if (h.z0 >= nearZ) {
        const y0 = track.terrain.heightBefore(h.z0);
        cam.project(h.x0, y0, h.z0, P[5]);
        cam.project(h.x1, y0, h.z0, P[6]);
        ctx.moveTo(P[5].x, P[5].y);
        ctx.lineTo(P[6].x, P[6].y);
      }
      for (const x of [h.x0, h.x1]) {
        if (Math.abs(Math.abs(x) - H) < 0.01) continue;
        for (let k = 0; k <= steps; k++) {
          const z = zA + ((zB - zA) * k) / steps;
          cam.project(x, yAt(z), z, P[0]);
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
        if (z - 1 < nearZ) continue;
        cam.project(cx - half, yAt(z - 1), z - 1, P[7]);
        cam.project(cx, yAt(z), z, P[8]);
        cam.project(cx + half, yAt(z - 1), z - 1, P[9]);
        ctx.moveTo(P[7].x, P[7].y);
        ctx.lineTo(P[8].x, P[8].y);
        ctx.lineTo(P[9].x, P[9].y);
      }
      this.neon(PALETTE.dangerSoft, 2, 0.7);
    }
  }

  drawBestMarker(track, zBest) {
    const cam = this.camera;
    const P = this.P;
    if (zBest < cam.z + cam.near + 0.5 || zBest > cam.z + FAR) return;
    const alpha = Math.max(0, Math.min(1, (90 - (zBest - cam.z)) / 30));
    if (alpha <= 0) return;
    const ctx = this.ctx;
    const y = track.heightAt(zBest);
    cam.project(-H, y, zBest, P[0]);
    cam.project(H, y, zBest, P[1]);
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y);
    ctx.lineTo(P[1].x, P[1].y);
    this.neon(PALETTE.orb, 2.5, alpha);
    const size = Math.max(10, Math.min(22, P[0].s * 0.45));
    ctx.font = `italic 800 ${size}px ${FONT_DISPLAY}`;
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
      else if (o.kind !== undefined) this.drawBox(track, o, v.time);
      else if (o.collected !== undefined) this.drawOrb(track, o, v.time);
      else this.drawGateFrame(track, o);
    }
  }

  fade(z) {
    const dz = z - this.camera.z;
    return Math.max(0, Math.min(1, (FAR - dz) / 30));
  }

  drawBox(track, o, time) {
    const cam = this.camera;
    const nearZ = cam.z + cam.near + 0.02;
    const alpha = this.fade(o.z0);
    if (alpha <= 0) return;
    let color = PALETTE.danger;
    let fillA = 0.24;
    if (o.kind === 'hurdle') {
      color = PALETTE.dangerSoft;
      fillA = 0.5;
    } else if (o.kind === 'mover') {
      color = PALETTE.mover;
      fillA = 0.42;
    } else if (o.kind === 'post') {
      const g = o.gate;
      color = g && g.resolved ? tierColor(g.result) : PALETTE.gate;
      fillA = 0.55;
    }
    if (o.hitFlash > 0) color = PALETTE.white;
    const x0 = o.x - o.w / 2;
    const x1 = o.x + o.w / 2;
    const zEnd = o.z1;
    const zStart = Math.max(o.z0, nearZ);
    if (zEnd <= zStart) return;
    // Split long boxes so they follow the cosmetic curve and the terrain.
    const chunks = Math.max(1, Math.ceil((zEnd - zStart) / 4));
    for (let c = chunks - 1; c >= 0; c--) {
      const za = zStart + ((zEnd - zStart) * c) / chunks;
      const zb = zStart + ((zEnd - zStart) * (c + 1)) / chunks;
      this.drawBoxChunk(x0, x1, o.h, za, zb, track.heightAt(za), track.heightAt(zb), color, fillA * alpha, alpha, c === 0, o.kind === 'mover' ? time : -1);
    }
  }

  drawBoxChunk(x0, x1, h, zn, zf, bn, bf, color, fillA, alpha, front, pulseTime) {
    const ctx = this.ctx;
    const cam = this.camera;
    const P = this.P;
    const nTL = cam.project(x0, bn + h, zn, P[0]);
    const nTR = cam.project(x1, bn + h, zn, P[1]);
    const nBR = cam.project(x1, bn, zn, P[2]);
    const nBL = cam.project(x0, bn, zn, P[3]);
    const fTL = cam.project(x0, bf + h, zf, P[4]);
    const fTR = cam.project(x1, bf + h, zf, P[5]);
    const fBR = cam.project(x1, bf, zf, P[6]);
    const fBL = cam.project(x0, bf, zf, P[7]);
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
    if (fTL.y < nTL.y) {
      quad(nTL, nTR, fTR, fTL);
      ctx.globalAlpha = Math.min(1, fillA * 1.6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const lw = Math.max(1, Math.min(3, nTL.s * 0.05));
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

  drawGateFrame(track, g) {
    const cam = this.camera;
    const P = this.P;
    const ctx = this.ctx;
    const alpha = this.fade(g.z);
    const off = g.width / 2 + GATE_POST_WIDTH;
    const base = track.heightAt(g.z);
    const color = g.resolved ? tierColor(g.result) : PALETTE.gate;
    cam.project(g.x - off, base + GATE_HEIGHT, g.z, P[0]);
    cam.project(g.x + off, base + GATE_HEIGHT, g.z, P[1]);
    if (!P[0].visible) return;
    ctx.beginPath();
    ctx.moveTo(P[0].x, P[0].y);
    ctx.lineTo(P[1].x, P[1].y);
    this.neon(color, Math.max(1.5, P[0].s * 0.08), alpha);
    cam.project(g.x, base + 0.02, g.z, P[2]);
    cam.project(g.x, base + GATE_HEIGHT, g.z, P[3]);
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

  drawOrb(track, o, time) {
    const cam = this.camera;
    const y = track.heightAt(o.z) + o.y + 0.1 * Math.sin(time * 4 + o.z * 0.7);
    const q = cam.project(o.x, y, o.z, this.q);
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
    return { core: '#ffffff', glow: hslToHex(hue, 100, 62), trail: hslToHex((hue + 40) % 360, 100, 65) };
  }

  drawPlayer(v) {
    const ctx = this.ctx;
    const cam = this.camera;
    const r = v.radius;
    const colors = this.skinColors(v.skin, v.time);

    if (v.ghostVisible) {
      const g = cam.project(v.ghostX, v.ghostY + r, v.pz, this.q);
      if (g.visible) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = PALETTE.white;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(g.x, g.y, r * g.s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    if (!v.playerVisible) return;

    // Soft contact shadow on the deck: widens and fades with height.
    if (v.shadow) {
      const sh = cam.project(v.px, v.groundY, v.pz, this.q);
      if (sh.visible) {
        const height = Math.max(0, v.py - v.groundY);
        const k = 1 / (1 + height * 0.45);
        const w = r * sh.s * (2.6 + height * 0.5);
        const hgt = w * 0.32;
        ctx.globalAlpha = 0.7 * k * v.playerAlpha;
        ctx.drawImage(this.shadow, sh.x - w / 2, sh.y - hgt / 2, w, hgt);
        ctx.globalAlpha = 1;
      }
    }

    const trail = v.trail;
    ctx.globalCompositeOperation = 'lighter';
    const trailSprite = glowSprite(colors.trail, 64);
    for (let i = 0; i < trail.count; i++) {
      const idx = (trail.head - 1 - i + trail.size) % trail.size;
      const tq = cam.project(trail.x[idx], trail.y[idx] + r, trail.z[idx], this.q);
      if (!tq.visible) continue;
      const k = 1 - i / trail.size;
      const sz = r * tq.s * 2.2 * k;
      ctx.globalAlpha = 0.26 * k;
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
    ctx.globalAlpha = 0.5 * v.playerAlpha;
    ctx.drawImage(glowSprite(colors.glow, 128), q.x - glow / 2, q.y - glow / 2, glow, glow);
    ctx.globalCompositeOperation = 'source-over';

    const sx = pr * (1 + v.squash * 0.25);
    const sy = pr * (1 - v.squash * 0.25);
    ctx.globalAlpha = v.playerAlpha;
    ctx.drawImage(ballSprite(colors.core, colors.glow, 128), q.x - sx, q.y - sy + (pr - sy), sx * 2, sy * 2);

    ctx.strokeStyle = withAlpha('#ffffff', 0.5 * v.playerAlpha);
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
      const size = Math.round(Math.max(13, Math.min(28, q.s * 0.5)) * t.scale);
      ctx.font = `italic 800 ${size}px ${FONT_DISPLAY}`;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      const y = q.y - (1 - k) * 46;
      ctx.fillStyle = '#000014';
      ctx.fillText(t.text, q.x + 2, y + 2);
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
