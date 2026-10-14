import { PHYSICS } from '../config.js';

/** The player's physical state. Pure data plus tiny helpers; no rendering. */
export class Player {
  constructor() {
    this.radius = PHYSICS.PLAYER_RADIUS;
    this.reset();
  }

  reset() {
    this.x = 0; // lateral position (m)
    this.y = 0; // height of ball bottom above surface (m)
    this.z = 0; // forward distance (m)
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.prevX = 0;
    this.prevY = 0;
    this.prevZ = 0;
    this.grounded = true;
    this.coyote = 0; // remaining coyote time after leaving support
    this.jumpBuffer = 0; // remaining buffered-jump time
    this.jumpedSinceGround = false;
    this.falling = false; // committed to a fall into the void (no control)
    this.alive = true;
  }

  savePrevious() {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
  }

  /** Centre of the collision sphere (y is the ball bottom). */
  get centerY() {
    return this.y + this.radius;
  }
}
