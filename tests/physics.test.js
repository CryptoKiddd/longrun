import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS } from '../src/config.js';
import { Player } from '../src/entities/Player.js';
import { Track } from '../src/world/Track.js';
import {
  PhysicsWorld,
  stepHorizontal,
  stepVertical,
  requestJump,
  canJump,
  resolveRails,
  StepEvents,
  FLAT_WORLD,
} from '../src/physics/PhysicsWorld.js';
import { GameLoop } from '../src/core/GameLoop.js';

const DT = PHYSICS.DT;
const always = FLAT_WORLD;
const never = { ...FLAT_WORLD, isSupported: () => false };

test('gravity decreases vertical velocity by g*dt each step', () => {
  const p = new Player();
  p.grounded = false;
  p.y = 5;
  p.vy = 0;
  stepVertical(p, always, DT, null);
  assert.ok(Math.abs(p.vy - -PHYSICS.GRAVITY * DT) < 1e-9);
  stepVertical(p, always, DT, null);
  assert.ok(Math.abs(p.vy - -2 * PHYSICS.GRAVITY * DT) < 1e-9);
  assert.ok(p.y < 5, 'falls downward (toward -y)');
});

test('jumping launches the player upward with positive velocity', () => {
  const p = new Player();
  const ev = new StepEvents();
  requestJump(p);
  stepVertical(p, always, DT, ev);
  assert.equal(ev.jumped, true);
  assert.equal(p.grounded, false);
  assert.ok(p.vy > 0 && p.vy <= PHYSICS.JUMP_VELOCITY);
  assert.ok(p.y > 0);
});

test('a full jump has ascent, apex and descent, and lands with velocity reset', () => {
  const p = new Player();
  const ev = new StepEvents();
  requestJump(p);
  let apex = 0;
  let sawAscent = false;
  let sawDescent = false;
  let landed = false;
  for (let i = 0; i < 240 && !landed; i++) {
    ev.reset();
    stepVertical(p, always, DT, ev);
    if (p.vy > 0) sawAscent = true;
    if (p.vy < 0) sawDescent = true;
    apex = Math.max(apex, p.y);
    landed = ev.landed;
  }
  const expectedApex = (PHYSICS.JUMP_VELOCITY * PHYSICS.JUMP_VELOCITY) / (2 * PHYSICS.GRAVITY);
  assert.ok(sawAscent && sawDescent && landed);
  assert.ok(Math.abs(apex - expectedApex) < 0.05, `apex ${apex} ~ ${expectedApex}`);
  assert.equal(p.vy, 0);
  assert.equal(p.y, 0);
  assert.equal(p.grounded, true);
  assert.equal(p.jumpedSinceGround, false);
});

test('airborne players cannot perform a second jump', () => {
  const p = new Player();
  requestJump(p);
  stepVertical(p, always, DT, null);
  for (let i = 0; i < 20; i++) stepVertical(p, always, DT, null);
  const vyBefore = p.vy;
  assert.equal(canJump(p), false);
  const ev = new StepEvents();
  requestJump(p);
  stepVertical(p, always, DT, ev);
  assert.equal(ev.jumped, false);
  assert.ok(p.vy < vyBefore, 'velocity keeps decreasing under gravity');
});

test('a jump pressed just before landing is buffered and fires on landing', () => {
  const p = new Player();
  requestJump(p);
  stepVertical(p, always, DT, null);
  // Advance until just before touchdown.
  while (!(p.vy < 0 && p.y < 0.15)) stepVertical(p, always, DT, null);
  requestJump(p);
  let jumpedAgain = false;
  for (let i = 0; i < 20; i++) {
    const ev = new StepEvents();
    stepVertical(p, always, DT, ev);
    if (ev.jumped) jumpedAgain = true;
  }
  assert.equal(jumpedAgain, true);
});

test('coyote time allows a jump shortly after leaving an edge, but not later', () => {
  const p = new Player();
  stepVertical(p, never, DT, null); // roll off the edge
  assert.equal(p.grounded, false);
  assert.equal(canJump(p), true);
  for (let i = 0; i < 30; i++) stepVertical(p, never, DT, null);
  assert.equal(canJump(p), false);
});

