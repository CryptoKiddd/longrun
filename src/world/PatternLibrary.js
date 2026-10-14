import { PHYSICS, TRACK } from '../config.js';
import { lerpLevel, UNLOCKS } from './DifficultyManager.js';

/**
 * @typedef {{ type: 'wall'|'hurdle', x: number, z: number, w: number, d: number, h: number }} BoxItem
 * @typedef {{ type: 'mover', x: number, z: number, w: number, d: number, h: number, amp: number, freq: number, phase: number }} MoverItem
 * @typedef {{ type: 'hole', x0: number, x1: number, z0: number, z1: number }} HoleItem
 * @typedef {{ type: 'gate', x: number, z: number, width: number }} GateItem
 * @typedef {{ type: 'orb', x: number, y?: number, z: number, risky?: boolean }} OrbItem
 * @typedef {{ z0: number, z1: number, dh: number, ease?: boolean }} TerrainPiece  z1 === z0 means an instant drop (dh < 0)
 * @typedef {{
 *   id: string, length: number, items: Array<BoxItem|MoverItem|HoleItem|GateItem|OrbItem>,
 *   terrain?: TerrainPiece[], theme?: string, checkpoints?: Array<{z:number, x:number}>
 * }} SegmentSpec
 *
 * @typedef {{ rng: import('../core/rng.js').Rng, level: number, speed: number, z: number, leadIn: number, intro: boolean }} PatternContext
 *
 * Each pattern builds a spec in SEGMENT-LOCAL z. Hazards start at ctx.leadIn.
 * All heights (orbs, obstacles) are relative to the local track surface.
 * `intro` is true the first time a mechanic appears: build its gentlest form.
 */

const H = TRACK.HALF_WIDTH;
const R = PHYSICS.PLAYER_RADIUS;
const G = PHYSICS.GRAVITY;
const AIRTIME = (2 * PHYSICS.JUMP_VELOCITY) / G;
const EDGE = H - R - 0.35; // furthest comfortable lane centre

export const DIM = Object.freeze({
  WALL_D: 0.6,
  WALL_H: 2.6,
  HURDLE_D: 0.5,
  HURDLE_H: 0.55,
  MOVER_D: 0.7,
  MOVER_H: 1.7,
  AIR_ORB_Y: 1.5,
  ORB_Y: 0.35,
});

/** Distance between consecutive hazards: shrinks (in seconds) with level. */
function spacing(ctx, easy = 1.0, hard = 0.5) {
  return ctx.speed * lerpLevel(ctx.level, easy, hard);
}

/** Room after the last hazard so jumps land and the next segment is readable. */
function tail(ctx) {
  return ctx.speed * (AIRTIME + 0.15) + 2;
}

function orbLine(items, x0, z0, x1, z1, count, y = DIM.ORB_Y, risky = false) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    items.push({ type: 'orb', x: x0 + (x1 - x0) * t, y, z: z0 + (z1 - z0) * t, risky });
  }
}

/** Orbs following an arc over [zStart, zEnd] peaking at `peak` above the surface. */
function orbArc(items, x, zStart, zEnd, count, peak = DIM.AIR_ORB_Y) {
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const y = DIM.ORB_Y + (peak - DIM.ORB_Y) * Math.sin(Math.PI * t);
    items.push({ type: 'orb', x, y, z: zStart + (zEnd - zStart) * t, risky: true });
  }
}

function wallFromSide(side, w, z) {
  return { type: 'wall', x: side * (H - w / 2), z, w, d: DIM.WALL_D, h: DIM.WALL_H };
}

// ---------------------------------------------------------------------------
// Flat-track patterns
// ---------------------------------------------------------------------------

/** Recovery / breathing room with an easy orb trail. */
function runway(ctx, lengthSeconds = lerpLevel(ctx.level, 1.4, 0.8)) {
  const { rng } = ctx;
  const length = Math.max(22, ctx.speed * lengthSeconds);
  const items = [];
  const x = rng.range(-2.5, 2.5);
  const x2 = Math.max(-EDGE, Math.min(EDGE, x + rng.range(-2.5, 2.5)));
  orbLine(items, x, length * 0.25, x2, length * 0.75, rng.int(4, 6));
  return { id: 'runway', length, items };
}

