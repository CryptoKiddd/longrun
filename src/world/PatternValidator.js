import { PHYSICS, TRACK } from '../config.js';
import { sweptSphereAABB } from '../physics/Collision.js';
import { Track, moverX } from './Track.js';

/**
 * Fairness validator for a segment spec.
 *
 * Models the player CONSERVATIVELY (weaker than reality):
 *   - lateral movement at 70% of max speed, discretised into 0.3 m lanes
 *   - no steering while airborne
 *   - jump arcs land slightly earlier than real (shorter air distance)
 *   - obstacles inflated by HIT_MARGIN; floor near hole edges treated as missing
 *   - must be grounded (not mid-air) at the end of the segment
 *
 * A backward dynamic-programming pass marks every (step, lane, air-phase)
 * state from which the end of the segment is reachable without dying.
 * The segment is valid only if EVERY grounded entry lane is safe, so the
 * player can never be dealt an unwinnable layout regardless of position.
 * Optional spec.checkpoints ({z, x}) must additionally be reachable & safe,
 * which proves a specific route (e.g. a risk-reward line) is survivable.
 */

export const VALIDATION = Object.freeze({
  CELL: 0.3, // m lane width
  LAT_FRACTION: 0.7, // fraction of max lateral speed assumed
  HIT_MARGIN: 0.12, // m added to the player radius for obstacle tests
  SUPPORT_MARGIN: 0.15, // m of hole-edge floor considered unsafe
});

const scratchTrack = new Track();

/**
 * @param {import('./PatternLibrary.js').SegmentSpec} spec
 * @param {number} speed forward speed (m/s) the segment will be played at
 * @returns {{ ok: boolean, reason: string, unsafeLanes: number, lanes: number }}
 */
