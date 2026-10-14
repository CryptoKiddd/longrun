import { COURSE_VERSION, TRACK } from '../config.js';

/**
 * Ghost of the best run over the deterministic opening course.
 * Stores only lateral position and height every STEP metres (centimetre ints),
 * because forward position is a pure function of time for every run.
 */
const STEP = 2;

export class GhostRecorder {
  constructor(limit = TRACK.OPENING_LENGTH) {
    this.limit = limit;
    this.reset();
  }

  reset() {
    this.xs = [];
    this.ys = [];
    this.nextZ = 0;
    this.endZ = 0;
  }

  record(z, x, y) {
    while (z >= this.nextZ && this.nextZ <= this.limit) {
      this.xs.push(Math.round(x * 100));
      this.ys.push(Math.round(y * 100));
      this.nextZ += STEP;
    }
    if (z <= this.limit) this.endZ = z;
  }

  /** Serializable snapshot for persistence. */
  export(score) {
    return { v: COURSE_VERSION, step: STEP, xs: this.xs.slice(), ys: this.ys.slice(), score, endZ: Math.round(this.endZ) };
  }
}

export class GhostPlayback {
  constructor() {
    this.data = null;
    this.x = 0;
    this.y = 0;
    this.visible = false;
    this.ended = false;
  }

  load(data) {
    this.data = data && data.xs && data.xs.length > 1 ? data : null;
  }

  /** Update the sampled ghost position for player distance z. */
  sample(z) {
    const d = this.data;
    this.visible = false;
    this.ended = false;
    if (!d) return;
    const f = z / d.step;
    const i = Math.floor(f);
    if (i < 0) return;
    if (i >= d.xs.length - 1 || z > d.endZ) {
      this.ended = z <= d.endZ + 12; // brief fade where the ghost's run stopped
      return;
    }
    const t = f - i;
    this.x = (d.xs[i] + (d.xs[i + 1] - d.xs[i]) * t) / 100;
    this.y = (d.ys[i] + (d.ys[i + 1] - d.ys[i]) * t) / 100;
    this.visible = true;
  }
}
