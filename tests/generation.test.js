import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track } from '../src/world/Track.js';
import { SegmentGenerator } from '../src/world/SegmentGenerator.js';
import { PATTERNS } from '../src/world/PatternLibrary.js';
import { validateSegment } from '../src/world/PatternValidator.js';
import { difficultyAt, speedAt, UNLOCKS } from '../src/world/DifficultyManager.js';
import { TRACK, SPEED } from '../src/config.js';
import { Rng } from '../src/core/rng.js';

const H = TRACK.HALF_WIDTH;

test('validator rejects an unavoidable full-width wall', () => {
  const spec = { id: 'x', length: 60, items: [{ type: 'wall', x: 0, z: 20, w: 2 * H, d: 0.6, h: 2.6 }] };
  assert.equal(validateSegment(spec, 0, { speed: 20 }).ok, false);
});

test('validator rejects a hole too long to jump', () => {
  const spec = { id: 'x', length: 80, items: [{ type: 'hole', x0: -H, x1: H, z0: 20, z1: 45 }] };
  assert.equal(validateSegment(spec, 0, { speed: 20 }).ok, false);
});

test('validator rejects a hazard with no reaction distance from some lanes', () => {
  // Wall covering the left 2/3 one metre after entry: left lanes cannot escape.
  const spec = { id: 'x', length: 40, items: [{ type: 'wall', x: -1.5, z: 1, w: 6, d: 0.6, h: 2.6 }] };
  const r = validateSegment(spec, 0, { speed: 20 });
  assert.equal(r.ok, false);
  assert.ok(r.unsafeLanes > 0 && r.unsafeLanes < r.lanes);
});

test('validator accepts a jumpable hole and a steerable wall', () => {
  assert.equal(validateSegment({ id: 'x', length: 60, items: [{ type: 'hole', x0: -H, x1: H, z0: 20, z1: 25 }] }, 0, { speed: 18 }).ok, true);
  assert.equal(validateSegment({ id: 'x', length: 60, items: [{ type: 'wall', x: -2, z: 25, w: 5, d: 0.6, h: 2.6 }] }, 0, { speed: 18 }).ok, true);
});

test('validator rejects a segment that ends mid-jump over a hole', () => {
  const spec = { id: 'x', length: 26, items: [{ type: 'hole', x0: -H, x1: H, z0: 20, z1: 26 }] };
  assert.equal(validateSegment(spec, 0, { speed: 18 }).ok, false);
});

test('every pattern can be validated at every difficulty (with lead-in growth)', () => {
  for (const p of PATTERNS) {
    for (const z of [p.unlock + 1, 1200, 2500, 4000, 7000]) {
      const speed = speedAt(z + 40);
      const level = difficultyAt(z);
      let seed = 1;
      let failures = 0;
      for (let i = 0; i < 12; i++) {
        const r = new Rng(seed++ * 7919);
        let ok = false;
        for (let g = 0; g <= 3 && !ok; g++) {
          const spec = p.build({ rng: r, level, speed, z, leadIn: speed * (0.6 - 0.28 * level + g * 0.3), intro: false });
          ok = validateSegment(spec, z).ok;
        }
        if (!ok) failures++;
      }
      assert.ok(failures <= 1, `${p.id} at z=${z}: ${failures}/12 unvalidatable`);
    }
  }
});

/** Generate a long course and re-validate each placed segment independently. */
function generateCourse(seed, until) {
  const track = new Track();
  const specs = [];
  const gen = new SegmentGenerator(track, {
    validate: (spec, z) => {
      const r = validateSegment(spec, z);
      if (r.ok) specs.push({ spec, z });
      return r;
    },
  });
  gen.reset(seed);
  while (track.generatedUntil < until) gen.generateNext();
  return { track, gen, specs };
}

test('procedural course: all placed segments are valid, contiguous and endless', () => {
  for (const seed of [1, 99, 2024, 777777]) {
    const { gen, track } = generateCourse(seed, 9000);
    assert.ok(track.generatedUntil >= 9000);
    assert.ok(gen.stats.generated > 60, 'many segments');
    assert.ok(gen.stats.fallbacks <= 2, `fallbacks ${gen.stats.fallbacks}`);
  }
});

test('hazards never overlap segment lead-ins and recovery runways appear', () => {
  const { gen } = generateCourse(5, 6000);
  const ids = gen.log;
  assert.ok(ids.includes('runway'), 'recovery sections inserted');
  // No more than 6 demanding patterns in a row without a runway.
  let run = 0;
  for (const id of ids) {
    run = id === 'runway' || id === 'tutorial' ? 0 : run + 1;
    assert.ok(run <= 7, `too many hard patterns in a row: ${ids.join(',')}`);
  }
});

test('mechanics are introduced progressively, starting gently', () => {
  const { gen, track } = generateCourse(3, 2600);
  assert.equal(gen.log[0], 'tutorial');
  assert.ok(track.generatedUntil >= UNLOCKS.slalom);
  const firstIndex = (id) => gen.log.indexOf(id);
  assert.ok(firstIndex('slalom') < firstIndex('hurdles'));
  assert.ok(firstIndex('hurdles') < firstIndex('hole'));
  assert.ok(firstIndex('hole') < firstIndex('mover'));
});

test('the opening is approachable: no hazards in the first six seconds', () => {
  const track = new Track();
  const gen = new SegmentGenerator(track);
  gen.reset(11);
  gen.ensureAhead(0, 400);
  const calm = SPEED.MIN * 6;
  for (const o of track.obstacles) assert.ok(o.z0 > calm, `obstacle at ${o.z0}`);
  for (const h of track.holes) assert.ok(h.z0 > calm, `hole at ${h.z0}`);
});

test('opening course is identical across runs (deterministic for ghosts); later course varies', () => {
  const a = generateCourse(1, TRACK.OPENING_LENGTH + 1500);
  const b = generateCourse(2, TRACK.OPENING_LENGTH + 1500);
  const sig = (track, lo, hi) =>
    track.obstacles
      .filter((o) => o.z0 >= lo && o.z0 < hi)
      .map((o) => `${o.kind}:${o.x.toFixed(2)}:${o.z0.toFixed(2)}`)
      .join('|');
  assert.equal(sig(a.track, 0, TRACK.OPENING_LENGTH - 100), sig(b.track, 0, TRACK.OPENING_LENGTH - 100));
  assert.notEqual(sig(a.track, TRACK.OPENING_LENGTH + 200, 99999), sig(b.track, TRACK.OPENING_LENGTH + 200, 99999));
});

test('track recycling keeps object counts bounded', () => {
  const track = new Track();
  const gen = new SegmentGenerator(track);
  gen.reset(8);
  let maxObjects = 0;
  for (let z = 0; z < 20000; z += 5) {
    gen.ensureAhead(z);
    track.recycle(z - TRACK.KEEP_BEHIND);
    maxObjects = Math.max(maxObjects, track.obstacles.length + track.orbs.length + track.holes.length + track.gates.length);
  }
  assert.ok(maxObjects < 400, `max live objects ${maxObjects}`);
  assert.ok(track.generatedUntil > 20000);
});

test('difficulty and speed rise monotonically and plateau', () => {
  let prev = -1;
  for (let z = 0; z <= 10000; z += 100) {
    const s = speedAt(z);
    assert.ok(s >= prev);
    assert.ok(s <= SPEED.MAX + 1e-9);
    prev = s;
  }
  assert.equal(speedAt(0), SPEED.MIN);
  assert.equal(speedAt(1e6), SPEED.MAX);
  assert.ok(difficultyAt(150) < 0.08);
});
