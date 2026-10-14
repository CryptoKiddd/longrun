# Architecture

## Data flow

```
 keyboard / pointer
        │
 InputManager ── steer (-1..1), jump presses, actions (confirm/pause/mute/blur)
        │
 Game ── StateMachine (INITIALIZING → READY → PLAYING ⇄ PAUSED, PLAYING → GAME_OVER → PLAYING|READY)
        │
 GameLoop (requestAnimationFrame)
   ├─ fixedUpdate(1/120 s) ── only in PLAYING ──▶ Simulation.step
   │                                              ├─ PhysicsWorld.step
   │                                              │    forward → movers → horizontal → rails → vertical → swept collisions
   │                                              ├─ ScoreSystem, challenges, GhostRecorder
   │                                              ├─ SegmentGenerator.ensureAhead (pattern → validate → Track)
   │                                              └─ Track.recycle
   │                                       notices ─▶ Game: audio, particles, floating text, toasts
   └─ frameUpdate(real dt, alpha) ── visuals (all states) ──▶ Renderer.render(view) + HUD.draw
```

## Coordinates and units

Defined once in `src/config.js`:

- `x` is lateral metres (0 = centre, + = right), `y` is metres up, `z` is metres forward.
- Gravity reduces `vy`, and jump velocity is positive. `Player.y` is the **absolute** height of the ball's bottom.
- The track surface height is `Terrain.heightAt(z)`, built from eased hills, linear slopes, and downward steps (ramp lips and drop-offs). Obstacle, orb and gate heights are **relative to the local surface**, and collisions run in surface-relative coordinates, so hazards always sit on the deck.
- Everything is in SI units and seconds.

The renderer projects world coordinates to screen space through `Camera.project`. Nothing flows back from the screen into gameplay. The visible track curvature is a cosmetic lateral offset applied during projection that grows with distance ahead of the camera, so physics and collisions always run on a straight track.

## Fixed timestep

`GameLoop.advance(realDt)`:

1. Clamps `realDt` to `[0, 0.1]` s.
2. Adds it to an accumulator and runs `fixedUpdate(1/120)` while the accumulator holds at least one step, up to 12 steps per frame. Any remaining backlog is dropped (no spiral of death).
3. Calls `frameUpdate(dt, alpha)`, where `alpha` interpolates the rendered player between the last two physics states.

`resetTiming()` runs on start and resume, so time spent paused or in a background tab is never simulated.

## Physics

`PhysicsWorld` runs small, separately tested functions in a fixed order:

| Step | Function | Notes |
| --- | --- | --- |
| World progression | `stepForward` | `vz = speedAt(z) + slopeBonus(grade)`; downhill is faster. Still a pure function of distance and terrain |
| Movers | `Track.updateMovers` | `x = base + amp·sin(freq·(playerZ − z0) + phase)` |
| Lateral | `stepHorizontal` | accel 55 m/s² (95 when reversing), max 9 m/s, exponential friction only without input, 65 % air control |
| Rails | `resolveRails` | clamp and reflect 25 % of lateral speed |
| Vertical | `stepVertical` | Grounded balls follow the surface while gravity can hold them (`v^2 * H'' >= -g`). They leave the ground at sharp crests, ramp lips and drop-offs, keeping their vertical speed. A jump **adds** 8 m/s to the current vertical speed, so jumping at a ramp lip goes higher. Also: 0.12 s jump buffer, 0.08 s coyote time, semi-implicit Euler, a landing lip that scales with relative speed (no tunnelling), falls into holes, and crashes into platform sides |
| Collisions | `detectCollisions` | swept sphere vs AABB (movers in their own frame), swept orb pickup, gate-plane crossing with accuracy |

`StepEvents` is reused every step, so collision events don't allocate.

## Course generation

