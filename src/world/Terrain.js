/**
 * Track elevation: a contiguous list of pieces covering [z0, z1).
 *  - 'ease'   : smooth hill/valley, h = h0 + dh * (1 - cos(pi t)) / 2  (eased in and out)
 *  - 'linear' : constant grade (downhill runs, ramp faces)
 * Heights may only step DOWN between pieces (ramp lips, drop-offs). The ball
 * leaves the ground physically at such steps and at sharp crests.
 *
 * heightAt(z) is right-continuous (value of the piece starting at z);
 * heightBefore(z) is the left limit (used to render both sides of a drop).
 */
function makePiece() {
  return { z0: 0, z1: 0, h0: 0, h1: 0, ease: false };
}

export class Terrain {
  constructor() {
    this.pieces = [];
    this.pool = [];
    this.drops = []; // { z, high, low } discontinuities, for rendering
    this.reset();
  }

  reset() {
    for (const p of this.pieces) this.pool.push(p);
    this.pieces.length = 0;
    this.drops.length = 0;
    this.endZ = 0;
    this.endH = 0;
  }

  /** Append a piece starting at the current end. z1 === endZ means an instant drop by dh (< 0). */
  append(z1, dh, ease = false) {
    if (z1 <= this.endZ + 1e-9) {
      if (dh < 0) {
        this.drops.push({ z: this.endZ, high: this.endH, low: this.endH + dh });
        this.endH += dh;
      }
      return;
    }
    const p = this.pool.length ? this.pool.pop() : makePiece();
    p.z0 = this.endZ;
    p.z1 = z1;
    p.h0 = this.endH;
    p.h1 = this.endH + dh;
    p.ease = ease;
    this.pieces.push(p);
    this.endZ = z1;
    this.endH = p.h1;
  }

  /** Index of the piece containing z (right-continuous), or -1 before / pieces.length after. */
  find(z) {
    const ps = this.pieces;
    let lo = 0;
    let hi = ps.length - 1;
    if (hi < 0 || z < ps[0].z0) return -1;
    if (z >= ps[hi].z1) return ps.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ps[mid].z0 <= z) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  static evalH(p, z) {
    const t = (z - p.z0) / (p.z1 - p.z0);
    const k = p.ease ? (1 - Math.cos(Math.PI * t)) / 2 : t;
    return p.h0 + (p.h1 - p.h0) * k;
  }

  static evalSlope(p, z) {
    const len = p.z1 - p.z0;
    if (!p.ease) return (p.h1 - p.h0) / len;
    const t = (z - p.z0) / len;
    return ((p.h1 - p.h0) * Math.PI * Math.sin(Math.PI * t)) / (2 * len);
  }

  heightAt(z) {
    const i = this.find(z);
    if (i < 0) return this.pieces.length ? this.pieces[0].h0 : 0;
    if (i >= this.pieces.length) return this.endH;
    return Terrain.evalH(this.pieces[i], z);
  }

  /** Left limit of the height at z (differs from heightAt only at drops). */
  heightBefore(z) {
    const i = this.find(z);
    if (i > 0 && i < this.pieces.length && Math.abs(this.pieces[i].z0 - z) < 1e-9) return this.pieces[i - 1].h1;
    if (i >= this.pieces.length && this.pieces.length && Math.abs(this.endZ - z) < 1e-9) return this.pieces[this.pieces.length - 1].h1;
    return this.heightAt(z);
  }

  slopeAt(z) {
    const i = this.find(z);
    if (i < 0 || i >= this.pieces.length) return 0;
    return Terrain.evalSlope(this.pieces[i], z);
  }

  /** Drop pieces wholly behind minZ (always keeps the last piece). */
  recycle(minZ) {
    let n = 0;
    while (n < this.pieces.length - 1 && this.pieces[n].z1 < minZ) n++;
    if (n > 0) {
      for (let i = 0; i < n; i++) this.pool.push(this.pieces[i]);
      this.pieces.splice(0, n);
    }
    let d = 0;
    while (d < this.drops.length && this.drops[d].z < minZ) d++;
    if (d > 0) this.drops.splice(0, d);
  }
}
