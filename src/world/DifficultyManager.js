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

/** Base forward speed (m/s) at distance z, ignoring terrain. */
export function speedAt(z) {
  return SPEED.MIN + (SPEED.MAX - SPEED.MIN) * difficultyAt(z);
}

/**
 * Forward speed including the slope effect: downhill is faster, uphill slower.
 * Still a pure function of (distance, terrain), so runs stay deterministic.
 */
export function forwardSpeed(z, grade) {
  return speedAt(z) + slopeBonus(grade);
}

/** Speed change from the local grade (negative grade = downhill = faster). */
export function slopeBonus(grade) {
  const g = grade < -0.4 ? -0.4 : grade > 0.25 ? 0.25 : grade;
  return -SPEED.SLOPE_BONUS * g;
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
  slalom: 135,
  hills: 165,
  gate: 190,
  hurdle: 250,
  downhill: 300,
  hole: 340,
  ramp: 420,
  gateRow: 470,
  partialHole: 540,
  drop: 600,
  mover: 660,
  riskRoute: 740,
  combo: 1000,
  slopeSlalom: 1150,
  doubleMover: 1300,
});
