/**
 * End-to-end fairness check: a bot plays real runs through Simulation using
 * the REAL physics functions for lookahead. If the validator's conservative
 * model ever accepted a layout the real physics can't survive, the bot dies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS } from '../src/config.js';
import { Simulation } from '../src/core/Simulation.js';
import { Player } from '../src/entities/Player.js';
import { stepForward, stepHorizontal, resolveRails, stepVertical, requestJump, findObstacleHit, StepEvents } from '../src/physics/PhysicsWorld.js';

const DT = PHYSICS.DT;
const SEG = 0.2; // s per plan segment
const SEG_STEPS = Math.round(SEG / DT);
const DEPTH = 8; // 1.6 s lookahead
const NODE_LIMIT = 4000;

const stack = Array.from({ length: DEPTH + 1 }, () => new Player());
const ev = new StepEvents();
let nodes = 0;

/** Advance probe by one plan segment using the real physics (no world mutation). */
function simulateSegment(track, b, steer, jump) {
  const r = b.radius;
  for (let i = 0; i < SEG_STEPS; i++) {
    b.savePrevious();
    if (jump && i === 0) requestJump(b);
    stepForward(b, DT, track);
    stepHorizontal(b, steer, DT);
    resolveRails(b, track.halfWidth, null);
    ev.reset();
    stepVertical(b, track, DT, ev);
    if (ev.crashed || b.falling) return false;
    const ay = b.prevY - track.heightAt(b.prevZ) + r;
    const by = b.y - track.heightAt(b.z) + r;
    if (findObstacleHit(track.obstacles, b.prevX, ay, b.prevZ, b.x, by, b.z, r, b.prevZ, b.z)) return false;
  }
  return true;
}

const OPTIONS = [];
for (const jump of [false, true]) for (const steer of [0, -1, 1]) OPTIONS.push({ steer, jump });

/** Depth-first search for a sequence of segments that survives the lookahead. */
function search(track, depth, prevSteer) {
  if (depth === DEPTH) return [];
  const order = OPTIONS.slice().sort((a, b) => (a.jump - b.jump) || ((a.steer === prevSteer ? 0 : 1) - (b.steer === prevSteer ? 0 : 1)));
  for (const o of order) {
    if (++nodes > NODE_LIMIT) return null;
    const next = stack[depth + 1];
    Object.assign(next, stack[depth]);
    if (o.jump && !next.grounded) continue;
    if (!simulateSegment(track, next, o.steer, o.jump)) continue;
    const rest = search(track, depth + 1, o.steer);
    if (rest) return [o, ...rest];
  }
  return null;
}

function planFrom(sim, prevSteer) {
  Object.assign(stack[0], sim.player);
  nodes = 0;
  return search(sim.track, 0, prevSteer);
}

/** Does the remaining plan still survive from the current state? */
function planHolds(sim, plan, offsetSteps) {
  const b = stack[0];
  Object.assign(b, sim.player);
  // Finish the current segment, then the rest.
  let first = true;
  for (const o of plan) {
    const steps = first ? SEG_STEPS - offsetSteps : SEG_STEPS;
    for (let i = 0; i < steps; i++) {
      const r = b.radius;
      b.savePrevious();
      if (o.jump && i === 0 && (!first || offsetSteps === 0)) requestJump(b);
      stepForward(b, DT, sim.track);
      stepHorizontal(b, o.steer, DT);
      resolveRails(b, sim.track.halfWidth, null);
      ev.reset();
      stepVertical(b, sim.track, DT, ev);
      if (ev.crashed || b.falling) return false;
      if (findObstacleHit(sim.track.obstacles, b.prevX, b.prevY - sim.track.heightAt(b.prevZ) + r, b.prevZ, b.x, b.y - sim.track.heightAt(b.z) + r, b.z, r, b.prevZ, b.z)) return false;
    }
    first = false;
  }
  return true;
}

export function autopilot(seed, distance) {
  const sim = new Simulation();
  sim.reset(seed);
  let plan = [];
  let offset = 0; // steps into plan[0]
  let steer = 0;
  while (sim.player.z < distance && !sim.over) {
    if (offset >= SEG_STEPS) {
      plan.shift();
      offset = 0;
    }
    const needPlan = plan.length < 5 || (offset % 6 === 0 && !planHolds(sim, plan, offset));
    let jumpNow = false;
    if (needPlan) {
      const p = planFrom(sim, steer);
      if (p) {
        plan = p;
        offset = 0;
      }
    }
    const seg = plan[0] || { steer: 0, jump: false };
    if (offset === 0 && seg.jump) jumpNow = true;
    steer = seg.steer;
    sim.step(DT, { steer, jump: jumpNow });
    offset++;
  }
  return sim;
}

for (const seed of [3, 1234]) {
  test(`autopilot survives 3000 m of generated course (seed ${seed})`, () => {
    const sim = autopilot(seed, 3000);
    assert.equal(sim.over, false, `bot crashed (${sim.crashCause}) at z=${sim.player.z.toFixed(1)} x=${sim.player.x.toFixed(2)}; segments: ${sim.generator.log.join(',')}`);
    assert.ok(sim.generator.log.filter((id) => id !== 'runway' && id !== 'tutorial').length > 15, 'played through many hazard segments');
  });
}
