/** Small, fast, seedable PRNG (mulberry32). Deterministic across platforms. */
export class Rng {
  constructor(seed = 1) {
    this.seed(seed);
  }

  seed(seed) {
    this.state = seed >>> 0 || 1;
  }

  /** @returns {number} float in [0, 1) */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}
