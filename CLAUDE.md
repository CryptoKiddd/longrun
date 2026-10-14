# PULSE: One More Run — project guide

Skill-and-precision endless runner for the browser (primary target: Y8). Native ES modules + Canvas 2D. **No runtime dependencies**, no framework, no backend. `esbuild` is the only dev dependency (production bundle).

## Commands

| Task | Command |
| --- | --- |
| Dev server (ES modules, no build) | `npm run dev` → http://localhost:5173 |
| Unit tests (node:test) | `npm test` |
| Syntax/lint check | `npm run check` |
| Production build → `dist/` | `npm run build` |
| Serve the build | `npm run preview` → http://localhost:4173 |
| Everything | `npm run verify` |
| Browser smoke test (headless Chrome) | `node scripts/smoke.mjs [root] [outDir]` (use `dist` to test the build) |

`index.html` loads `src/main.js` as a module; the build swaps that exact tag for a bundled classic `game.js` (keep the tag text unchanged — `scripts/build.mjs` asserts it).

## Architecture (one-way data flow)

```
InputManager ──intent──▶ Simulation.step (fixed 1/120 s, PLAYING only)
                           ├─ PhysicsWorld: forward → movers → horizontal → rails → vertical → collisions
                           ├─ ScoreSystem / challenges / ghost recording
                           └─ SegmentGenerator (pattern → PatternValidator → Track)
Game (FSM + DOM UI + audio + platform) ──▶ Renderer (Camera projection, read-only view of state)
```

- `src/config.js` — every tuning constant **and the coordinate convention**: x right, y up (gravity −y), z forward, metres/seconds. `Player.y` is the ball bottom's *absolute* height; terrain height is `track.heightAt(z)`; obstacle/orb/gate heights are *relative to the surface*.
- `src/core/` — `GameLoop` (accumulator, clamped deltas, capped catch-up), `GameState` (FSM), `InputManager`, `Simulation` (DOM-free run model), `Game` (wires everything), `AudioManager`, `Storage`, `rng`.
- `src/physics/` — `Collision` (swept sphere/AABB etc.), `PhysicsWorld` (sub-steps as separate functions).
- `src/world/` — `Track` (pooled live objects), `Terrain` (eased hills, slopes, ramp lips, drop-offs), `PatternLibrary`, `PatternValidator` (trajectory-aware reachability DP), `SegmentGenerator`, `DifficultyManager`.
- `src/systems/` — scoring, progression (records, challenges, cosmetics), particles, ghost.
- `src/rendering/` — `Camera` (projection + visual-only track curvature), `Renderer`, `sprites`.
- `src/ui/` — DOM overlays (menus), the canvas HUD, and `fonts.js` (bundled OFL fonts in `assets/fonts/`, copied to `dist/` by the build).
- `src/platform/PlatformAdapter.js` — no-op adapter; real SDKs plug in here only.

## Non-negotiable rules

1. **Physics never reads render/screen state.** Projection is one-way. Curvature is cosmetic.
2. **Determinism:** course, terrain, forward speed and mover phase depend only on distance and seed. Difficulty depends on distance, never score. Don't use `Math.random()` in generation; use the seeded `Rng`.
3. **Fairness:** every generated segment must pass `validateSegment` (all entry lanes survivable). Never make the game harder by silently changing hitboxes.
4. Gameplay updates only in `State.PLAYING`. Add new states/transitions in `GameState.js`'s table.
5. No allocations in per-step/per-frame hot paths when avoidable (pools, reused event objects).
6. Pure logic modules (`physics`, `world`, `systems`, `core/Simulation`) must not touch `window`/`document` so they stay testable in Node.
7. Monetization: never fake ads, never ads during gameplay, never invent SDK methods. See `docs/PLATFORM.md`.
8. Git: work on `main`, feature-sized commits, **no Co-Authored-By trailers**.

See `docs/ARCHITECTURE.md` and `docs/GAME_DESIGN.md` for details, and `.claude/rules/` for area-specific rules.
