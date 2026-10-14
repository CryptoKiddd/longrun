import { PHYSICS, TRACK } from '../config.js';
import { lerpLevel, UNLOCKS } from './DifficultyManager.js';

/**
 * @typedef {{ type: 'wall'|'hurdle', x: number, z: number, w: number, d: number, h: number }} BoxItem
 * @typedef {{ type: 'mover', x: number, z: number, w: number, d: number, h: number, amp: number, freq: number, phase: number }} MoverItem
 * @typedef {{ type: 'hole', x0: number, x1: number, z0: number, z1: number }} HoleItem
 * @typedef {{ type: 'gate', x: number, z: number, width: number }} GateItem
 * @typedef {{ type: 'orb', x: number, y?: number, z: number, risky?: boolean }} OrbItem
 * @typedef {{
 *   id: string, length: number, items: Array<BoxItem|MoverItem|HoleItem|GateItem|OrbItem>,
 *   theme?: string, checkpoints?: Array<{z:number, x:number}>, intensity?: number
 * }} SegmentSpec
 *
 * @typedef {{ rng: import('../core/rng.js').Rng, level: number, speed: number, z: number, leadIn: number, intro: boolean }} PatternContext
 *
 * Each pattern builds a spec in SEGMENT-LOCAL z. Hazards start at ctx.leadIn.
 * `intro` is true the first time a mechanic appears: build its gentlest form.
 */

const H = TRACK.HALF_WIDTH;
const R = PHYSICS.PLAYER_RADIUS;
const AIRTIME = (2 * PHYSICS.JUMP_VELOCITY) / PHYSICS.GRAVITY;
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
function spacing(ctx, easy = 1.15, hard = 0.6) {
  return ctx.speed * lerpLevel(ctx.level, easy, hard);
}

/** Room after the last hazard so jumps land and the next segment is readable. */
function tail(ctx) {
  return ctx.speed * (AIRTIME + 0.2) + 2;
}

function orbLine(items, x0, z0, x1, z1, count, y = DIM.ORB_Y, risky = false) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    items.push({ type: 'orb', x: x0 + (x1 - x0) * t, y, z: z0 + (z1 - z0) * t, risky });
  }
}

/** Orbs following a jump arc over [zStart, zEnd]. */
function orbArc(items, x, zStart, zEnd, count) {
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const y = DIM.ORB_Y + (DIM.AIR_ORB_Y - DIM.ORB_Y) * Math.sin(Math.PI * t) * 1.1;
    items.push({ type: 'orb', x, y, z: zStart + (zEnd - zStart) * t, risky: true });
  }
}

function wallFromSide(side, w, z) {
  return { type: 'wall', x: side * (H - w / 2), z, w, d: DIM.WALL_D, h: DIM.WALL_H };
}

// ---------------------------------------------------------------------------

/** Recovery / breathing room with an easy orb trail. */
function runway(ctx, lengthSeconds = lerpLevel(ctx.level, 2.0, 1.1)) {
  const { rng } = ctx;
  const length = Math.max(24, ctx.speed * lengthSeconds);
  const items = [];
  const x = rng.range(-2.5, 2.5);
  const x2 = Math.max(-EDGE, Math.min(EDGE, x + rng.range(-2.5, 2.5)));
  orbLine(items, x, length * 0.25, x2, length * 0.75, rng.int(4, 6));
  return { id: 'runway', length, items };
}

function slalom(ctx) {
  const { rng } = ctx;
  const n = ctx.intro ? 2 : rng.int(3, 3 + Math.round(ctx.level * 3));
  const w = ctx.intro ? 3.6 : lerpLevel(ctx.level, 4.2, 5.4) + rng.range(-0.3, 0.3);
  const gap = spacing(ctx, 1.2, 0.62);
  const items = [];
  let side = rng.sign();
  let z = ctx.leadIn;
  for (let i = 0; i < n; i++) {
    items.push(wallFromSide(side, w, z));
    const freeX = -side * (H - (2 * H - w) / 2);
    items.push({ type: 'orb', x: freeX, y: DIM.ORB_Y, z: z + DIM.WALL_D / 2 });
    z += gap;
    side = -side;
  }
  return { id: 'slalom', length: z - gap + tail(ctx), items };
}