function slalom(ctx) {
  const { rng } = ctx;
  const n = ctx.intro ? 2 : rng.int(3, 3 + Math.round(ctx.level * 4));
  const w = ctx.intro ? 3.8 : lerpLevel(ctx.level, 4.6, 5.4) + rng.range(-0.3, 0.3);
  const gap = spacing(ctx, 1.05, 0.6);
  const items = [];
  let side = rng.sign();
  let z = ctx.leadIn;
  for (let i = 0; i < n; i++) {
    items.push(wallFromSide(side, w, z));
    const freeX = -side * (H - (2 * H - w) / 2);
    items.push({ type: 'orb', x: freeX, y: DIM.ORB_Y, z: z + DIM.WALL_D / 2 });
    z += gap * rng.range(0.9, 1.1);
    side = -side;
  }
  return { id: 'slalom', length: z - gap + tail(ctx), items };
}

function centerBlock(ctx) {
  const { rng } = ctx;
  const items = [];
  const z = ctx.leadIn;
  if (rng.chance(0.5)) {
    const w = lerpLevel(ctx.level, 2.8, 4.2);
    const x = rng.range(-1.4, 1.4);
    items.push({ type: 'wall', x, z, w, d: DIM.WALL_D, h: DIM.WALL_H });
    const side = rng.sign();
    const ox = side > 0 ? (x + w / 2 + H) / 2 : (x - w / 2 - H) / 2;
    orbLine(items, ox, z - 6, ox, z + 4, 4);
    if (ctx.level > 0.35) {
      // Follow-up wall on the side the orbs lead to.
      items.push(wallFromSide(side, lerpLevel(ctx.level, 4.2, 5.2), z + spacing(ctx, 0.9, 0.5)));
    }
    return { id: 'centerBlock', length: z + spacing(ctx, 0.9, 0.5) + tail(ctx), items };
  }
  // Two side walls leave a central corridor.
  const corridor = lerpLevel(ctx.level, 3.0, 2.0);
  const cx = rng.range(-1.8, 1.8);
  const lw = cx - corridor / 2 + H;
  const rw = H - (cx + corridor / 2);
  if (lw > 0.4) items.push({ type: 'wall', x: -H + lw / 2, z, w: lw, d: DIM.WALL_D * 3, h: DIM.WALL_H });
  if (rw > 0.4) items.push({ type: 'wall', x: H - rw / 2, z, w: rw, d: DIM.WALL_D * 3, h: DIM.WALL_H });
  orbLine(items, cx, z - 4, cx, z + 3, 4);
  return { id: 'centerBlock', length: z + tail(ctx), items };
}

function gateWidth(ctx) {
  return ctx.intro ? 3.2 : lerpLevel(ctx.level, 2.9, 1.9);
}

function singleGate(ctx) {
  const { rng } = ctx;
  const width = gateWidth(ctx);
  const maxX = H - width / 2 - 0.6;
  const x = ctx.intro ? 0 : rng.range(-maxX, maxX);
  const z = ctx.leadIn + 4;
  const items = [{ type: 'gate', x, z, width }];
  orbLine(items, x, z - 10, x, z - 3, 3);
  return { id: 'gate', length: z + tail(ctx), items, theme: 'precision' };
}

function gateRow(ctx) {
  const { rng } = ctx;
  const n = rng.int(3, ctx.level > 0.45 ? 6 : 4);
  const width = gateWidth(ctx);
  const gap = spacing(ctx, 1.1, 0.62);
  const maxX = H - width / 2 - 0.6;
  const items = [];
  let x = rng.range(-1.5, 1.5);
  let z = ctx.leadIn + 4;
  for (let i = 0; i < n; i++) {
    items.push({ type: 'gate', x, z, width });
    items.push({ type: 'orb', x, y: DIM.ORB_Y, z: z - 2 });
    const shift = rng.sign() * rng.range(1.4, lerpLevel(ctx.level, 2.4, 3.8));
    x = Math.max(-maxX, Math.min(maxX, x + shift));
    z += gap;
  }
  return { id: 'gateRow', length: z - gap + tail(ctx), items, theme: 'precision' };
}

