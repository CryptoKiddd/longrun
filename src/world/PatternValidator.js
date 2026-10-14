import { PHYSICS, TRACK } from '../config.js';
import { Player } from '../entities/Player.js';
import { stepVertical, requestJump, findObstacleHit } from '../physics/PhysicsWorld.js';
import { speedAt, slopeBonus } from './DifficultyManager.js';
import { Track } from './Track.js';

/**
 * Fairness validator for a segment spec (including terrain: hills, slopes,
 * ramps and drop-offs).
 *
 * Vertical motion does not depend on the lane, so every possible take-off —
 * a jump, or a natural launch off a ramp lip / crest / drop — is simulated
 * ONCE with the real physics integrator. A dynamic-programming pass over
 * (step, lane, trajectory phase) then checks lateral options against
 * obstacles and floor, using a CONSERVATIVE player:
 *   - lateral movement at 70% of max speed, discretised into lanes
 *   - no steering while airborne, no coyote/buffer forgiveness
 *   - obstacles inflated by HIT_MARGIN; floor near hole edges is unsafe
 *   - landings need floor across the whole step in which they happen
 *   - must be grounded (not mid-air) at the end of the segment
 * The segment is valid only if EVERY grounded entry lane is safe. Optional
 * spec.checkpoints ({z, x}) must additionally be reachable grounded states,
 * proving a specific route (e.g. a risk-reward line) is survivable.
 */

export const VALIDATION = Object.freeze({
  SUBSTEPS: 6, // physics ticks per validator step (0.05 s)
  LAT_FRACTION: 0.7, // fraction of max lateral speed assumed
  HIT_MARGIN: 0.12, // m added to the player radius for obstacle tests
  SUPPORT_MARGIN: 0.15, // m of hole-edge floor considered unsafe
});

const scratch = new Track();
const probe = new Player();
const world1d = {
  isSupported: () => true,
  heightAt: (z) => scratch.heightAt(z),
  slopeAt: (z) => scratch.slopeAt(z),
};

/**
 * @param {import('./PatternLibrary.js').SegmentSpec} spec
 * @param {number} zStart world distance where the segment begins (sets speed)
 * @param {{ speed?: number }} [opts] fixed base speed override (tests)
 * @returns {{ ok: boolean, reason: string, unsafeLanes: number, lanes: number }}
 */
