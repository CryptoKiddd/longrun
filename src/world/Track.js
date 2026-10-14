import { TRACK } from '../config.js';
import { Terrain } from './Terrain.js';

/**
 * Live course contents in world coordinates, built from segment specs.
 * Objects are pooled and recycled once the player has passed them.
 *
 * Obstacle kinds: 'wall' (tall, steer around), 'hurdle' (low, jump or steer),
 * 'mover' (oscillates laterally), 'post' (precision-gate post).
 * Movers are driven by the PLAYER'S distance, not wall-clock time, so their
 * position at any point of the course is deterministic and validatable.
 *
 * Elevation lives in `terrain`. Obstacle and orb heights are RELATIVE to the
 * local surface, so hazards always sit on the track whatever its slope.
 */

export const GATE_POST_WIDTH = 0.35;
export const GATE_HEIGHT = 2.9;

/** Lateral centre of a moving obstacle when the player is at distance playerZ. */
export function moverX(o, playerZ) {
  return o.baseX + o.amp * Math.sin(o.freq * (playerZ - o.z0) + o.phase);
}

function makeObstacle() {
  return { kind: 'wall', x: 0, baseX: 0, w: 1, d: 1, h: 1, z0: 0, z1: 1, amp: 0, freq: 0, phase: 0, gate: null, hitFlash: 0 };
}
function makeHole() {
  return { x0: 0, x1: 0, z0: 0, z1: 0 };
}
function makeOrb() {
  return { x: 0, y: 0, z: 0, collected: false, risky: false };
}
function makeGate() {
  return { x: 0, z: 0, width: 2, resolved: false, result: '', accuracy: 0, flash: 0 };
}
function makeZone() {
  return { z0: 0, z1: 0, theme: '' };
}

export class Track {
  constructor() {
    this.halfWidth = TRACK.HALF_WIDTH;
    this.obstacles = [];
    this.holes = [];
    this.orbs = [];
    this.gates = [];
    this.zones = [];
    this.terrain = new Terrain();
    this.pools = { obstacles: [], holes: [], orbs: [], gates: [], zones: [] };
    this.generatedUntil = 0;
    this.segmentCount = 0;
  }

  reset() {
    for (const key of ['obstacles', 'holes', 'orbs', 'gates', 'zones']) {
      const pool = this.pools[key];
      for (const o of this[key]) pool.push(o);
      this[key].length = 0;
    }
    this.terrain.reset();
    this.generatedUntil = 0;
    this.segmentCount = 0;
  }

  take(key, factory) {
    const pool = this.pools[key];
    return pool.length ? pool.pop() : factory();
  }

  addObstacle(kind, x, z0, w, d, h, amp = 0, freq = 0, phase = 0) {
    const o = this.take('obstacles', makeObstacle);
    o.kind = kind;
    o.baseX = x;
    o.x = x;
    o.w = w;
    o.d = d;
    o.h = h;
    o.z0 = z0;
    o.z1 = z0 + d;
    o.amp = amp;
    o.freq = freq;
    o.phase = phase;
    o.gate = null;
    o.hitFlash = 0;
    if (kind === 'mover') o.x = moverX(o, 0);
    this.obstacles.push(o);
    return o;
  }

