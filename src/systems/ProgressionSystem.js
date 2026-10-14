import { COURSE_VERSION } from '../config.js';

/**
 * Local, non-sensitive progression: records, optional challenges, cosmetic
 * unlocks and settings. Cosmetics are purely visual — no gameplay effect.
 */

export const SAVE_VERSION = 1;

/**
 * Optional per-run challenges. Completing one awards a flat bonus in that run
 * and counts toward cosmetic unlocks. They never block play.
 * `check(s)` receives live run stats.
 */
export const CHALLENGES = Object.freeze([
  { id: 'orbs5', label: 'Collect 5 energy orbs in one run', check: (s) => s.orbs >= 5 },
  { id: 'dist500', label: 'Travel 500 m', check: (s) => s.distance >= 500 },
  { id: 'perfect3', label: 'Pass 3 perfect gates in one run', check: (s) => s.perfectGates >= 3 },
  { id: 'survive45', label: 'Survive for 45 seconds', check: (s) => s.time >= 45 },
  { id: 'mult3', label: 'Reach a x3 multiplier', check: (s) => s.multiplier >= 3 },
  { id: 'clean8', label: 'Pass 8 gates in a row without missing', check: (s) => s.cleanGates >= 8 },
  { id: 'orbs40', label: 'Collect 40 energy orbs in one run', check: (s) => s.orbs >= 40 },
  { id: 'dist1500', label: 'Travel 1,500 m', check: (s) => s.distance >= 1500 },
  { id: 'survive120', label: 'Survive for 2 minutes', check: (s) => s.time >= 120 },
  { id: 'score10k', label: 'Score 10,000 in one run', check: (s) => s.score >= 10000 },
  { id: 'mult5', label: 'Reach the x5 multiplier', check: (s) => s.multiplier >= 5 },
  { id: 'dist3000', label: 'Travel 3,000 m', check: (s) => s.distance >= 3000 },
]);

export const ACTIVE_CHALLENGES = 3;

/** Cosmetic ball skins. `need` = challenges completed to unlock. */
export const SKINS = Object.freeze([
  { id: 'cyan', name: 'Pulse', need: 0, core: '#e8feff', glow: '#22e4ff', trail: '#22e4ff' },
  { id: 'violet', name: 'Nebula', need: 2, core: '#f4ecff', glow: '#a77bff', trail: '#c49bff' },
  { id: 'solar', name: 'Solar', need: 4, core: '#fff8e6', glow: '#ffb02e', trail: '#ff8a3d' },
  { id: 'lime', name: 'Volt', need: 6, core: '#f3ffe8', glow: '#7dff5a', trail: '#b6ff4a' },
  { id: 'ice', name: 'Frost', need: 8, core: '#ffffff', glow: '#bfe9ff', trail: '#e6f7ff' },
  { id: 'prism', name: 'Prism', need: 10, core: '#ffffff', glow: 'prism', trail: 'prism' },
]);

const DEFAULT_SETTINGS = Object.freeze({
  muted: false,
  volume: 0.7,
  reducedEffects: false,
  ghost: true,
});

function num(v, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function sanitizeGhost(g) {
  if (!g || typeof g !== 'object') return null;
  if (g.v !== COURSE_VERSION || !Array.isArray(g.xs) || !Array.isArray(g.ys)) return null;
  if (g.xs.length !== g.ys.length || g.xs.length > 2000) return null;
  if (!g.xs.every(Number.isFinite) || !g.ys.every(Number.isFinite)) return null;
  return { v: g.v, step: num(g.step, 2, 0.5, 10), xs: g.xs, ys: g.ys, score: num(g.score), endZ: num(g.endZ) };
}

/** Build a fully valid save object from anything (including null/garbage). */
export function sanitizeSave(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ids = new Set(CHALLENGES.map((c) => c.id));
  const s = r.settings && typeof r.settings === 'object' ? r.settings : {};
  const done = Array.isArray(r.challengesDone) ? r.challengesDone.filter((id) => ids.has(id)) : [];
  const skin = SKINS.some((k) => k.id === r.skin) ? r.skin : 'cyan';
  return {
    v: SAVE_VERSION,
    bestScore: Math.floor(num(r.bestScore)),
    bestDistance: Math.floor(num(r.bestDistance)),
    totalRuns: Math.floor(num(r.totalRuns)),
    totalOrbs: Math.floor(num(r.totalOrbs)),
    challengesDone: [...new Set(done)],
    skin,
    settings: {
      muted: typeof s.muted === 'boolean' ? s.muted : DEFAULT_SETTINGS.muted,
      volume: num(s.volume, DEFAULT_SETTINGS.volume, 0, 1),
      reducedEffects: typeof s.reducedEffects === 'boolean' ? s.reducedEffects : DEFAULT_SETTINGS.reducedEffects,
      ghost: typeof s.ghost === 'boolean' ? s.ghost : DEFAULT_SETTINGS.ghost,
    },
    ghost: sanitizeGhost(r.ghost),
  };
}

export class ProgressionSystem {
  /** @param {import('../core/Storage.js').SafeStorage} storage */
  constructor(storage) {
    this.storage = storage;
    this.data = sanitizeSave(null);
  }

  load() {
    this.data = sanitizeSave(this.storage.load());
    // A skin selected in an older save must still be unlocked.
    if (!this.isSkinUnlocked(this.data.skin)) this.data.skin = 'cyan';
    return this.data;
  }

  save() {
    return this.storage.save(this.data);
  }

  get settings() {
    return this.data.settings;
  }

  setSetting(key, value) {
    if (!(key in this.data.settings)) return;
    this.data.settings[key] = value;
    this.data = sanitizeSave(this.data);
    this.save();
  }

  get completedCount() {
    return this.data.challengesDone.length;
  }

  isChallengeDone(id) {
    return this.data.challengesDone.includes(id);
  }

  /** The first few not-yet-completed challenges, in order. */
  activeChallenges() {
    return CHALLENGES.filter((c) => !this.isChallengeDone(c.id)).slice(0, ACTIVE_CHALLENGES);
  }

  /** @returns {Array<object>} skins newly unlocked by this completion */
  completeChallenge(id) {
    if (this.isChallengeDone(id) || !CHALLENGES.some((c) => c.id === id)) return [];
    const before = this.unlockedSkins().length;
    this.data.challengesDone.push(id);
    return this.unlockedSkins().slice(before);
  }

  isSkinUnlocked(id) {
    const skin = SKINS.find((s) => s.id === id);
    return !!skin && this.completedCount >= skin.need;
  }

  unlockedSkins() {
    return SKINS.filter((s) => this.completedCount >= s.need);
  }

  get skin() {
    return SKINS.find((s) => s.id === this.data.skin) || SKINS[0];
  }

  selectSkin(id) {
    if (!this.isSkinUnlocked(id)) return false;
    this.data.skin = id;
    this.save();
    return true;
  }

  /**
   * Record a finished run. Persists records; never deletes existing ones.
   * @param {{ score:number, distance:number, orbs:number }} summary
   * @param {object|null} ghost recorded ghost for this run
   */
  recordRun(summary, ghost = null) {
    const d = this.data;
    const newBest = summary.score > d.bestScore;
    const newBestDistance = summary.distance > d.bestDistance;
    d.totalRuns++;
    d.totalOrbs += summary.orbs;
    if (newBest) {
      d.bestScore = summary.score;
      if (ghost) d.ghost = sanitizeGhost(ghost);
    }
    if (newBestDistance) d.bestDistance = summary.distance;
    this.save();
    return { newBest, newBestDistance, previousBest: newBest ? null : d.bestScore };
  }
}