function hurdles(ctx) {
  const { rng } = ctx;
  const n = ctx.intro ? 1 : rng.int(2, ctx.level > 0.4 ? 4 : 3);
  const gap = ctx.speed * (AIRTIME + lerpLevel(ctx.level, 0.55, 0.3));
  const items = [];
  let z = ctx.leadIn + 2;
  for (let i = 0; i < n; i++) {
    const partial = !ctx.intro && rng.chance(0.4);
    if (partial) {
      // Leave a steer-around lane on one side: jump OR steer.
      const side = rng.sign();
      const w = 2 * H - 2.2;
      items.push({ type: 'hurdle', x: side * (H - w / 2), z, w, d: DIM.HURDLE_D, h: DIM.HURDLE_H });
    } else {
      items.push({ type: 'hurdle', x: 0, z, w: 2 * H, d: DIM.HURDLE_D, h: DIM.HURDLE_H });
    }
    items.push({ type: 'orb', x: rng.range(-2, 2), y: DIM.AIR_ORB_Y, z: z + DIM.HURDLE_D / 2, risky: true });
    z += gap * rng.range(0.95, 1.2);
  }
  return { id: 'hurdles', length: z - gap + tail(ctx), items };
}

/** Longest gap that leaves a fair take-off window at this speed. */
function holeLength(ctx) {
  const window = ctx.intro ? 0.38 : lerpLevel(ctx.level, 0.3, 0.18);
  return Math.max(3, ctx.speed * (AIRTIME - window) * 0.85);
}

function fullHole(ctx) {
  const L = holeLength(ctx) * (ctx.intro ? 0.7 : 1);
  const z0 = ctx.leadIn + 6;
  const items = [{ type: 'hole', x0: -H, x1: H, z0, z1: z0 + L }];
  orbArc(items, ctx.rng.range(-2, 2), z0 - 1, z0 + L + 1, 3);
  return { id: 'hole', length: z0 + L + tail(ctx), items };
}

/** Hole on one side: steer to the safe side, or jump it for the orbs. */
function partialHole(ctx) {
  const { rng } = ctx;
  const side = rng.sign();
  const holeW = lerpLevel(ctx.level, 5.4, 6.6);
  const L = Math.min(holeLength(ctx), 16);
  const z0 = ctx.leadIn + 6;
  const x0 = side > 0 ? H - holeW : -H;
  const x1 = side > 0 ? H : -H + holeW;
  const holeCx = (x0 + x1) / 2;
  const items = [{ type: 'hole', x0, x1, z0, z1: z0 + L }];
  orbArc(items, holeCx, z0 - 1, z0 + L + 1, 4);
  const safeCx = side > 0 ? (-H + x0) / 2 : (x1 + H) / 2;
  orbLine(items, safeCx, z0, safeCx, z0 + L, 2);
  return {
    id: 'partialHole',
    length: z0 + L + tail(ctx),
    items,
    theme: 'risk',
    checkpoints: [{ z: z0 + L + ctx.speed * 0.3 + 1.5, x: holeCx }],
  };
}

function moverItem(ctx, z, baseX, amp, w, phase) {
  // Lateral speed of the barrier is amp * omega; keep it below the player's.
  const omega = lerpLevel(ctx.level, 1.8, 3.0);
  const cappedOmega = Math.min(omega, (PHYSICS.LAT_MAX_SPEED * 0.55) / Math.max(amp, 0.1));
  return { type: 'mover', x: baseX, z, w, d: DIM.MOVER_D, h: DIM.MOVER_H, amp, freq: cappedOmega / ctx.speed, phase };
}

function mover(ctx) {
  const { rng } = ctx;
  const w = ctx.intro ? 2.0 : lerpLevel(ctx.level, 2.4, 3.2);
  const amp = H - w / 2 - 0.3;
  const z = ctx.leadIn + 6;
  const items = [moverItem(ctx, z, 0, amp * (ctx.intro ? 0.7 : 1), w, rng.range(0, Math.PI * 2))];
  orbLine(items, 0, z + 3, 0, z + 9, 3);
  return { id: 'mover', length: z + tail(ctx), items };
}

