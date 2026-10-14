import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SafeStorage, MemoryBackend } from '../src/core/Storage.js';
import { ProgressionSystem, sanitizeSave, CHALLENGES, SKINS } from '../src/systems/ProgressionSystem.js';
import { GhostRecorder, GhostPlayback } from '../src/systems/GhostSystem.js';
import { Simulation } from '../src/core/Simulation.js';
import { ScoreSystem, GateTier } from '../src/systems/ScoreSystem.js';
import { COURSE_VERSION, PHYSICS } from '../src/config.js';

const KEY = 'pulse.save';

function makeProgression(initial) {
  const backend = new MemoryBackend(initial ? { [KEY]: initial } : {});
  const prog = new ProgressionSystem(new SafeStorage(KEY, backend));
  prog.load();
  return { prog, backend };
}

test('storage: missing, malformed and throwing backends degrade gracefully', () => {
  assert.equal(new SafeStorage(KEY, null).load(), null);
  assert.equal(new SafeStorage(KEY, new MemoryBackend({ [KEY]: '{not json' })).load(), null);
  assert.equal(new SafeStorage(KEY, new MemoryBackend({ [KEY]: '[1,2]' })).load(), null);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  const s = new SafeStorage(KEY, throwing);
  assert.equal(s.load(), null);
  assert.equal(s.save({ a: 1 }), false);
});

test('sanitizeSave repairs garbage into a valid save', () => {
  const s = sanitizeSave({ bestScore: 'lots', bestDistance: -5, skin: 'hacker', challengesDone: ['orbs5', 'nope', 'orbs5'], settings: { volume: 9, muted: 'yes' } });
  assert.equal(s.bestScore, 0);
  assert.equal(s.bestDistance, 0);
  assert.equal(s.skin, 'cyan');
  assert.deepEqual(s.challengesDone, ['orbs5']);
  assert.equal(s.settings.volume, 1);
  assert.equal(s.settings.muted, false);
  assert.equal(s.ghost, null);
});

test('best score and distance persist and are never lowered', () => {
  const { prog, backend } = makeProgression();
  let r = prog.recordRun({ score: 1200, distance: 900, orbs: 10 });
  assert.equal(r.newBest, true);
  r = prog.recordRun({ score: 500, distance: 1000, orbs: 3 });
  assert.equal(r.newBest, false);
  assert.equal(r.newBestDistance, true);
  const reloaded = new ProgressionSystem(new SafeStorage(KEY, backend));
  reloaded.load();
  assert.equal(reloaded.data.bestScore, 1200);
  assert.equal(reloaded.data.bestDistance, 1000);
  assert.equal(reloaded.data.totalRuns, 2);
  assert.equal(reloaded.data.totalOrbs, 13);
});

test('challenges complete once and unlock cosmetic skins only', () => {
  const { prog } = makeProgression();
  assert.equal(prog.activeChallenges().length, 3);
  assert.equal(prog.isSkinUnlocked('violet'), false);
  assert.equal(prog.selectSkin('violet'), false);
  prog.completeChallenge(CHALLENGES[0].id);
  const unlocked = prog.completeChallenge(CHALLENGES[1].id);
  assert.deepEqual(unlocked.map((s) => s.id), ['violet']);
  assert.deepEqual(prog.completeChallenge(CHALLENGES[1].id), [], 'idempotent');
  assert.equal(prog.selectSkin('violet'), true);
  assert.equal(prog.skin.id, 'violet');
  assert.equal(prog.activeChallenges()[0].id, CHALLENGES[2].id);
  // Skins carry no gameplay properties.
  for (const s of SKINS) assert.deepEqual(Object.keys(s).sort(), ['core', 'glow', 'id', 'name', 'need', 'trail']);
});