function centerBlock(ctx) {
  const { rng } = ctx;
  const items = [];
  const z = ctx.leadIn;
  if (rng.chance(0.5)) {
    const w = lerpLevel(ctx.level, 2.4, 3.6);
    const x = rng.range(-1.2, 1.2);
    items.push({ type: 'wall', x, z, w, d: DIM.WALL_D, h: DIM.WALL_H });
    const side = rng.sign();
    const ox = side > 0 ? (x + w / 2 + H) / 2 : (x - w / 2 - H) / 2;
    orbLine(items, ox, z - 6, ox, z + 4, 4);
  } else {
    // Two side walls leave a central corridor.
    const corridor = lerpLevel(ctx.level, 3.4, 2.4);
    const cx = rng.range(-1.5, 1.5);
    const lw = cx - corridor / 2 + H;
    const rw = H - (cx + corridor / 2);
    if (lw > 0.4) items.push({ type: 'wall', x: -H + lw / 2, z, w: lw, d: DIM.WALL_D * 3, h: DIM.WALL_H });
    if (rw > 0.4) items.push({ type: 'wall', x: H - rw / 2, z, w: rw, d: DIM.WALL_D * 3, h: DIM.WALL_H });
    orbLine(items, cx, z - 4, cx, z + 3, 4);
  }
  return { id: 'centerBlock', length: z + tail(ctx), items };
}

function gateWidth(ctx) {
  return ctx.intro ? 3.4 : lerpLevel(ctx.level, 3.2, 2.15);
}

function singleGate(ctx) {
  const { rng } = ctx;
  const width = gateWidth(ctx);
  const maxX = H - width / 2 - 0.6;
  const x = ctx.intro ? 0 : rng.range(-maxX, maxX) * Math.min(1, 0.4 + ctx.level);
  const z = ctx.leadIn + 4;
  const items = [{ type: 'gate', x, z, width }];
  orbLine(items, x, z - 10, x, z - 3, 3);
  return { id: 'gate', length: z + tail(ctx), items, theme: 'precision' };
}

function gateRow(ctx) {
  const { rng } = ctx;
  const n = rng.int(3, ctx.level > 0.5 ? 5 : 4);
  const width = gateWidth(ctx);
  const gap = spacing(ctx, 1.25, 0.75);
  const maxX = H - width / 2 - 0.6;
  const items = [];
  let x = rng.range(-1, 1);
  let z = ctx.leadIn + 4;
  for (let i = 0; i < n; i++) {
    items.push({ type: 'gate', x, z, width });
    items.push({ type: 'orb', x, y: DIM.ORB_Y, z: z - 2 });
    const shift = rng.sign() * rng.range(1.0, lerpLevel(ctx.level, 2.0, 3.2));
    x = Math.max(-maxX, Math.min(maxX, x + shift));
    z += gap;
  }
  return { id: 'gateRow', length: z - gap + tail(ctx), items, theme: 'precision' };
}

function hurdles(ctx) {
  const { rng } = ctx;
  const n = ctx.intro ? 1 : rng.int(1, ctx.level > 0.4 ? 3 : 2);
  // Enough room to land and jump again comfortably.
  const gap = ctx.speed * (AIRTIME + lerpLevel(ctx.level, 0.7, 0.4));
  const items = [];
  let z = ctx.leadIn + 2;
  const partial = !ctx.intro && ctx.level > 0.25 && rng.chance(0.4);
  for (let i = 0; i < n; i++) {
    if (partial) {
      // Leave a steer-around lane on one side: jump OR steer.
      const side = rng.sign();
      const w = 2 * H - 2.4;
      items.push({ type: 'hurdle', x: side * (H - w / 2), z, w, d: DIM.HURDLE_D, h: DIM.HURDLE_H });
    } else {
      items.push({ type: 'hurdle', x: 0, z, w: 2 * H, d: DIM.HURDLE_D, h: DIM.HURDLE_H });
    }
    // Air orbs reward jumping cleanly over the bar.
    items.push({ type: 'orb', x: rng.range(-2, 2), y: DIM.AIR_ORB_Y, z: z + DIM.HURDLE_D / 2, risky: true });
    z += gap;
  }
  return { id: 'hurdles', length: z - gap + tail(ctx), items };
}

