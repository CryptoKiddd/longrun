import { PHYSICS } from '../config.js';

/**
 * Fixed-timestep loop with an accumulator.
 * - fixedUpdate(dt) runs in constant DT increments (refresh-rate independent).
 * - frameUpdate(realDt, alpha) runs once per animation frame; alpha in [0,1)
 *   is the interpolation factor between the last two physics states.
 * Large deltas are clamped and catch-up steps are capped.
 */
export class GameLoop {
  constructor({
    fixedUpdate,
    frameUpdate,
    dt = PHYSICS.DT,
    maxFrameDt = PHYSICS.MAX_FRAME_DT,
    maxSteps = PHYSICS.MAX_STEPS_PER_FRAME,
    raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame.bind(globalThis) : null,
    caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame.bind(globalThis) : null,
  }) {
    this.fixedUpdate = fixedUpdate;
    this.frameUpdate = frameUpdate;
    this.dt = dt;
    this.maxFrameDt = maxFrameDt;
    this.maxSteps = maxSteps;
    this.raf = raf;
    this.caf = caf;
    this.accumulator = 0;
    this.lastTime = null;
    this.handle = 0;
    this.running = false;
    this.droppedTime = 0;
    this._tick = (t) => this.tick(t);
  }

  start() {
    if (this.running || !this.raf) return;
    this.running = true;
    this.resetTiming();
    this.handle = this.raf(this._tick);
  }

  stop() {
    this.running = false;
    if (this.caf && this.handle) this.caf(this.handle);
    this.handle = 0;
  }

  /** Forget elapsed time (e.g. after pause/tab switch) so nothing jumps. */
  resetTiming() {
    this.lastTime = null;
    this.accumulator = 0;
  }

  tick(timeMs) {
    if (!this.running) return;
    const realDt = this.lastTime === null ? 0 : (timeMs - this.lastTime) / 1000;
    this.lastTime = timeMs;
    this.advance(realDt);
    this.handle = this.raf(this._tick);
  }

  /**
   * Advance by a real elapsed time. Exposed for deterministic tests.
   * @returns {number} number of fixed steps executed
   */
  advance(realDt) {
    const frameDt = Math.min(Math.max(realDt, 0), this.maxFrameDt);
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= this.dt && steps < this.maxSteps) {
      this.fixedUpdate(this.dt);
      this.accumulator -= this.dt;
      steps++;
    }
    if (steps === this.maxSteps && this.accumulator >= this.dt) {
      // Drop the backlog instead of trying to catch up forever.
      this.droppedTime += this.accumulator;
      this.accumulator = 0;
    }
    this.frameUpdate(frameDt, this.accumulator / this.dt);
    return steps;
  }
}
