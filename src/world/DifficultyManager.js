import { SPEED } from '../config.js';

/**
 * Difficulty is a pure function of distance travelled (never of score).
 * Because forward speed also depends only on distance, the course and every
 * moving obstacle's phase are fully deterministic for a given seed.
 */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Difficulty level in [0, 1]: rises quickly at first, then plateaus. */
export function difficultyAt(z) {
  const t = clamp01(z / SPEED.RAMP_DISTANCE);
  return 1 - Math.pow(1 - t, 1.7);
}

/** Forward speed (m/s) at distance z. */
export function speedAt(z) {
  return SPEED.MIN + (SPEED.MAX - SPEED.MIN) * difficultyAt(z);
}

/** Interpolate a parameter by level: lerpLevel(level, easyValue, hardValue). */
export function lerpLevel(level, easy, hard) {
  return easy + (hard - easy) * clamp01(level);
}

/**
 * Distance at which each mechanic is introduced. The opening introduces
 * them one at a time so players meet simple obstacles first.
 */
export const UNLOCKS = Object.freeze({
  tutorial: 0,
  slalom: 140,
  gate: 220,
  hurdle: 320,
  hole: 430,
  gateRow: 560,
  partialHole: 650,
  mover: 800,
  riskRoute: 900,
  combo: 1500,
  doubleMover: 1900,
});
