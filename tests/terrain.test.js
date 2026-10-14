import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS, TRACK } from '../src/config.js';
import { Terrain } from '../src/world/Terrain.js';
import { Track } from '../src/world/Track.js';
import { Player } from '../src/entities/Player.js';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { validateSegment } from '../src/world/PatternValidator.js';
import { forwardSpeed, speedAt } from '../src/world/DifficultyManager.js';

const DT = PHYSICS.DT;
const H = TRACK.HALF_WIDTH;

test('terrain: eased hills are continuous with zero slope at the ends', () => {
  const t = new Terrain();
  t.append(10, 0);
  t.append(40, 3, true);
  t.append(70, -3, true);
  assert.equal(t.heightAt(10), 0);
  assert.ok(Math.abs(t.heightAt(25) - 1.5) < 1e-9);
  assert.ok(Math.abs(t.heightAt(40) - 3) < 1e-9);
  assert.ok(Math.abs(t.slopeAt(10.0001)) < 1e-3);
  assert.ok(t.slopeAt(25) > 0 && t.slopeAt(55) < 0);
  assert.ok(Math.abs(t.heightAt(70)) < 1e-9);
});

test('terrain: drops are discontinuities with both sides queryable', () => {
  const t = new Terrain();
  t.append(20, 2); // linear ramp up 2 m
  t.append(20, -2); // lip: instant drop
  t.append(50, 0);
  assert.equal(t.heightBefore(20), 2);
  assert.equal(t.heightAt(20), 0);
  assert.equal(t.drops.length, 1);
  assert.equal(t.slopeAt(10), 0.1);
});

function run(spec, steps, steer = 0, jumpAtZ = -1) {
  const track = new Track();
  track.addSegment(spec, 0);
  const world = new PhysicsWorld(track);
  const p = new Player();
  const log = [];
  for (let i = 0; i < steps && p.alive; i++) {
    const jump = jumpAtZ >= 0 && p.z >= jumpAtZ && p.z < jumpAtZ + p.vz * DT * 1.01;
    const ev = world.step(p, { steer, jump }, DT);
    log.push({ z: p.z, y: p.y, ground: track.heightAt(p.z), grounded: p.grounded, launched: ev.launched, crashed: ev.crashed });
  }
  return { p, log, track };
}

test('the ball follows a gentle downhill while grounded and speeds up', () => {
  const spec = { id: 't', length: 200, items: [], terrain: [{ z0: 10, z1: 150, dh: -14, ease: true }] };
  const { p, log } = run(spec, 120 * 6);
  const onSlope = log.filter((e) => e.z > 20 && e.z < 140);
  assert.ok(onSlope.every((e) => e.grounded && Math.abs(e.y - e.ground) < 1e-6), 'stays on the surface');
  assert.ok(forwardSpeed(80, -0.15) > speedAt(80), 'downhill is faster');
  assert.ok(p.alive);
});

test('a ramp lip launches the ball into the air and it lands beyond a gap', () => {
  const spec = {
    id: 't',
    length: 120,
    items: [{ type: 'hole', x0: -H, x1: H, z0: 26, z1: 31 }],
    terrain: [
      { z0: 20, z1: 26, dh: 2.1 },
      { z0: 26, z1: 26, dh: -2.1 },
    ],
  };
  const { p, log } = run(spec, 120 * 4);
  assert.ok(log.some((e) => e.launched), 'launched at the lip');
  const peak = Math.max(...log.map((e) => e.y));
  assert.ok(peak > 2.3, `peak ${peak}`);
  assert.ok(p.alive, 'cleared the gap');
  assert.ok(log[log.length - 1].grounded);
});

test('rolling off a drop-off falls to the lower deck and lands', () => {
  const spec = { id: 't', length: 100, items: [], terrain: [{ z0: 20, z1: 20, dh: -3 }] };
  const { p, log } = run(spec, 120 * 3);
  const airborne = log.filter((e) => !e.grounded);
  assert.ok(airborne.length > 20, 'spent time in the air');
  assert.ok(p.alive && p.grounded);
  assert.ok(Math.abs(p.y - -3) < 1e-6);
});

test('a sharp crest pops the ball off the ground at speed', () => {
  // Peak curvature 4*pi^2/(2*10^2) ~ 0.2/m: v^2 * 0.2 >> g at ~16 m/s.
  const spec = { id: 't', length: 120, items: [], terrain: [{ z0: 10, z1: 20, dh: 4, ease: true }, { z0: 20, z1: 30, dh: -4, ease: true }] };
  const { log } = run(spec, 120 * 3);
  const air = log.filter((e) => e.z > 18 && e.z < 40 && !e.grounded);
  assert.ok(air.length > 0, 'left the ground over the crest');
});

test('obstacles sit on the local surface (relative collision heights)', () => {
  const spec = {
    id: 't',
    length: 120,
    items: [{ type: 'wall', x: 0, z: 60, w: 3, d: 0.6, h: 2.6 }],
    terrain: [{ z0: 10, z1: 100, dh: -20, ease: true }],
  };
  const { p } = run(spec, 120 * 5);
  assert.equal(p.alive, false, 'hit the wall halfway down the slope');
});

test('validator: ramp gaps are accepted when the launch clears them and rejected otherwise', () => {
  const mk = (gap) => ({
    id: 't',
    length: 110,
    items: [{ type: 'hole', x0: -H, x1: H, z0: 26, z1: 26 + gap }],
    terrain: [
      { z0: 20, z1: 26, dh: 2.1 },
      { z0: 26, z1: 26, dh: -2.1 },
    ],
  });
  assert.equal(validateSegment(mk(6), 0, { speed: 18 }).ok, true);
  assert.equal(validateSegment(mk(40), 0, { speed: 18 }).ok, false);
});

test('validator: a drop-off onto a wall is rejected; onto open deck accepted', () => {
  const base = { id: 't', length: 90, terrain: [{ z0: 20, z1: 20, dh: -3 }] };
  assert.equal(validateSegment({ ...base, items: [] }, 0, { speed: 18 }).ok, true);
  // Long enough that no trajectory off the edge (even a jump) can clear it.
  assert.equal(validateSegment({ ...base, items: [{ type: 'wall', x: 0, z: 26, w: 2 * H, d: 16, h: 2.6 }] }, 0, { speed: 18 }).ok, false);
});
