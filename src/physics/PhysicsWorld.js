import { PHYSICS } from '../config.js';
import { forwardSpeed } from '../world/DifficultyManager.js';
import { sweptSphereAABB, segmentPointDistSq, crossPlaneZ } from './Collision.js';
import { moverX } from '../world/Track.js';

export const ORB_PICKUP_RADIUS = 0.85; // centre-to-centre, player r + orb r + forgiveness

/**
 * A "world" for the physics functions:
 *   isSupported(x, z) -> boolean   floor exists (no hole, inside rails)
 *   heightAt(z)       -> number    surface height (m)
 *   slopeAt(z)        -> number    surface grade dh/dz
 * Player.y is the ABSOLUTE height of the ball bottom.
 */
export const FLAT_WORLD = Object.freeze({
  isSupported: () => true,
  heightAt: () => 0,
  slopeAt: () => 0,
});

/** Per-step event record. Reused every step to avoid allocations. */
export class StepEvents {
  constructor() {
    this.orbs = [];
    this.gates = [];
    this.reset();
  }

  reset() {
    this.jumped = false;
    this.launched = false; // left the ground with upward speed (ramp lip / crest)
    this.landed = false;
    this.landingSpeed = 0;
    this.railHit = false;
    this.crashed = false;
    this.crashCause = ''; // 'obstacle' | 'fell'
    this.crashObstacle = null;
    this.orbs.length = 0;
    this.gates.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Sub-systems. Each is a small function over the player state.
// ---------------------------------------------------------------------------

/** World progression: forward speed depends on distance and the local grade. */
export function stepForward(p, dt, world = FLAT_WORLD) {
  p.vz = forwardSpeed(p.z, world.slopeAt(p.z));
  p.z += p.vz * dt;
}

/**
 * Lateral motion: acceleration toward the steer direction (boosted when
 * reversing), exponential friction ONLY when not steering, hard speed cap.
 * @param {number} steer -1..1
 */
export function stepHorizontal(p, steer, dt, cfg = PHYSICS) {
  if (p.falling) steer = 0;
  const control = p.grounded ? 1 : cfg.AIR_CONTROL;
  if (steer !== 0) {
    const opposing = p.vx * steer < 0;
    const accel = (opposing ? cfg.LAT_TURN_ACCEL : cfg.LAT_ACCEL) * control;
    p.vx += steer * accel * dt;
    // Analog input caps speed proportionally; ease down toward that cap.
    const cap = cfg.LAT_MAX_SPEED * Math.abs(steer);
    if (Math.abs(p.vx) > cap && p.vx * steer > 0) {
      const target = Math.sign(p.vx) * cap;
      p.vx = target + (p.vx - target) * Math.exp(-cfg.LAT_FRICTION * dt);
    }
  } else {
    const k = p.grounded ? cfg.LAT_FRICTION : cfg.AIR_FRICTION;
    p.vx *= Math.exp(-k * dt);
    if (Math.abs(p.vx) < 0.01) p.vx = 0;
  }
  if (p.vx > cfg.LAT_MAX_SPEED) p.vx = cfg.LAT_MAX_SPEED;
  else if (p.vx < -cfg.LAT_MAX_SPEED) p.vx = -cfg.LAT_MAX_SPEED;
  p.x += p.vx * dt;
}

/** Side rails: clamp inside the track and reflect a little velocity. */
export function resolveRails(p, halfWidth, events, cfg = PHYSICS) {
  if (p.falling) return;
  const limit = halfWidth - p.radius;
  if (p.x > limit || p.x < -limit) {
    const side = Math.sign(p.x);
    p.x = side * limit;
    if (p.vx * side > 0) {
      p.vx = -p.vx * cfg.RAIL_BOUNCE;
      if (events) events.railHit = true;
    }
  }
}

/** Register a jump press (buffered so slightly-early presses still count). */
export function requestJump(p, cfg = PHYSICS) {
  p.jumpBuffer = cfg.JUMP_BUFFER;
}

/** Whether a normal jump is allowed right now (grounded or coyote time). */
export function canJump(p) {
  if (p.falling || !p.alive) return false;
  return p.grounded || (p.coyote > 0 && !p.jumpedSinceGround);
}

/**
 * Vertical motion over terrain:
 *  - grounded: follow the surface while gravity can hold the ball on it;
 *    leave the ground at crests, ramp lips and drop-offs (keeping vy);
 *  - jump adds JUMP_VELOCITY to the current vertical velocity (ramp boost);
 *  - airborne: semi-implicit Euler under gravity (-y), land on floor,
 *    fall into holes, or hit the side of a platform from below.
 */
export function stepVertical(p, world, dt, events, cfg = PHYSICS) {
  const ground = world.heightAt(p.z);
  const groundVy = world.slopeAt(p.z) * p.vz;
  const supported = world.isSupported(p.x, p.z);

  if (p.jumpBuffer > 0 && canJump(p)) {
    p.vy = (p.grounded ? p.vy : Math.max(0, p.vy)) + cfg.JUMP_VELOCITY;
    p.grounded = false;
    p.jumpedSinceGround = true;
    p.jumpBuffer = 0;
    p.coyote = 0;
    if (events) events.jumped = true;
  }
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);

  if (p.grounded) {
    if (supported) {
      // Stay on the surface while gravity can supply the required downward
      // acceleration (v^2 * curvature >= -g) and the surface hasn't stepped
      // down (ramp lip / drop-off) since the last step.
      const minVy = p.vy - cfg.GRAVITY * dt - 1e-6;
      const stepped = ground < p.y + p.vy * dt - 0.05;
      if (!stepped && groundVy >= minVy) {
        p.y = ground;
        p.vy = groundVy;
        return;
      }
      // The surface falls away faster than gravity: we're airborne.
      if (events && p.vy > 2) events.launched = true;
    }
    p.grounded = false;
    p.coyote = cfg.COYOTE_TIME;
  } else {
    p.coyote = Math.max(0, p.coyote - dt);
  }

  const vyBefore = p.vy;
  p.vy -= cfg.GRAVITY * dt;
  p.y += p.vy * dt;

  const rel = p.y - ground;
  if (rel <= 0) {
    // Lip tolerance grows with relative speed so a fast step can't tunnel.
    const lip = cfg.LANDING_LIP + Math.abs(p.vy - groundVy) * dt;
    if (supported && !p.falling && rel >= -lip) {
      if (events) {
        events.landed = true;
        events.landingSpeed = Math.max(0, groundVy - vyBefore);
      }
      p.y = ground;
      p.vy = groundVy;
      p.grounded = true;
      p.jumpedSinceGround = false;
      p.coyote = 0;
    } else if (supported) {
      // Below the surface but under floor: hit the side of a platform.
      p.falling = true;
      if (events) {
        events.crashed = true;
        events.crashCause = 'fell';
      }
    } else if (rel < -cfg.LANDING_LIP) {
      p.falling = true;
    }
  }
  if (rel < -cfg.FALL_DEATH_DEPTH && events && !events.crashed) {
    events.crashed = true;
    events.crashCause = 'fell';
  }
}

/**
 * First obstacle hit by the sphere moving from A to B, or null. Positions are
 * in SURFACE-RELATIVE height (y above the local track surface). Movers are
 * tested in the obstacle's frame. Pure: does not mutate the track.
 */
export function findObstacleHit(obstacles, ax, ay, az, bx, by, bz, r, zA, zB) {
  const zLo = Math.min(az, bz) - r - 1;
  const zHi = Math.max(az, bz) + r + 1;
  for (const o of obstacles) {
    if (o.z1 < zLo || o.z0 > zHi) continue;
    let ox = o.x;
    let sx = ax;
    if (o.kind === 'mover') {
      ox = moverX(o, zB);
      sx = ax - (ox - moverX(o, zA));
    }
    const hw = o.w / 2;
    if (sweptSphereAABB(sx, ay, az, bx, by, bz, r, ox - hw, 0, o.z0, ox + hw, o.h, o.z1) >= 0) return o;
  }
  return null;
}

/**
 * Swept collision of the player's motion this step against obstacles,
 * orbs and gate planes (all heights relative to the local surface).
 */
export function detectCollisions(p, track, events) {
  const r = p.radius;
  const ax = p.prevX, ay = p.prevY - track.heightAt(p.prevZ) + r, az = p.prevZ;
  const bx = p.x, by = p.y - track.heightAt(p.z) + r, bz = p.z;

  const hit = findObstacleHit(track.obstacles, ax, ay, az, bx, by, bz, r, p.prevZ, p.z);
  if (hit) {
    events.crashed = true;
    events.crashCause = 'obstacle';
    events.crashObstacle = hit;
    return;
  }

  const zLo = Math.min(az, bz) - r - 1;
  const zHi = Math.max(az, bz) + r + 1;
  const pick2 = ORB_PICKUP_RADIUS * ORB_PICKUP_RADIUS;
  for (const orb of track.orbs) {
    if (orb.collected || orb.z < zLo || orb.z > zHi) continue;
    if (segmentPointDistSq(ax, ay, az, bx, by, bz, orb.x, orb.y, orb.z) <= pick2) {
      orb.collected = true; // flag guarantees single award
      events.orbs.push(orb);
    }
  }

  for (const g of track.gates) {
    if (g.resolved) continue;
    const t = crossPlaneZ(az, bz, g.z);
    if (t < 0) continue;
    const xc = ax + (bx - ax) * t;
    const usable = g.width / 2 - r;
    const off = Math.abs(xc - g.x);
    g.resolved = true;
    if (off <= g.width / 2) {
      g.accuracy = usable > 0 ? Math.max(0, Math.min(1, 1 - off / usable)) : 0;
      g.result = 'pass';
    } else {
      g.accuracy = 0;
      g.result = 'miss';
    }
    events.gates.push(g);
  }
}

/**
 * Owns the per-step ordering of the physics sub-systems.
 */
export class PhysicsWorld {
  constructor(track, cfg = PHYSICS) {
    this.track = track;
    this.cfg = cfg;
    this.events = new StepEvents();
  }

  /**
   * @param {import('../entities/Player.js').Player} p
   * @param {{ steer: number, jump: boolean }} intent
   * @returns {StepEvents}
   */
  step(p, intent, dt) {
    const ev = this.events;
    ev.reset();
    if (!p.alive) return ev;
    p.savePrevious();
    if (intent.jump) requestJump(p, this.cfg);

    stepForward(p, dt, this.track);
    this.track.updateMovers(p.z);
    stepHorizontal(p, intent.steer, dt, this.cfg);
    resolveRails(p, this.track.halfWidth, ev, this.cfg);
    stepVertical(p, this.track, dt, ev, this.cfg);
    if (!ev.crashed && !p.falling) detectCollisions(p, this.track, ev);
    if (ev.crashed) p.alive = false;
    return ev;
  }
}