export function validateSegment(spec, zStart, opts = {}, cfg = PHYSICS) {
  const R = cfg.PLAYER_RADIUS;
  const H = TRACK.HALF_WIDTH;
  const { SUBSTEPS, LAT_FRACTION, HIT_MARGIN, SUPPORT_MARGIN } = VALIDATION;
  const DT = cfg.DT;
  const dtz = SUBSTEPS * DT;
  const CELL = cfg.LAT_MAX_SPEED * LAT_FRACTION * dtz; // one lane change per step
  const rHit = R + HIT_MARGIN;
  const baseSpeed = (z) => (opts.speed !== undefined ? opts.speed : speedAt(zStart + z));

  scratch.reset();
  scratch.addSegment(spec, 0);
  const obstacles = scratch.obstacles;
  const L = spec.length;

  const span = H - R;
  const nCells = Math.floor((2 * span) / CELL + 1e-9) + 1;
  const xs = new Float64Array(nCells);
  const step = (2 * span) / (nCells - 1);
  for (let i = 0; i < nCells; i++) xs[i] = -span + i * step;

  // One-dimensional ball used to integrate forward + vertical motion exactly.
  const advance = (b) => {
    b.vz = baseSpeed(b.z) + slopeBonus(scratch.slopeAt(b.z));
    b.z += b.vz * DT;
    stepVertical(b, world1d, DT, null, cfg);
  };
  const place = (z) => {
    probe.reset();
    probe.z = z;
    probe.y = scratch.heightAt(z);
    probe.vz = baseSpeed(z) + slopeBonus(scratch.slopeAt(z));
    probe.vy = scratch.slopeAt(z) * probe.vz;
    return probe;
  };

  // Step positions (forward speed depends only on z and terrain).
  const zsArr = [0];
  {
    const b = place(0);
    while (zsArr[zsArr.length - 1] < L && zsArr.length < 4000) {
      for (let s = 0; s < SUBSTEPS; s++) {
        b.vz = baseSpeed(b.z) + slopeBonus(scratch.slopeAt(b.z));
        b.z += b.vz * DT;
      }
      zsArr.push(Math.min(b.z, L));
    }
  }
  const nSteps = zsArr.length;
  const last = nSteps - 1;
  const zs = Float64Array.from(zsArr);

  /**
   * Simulate a take-off from grounded at step k. type 0 = roll (natural
   * launch, only if the ball actually leaves the ground), 1 = jump.
   * Returns { rel: Float64Array (relY at j = 0..len), len } or null.
   */
  const MAX_AIR = 80;
  const simulate = (k, type) => {
    const b = place(zs[k]);
    b.grounded = true;
    if (type === 1) requestJump(b, cfg);
    const rel = [0];
    for (let j = 1; j <= MAX_AIR; j++) {
      for (let s = 0; s < SUBSTEPS; s++) advance(b);
      if (k + j > last) return { rel: null, len: Infinity };
      if (Math.abs(b.z - zs[k + j]) > 0.05) b.z = zs[k + j]; // keep grids aligned
      if (b.grounded) {
        if (j === 1 && type === 0) return null; // never left the ground
        rel.push(0);
        return { rel: Float64Array.from(rel), len: j };
      }
      rel.push(b.y - scratch.heightAt(b.z));
    }
    return { rel: null, len: Infinity };
  };

  const traj = new Array(nSteps * 2);
  let maxLen = 1;
  for (let k = 0; k < last; k++) {
    traj[k * 2] = simulate(k, 0);
    traj[k * 2 + 1] = simulate(k, 1);
    for (const t of [traj[k * 2], traj[k * 2 + 1]]) if (t && t.len !== Infinity) maxLen = Math.max(maxLen, t.len);
  }

  const supported = (x, z) => scratch.isSupported(x, z, SUPPORT_MARGIN);
  const hits = (x0, y0, z0, x1, y1, z1) => findObstacleHit(obstacles, x0, y0 + R, z0, x1, y1 + R, z1, rHit, z0, z1) !== null;
  const landingOk = (x, k1) => supported(x, zs[k1 - 1]) && supported(x, (zs[k1 - 1] + zs[k1]) / 2) && supported(x, zs[k1]);

  // ---- backward pass: which states can reach the end alive -------------------
  const safeG = Array.from({ length: nSteps }, () => new Uint8Array(nCells));
  const safeA = new Array(nSteps * 2); // per trajectory: Uint8Array(len * nCells), index j*nCells + c
  for (let i = 0; i < traj.length; i++) {
    const t = traj[i];
    if (t && t.len !== Infinity) safeA[i] = new Uint8Array((t.len + 1) * nCells);
  }

  for (let c = 0; c < nCells; c++) safeG[last][c] = supported(xs[c], zs[last]) ? 1 : 0;

  /** Is entering trajectory t (from ground at k0) at phase j safe for lane c? */
  const airOk = (ti, j, c) => {
    const t = traj[ti];
    const k0 = ti >> 1;
    if (j === t.len) return safeG[k0 + j][c] === 1 && landingOk(xs[c], k0 + j);
    return safeA[ti][j * nCells + c] === 1;
  };

  for (let k = last - 1; k >= 0; k--) {
    // Airborne states at step k (phase j = k - k0 of trajectories started earlier).
    for (let k0 = Math.max(0, k - maxLen); k0 < k; k0++) {
      for (let type = 0; type < 2; type++) {
        const ti = k0 * 2 + type;
        const t = traj[ti];
        if (!t || t.len === Infinity) continue;
        const j = k - k0;
        if (j >= t.len) continue;
        for (let c = 0; c < nCells; c++) {
          if (!airOk(ti, j + 1, c)) continue;
          if (!hits(xs[c], t.rel[j], zs[k], xs[c], t.rel[j + 1], zs[k + 1])) safeA[ti][j * nCells + c] = 1;
        }
      }
    }
    // Grounded states at step k.
    const roll = traj[k * 2];
    const jump = traj[k * 2 + 1];
    const zm = (zs[k] + zs[k + 1]) / 2;
    for (let c = 0; c < nCells; c++) {
      const x = xs[c];
      if (!supported(x, zs[k])) continue;
      let ok = false;
      if (!roll) {
        for (let m = -1; m <= 1 && !ok; m++) {
          const c2 = c + m;
          if (c2 < 0 || c2 >= nCells || !safeG[k + 1][c2]) continue;
          const x2 = xs[c2];
          if (!supported(x2, zs[k + 1]) || !supported((x + x2) / 2, zm)) continue;
          if (!hits(x, 0, zs[k], x2, 0, zs[k + 1])) ok = true;
        }
      } else if (roll.len !== Infinity && airOk(k * 2, 1, c) && !hits(x, 0, zs[k], x, roll.rel[1], zs[k + 1])) {
        ok = true;
      }
      if (!ok && jump && jump.len !== Infinity && airOk(k * 2 + 1, 1, c) && !hits(x, 0, zs[k], x, jump.rel[1], zs[k + 1])) ok = true;
      if (ok) safeG[k][c] = 1;
    }
  }

  let unsafeLanes = 0;
  for (let c = 0; c < nCells; c++) if (!safeG[0][c]) unsafeLanes++;
  if (unsafeLanes > 0) return { ok: false, reason: 'unsafe-entry', unsafeLanes, lanes: nCells };

  if (spec.checkpoints && spec.checkpoints.length) {
    // ---- forward pass: which safe states are reachable from the entry --------
    const reachG = Array.from({ length: nSteps }, () => new Uint8Array(nCells));
    const reachA = new Array(nSteps * 2);
    reachG[0].set(safeG[0]);
    const enter = (ti, j, c) => {
      const t = traj[ti];
      const k0 = ti >> 1;
      if (j === t.len) {
        if (safeG[k0 + j][c] && landingOk(xs[c], k0 + j)) reachG[k0 + j][c] = 1;
      } else if (safeA[ti][j * nCells + c]) {
        if (!reachA[ti]) reachA[ti] = new Uint8Array((t.len + 1) * nCells);
        reachA[ti][j * nCells + c] = 1;
      }
    };
    for (let k = 0; k < last; k++) {
      for (let k0 = Math.max(0, k - maxLen); k0 < k; k0++) {
        for (let type = 0; type < 2; type++) {
          const ti = k0 * 2 + type;
          const t = traj[ti];
          if (!t || t.len === Infinity || !reachA[ti]) continue;
          const j = k - k0;
          if (j >= t.len) continue;
          for (let c = 0; c < nCells; c++) if (reachA[ti][j * nCells + c]) enter(ti, j + 1, c);
        }
      }
      const roll = traj[k * 2];
      const jump = traj[k * 2 + 1];
      for (let c = 0; c < nCells; c++) {
        if (!reachG[k][c]) continue;
        if (!roll) {
          for (let m = -1; m <= 1; m++) {
            const c2 = c + m;
            if (c2 >= 0 && c2 < nCells && safeG[k + 1][c2] && supported(xs[c2], zs[k + 1]) && !hits(xs[c], 0, zs[k], xs[c2], 0, zs[k + 1])) reachG[k + 1][c2] = 1;
          }
        } else if (roll.len !== Infinity) enter(k * 2, 1, c);
        if (jump && jump.len !== Infinity) enter(k * 2 + 1, 1, c);
      }
    }
    for (const cp of spec.checkpoints) {
      let k = 0;
      while (k < last && zs[k] < cp.z) k++;
      const c = Math.min(nCells - 1, Math.max(0, Math.round((cp.x + span) / step)));
      // Accept the nearest lane or a direct neighbour (lane grid quantisation).
      const near = [c, c - 1, c + 1].some((cc) => cc >= 0 && cc < nCells && reachG[k][cc]);
      if (!near) return { ok: false, reason: 'unreachable-checkpoint', unsafeLanes: 0, lanes: nCells };
    }
  }

  return { ok: true, reason: '', unsafeLanes: 0, lanes: nCells };
}