test('horizontal velocity never exceeds the maximum', () => {
  const p = new Player();
  for (let i = 0; i < 600; i++) {
    stepHorizontal(p, 1, DT);
    assert.ok(p.vx <= PHYSICS.LAT_MAX_SPEED + 1e-9);
  }
  assert.ok(Math.abs(p.vx - PHYSICS.LAT_MAX_SPEED) < 1e-6);
  for (let i = 0; i < 600; i++) stepHorizontal(p, -1, DT);
  assert.ok(Math.abs(p.vx + PHYSICS.LAT_MAX_SPEED) < 1e-6);
});

test('acceleration is not cancelled by friction while steering', () => {
  const p = new Player();
  stepHorizontal(p, 1, DT);
  assert.ok(Math.abs(p.vx - PHYSICS.LAT_ACCEL * DT) < 1e-9);
});

test('friction smoothly reduces horizontal speed to zero without input', () => {
  const p = new Player();
  p.vx = 8;
  let last = p.vx;
  for (let i = 0; i < 240; i++) {
    stepHorizontal(p, 0, DT);
    assert.ok(p.vx <= last && p.vx >= 0, 'monotonic decay, no sign flip');
    last = p.vx;
  }
  assert.equal(p.vx, 0);
});

test('reversing direction uses the stronger turn acceleration', () => {
  const p = new Player();
  p.vx = 5;
  stepHorizontal(p, -1, DT);
  assert.ok(Math.abs(p.vx - (5 - PHYSICS.LAT_TURN_ACCEL * DT)) < 1e-9);
});

test('side rails clamp position and reflect velocity', () => {
  const p = new Player();
  p.x = 10;
  p.vx = 8;
  const ev = new StepEvents();
  resolveRails(p, 4.5, ev);
  assert.equal(p.x, 4.5 - p.radius);
  assert.ok(p.vx < 0);
  assert.equal(ev.railHit, true);
});

test('player falls into a hole and the run ends with cause "fell"', () => {
  const track = new Track();
  track.addSegment({ length: 60, items: [{ type: 'hole', x0: -4.5, x1: 4.5, z0: 5, z1: 30 }] }, 0);
  const world = new PhysicsWorld(track);
  const p = new Player();
  let ev;
  for (let i = 0; i < 600; i++) {
    ev = world.step(p, { steer: 0, jump: false }, DT);
    if (ev.crashed) break;
  }
  assert.equal(ev.crashed, true);
  assert.equal(ev.crashCause, 'fell');
  assert.equal(p.alive, false);
});

test('physics is consistent across different rendering frame rates', () => {
  function run(frameDeltas) {
    const p = new Player();
    const track = new Track();
    track.addSegment({ length: 400, items: [] }, 0);
    const world = new PhysicsWorld(track);
    let t = 0;
    const loop = new GameLoop({
      fixedUpdate: (dt) => {
        t += dt;
        world.step(p, { steer: t < 0.5 ? 1 : -0.5, jump: t > 0.2 && t < 0.21 }, dt);
      },
      frameUpdate: () => {},
      raf: null,
    });
    for (const d of frameDeltas) loop.advance(d);
    return { p, t };
  }
  const total = 1.5;
  const fps30 = Array(Math.round(total * 30)).fill(1 / 30);
  const fps60 = Array(Math.round(total * 60)).fill(1 / 60);
  const fps144 = Array(Math.round(total * 144)).fill(1 / 144);
  const jitter = [];
  let acc = 0;
  let seed = 7;
  while (acc < total - 0.03) {
    seed = (seed * 16807) % 2147483647;
    const d = 0.004 + (seed / 2147483647) * 0.03;
    jitter.push(d);
    acc += d;
  }
  jitter.push(total - acc);
  const results = [fps30, fps60, fps144, jitter].map(run);
  const ref = results[1];
  for (const r of results) {
    // Same simulated time (within one step) => same state (within one step of motion).
    assert.ok(Math.abs(r.t - ref.t) <= DT + 1e-9, `time ${r.t} vs ${ref.t}`);
    assert.ok(Math.abs(r.p.z - ref.p.z) <= ref.p.vz * DT * 1.01 + 1e-6);
    assert.ok(Math.abs(r.p.x - ref.p.x) <= PHYSICS.LAT_MAX_SPEED * DT + 1e-6);
  }
});
