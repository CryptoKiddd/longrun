import { RENDER } from '../config.js';

/**
 * Pseudo-3D pinhole camera. Projects world (x, y, z) to screen pixels.
 * The track's gentle curvature is PURELY COSMETIC: a lateral offset applied
 * during projection that grows with distance ahead of the camera. Physics
 * never sees it, and it is ~0 near the player, so it cannot affect fairness.
 */

const A1 = 16, L1 = 260, A2 = 8, L2 = 97, P2 = 1.3;

export function curveAt(z) {
  return A1 * Math.sin(z / L1) + A2 * Math.sin(z / L2 + P2);
}

export function curveSlope(z) {
  return (A1 / L1) * Math.cos(z / L1) + (A2 / L2) * Math.cos(z / L2 + P2);
}

export class Camera {
  constructor() {
    this.x = 0;
    this.y = RENDER.CAMERA_HEIGHT;
    this.z = -RENDER.CAMERA_BACK;
    this.width = 1;
    this.height = 1;
    this.focal = 1;
    this.horizon = 0;
    this.cx = 0;
    this.curve0 = 0;
    this.slope0 = 0;
    this.near = RENDER.NEAR;
    this.curveScale = 1;
    this.baseHeight = RENDER.CAMERA_HEIGHT;
    this.groundY = 0; // smoothed surface height under the player
    this.pitch = 0; // smoothed view tilt (grade ahead); pivots at the player's depth
  }

  /** Screen y of the horizon including the current pitch. */
  get horizonEff() {
    return this.horizon + this.pitch * this.focal;
  }

  /**
   * Fit the view so the full track width is visible at the player's depth.
   * Narrow (portrait) screens limit the focal length, so the camera rises
   * with the aspect ratio to keep the player low and the track filling the view.
   */
  resize(w, h) {
    this.width = w;
    this.height = h;
    this.cx = w / 2;
    this.focal = Math.min(h * 1.0, w * 0.64);
    const portrait = Math.max(0, Math.min(1, (1.3 - w / h) / (1.3 - 0.46)));
    this.baseHeight = RENDER.CAMERA_HEIGHT + portrait * 3.4;
    const playerDrop = (this.baseHeight * this.focal) / RENDER.CAMERA_BACK;
    const horizon = h * 0.76 - playerDrop;
    this.horizon = Math.max(h * 0.26, Math.min(h * 0.5, horizon));
  }

  /**
   * Smoothly follow the (interpolated) player over the terrain. The view
   * tilts with the grade ahead so slopes read as "rolling downhill".
   * @param {{heightAt(z:number):number}} terrain
   */
  follow(px, py, pz, dt, snap, terrain) {
    const targetX = px * 0.55;
    const k = snap ? 1 : 1 - Math.exp(-7 * dt);
    this.x += (targetX - this.x) * k;
    const ground = terrain.heightAt(pz);
    const kg = snap ? 1 : 1 - Math.exp(-9 * dt);
    this.groundY += (ground - this.groundY) * kg;
    const lift = Math.max(-1, py - ground) * 0.35;
    this.y = this.groundY + this.baseHeight + lift;
    const ahead = (terrain.heightAt(pz + 14) - ground) / 14;
    const targetPitch = Math.max(-0.22, Math.min(0.18, ahead * 0.75));
    this.pitch += (targetPitch - this.pitch) * (snap ? 1 : 1 - Math.exp(-3 * dt));
    this.z = pz - RENDER.CAMERA_BACK;
    this.curve0 = curveAt(this.z);
    this.slope0 = curveSlope(this.z);
  }

  /** Cosmetic lateral offset of the track at world z. */
  curveOffset(z) {
    const dz = z - this.z;
    return (curveAt(z) - this.curve0 - this.slope0 * dz) * this.curveScale;
  }

  /**
   * @param {{x:number,y:number,s:number,visible:boolean}} out reused output
   */
  project(x, y, z, out) {
    const dz = z - this.z;
    if (dz < this.near) {
      out.visible = false;
      return out;
    }
    const s = this.focal / dz;
    out.x = this.cx + (x + this.curveOffset(z) - this.x) * s;
    out.y = this.horizon + (this.y - y + this.pitch * (dz - RENDER.CAMERA_BACK)) * s;
    out.s = s;
    out.visible = true;
    return out;
  }
}