function doubleMover(ctx) {
  const { rng } = ctx;
  const w = lerpLevel(ctx.level, 2.2, 2.9);
  const amp = H - w / 2 - 0.3;
  const gap = spacing(ctx, 1.1, 0.7);
  const phase = rng.range(0, Math.PI * 2);
  const z = ctx.leadIn + 6;
  const items = [moverItem(ctx, z, 0, amp, w, phase), moverItem(ctx, z + gap, 0, amp, w, phase + Math.PI * rng.range(0.6, 1.4))];
  orbLine(items, 0, z + gap / 2 - 2, 0, z + gap / 2 + 2, 3);
  return { id: 'doubleMover', length: z + gap + tail(ctx), items };
}

/** A divider splits the track: wide safe lane vs. narrow orb-filled lane. */
function riskRoute(ctx) {
  const { rng } = ctx;
  const side = rng.sign();
  const narrow = lerpLevel(ctx.level, 2.0, 1.7);
  const length = ctx.speed * lerpLevel(ctx.level, 1.1, 0.9);
  const z0 = ctx.leadIn + 4;
  const dividerW = 0.7;
  const dividerX = side * (H - narrow - dividerW / 2);
  const laneX = side * (H - narrow / 2);
  const items = [{ type: 'wall', x: dividerX, z: z0, w: dividerW, d: length, h: DIM.WALL_H }];
  orbLine(items, laneX, z0 + 1, laneX, z0 + length - 1, Math.max(5, Math.round(length / 3)), DIM.ORB_Y, true);
  const checkpoints = [
    { z: z0 + 1.5, x: laneX },
    { z: z0 + length - 1, x: laneX },
  ];
  if (ctx.level > 0.3 && rng.chance(0.65)) {
    items.push({ type: 'hurdle', x: laneX, z: z0 + length * 0.55, w: narrow, d: DIM.HURDLE_D, h: DIM.HURDLE_H });
  }
  // The wide lane isn't free either at higher levels.
  if (ctx.level > 0.45) {
    const wideW = 2 * H - narrow - dividerW;
    items.push({ type: 'wall', x: -side * (H - wideW * 0.3), z: z0 + length * 0.4, w: wideW * 0.55, d: DIM.WALL_D, h: DIM.WALL_H });
  }
  return { id: 'riskRoute', length: z0 + length + tail(ctx), items, theme: 'risk', checkpoints };
}

/** Hole, then a gate placed where you land: chained jump + precision. */
function holeThenGate(ctx) {
  const { rng } = ctx;
  const L = holeLength(ctx) * 0.85;
  const z0 = ctx.leadIn + 6;
  const width = gateWidth(ctx) + 0.3;
  const gateZ = z0 + L + spacing(ctx, 1.1, 0.7) + ctx.speed * 0.3;
  const gx = rng.range(-2.4, 2.4);
  const items = [
    { type: 'hole', x0: -H, x1: H, z0, z1: z0 + L },
    { type: 'gate', x: gx, z: gateZ, width },
  ];
  orbArc(items, gx * 0.5, z0 - 1, z0 + L + 1, 3);
  return { id: 'holeThenGate', length: gateZ + tail(ctx), items, theme: 'precision' };
}

/** Wall with a door, followed by a side wall: steer, then steer again. */
function doorway(ctx) {
  const { rng } = ctx;
  const door = lerpLevel(ctx.level, 2.8, 2.1);
  const dx = rng.range(-2.6, 2.6);
  const z = ctx.leadIn + 4;
  const lw = dx - door / 2 + H;
  const rw = H - (dx + door / 2);
  const items = [];
  if (lw > 0.3) items.push({ type: 'wall', x: -H + lw / 2, z, w: lw, d: DIM.WALL_D, h: DIM.WALL_H });
  if (rw > 0.3) items.push({ type: 'wall', x: H - rw / 2, z, w: rw, d: DIM.WALL_D, h: DIM.WALL_H });
  orbLine(items, dx, z - 4, dx, z + 1, 3);
  const z2 = z + spacing(ctx, 1.05, 0.6);
  const side = dx > 0 ? 1 : -1;
  items.push(wallFromSide(side, lerpLevel(ctx.level, 4.6, 5.6), z2));
  return { id: 'doorway', length: z2 + tail(ctx), items };
}