  /**
   * Instantiate a validated segment spec at world distance zStart.
   * @param {import('./PatternLibrary.js').SegmentSpec} spec
   */
  addSegment(spec, zStart) {
    this.addTerrain(spec, zStart);
    const items = spec.items.slice().sort((a, b) => (a.z ?? a.z0) - (b.z ?? b.z0));
    for (const it of items) {
      switch (it.type) {
        case 'wall':
        case 'hurdle':
          this.addObstacle(it.type, it.x, zStart + it.z, it.w, it.d, it.h);
          break;
        case 'mover':
          this.addObstacle('mover', it.x, zStart + it.z, it.w, it.d, it.h, it.amp, it.freq, it.phase);
          break;
        case 'hole': {
          const h = this.take('holes', makeHole);
          h.x0 = it.x0;
          h.x1 = it.x1;
          h.z0 = zStart + it.z0;
          h.z1 = zStart + it.z1;
          this.holes.push(h);
          break;
        }
        case 'orb': {
          const o = this.take('orbs', makeOrb);
          o.x = it.x;
          o.y = it.y ?? 0.35;
          o.z = zStart + it.z;
          o.collected = false;
          o.risky = !!it.risky;
          this.orbs.push(o);
          break;
        }
        case 'gate': {
          const g = this.take('gates', makeGate);
          g.x = it.x;
          g.z = zStart + it.z;
          g.width = it.width;
          g.resolved = false;
          g.result = '';
          g.accuracy = 0;
          g.flash = 0;
          this.gates.push(g);
          const off = it.width / 2 + GATE_POST_WIDTH / 2;
          const pz = g.z - GATE_POST_WIDTH / 2;
          this.addObstacle('post', it.x - off, pz, GATE_POST_WIDTH, GATE_POST_WIDTH, GATE_HEIGHT).gate = g;
          this.addObstacle('post', it.x + off, pz, GATE_POST_WIDTH, GATE_POST_WIDTH, GATE_HEIGHT).gate = g;
          break;
        }
        default:
          break;
      }
    }
    if (spec.theme) {
      const zone = this.take('zones', makeZone);
      zone.z0 = zStart;
      zone.z1 = zStart + spec.length;
      zone.theme = spec.theme;
      this.zones.push(zone);
    }
    this.generatedUntil = zStart + spec.length;
    this.segmentCount++;
  }

  /**
   * Extend the elevation profile over the segment. spec.terrain pieces are
   * { z0, z1, dh, ease } in local z; gaps between them stay flat.
   */
  addTerrain(spec, zStart) {
    const t = this.terrain;
    if (t.endZ < zStart) t.append(zStart, 0);
    if (spec.terrain) {
      const pieces = spec.terrain.slice().sort((a, b) => a.z0 - b.z0);
      for (const piece of pieces) {
        if (zStart + piece.z0 > t.endZ) t.append(zStart + piece.z0, 0);
        t.append(zStart + piece.z1, piece.dh, !!piece.ease);
      }
    }
    if (t.endZ < zStart + spec.length) t.append(zStart + spec.length, 0);
  }

  heightAt(z) {
    return this.terrain.heightAt(z);
  }

  slopeAt(z) {
    return this.terrain.slopeAt(z);
  }

  /** Return objects entirely behind minZ to their pools (in-place compaction). */
  recycle(minZ) {
    this.compact('obstacles', (o) => o.z1 < minZ);
    this.compact('holes', (h) => h.z1 < minZ);
    this.compact('orbs', (o) => o.z < minZ);
    this.compact('gates', (g) => g.z < minZ);
    this.compact('zones', (z) => z.z1 < minZ);
    this.terrain.recycle(minZ - 10);
  }

  compact(key, isDead) {
    const arr = this[key];
    const pool = this.pools[key];
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const o = arr[i];
      if (isDead(o)) pool.push(o);
      else arr[w++] = o;
    }
    arr.length = w;
  }

  updateMovers(playerZ) {
    for (const o of this.obstacles) {
      if (o.kind === 'mover') o.x = moverX(o, playerZ);
    }
  }

  /**
   * Is there floor under the point (x, z)?
   * margin > 0 treats points within `margin` of a hole edge as unsupported
   * (used by the validator to stay conservative).
   */
  isSupported(x, z, margin = 0) {
    if (x < -this.halfWidth || x > this.halfWidth) return false;
    for (const h of this.holes) {
      if (z >= h.z0 - margin && z <= h.z1 + margin && x >= h.x0 - margin && x <= h.x1 + margin) return false;
    }
    return true;
  }

  themeAt(z) {
    for (const zone of this.zones) if (z >= zone.z0 && z < zone.z1) return zone.theme;
    return '';
  }

  /** Nearest upcoming hazard of a kind within `range` metres (for tutorial hints). */
  upcoming(kind, fromZ, range) {
    if (kind === 'hole') {
      for (const h of this.holes) if (h.z0 > fromZ && h.z0 < fromZ + range) return h;
      return null;
    }
    for (const o of this.obstacles) if (o.kind === kind && o.z0 > fromZ && o.z0 < fromZ + range) return o;
    return null;
  }
}