export function validateSegment(spec, speed, cfg = PHYSICS) {
  const R = cfg.PLAYER_RADIUS;
  const H = TRACK.HALF_WIDTH;
  const { CELL, LAT_FRACTION, HIT_MARGIN, SUPPORT_MARGIN } = VALIDATION;
  const rHit = R + HIT_MARGIN;

  scratchTrack.reset();
  scratchTrack.addSegment(spec, 0);
  const obstacles = scratchTrack.obstacles;

  const span = H - R;
  const nCells = Math.floor((2 * span) / CELL + 1e-9) + 1;
  const xs = new Float64Array(nCells);
  for (let i = 0; i < nCells; i++) xs[i] = -span + i * CELL;

  // One lane change per step at the conservative lateral speed.
  const dtz = CELL / (cfg.LAT_MAX_SPEED * LAT_FRACTION);
  const dz = speed * dtz;
  const nSteps = Math.ceil(spec.length / dz) + 1;
  const zs = new Float64Array(nSteps);
  for (let k = 0; k < nSteps; k++) zs[k] = Math.min(k * dz, spec.length);

  // Air phases: 0 = grounded, 1..K-1 airborne; after K-1 the ball lands.
  const airtime = (2 * cfg.JUMP_VELOCITY) / cfg.GRAVITY;
  const K = Math.max(2, Math.floor(airtime / dtz));
  const yAt = new Float64Array(K);
  for (let a = 0; a < K; a++) {
    const t = a * dtz;
    yAt[a] = Math.max(0, cfg.JUMP_VELOCITY * t - 0.5 * cfg.GRAVITY * t * t);
  }

  const supported = (x, z) => scratchTrack.isSupported(x, z, SUPPORT_MARGIN);

  const hits = (x0, y0, z0, x1, y1, z1) => {
    const zLo = Math.min(z0, z1) - rHit;
    const zHi = Math.max(z0, z1) + rHit;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.z1 < zLo || o.z0 > zHi) continue;
      let ox = o.x;
      let sx = x0;
      if (o.kind === 'mover') {
        ox = moverX(o, z1);
        sx = x0 - (ox - moverX(o, z0));
      }
      const hw = o.w / 2;
      if (sweptSphereAABB(sx, y0 + R, z0, x1, y1 + R, z1, rHit, ox - hw, 0, o.z0, ox + hw, o.h, o.z1) >= 0) return true;
    }
    return false;
  };

  const stride = K;
  const safe = new Array(nSteps);
  const last = nSteps - 1;
  safe[last] = new Uint8Array(nCells * stride);
  for (let c = 0; c < nCells; c++) {
    // Must finish grounded on solid floor.
    safe[last][c * stride] = supported(xs[c], zs[last]) ? 1 : 0;
  }

  for (let k = last - 1; k >= 0; k--) {
    const cur = new Uint8Array(nCells * stride);
    const nxt = safe[k + 1];
    const z0 = zs[k];
    const z1 = zs[k + 1];
    const zm = (z0 + z1) / 2;
    for (let c = 0; c < nCells; c++) {
      const x = xs[c];
      // Grounded: steer -1/0/+1 lane, or jump.
      if (supported(x, z0)) {
        let ok = false;
        for (let m = -1; m <= 1 && !ok; m++) {
          const c2 = c + m;
          if (c2 < 0 || c2 >= nCells || !nxt[c2 * stride]) continue;
          const x2 = xs[c2];
          if (!supported(x2, z1) || !supported((x + x2) / 2, zm)) continue;
          if (!hits(x, 0, z0, x2, 0, z1)) ok = true;
        }
        if (!ok && nxt[c * stride + 1] && !hits(x, 0, z0, x, yAt[1], z1)) ok = true;
        if (ok) cur[c * stride] = 1;
      }
      // Airborne: ballistic, no steering.
      for (let a = 1; a < K; a++) {
        const landing = a === K - 1;
        const a2 = landing ? 0 : a + 1;
        if (!nxt[c * stride + a2]) continue;
        if (landing && !supported(x, z1)) continue;
        if (!hits(x, yAt[a], z0, x, landing ? 0 : yAt[a2], z1)) cur[c * stride + a] = 1;
      }
    }
    safe[k] = cur;
  }

  let unsafeLanes = 0;
  for (let c = 0; c < nCells; c++) if (!safe[0][c * stride]) unsafeLanes++;
  if (unsafeLanes > 0) {
    return { ok: false, reason: 'unsafe-entry', unsafeLanes, lanes: nCells };
  }

  if (spec.checkpoints && spec.checkpoints.length) {
    // Forward reachability from all entry lanes, restricted to safe states.
    const reach = new Array(nSteps);
    reach[0] = safe[0].slice();
    for (let k = 0; k < last; k++) {
      const r = reach[k];
      const n = new Uint8Array(nCells * stride);
      const s = safe[k + 1];
      for (let c = 0; c < nCells; c++) {
        if (r[c * stride]) {
          for (let m = -1; m <= 1; m++) {
            const c2 = c + m;
            if (c2 >= 0 && c2 < nCells && s[c2 * stride]) n[c2 * stride] = 1;
          }
          if (s[c * stride + 1]) n[c * stride + 1] = 1;
        }
        for (let a = 1; a < K; a++) {
          if (!r[c * stride + a]) continue;
          const a2 = a === K - 1 ? 0 : a + 1;
          if (s[c * stride + a2]) n[c * stride + a2] = 1;
        }
      }
      reach[k + 1] = n;
    }
    for (const cp of spec.checkpoints) {
      const k = Math.min(last, Math.max(0, Math.round(cp.z / dz)));
      const c = Math.min(nCells - 1, Math.max(0, Math.round((cp.x + span) / CELL)));
      if (!reach[k][c * stride]) {
        return { ok: false, reason: 'unreachable-checkpoint', unsafeLanes: 0, lanes: nCells };
      }
    }
  }

  return { ok: true, reason: '', unsafeLanes: 0, lanes: nCells };
}
