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
import { moverX } from '../src/world/Track.js';
import { sweptSphereAABB } from '../src/physics/Collision.js';
import { stepForward, stepHorizontal, resolveRails, stepVertical, requestJump, StepEvents } from '../src/physics/PhysicsWorld.js';

const DT = PHYSICS.DT;
const HORIZON = Math.round(1.5 / DT);

const PLANS = [];
for (const jumpAt of [-1, 0, 0.12, 0.25, 0.4, 0.55]) {
  for (const s1 of [0, -1, 1]) {
    for (const switchAt of [0.15, 0.35, 0.7]) {
      for (const s2 of [0, -1, 1]) PLANS.push({ s1, s2, switchAt, jumpAt });
    }
  }
}

const probe = new Player();
const ev = new StepEvents();

/** Does following `plan` from time offset `t0` survive the horizon? (no world mutation) */
function survives(sim, plan, t0) {
  const track = sim.track;
  Object.assign(probe, sim.player);
  const support = (x, z) => track.isSupported(x, z);
  for (let i = 0; i < HORIZON; i++) {
    const t = t0 + i * DT;
    probe.savePrevious();
    if (plan.jumpAt >= 0 && Math.abs(t - plan.jumpAt) < DT / 2) requestJump(probe);
    stepForward(probe, DT);
    stepHorizontal(probe, t < plan.switchAt ? plan.s1 : plan.s2, DT);
    resolveRails(probe, track.halfWidth, null);
    ev.reset();
    stepVertical(probe, support, DT, ev);
    if (ev.crashed || probe.falling) return false;
    const r = probe.radius;
    for (const o of track.obstacles) {
      if (o.z1 < probe.prevZ - 2 || o.z0 > probe.z + 2) continue;
      let ox = o.x;
      let sx = probe.prevX;
      if (o.kind === 'mover') {
        ox = moverX(o, probe.z);
        sx -= ox - moverX(o, probe.prevZ);
      }
      const hw = o.w / 2;
      if (sweptSphereAABB(sx, probe.prevY + r, probe.prevZ, probe.x, probe.y + r, probe.z, r, ox - hw, 0, o.z0, ox + hw, o.h, o.z1) >= 0) return false;
    }
  }
  return true;
}

function autopilot(seed, distance) {
  const sim = new Simulation();
  sim.reset(seed);
  let plan = PLANS[0];
  let planT = 0;
  let steps = 0;
  while (sim.player.z < distance && !sim.over) {
    if (steps % 6 === 0 && !survives(sim, plan, planT)) {
      plan = PLANS.find((p) => survives(sim, p, 0)) || plan;
      planT = 0;
    }
    const jump = plan.jumpAt >= 0 && Math.abs(planT - plan.jumpAt) < DT / 2;
    sim.step(DT, { steer: planT < plan.switchAt ? plan.s1 : plan.s2, jump });
    planT += DT;
    steps++;
  }
  return sim;
}

for (const seed of [3, 1234]) {
  test(`autopilot survives 3000 m of generated course (seed ${seed})`, () => {
    const sim = autopilot(seed, 3000);
    assert.equal(sim.over, false, `bot crashed (${sim.crashCause}) at z=${sim.player.z.toFixed(1)} x=${sim.player.x.toFixed(2)}; segments: ${sim.generator.log.join(',')}`);
    assert.ok(sim.score.gatesTotal > 5, 'met gates along the way');
  });
}
