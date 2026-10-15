/**
 * Central tuning constants for PULSE.
 *
 * WORLD COORDINATE CONVENTION (used by all gameplay code):
 *   x — lateral metres, 0 = track centre, +x = right (from the player's view).
 *   y — vertical metres, 0 = track surface, +y = up. Gravity acts toward -y,
 *       jump velocity is positive. Player.y is the height of the BALL'S BOTTOM.
 *   z — forward metres along the track, +z = direction of travel.
 * All physics uses SI units and seconds. Rendering projects these coordinates
 * to the screen; screen positions are never fed back into gameplay.
 */

export const PHYSICS = Object.freeze({
  DT: 1 / 120, // fixed simulation step (s)
  MAX_FRAME_DT: 0.1, // clamp for a single rAF delta (s)
  MAX_STEPS_PER_FRAME: 12, // catch-up cap (prevents spiral of death)

  GRAVITY: 24, // m/s², applied toward -y
  JUMP_VELOCITY: 8, // m/s, +y  -> apex 1.33 m, airtime 0.667 s
  COYOTE_TIME: 0.08, // s after leaving an edge where a jump is still allowed
  JUMP_BUFFER: 0.12, // s a jump press is remembered before landing

  LAT_ACCEL: 55, // m/s² steering acceleration
  LAT_TURN_ACCEL: 95, // m/s² when steering against current velocity
  LAT_MAX_SPEED: 9, // m/s
  LAT_FRICTION: 12, // 1/s exponential decay with no steering input (ground)
  AIR_FRICTION: 3, // 1/s decay with no input while airborne
  AIR_CONTROL: 0.65, // steering acceleration multiplier while airborne
  RAIL_BOUNCE: 0.25, // fraction of lateral speed reflected by side rails

  DASH_SPEED: 19, // m/s lateral burst
  DASH_TIME: 0.14, // s the burst lasts (~2.7 m sidestep)
  DASH_COOLDOWN: 1.0, // s before the next dash
  SLAM_SPEED: 16, // m/s downward when dashing in the air without a direction

  PLAYER_RADIUS: 0.45,
  LANDING_LIP: 0.12, // m below surface still snapped up onto a floor edge
  FALL_DEATH_DEPTH: 1.4, // m below the surface at which a fall ends the run
});

export const TRACK = Object.freeze({
  HALF_WIDTH: 4.5, // m; side rails at ±HALF_WIDTH
  VIEW_AHEAD: 170, // m generated/rendered ahead of the player
  KEEP_BEHIND: 14, // m kept behind the player before recycling
  OPENING_LENGTH: 640, // m of deterministic opening course (ghost replays)
  OPENING_SEED: 0x5eed1e,
});

export const SPEED = Object.freeze({
  MIN: 22, // m/s at the start of a run
  MAX: 38, // m/s cap (before slope bonus)
  RAMP_DISTANCE: 3600, // m over which speed eases from MIN to MAX
  SLOPE_BONUS: 14, // m/s gained per unit of downhill grade (lost uphill)
});

export const SCORING = Object.freeze({
  METRES_PER_POINT: 1,
  ORB_POINTS: 25,
  GATE_BASE: 50,
  GATE_ACCURACY_BONUS: 100,
  STREAK_BONUS: 10,
  PERFECT_ACCURACY: 0.75,
  GOOD_ACCURACY: 0.4,
  MAX_MULTIPLIER: 5,
  STREAK_PER_MULTIPLIER: 2,
  CHALLENGE_BONUS: 250,
});

export const RENDER = Object.freeze({
  MAX_DPR: 2,
  MAX_PIXELS: 2_600_000, // cap on internal canvas pixel count
  CAMERA_HEIGHT: 3.1,
  CAMERA_BACK: 6.5,
  NEAR: 1.2,
  SLICE: 2, // m per track slice
});

/** Bump when course generation changes so stale ghost data is discarded. */
export const COURSE_VERSION = 3;
