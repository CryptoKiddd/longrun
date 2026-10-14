/**
 * Fixed-capacity world-space particle pool (struct-of-arrays, no per-particle
 * allocation). Visual only: never affects gameplay.
 */
export class ParticleSystem {
  constructor(capacity = 420) {
    this.capacity = capacity;
    this.limit = capacity; // may be lowered by the quality manager
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.color = new Uint8Array(capacity);
    this.count = 0;
  }

  clear() {
    this.count = 0;
  }

  spawn(x, y, z, vx, vy, vz, life, size, color, gravity = 0) {
    if (this.count >= this.limit) return;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.color[i] = color;
    this.gravity[i] = gravity;
  }

  /** Radial burst. `forward` adds the player's forward speed so bursts travel with the view. */
  burst(x, y, z, n, speed, life, size, color, forward = 0, gravity = 0, rand = Math.random) {
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      const e = (rand() - 0.3) * Math.PI;
      const v = speed * (0.4 + rand() * 0.6);
      this.spawn(x, y, z, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v + speed * 0.2, Math.sin(a) * Math.cos(e) * v + forward, life * (0.6 + rand() * 0.4), size * (0.6 + rand() * 0.6), color, gravity);
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Swap-remove with the last live particle.
        const j = --this.count;
        this.x[i] = this.x[j];
        this.y[i] = this.y[j];
        this.z[i] = this.z[j];
        this.vx[i] = this.vx[j];
        this.vy[i] = this.vy[j];
        this.vz[i] = this.vz[j];
        this.life[i] = this.life[j];
        this.maxLife[i] = this.maxLife[j];
        this.size[i] = this.size[j];
        this.color[i] = this.color[j];
        this.gravity[i] = this.gravity[j];
        continue;
      }
      this.vy[i] -= this.gravity[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      i++;
    }
  }
}
