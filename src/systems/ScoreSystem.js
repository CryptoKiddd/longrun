import { SCORING } from '../config.js';

/**
 * Transparent run scoring.
 *   distance  : 1 point per metre (never multiplied)
 *   orbs      : ORB_POINTS x multiplier
 *   gates     : (GATE_BASE + accuracy x GATE_ACCURACY_BONUS + streak x STREAK_BONUS) x multiplier
 *   challenges: flat CHALLENGE_BONUS
 * Multiplier = 1 + floor(streak / STREAK_PER_MULTIPLIER), capped at MAX_MULTIPLIER.
 * PERFECT and GOOD passes extend the streak; an OK pass keeps it; a missed
 * gate resets the streak (but never removes points already earned).
 */
export const GateTier = Object.freeze({ PERFECT: 'PERFECT', GOOD: 'GOOD', OK: 'OK', MISS: 'MISS' });

export function gateTier(accuracy, passed, cfg = SCORING) {
  if (!passed) return GateTier.MISS;
  if (accuracy >= cfg.PERFECT_ACCURACY) return GateTier.PERFECT;
  if (accuracy >= cfg.GOOD_ACCURACY) return GateTier.GOOD;
  return GateTier.OK;
}

export class ScoreSystem {
  constructor(cfg = SCORING) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.distance = 0;
    this.bonus = 0;
    this.orbs = 0;
    this.gatesTotal = 0;
    this.gatesPassed = 0;
    this.perfectGates = 0;
    this.accuracySum = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.cleanGates = 0; // consecutive gates without a miss
    this.bestCleanGates = 0;
    this.bestMultiplier = 1;
    this.challengePoints = 0;
  }

  get multiplier() {
    return Math.min(this.cfg.MAX_MULTIPLIER, 1 + Math.floor(this.streak / this.cfg.STREAK_PER_MULTIPLIER));
  }

  get distancePoints() {
    return Math.floor(this.distance / this.cfg.METRES_PER_POINT);
  }

  get total() {
    return this.distancePoints + this.bonus;
  }

  /** Precision percentage across all gates met this run (misses count as 0). */
  get precision() {
    return this.gatesTotal ? Math.round((this.accuracySum / this.gatesTotal) * 100) : 0;
  }

  setDistance(metres) {
    if (metres > this.distance) this.distance = metres;
  }

  /** @returns {number} points awarded */
  collectOrb() {
    this.orbs++;
    const pts = this.cfg.ORB_POINTS * this.multiplier;
    this.bonus += pts;
    return pts;
  }

  /**
   * @returns {{ tier: string, points: number }}
   */
  resolveGate(passed, accuracy) {
    this.gatesTotal++;
    const tier = gateTier(accuracy, passed, this.cfg);
    if (tier === GateTier.MISS) {
      this.streak = 0;
      this.cleanGates = 0;
      return { tier, points: 0 };
    }
    this.gatesPassed++;
    this.accuracySum += accuracy;
    this.cleanGates++;
    this.bestCleanGates = Math.max(this.bestCleanGates, this.cleanGates);
    if (tier === GateTier.PERFECT) this.perfectGates++;
    if (tier === GateTier.PERFECT || tier === GateTier.GOOD) this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.bestMultiplier = Math.max(this.bestMultiplier, this.multiplier);
    const base = this.cfg.GATE_BASE + Math.round(accuracy * this.cfg.GATE_ACCURACY_BONUS) + this.streak * this.cfg.STREAK_BONUS;
    const points = base * this.multiplier;
    this.bonus += points;
    return { tier, points };
  }

  addChallengeBonus(points = this.cfg.CHALLENGE_BONUS) {
    this.bonus += points;
    this.challengePoints += points;
    return points;
  }

  summary() {
    return {
      score: this.total,
      distance: Math.floor(this.distance),
      orbs: this.orbs,
      precision: this.precision,
      gatesPassed: this.gatesPassed,
      gatesTotal: this.gatesTotal,
      perfectGates: this.perfectGates,
      bestStreak: this.bestStreak,
      bestMultiplier: this.bestMultiplier,
    };
  }
}
