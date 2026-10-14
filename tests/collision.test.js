import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweptSphereAABB, sphereAABBOverlap, segmentPointDistSq, crossPlaneZ } from '../src/physics/Collision.js';
import { Player } from '../src/entities/Player.js';
import { Track } from '../src/world/Track.js';
import { PhysicsWorld, detectCollisions, StepEvents } from '../src/physics/PhysicsWorld.js';
import { ScoreSystem } from '../src/systems/ScoreSystem.js';
import { PHYSICS } from '../src/config.js';

test('sphere/box overlap: hit and miss', () => {
  assert.equal(sphereAABBOverlap(0, 0.5, 0, 0.5, -1, 0, -1, 1, 1, 1), true);
  assert.equal(sphereAABBOverlap(3, 0.5, 0, 0.5, -1, 0, -1, 1, 1, 1), false);
  // Rounded corner: inside the expanded box, but outside the sphere sum.
  assert.equal(sphereAABBOverlap(1.4, 0.5, 1.4, 0.5, -1, 0, -1, 1, 1, 1), false);
});

test('swept sphere detects a thin wall it would tunnel through', () => {
  // One step jumps from z=-5 to z=5 through a 0.1 m wall.
  const t = sweptSphereAABB(0, 0.5, -5, 0, 0.5, 5, 0.45, -1, 0, 0, 1, 2, 0.1);
  assert.ok(t > 0.4 && t < 0.5, `t=${t}`);
});

test('swept sphere misses when passing beside or above', () => {
  assert.equal(sweptSphereAABB(2, 0.5, -5, 2, 0.5, 5, 0.45, -1, 0, 0, 1, 2, 0.5), -1);
  assert.equal(sweptSphereAABB(0, 3, -5, 0, 3, 5, 0.45, -1, 0, 0, 1, 2, 0.5), -1);
});

test('swept sphere does not report corner-region near misses', () => {
  // Diagonal approach that ends inside the expanded box's corner region but
  // never within r of the real corner (closest distance ~0.495 > 0.45).
  const t = sweptSphereAABB(2, 0.5, -1, 1.35, 0.5, -0.35, 0.45, -1, 0, 0, 1, 1, 0.1);
  assert.equal(t, -1);
  // Same approach continued slightly further does touch.
  assert.ok(sweptSphereAABB(2, 0.5, -1, 1.25, 0.5, -0.25, 0.45, -1, 0, 0, 1, 1, 0.1) > 0);
});

test('segment-point distance and plane crossing', () => {
  assert.equal(segmentPointDistSq(0, 0, 0, 0, 0, 10, 1, 0, 5), 1);
  assert.equal(crossPlaneZ(0, 1, 0.5), 0.5);
  assert.equal(crossPlaneZ(0.6, 1, 0.5), -1);
});

function stepThrough(track, p, steps, steer = 0) {
  const world = new PhysicsWorld(track);
  const collected = [];
  let crashed = null;
  for (let i = 0; i < steps; i++) {
    const ev = world.step(p, { steer, jump: false }, PHYSICS.DT);
    collected.push(...ev.orbs);
    if (ev.crashed) {
      crashed = ev;
      break;
    }
  }
  return { collected, crashed };
}

test('running into a wall is a damaging collision', () => {
  const track = new Track();
  track.addSegment({ length: 50, items: [{ type: 'wall', x: 0, z: 10, w: 2, d: 0.6, h: 2.6 }] }, 0);
  const p = new Player();
  const { crashed } = stepThrough(track, p, 240);
  assert.ok(crashed);
  assert.equal(crashed.crashCause, 'obstacle');
});

test('passing beside a wall is safe', () => {
  const track = new Track();
  track.addSegment({ length: 50, items: [{ type: 'wall', x: 0, z: 10, w: 2, d: 0.6, h: 2.6 }] }, 0);
  const p = new Player();
  p.x = 2.5;
  const { crashed } = stepThrough(track, p, 240);
  assert.equal(crashed, null);
});

test('a moving barrier is detected using relative motion', () => {
  const track = new Track();
  track.addSegment({ length: 50, items: [{ type: 'mover', x: 0, z: 10, w: 2, d: 0.6, h: 1.6, amp: 0, freq: 0, phase: 0 }] }, 0);
  const p = new Player();
  const { crashed } = stepThrough(track, p, 240);
  assert.ok(crashed);
});

test('collectibles are awarded only once', () => {
  const track = new Track();
  track.addSegment({ length: 50, items: [{ type: 'orb', x: 0, y: 0.4, z: 5 }] }, 0);
  const p = new Player();
  const score = new ScoreSystem();
  const { collected } = stepThrough(track, p, 240);
  for (const _ of collected) score.collectOrb();
  assert.equal(collected.length, 1);
  assert.equal(score.orbs, 1);
  // Even if the player were moved back over it, the flag prevents re-award.
  const ev = new StepEvents();
  p.alive = true;
  p.prevZ = 4;
  p.z = 6;
  p.prevX = p.x = 0;
  detectCollisions(p, track, ev, p.prevZ);
  assert.equal(ev.orbs.length, 0);
});

test('gates: centre pass is accurate, outside pass is a miss, each resolved once', () => {
  const track = new Track();
  track.addSegment({ length: 80, items: [{ type: 'gate', x: 0, z: 10, width: 3 }, { type: 'gate', x: 0, z: 40, width: 3 }] }, 0);
  const world = new PhysicsWorld(track);
  const p = new Player();
  const results = [];
  for (let i = 0; i < 480; i++) {
    // Steer far right after the first gate to go around the second.
    const steer = p.z > 15 && p.x < 3.9 ? 1 : 0;
    const ev = world.step(p, { steer, jump: false }, PHYSICS.DT);
    assert.equal(ev.crashed, false);
    for (const g of ev.gates) results.push([g.result, g.accuracy]);
  }
  assert.equal(results.length, 2);
  assert.equal(results[0][0], 'pass');
  assert.ok(results[0][1] > 0.99);
  assert.equal(results[1][0], 'miss');
});

test('hitting a gate post is a crash', () => {
  const track = new Track();
  track.addSegment({ length: 50, items: [{ type: 'gate', x: 0, z: 10, width: 2 }] }, 0);
  const p = new Player();
  p.x = 1.15; // right on the post
  const { crashed } = stepThrough(track, p, 240);
  assert.ok(crashed);
});

test('jumping clears a hurdle', () => {
  const track = new Track();
  track.addSegment({ length: 50, items: [{ type: 'hurdle', x: 0, z: 10, w: 9, d: 0.5, h: 0.55 }] }, 0);
  const world = new PhysicsWorld(track);
  const p = new Player();
  let crashed = false;
  for (let i = 0; i < 240; i++) {
    const jump = p.z > 6 && p.z < 6.3;
    const ev = world.step(p, { steer: 0, jump }, PHYSICS.DT);
    if (ev.crashed) crashed = true;
  }
  assert.equal(crashed, false);
  assert.ok(p.z > 20);
});