/** Longest gap that leaves a comfortable take-off window at this speed. */
function holeLength(ctx) {
  const window = ctx.intro ? 0.4 : lerpLevel(ctx.level, 0.36, 0.24);
  return Math.max(3, ctx.speed * (AIRTIME - window) * 0.82);
}

function fullHole(ctx) {
  const L = holeLength(ctx) * (ctx.intro ? 0.7 : 1);
  const z0 = ctx.leadIn + 6;
  const items = [{ type: 'hole', x0: -H, x1: H, z0, z1: z0 + L }];
  const x = ctx.rng.range(-2, 2);
  orbArc(items, x, z0 - 1, z0 + L + 1, 3);
  return { id: 'hole', length: z0 + L + tail(ctx), items };
}

/** Hole on one side: steer to the safe side, or jump it for the orbs. */
function partialHole(ctx) {
  const { rng } = ctx;
  const side = rng.sign();
  const holeW = lerpLevel(ctx.level, 5.0, 6.4);
  const L = Math.min(holeLength(ctx), 14);
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
    // The jump-over route must itself be survivable.
    checkpoints: [{ z: z0 + L + ctx.speed * 0.25 + 1.5, x: holeCx }],
  };
}

function moverItem(ctx, z, baseX, amp, w, phase) {
  // Lateral speed of the barrier is amp * omega; keep it well below the player's.
  const omega = lerpLevel(ctx.level, 1.5, 2.4);
  const cappedOmega = Math.min(omega, (PHYSICS.LAT_MAX_SPEED * 0.45) / Math.max(amp, 0.1));
  return { type: 'mover', x: baseX, z, w, d: DIM.MOVER_D, h: DIM.MOVER_H, amp, freq: cappedOmega / ctx.speed, phase };
}

function mover(ctx) {
  const { rng } = ctx;
  const w = ctx.intro ? 2.0 : lerpLevel(ctx.level, 2.2, 2.9);
  const amp = H - w / 2 - 0.3;
  const z = ctx.leadIn + 6;
  const items = [moverItem(ctx, z, 0, amp * (ctx.intro ? 0.7 : 1), w, rng.range(0, Math.PI * 2))];
  orbLine(items, 0, z + 3, 0, z + 9, 3);
  return { id: 'mover', length: z + tail(ctx), items };
}

function doubleMover(ctx) {
  const { rng } = ctx;
  const w = lerpLevel(ctx.level, 2.0, 2.6);
  const amp = H - w / 2 - 0.3;
  const gap = spacing(ctx, 1.3, 0.85);
  const phase = rng.range(0, Math.PI * 2);
  const z = ctx.leadIn + 6;
  const items = [moverItem(ctx, z, 0, amp, w, phase), moverItem(ctx, z + gap, 0, amp, w, phase + Math.PI)];
  orbLine(items, 0, z + gap / 2 - 2, 0, z + gap / 2 + 2, 3);
  return { id: 'doubleMover', length: z + gap + tail(ctx), items };
}

/** A divider splits the track: wide safe lane vs. narrow orb-filled lane. */
function riskRoute(ctx) {
  const { rng } = ctx;
  const side = rng.sign(); // which side is the narrow lane
  const narrow = lerpLevel(ctx.level, 2.1, 1.75);
  const length = ctx.speed * lerpLevel(ctx.level, 1.1, 0.9);
  const z0 = ctx.leadIn + 4;
  const dividerW = 0.7;
  const dividerX = side * (H - narrow - dividerW / 2);
  const laneX = side * (H - narrow / 2);
  const items = [{ type: 'wall', x: dividerX, z: z0, w: dividerW, d: length, h: DIM.WALL_H }];
  orbLine(items, laneX, z0 + 1, laneX, z0 + length - 1, Math.max(5, Math.round(length / 3)), DIM.ORB_Y, true);
  // Checkpoints prove the narrow line is enterable and can be followed to the end.
  const checkpoints = [
    { z: z0 + 1.5, x: laneX },
    { z: z0 + length - 1, x: laneX },
  ];
  if (ctx.level > 0.35 && rng.chance(0.6)) {
    // A hurdle inside the narrow lane: the risky line also needs a jump.
    items.push({ type: 'hurdle', x: laneX, z: z0 + length * 0.55, w: narrow, d: DIM.HURDLE_D, h: DIM.HURDLE_H });
  }
  return { id: 'riskRoute', length: z0 + length + tail(ctx), items, theme: 'risk', checkpoints };
}

