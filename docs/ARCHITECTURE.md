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

- `x` is lateral metres (0 = centre, + = right), `y` is metres up (0 = track surface), `z` is metres forward.
- Gravity reduces `vy`, and jump velocity is positive. `Player.y` is the height of the ball's **bottom**.
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
| World progression | `stepForward` | `vz = speedAt(z)`; speed depends on distance only |
| Movers | `Track.updateMovers` | `x = base + amp·sin(freq·(playerZ − z0) + phase)` |
| Lateral | `stepHorizontal` | accel 55 m/s² (95 when reversing), max 9 m/s, exponential friction only without input, 65 % air control |
| Rails | `resolveRails` | clamp and reflect 25 % of lateral speed |
| Vertical | `stepVertical` | 0.12 s jump buffer, 0.08 s coyote time, semi-implicit Euler, landing lip that grows with fall speed (no tunnelling), falls into holes |
| Collisions | `detectCollisions` | swept sphere vs AABB (movers in their own frame), swept orb pickup, gate-plane crossing with accuracy |

`StepEvents` is reused every step, so collision events don't allocate.

## Course generation

- `PatternLibrary` holds 12 handcrafted patterns parameterised by `level` and `speed`. Timings are written in seconds and converted to metres, so they scale with speed.
- `SegmentGenerator`:
  - Introduces each mechanic once in its gentlest form, at the distance listed in `UNLOCKS`.
  - Otherwise picks patterns by weight and never repeats the previous one.
  - Inserts a recovery runway when a fatigue budget fills up.
  - If validation fails, grows the lead-in up to 3 times, then tries other patterns, then falls back to a known-safe runway.
- `PatternValidator` runs a backward dynamic-programming pass over states `(step, lane, air-phase)`, using the real swept-collision function. Its player model is deliberately weaker than the real one:
  - 70 % lateral speed
  - no air steering
  - shorter jumps
  - hitboxes inflated by 0.12 m
  - unsafe floor near hole edges
  - must finish grounded

  A segment passes only if **every** entry lane survives. Optional `checkpoints` additionally prove that a specific route (such as a risk-reward lane) can be reached and survived.
- The first 640 m use a fixed seed, so the opening is identical every run. This is what makes ghost replays meaningful.
- `Track` pools every object and recycles it 14 m behind the player, so live object counts stay bounded (the tests check this over 20 km).

## Rendering

- **Painter's algorithm:**
  - sky, stars and ridge (parallax follows the curve)
  - void grid
  - track slices (stripes, fog, zone tint)
  - lanes and rails
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
| `tests/autopilot.test.js` | a lookahead bot survives 3 km on two seeds using the real physics |
| `scripts/smoke.mjs` | real-browser end-to-end flow at three viewport sizes |