test('settings persist', () => {
  const { prog, backend } = makeProgression();
  prog.setSetting('muted', true);
  prog.setSetting('reducedEffects', true);
  const again = new ProgressionSystem(new SafeStorage(KEY, backend));
  again.load();
  assert.equal(again.settings.muted, true);
  assert.equal(again.settings.reducedEffects, true);
});

test('ghost records the opening and plays back interpolated positions', () => {
  const rec = new GhostRecorder(100);
  for (let z = 0; z <= 120; z += 0.25) rec.record(z, Math.sin(z / 10), z > 50 && z < 52 ? 1 : 0);
  const data = rec.export(999);
  assert.equal(data.v, COURSE_VERSION);
  assert.ok(data.xs.length >= 50 && data.xs.length <= 52);
  const pb = new GhostPlayback();
  pb.load(data);
  pb.sample(31);
  assert.equal(pb.visible, true);
  assert.ok(Math.abs(pb.x - Math.sin(3.1)) < 0.03);
  pb.sample(500);
  assert.equal(pb.visible, false);
});

test('a stale-version ghost is discarded on load', () => {
  const { prog } = makeProgression(JSON.stringify({ bestScore: 5, ghost: { v: COURSE_VERSION + 1, step: 2, xs: [1, 2], ys: [0, 0] } }));
  assert.equal(prog.data.ghost, null);
  assert.equal(prog.data.bestScore, 5);
});

test('score: transparent gate tiers, streak multiplier and miss reset', () => {
  const s = new ScoreSystem();
  assert.equal(s.resolveGate(true, 0.9).tier, GateTier.PERFECT);
  assert.equal(s.resolveGate(true, 0.5).tier, GateTier.GOOD);
  assert.equal(s.multiplier, 2);
  const before = s.total;
  assert.equal(s.resolveGate(false, 0).tier, GateTier.MISS);
  assert.equal(s.multiplier, 1);
  assert.equal(s.total, before, 'a miss never removes earned points');
  assert.equal(s.bestStreak, 2);
  assert.equal(s.precision, Math.round(((0.9 + 0.5) / 3) * 100));
  for (let i = 0; i < 30; i++) s.resolveGate(true, 1);
  assert.equal(s.multiplier, 5, 'capped');
});

test('restart resets run-specific state without deleting persistent records', () => {
  const { prog } = makeProgression();
  prog.recordRun({ score: 4321, distance: 1234, orbs: 9 });
  const sim = new Simulation();
  sim.reset(77, prog.activeChallenges());
  for (let i = 0; i < 1200; i++) sim.step(PHYSICS.DT, { steer: i % 240 < 120 ? 0.3 : -0.3, jump: false });
  assert.ok(sim.player.z > 100);
  assert.ok(sim.score.total > 0);
  sim.reset(78, prog.activeChallenges());
  assert.equal(sim.player.z, 0);
  assert.equal(sim.player.x, 0);
  assert.equal(sim.player.alive, true);
  assert.equal(sim.score.total, 0);
  assert.equal(sim.score.orbs, 0);
  assert.equal(sim.time, 0);
  assert.equal(sim.over, false);
  assert.equal(sim.notices.length, 0);
  assert.ok(sim.track.obstacles.every((o) => o.hitFlash === 0));
  assert.equal(prog.data.bestScore, 4321);
  assert.equal(prog.data.bestDistance, 1234);
});

test('challenge completion during a run awards its bonus once', () => {
  const sim = new Simulation();
  const orbs5 = CHALLENGES.find((c) => c.id === 'orbs5');
  sim.reset(1, [orbs5]);
  // The tutorial runway has a centre-line orb trail.
  for (let i = 0; i < 120 * 6; i++) sim.step(PHYSICS.DT, { steer: 0, jump: false });
  assert.ok(sim.score.orbs >= 5, `orbs ${sim.score.orbs}`);
  assert.equal(sim.completedChallenges.length, 1);
  assert.equal(sim.notices.filter((n) => n.kind === 'challenge').length, 1);
});