// ---------------------------------------------------------------------------
// Terrain patterns (hills, slopes, ramps, drops)
// ---------------------------------------------------------------------------

/** Rolling hills (eased): crests can pop the ball into the air at speed. */
function hills(ctx) {
  const { rng } = ctx;
  const amp = ctx.intro ? 1.2 : lerpLevel(ctx.level, 1.6, 3.6) * rng.range(0.8, 1.1);
  const wave = Math.max(14, ctx.speed * lerpLevel(ctx.level, 1.6, 0.9));
  const n = rng.int(2, 3);
  const terrain = [];
  const items = [];
  let z = ctx.leadIn;
  for (let i = 0; i < n; i++) {
    terrain.push({ z0: z, z1: z + wave, dh: amp, ease: true });
    // Orbs ride over the crest; a high one rewards the pop.
    items.push({ type: 'orb', x: rng.range(-2.5, 2.5), y: 1.1, z: z + wave + 1, risky: true });
    terrain.push({ z0: z + wave, z1: z + 2 * wave, dh: -amp, ease: true });
    z += 2 * wave;
  }
  if (ctx.level > 0.4 && !ctx.intro) {
    // A side wall in the last valley, visible from the previous crest.
    items.push(wallFromSide(rng.sign(), lerpLevel(ctx.level, 4.0, 5.0), z - wave * 0.15));
  }
  return { id: 'hills', length: z + tail(ctx), items, terrain };
}

/** Long eased descent: the ball accelerates downhill. */
function downhill(ctx) {
  const { rng } = ctx;
  const L = ctx.speed * lerpLevel(ctx.level, 3.2, 2.6) * rng.range(0.9, 1.2);
  const grade = ctx.intro ? 0.12 : lerpLevel(ctx.level, 0.16, 0.28);
  const z0 = ctx.leadIn;
  const terrain = [{ z0, z1: z0 + L, dh: -grade * L * 0.75, ease: true }];
  const items = [];
  orbLine(items, rng.range(-2, 2), z0 + 8, rng.range(-2, 2), z0 + L - 8, rng.int(6, 9));
  return { id: 'downhill', length: z0 + L + tail(ctx), items, terrain };
}

/** Downhill with a slalom along it (speed rises while you weave). */
function slopeSlalom(ctx) {
  // Space the walls for the extra downhill speed.
  const base = slalom({ ...ctx, speed: ctx.speed + 4 });
  const z0 = Math.max(4, ctx.leadIn * 0.5);
  const L = base.length - z0 - 4;
  base.terrain = [{ z0, z1: z0 + L, dh: -lerpLevel(ctx.level, 0.14, 0.22) * L * 0.7, ease: true }];
  base.id = 'slopeSlalom';
  return base;
}

/** Ramp kicker with a lip, launching over a gap. Jumping at the lip goes higher. */
function rampJump(ctx) {
  const { rng } = ctx;
  const rampLen = lerpLevel(ctx.level, 6, 8);
  const grade = ctx.intro ? 0.28 : lerpLevel(ctx.level, 0.3, 0.42);
  const rise = rampLen * grade;
  const z0 = ctx.leadIn + 2;
  const lip = z0 + rampLen;
  const vy = grade * ctx.speed;
  // Natural flight from the lip back down to the base height.
  const flightT = (vy + Math.sqrt(vy * vy + 2 * G * rise)) / G;
  const natural = ctx.speed * flightT;
  const gap = ctx.intro ? natural * 0.45 : natural * lerpLevel(ctx.level, 0.5, 0.78);
  const terrain = [
    { z0, z1: lip, dh: rise, ease: false },
    { z0: lip, z1: lip, dh: -rise },
  ];
  const items = [{ type: 'hole', x0: -H, x1: H, z0: lip, z1: lip + gap }];
  orbArc(items, rng.range(-2, 2), lip, lip + natural * 0.95, 5, rise + vy * vy / (2 * G) * 0.9);
  return { id: 'ramp', length: lip + natural + tail(ctx), items, terrain, theme: 'risk' };
}

