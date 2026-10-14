/**
 * Collision primitives in world space (see config.js for axes).
 * Everything here is pure math: no rendering, no game state.
 */

/** Squared distance from point (px,py,pz) to an axis-aligned box. */
export function pointAABBDistSq(px, py, pz, minX, minY, minZ, maxX, maxY, maxZ) {
  const dx = px < minX ? minX - px : px > maxX ? px - maxX : 0;
  const dy = py < minY ? minY - py : py > maxY ? py - maxY : 0;
  const dz = pz < minZ ? minZ - pz : pz > maxZ ? pz - maxZ : 0;
  return dx * dx + dy * dy + dz * dz;
}

export function sphereAABBOverlap(cx, cy, cz, r, minX, minY, minZ, maxX, maxY, maxZ) {
  return pointAABBDistSq(cx, cy, cz, minX, minY, minZ, maxX, maxY, maxZ) <= r * r;
}

const REFINE_SAMPLES = 8;

/**
 * Swept sphere vs AABB along the segment p0 -> p1.
 * Phase 1: slab test of the segment against the box expanded by r
 *          (conservative; catches any possible contact, no tunnelling).
 * Phase 2: exact sphere/box distance sampled inside the entry interval, so
 *          rounded corners are not reported as hits.
 * @returns {number} earliest contact fraction t in [0,1], or -1 for no hit.
 */
let slabMin = 0;
let slabMax = 1;

/** Clip [slabMin, slabMax] against one axis slab. Returns false if empty. */
function clipSlab(o, d, lo, hi) {
  if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
  let t1 = (lo - o) / d;
  let t2 = (hi - o) / d;
  if (t1 > t2) {
    const tmp = t1;
    t1 = t2;
    t2 = tmp;
  }
  if (t1 > slabMin) slabMin = t1;
  if (t2 < slabMax) slabMax = t2;
  return slabMin <= slabMax;
}

export function sweptSphereAABB(p0x, p0y, p0z, p1x, p1y, p1z, r, minX, minY, minZ, maxX, maxY, maxZ) {
  const dx = p1x - p0x, dy = p1y - p0y, dz = p1z - p0z;
  slabMin = 0;
  slabMax = 1;
  if (!clipSlab(p0x, dx, minX - r, maxX + r)) return -1;
  if (!clipSlab(p0y, dy, minY - r, maxY + r)) return -1;
  if (!clipSlab(p0z, dz, minZ - r, maxZ + r)) return -1;
  const tMin = slabMin;
  const tMax = slabMax;
  const r2 = r * r;
  for (let s = 0; s <= REFINE_SAMPLES; s++) {
    const t = tMin + ((tMax - tMin) * s) / REFINE_SAMPLES;
    const dist = pointAABBDistSq(p0x + dx * t, p0y + dy * t, p0z + dz * t, minX, minY, minZ, maxX, maxY, maxZ);
    if (dist <= r2) return t;
  }
  return -1;
}

/** Squared distance from point q to segment p0 -> p1. */
export function segmentPointDistSq(p0x, p0y, p0z, p1x, p1y, p1z, qx, qy, qz) {
  const dx = p1x - p0x, dy = p1y - p0y, dz = p1z - p0z;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (len2 > 1e-12) {
    t = ((qx - p0x) * dx + (qy - p0y) * dy + (qz - p0z) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const ex = p0x + dx * t - qx, ey = p0y + dy * t - qy, ez = p0z + dz * t - qz;
  return ex * ex + ey * ey + ez * ez;
}

/**
 * Fraction t where the segment crosses the plane z = planeZ going forward
 * (p0z < planeZ <= p1z), or -1.
 */
export function crossPlaneZ(p0z, p1z, planeZ) {
  if (p0z < planeZ && p1z >= planeZ) return (planeZ - p0z) / (p1z - p0z);
  return -1;
}
