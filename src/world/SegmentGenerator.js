import { TRACK } from '../config.js';
import { Rng } from '../core/rng.js';
import { difficultyAt, speedAt, lerpLevel, UNLOCKS } from './DifficultyManager.js';
import { PATTERNS, runway } from './PatternLibrary.js';
import { validateSegment } from './PatternValidator.js';

const MAX_LEADIN_GROWTH = 3;
const MAX_PATTERN_TRIES = 4;

/**
 * Endless course generation: picks handcrafted patterns by difficulty, builds
 * them, validates fairness, and appends them to the Track ahead of the player.
 *
 * Determinism: the opening (first TRACK.OPENING_LENGTH metres) always uses
 * TRACK.OPENING_SEED; after that a per-run seed is used.
 */
export class SegmentGenerator {
  constructor(track, { validate = validateSegment } = {}) {
    this.track = track;
    this.validate = validate;
    this.openingRng = new Rng(TRACK.OPENING_SEED);
    this.runRng = new Rng(1);
    this.stats = { generated: 0, rejected: 0, fallbacks: 0 };
    this.reset(1);
  }

  reset(runSeed) {
    this.openingRng.seed(TRACK.OPENING_SEED);
    this.runRng.seed(runSeed);
    this.heat = 0;
    this.lastId = '';
    this.introduced = new Set();
    this.stats.generated = 0;
    this.stats.rejected = 0;
    this.stats.fallbacks = 0;
    this.log = [];
    this.track.reset();
    // Tutorial runway: a calm start with an orb trail to learn steering.
    this.place(this.tutorialSpec());
  }

  tutorialSpec() {
    const items = [];
    for (let i = 0; i < 6; i++) items.push({ type: 'orb', x: 0, y: 0.35, z: 40 + i * 5 });
    for (let i = 0; i < 6; i++) items.push({ type: 'orb', x: -2.4 + i * 0.1, y: 0.35, z: 85 + i * 5 });
    return { id: 'tutorial', length: UNLOCKS.slalom, items };
  }

  rngFor(z) {
    return z < TRACK.OPENING_LENGTH ? this.openingRng : this.runRng;
  }

  /** Generate until the track extends `ahead` metres past playerZ. */
  ensureAhead(playerZ, ahead = TRACK.VIEW_AHEAD + 40) {
    let guard = 0;
    while (this.track.generatedUntil < playerZ + ahead && guard++ < 50) this.generateNext();
  }

  place(spec) {
    this.track.addSegment(spec, this.track.generatedUntil);
    this.stats.generated++;
    if (this.log.length < 400) this.log.push(spec.id);
  }

  available(z) {
    return PATTERNS.filter((p) => z >= p.unlock);
  }

  choose(rng, z, level) {
    const pool = this.available(z);
    if (!pool.length) return null;
    // Introduce each newly unlocked mechanic once, on its own, gently.
    for (const p of pool) {
      if (!this.introduced.has(p.id)) return { pattern: p, intro: true };
    }
    let total = 0;
    for (const p of pool) if (p.id !== this.lastId) total += Math.max(0.05, p.weight(level));
    let r = rng.next() * total;
    for (const p of pool) {
      if (p.id === this.lastId) continue;
      r -= Math.max(0.05, p.weight(level));
      if (r <= 0) return { pattern: p, intro: false };
    }
    return { pattern: pool[pool.length - 1], intro: false };
  }

  generateNext() {
    const z = this.track.generatedUntil;
    const rng = this.rngFor(z);
    const level = difficultyAt(z);

    // Fatigue budget: insert a recovery runway after demanding stretches.
    const budget = lerpLevel(level, 3, 7);
    if (this.heat >= budget) {
      this.heat = 0;
      this.lastId = 'runway';
      this.place(runway({ rng, level, speed: speedAt(z), z, leadIn: 0, intro: false }, lerpLevel(level, 1.6, 0.9)));
      return;
    }

    for (let attempt = 0; attempt < MAX_PATTERN_TRIES; attempt++) {
      const choice = this.choose(rng, z, level);
      if (!choice) break;
      const { pattern, intro } = choice;
      for (let grow = 0; grow <= MAX_LEADIN_GROWTH; grow++) {
        // Speed rises slightly over a segment; validate at the faster end.
        const speed = speedAt(z + 80);
        const leadIn = speed * (lerpLevel(level, 0.8, 0.45) + grow * 0.3);
        const ctx = { rng, level, speed, z, leadIn, intro };
        const spec = pattern.build(ctx);
        const result = this.validate(spec, speed);
        if (result.ok) {
          this.introduced.add(pattern.id);
          this.lastId = pattern.id;
          this.heat += pattern.intensity;
          this.place(spec);
          return;
        }
        this.stats.rejected++;
      }
      // Don't retry the same mechanic's intro forever.
      this.introduced.add(pattern.id);
    }

    // Known-safe fallback.
    this.stats.fallbacks++;
    this.heat = 0;
    this.lastId = 'runway';
    this.place(runway({ rng, level, speed: speedAt(z), z, leadIn: 0, intro: false }));
  }
}