- `PatternLibrary` holds 17 handcrafted patterns parameterised by `level` and `speed`. Five of them shape the terrain: rolling hills, downhill runs, a downhill slalom, ramp jumps over gaps, and drop-offs. Timings are written in seconds and converted to metres, so they scale with speed.
- `SegmentGenerator`:
  - Introduces each mechanic once in its gentlest form, at the distance listed in `UNLOCKS`.
  - Otherwise picks patterns by weight and never repeats the previous one.
  - Inserts a recovery runway when a fatigue budget fills up.
  - If validation fails, grows the lead-in up to 3 times, then tries other patterns, then falls back to a known-safe runway.
- `PatternValidator` handles terrain. Vertical motion doesn't depend on the lane, so every take-off is simulated **once with the real physics integrator**: both jumps and natural launches off crests, lips and drops. Validator steps are exactly 6 physics ticks. A backward dynamic-programming pass over `(step, lane, trajectory phase)` then checks the lateral options using the real swept-collision function. Its player model is deliberately weaker than the real one:
  - 70 % lateral speed
  - no air steering, coyote time or jump buffer
  - hitboxes inflated by 0.12 m
  - landings need floor across the whole step they happen in
  - unsafe floor near hole edges
  - must finish grounded

  A segment passes only if **every** entry lane survives. Optional `checkpoints` additionally prove that a specific route (such as a risk-reward lane) can be reached and survived.
- The first 640 m use a fixed seed, so the opening is identical every run. This is what makes ghost replays meaningful.
- `Track` pools every object and recycles it 14 m behind the player, so live object counts stay bounded (the tests check this over 20 km).

## Rendering

- **Camera:** follows the smoothed surface height and **pitches** with the grade 14 m ahead, pivoting at the player's depth so the ball stays put while slopes tilt the world. The sky shifts with the pitch.
- **Painter's algorithm:**
  - sky, stars and ridge (parallax follows the curve)
  - void grid
  - track slices, split exactly at drop-offs (left/right height limits keep lips crisp), with stripes, fog and zone tint
  - lanes, and rails drawn as additive light bands in world units that fade with distance (no hard outlines)
  - ramp-lip highlights
  - holes (void, far wall, chevrons)
  - best-distance marker
  - depth-sorted objects, with the player inserted at its depth
  - particles and floating text
  - vignette and flash
  - HUD
- **Glow** uses cached radial-gradient sprites and two-pass strokes. There is no `shadowBlur` and no full-screen filters.
- **Quality:** the backing store is capped at 2× DPR and 2.6 MP. If frames stay slower than ~42 fps for 2.5 s, the quality steps down: lower render scale, fewer particles, no void grid, no vignette, no glow passes.

## Testing

| Suite | Covers |
| --- | --- |
| `tests/physics.test.js` | gravity, jump phases, buffer, coyote, no double jump, landing, speed cap, friction, rails, falling, frame-rate independence |
| `tests/collision.test.js` | primitives, tunnelling, rounded corners, walls, movers, single-award orbs, gate pass/miss/post, hurdle jump |
| `tests/loop-state-input.test.js` | delta clamp, catch-up cap, resetTiming, FSM transitions, no updates outside PLAYING, key repeat, simultaneous directions, blur, touch drag, multi-touch |
| `tests/generation.test.js` | validator rejects unfair layouts, all patterns validate at all difficulties, endless contiguous course, recovery sections, progressive introduction, calm first 10 s, deterministic opening, bounded object count, monotonic difficulty |
| `tests/progression.test.js` | storage failures, sanitisation, records never lowered, challenges/skins, settings, ghost, scoring tiers, restart isolation |
| `tests/terrain.test.js` | eased hills, drops, following slopes, ramp launches, drop-off landings, crest pops, surface-relative obstacles, validator on ramps and drops |
| `tests/autopilot.test.js` | a depth-first planner bot (0.2 s steer/jump segments, 1.6 s lookahead, real physics) survives 3 km on two seeds |
| `scripts/smoke.mjs` | real-browser end-to-end flow at three viewport sizes |