/** The track ends and continues lower: roll off, or jump a gap to the lower deck. */
function dropOff(ctx) {
  const { rng } = ctx;
  const drop = ctx.intro ? 2 : lerpLevel(ctx.level, 2.4, 4.5) * rng.range(0.85, 1.1);
  const z0 = ctx.leadIn + 4;
  const fallT = Math.sqrt((2 * drop) / G);
  const natural = ctx.speed * fallT;
  const withGap = !ctx.intro && ctx.level > 0.2 && rng.chance(0.7);
  const gap = withGap ? natural * lerpLevel(ctx.level, 0.55, 1.05) : 0;
  const items = [];
  if (gap > 0) items.push({ type: 'hole', x0: -H, x1: H, z0: z0, z1: z0 + gap });
  orbArc(items, rng.range(-2, 2), z0, z0 + Math.max(natural, gap) + 4, 4, 1.4);
  const terrain = [{ z0, z1: z0, dh: -drop }];
  return { id: 'drop', length: z0 + Math.max(natural, gap) + tail(ctx), items, terrain };
}

/**
 * Pattern registry.
 * unlock: distance (m) at which it may appear; weight(level); intensity = fatigue cost.
 */
export const PATTERNS = Object.freeze([
  { id: 'slalom', unlock: UNLOCKS.slalom, intensity: 2, weight: (l) => 1.1 - l * 0.3, build: slalom },
  { id: 'centerBlock', unlock: UNLOCKS.slalom, intensity: 1, weight: (l) => 0.9 - l * 0.3, build: centerBlock },
  { id: 'hills', unlock: UNLOCKS.hills, intensity: 1, weight: () => 0.8, build: hills },
  { id: 'gate', unlock: UNLOCKS.gate, intensity: 1, weight: (l) => 0.9 - l * 0.4, build: singleGate },
  { id: 'hurdles', unlock: UNLOCKS.hurdle, intensity: 2, weight: () => 0.9, build: hurdles },
  { id: 'downhill', unlock: UNLOCKS.downhill, intensity: 1, weight: () => 0.8, build: downhill },
  { id: 'hole', unlock: UNLOCKS.hole, intensity: 2, weight: () => 0.8, build: fullHole },
  { id: 'ramp', unlock: UNLOCKS.ramp, intensity: 2, weight: () => 1.0, build: rampJump },
  { id: 'gateRow', unlock: UNLOCKS.gateRow, intensity: 2, weight: (l) => 0.7 + l * 0.5, build: gateRow },
  { id: 'partialHole', unlock: UNLOCKS.partialHole, intensity: 2, weight: () => 0.8, build: partialHole },
  { id: 'drop', unlock: UNLOCKS.drop, intensity: 2, weight: () => 0.9, build: dropOff },
  { id: 'mover', unlock: UNLOCKS.mover, intensity: 2, weight: (l) => 0.7 + l * 0.3, build: mover },
  { id: 'riskRoute', unlock: UNLOCKS.riskRoute, intensity: 3, weight: () => 0.7, build: riskRoute },
  { id: 'doorway', unlock: UNLOCKS.combo, intensity: 3, weight: (l) => 0.5 + l * 0.6, build: doorway },
  { id: 'holeThenGate', unlock: UNLOCKS.combo, intensity: 3, weight: (l) => 0.5 + l * 0.6, build: holeThenGate },
  { id: 'slopeSlalom', unlock: UNLOCKS.slopeSlalom, intensity: 3, weight: (l) => 0.5 + l * 0.6, build: slopeSlalom },
  { id: 'doubleMover', unlock: UNLOCKS.doubleMover, intensity: 3, weight: (l) => 0.4 + l * 0.7, build: doubleMover },
]);

export { runway };
