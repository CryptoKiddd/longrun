import { PHYSICS } from '../config.js';
import { speedAt } from '../world/DifficultyManager.js';
import { sweptSphereAABB, segmentPointDistSq, crossPlaneZ } from './Collision.js';

export const ORB_PICKUP_RADIUS = 0.85; // centre-to-centre, player r + orb r + forgiveness

/** Per-step event record. Reused every step to avoid allocations. */
export class StepEvents {
  constructor() {
    this.orbs = [];
    this.gates = [];
    this.reset();
  }

  reset() {
    this.jumped = false;
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
// Sub-systems. Each is a small pure-ish function over the player state.
// ---------------------------------------------------------------------------

/** World progression: forward speed is a function of distance. */
export function stepForward(p, dt) {
  p.vz = speedAt(p.z);
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
 * Vertical motion: buffered jump, gravity (toward -y), integration, landing,
 * leaving edges, and falling into holes.
 * @param {(x:number, z:number) => boolean} isSupported
 */
export function stepVertical(p, isSupported, dt, events, cfg = PHYSICS) {
  if (p.jumpBuffer > 0 && canJump(p)) {
    p.vy = cfg.JUMP_VELOCITY;
    p.grounded = false;
    p.jumpedSinceGround = true;
    p.jumpBuffer = 0;
    p.coyote = 0;
    if (events) events.jumped = true;
  }
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);

  const supported = isSupported(p.x, p.z);

  if (p.grounded) {
    if (supported) {
      p.y = 0;
      p.vy = 0;
      return;
    }
    // Rolled off an edge: start falling, with a short coyote window.
    p.grounded = false;
    p.coyote = cfg.COYOTE_TIME;
  } else {
    p.coyote = Math.max(0, p.coyote - dt);
  }

  // Semi-implicit Euler (velocity first, then position).
  p.vy -= cfg.GRAVITY * dt;
  p.y += p.vy * dt;

  if (p.y <= 0) {
    // Lip tolerance grows with fall speed so a fast step can never tunnel
    // through the surface.
    const lip = cfg.LANDING_LIP + Math.abs(p.vy) * dt;
    if (supported && !p.falling && p.y >= -lip && p.vy <= 0) {
      if (events) {
        events.landed = true;
        events.landingSpeed = -p.vy;
      }
      p.y = 0;
      p.vy = 0;
      p.grounded = true;
      p.jumpedSinceGround = false;
      p.coyote = 0;
    } else if (supported && p.y < -lip) {
      // Below the surface but now under floor: hit the hole wall.
      p.falling = true;
      if (events && p.y < -lip) {
        events.crashed = true;
        events.crashCause = 'fell';
      }
    } else if (!supported && p.y < -cfg.LANDING_LIP) {
      p.falling = true;
    }
  }
  if (p.y < -cfg.FALL_DEATH_DEPTH && events && !events.crashed) {
    events.crashed = true;
    events.crashCause = 'fell';
  }
}

/**
 * Swept collision of the player's motion this step against obstacles,
 * orbs and gate planes. Movers are tested in the obstacle's frame
 * (relative motion) so their own movement cannot cause tunnelling.
 */
export function detectCollisions(p, track, events, prevMoverZ) {
  const r = p.radius;
  const ax = p.prevX, ay = p.prevY + r, az = p.prevZ;
  const bx = p.x, by = p.y + r, bz = p.z;
  const zLo = Math.min(az, bz) - r - 1;
  const zHi = Math.max(az, bz) + r + 1;

  for (const o of track.obstacles) {
    if (o.z1 < zLo || o.z0 > zHi) continue;
    let startX = ax;
    if (o.kind === 'mover') {
      // Shift the start point by the obstacle's displacement this step.
      const prevOx = o.baseX + o.amp * Math.sin(o.freq * (prevMoverZ - o.z0) + o.phase);
      startX = ax - (o.x - prevOx);
    }
    const hw = o.w / 2;
    const t = sweptSphereAABB(startX, ay, az, bx, by, bz, r, o.x - hw, 0, o.z0, o.x + hw, o.h, o.z1);
    if (t >= 0) {
      events.crashed = true;
      events.crashCause = 'obstacle';
      events.crashObstacle = o;
      return;
    }
  }

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
    this.isSupported = (x, z) => track.isSupported(x, z);
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

    stepForward(p, dt);
    this.track.updateMovers(p.z);
    stepHorizontal(p, intent.steer, dt, this.cfg);
    resolveRails(p, this.track.halfWidth, ev, this.cfg);
    stepVertical(p, this.isSupported, dt, ev, this.cfg);
    if (!ev.crashed && !p.falling) detectCollisions(p, this.track, ev, p.prevZ);
    if (ev.crashed) p.alive = false;
    return ev;
  }
}