/** Hole, then a gate placed where you land: chained jump + precision. */
function holeThenGate(ctx) {
  const { rng } = ctx;
  const L = holeLength(ctx) * 0.85;
  const z0 = ctx.leadIn + 6;
  const width = gateWidth(ctx) + 0.3;
  const gateZ = z0 + L + spacing(ctx, 1.2, 0.8) + ctx.speed * 0.3;
  const gx = rng.range(-2.2, 2.2);
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
  const door = lerpLevel(ctx.level, 3.0, 2.3);
  const dx = rng.range(-2.4, 2.4);
  const z = ctx.leadIn + 4;
  const lw = dx - door / 2 + H;
  const rw = H - (dx + door / 2);
  const items = [];
  if (lw > 0.3) items.push({ type: 'wall', x: -H + lw / 2, z, w: lw, d: DIM.WALL_D, h: DIM.WALL_H });
  if (rw > 0.3) items.push({ type: 'wall', x: H - rw / 2, z, w: rw, d: DIM.WALL_D, h: DIM.WALL_H });
  orbLine(items, dx, z - 4, dx, z + 1, 3);
  const z2 = z + spacing(ctx, 1.2, 0.7);
  const side = dx > 0 ? 1 : -1;
  items.push(wallFromSide(side, lerpLevel(ctx.level, 4.4, 5.2), z2));
  return { id: 'doorway', length: z2 + tail(ctx), items };
}

/**
 * Pattern registry.
 * unlock: distance (m) at which it may appear; weight(level); intensity = fatigue cost.
 */
export const PATTERNS = Object.freeze([
  { id: 'slalom', unlock: UNLOCKS.slalom, intensity: 2, weight: (l) => 1.2 - l * 0.4, build: slalom },
  { id: 'centerBlock', unlock: UNLOCKS.slalom, intensity: 1, weight: (l) => 1.0 - l * 0.5, build: centerBlock },
  { id: 'gate', unlock: UNLOCKS.gate, intensity: 1, weight: (l) => 1.0 - l * 0.4, build: singleGate },
  { id: 'hurdles', unlock: UNLOCKS.hurdle, intensity: 1, weight: () => 0.9, build: hurdles },
  { id: 'hole', unlock: UNLOCKS.hole, intensity: 2, weight: () => 0.9, build: fullHole },
  { id: 'gateRow', unlock: UNLOCKS.gateRow, intensity: 2, weight: (l) => 0.7 + l * 0.5, build: gateRow },
  { id: 'partialHole', unlock: UNLOCKS.partialHole, intensity: 2, weight: () => 0.8, build: partialHole },
  { id: 'mover', unlock: UNLOCKS.mover, intensity: 2, weight: (l) => 0.7 + l * 0.3, build: mover },
  { id: 'riskRoute', unlock: UNLOCKS.riskRoute, intensity: 2, weight: () => 0.7, build: riskRoute },
  { id: 'doorway', unlock: UNLOCKS.combo, intensity: 3, weight: (l) => 0.4 + l * 0.6, build: doorway },
  { id: 'holeThenGate', unlock: UNLOCKS.combo, intensity: 3, weight: (l) => 0.4 + l * 0.6, build: holeThenGate },
  { id: 'doubleMover', unlock: UNLOCKS.doubleMover, intensity: 3, weight: (l) => 0.3 + l * 0.7, build: doubleMover },
]);

export { runway };
