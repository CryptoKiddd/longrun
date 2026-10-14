# PULSE: One More Run

A skill-and-precision endless runner for the browser. Steer a glowing energy ball along a neon track above the void, thread precision gates for a score multiplier, jump gaps and hurdles, collect energy orbs, and beat your personal best.

- **Pure HTML5 Canvas 2D + native ES modules.** No runtime dependencies, no backend, no login.
- **Fair by construction.** Every generated segment is checked by a reachability validator, and an autopilot test plays 3 km through the real physics in CI.
- **Static-host ready.** `npm run build` outputs three files (`index.html`, `game.js`, `styles.css`, ~74 KiB of JS) that also run from `file://`.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Steer | `←` `→` or `A` `D` | Drag anywhere (floating joystick) |
| Jump | `Space` or `↑` / `W` | **JUMP** button, a second finger, or a quick upward swipe |
| Pause / resume | `Esc` or `P` | Pause button (top right) |
| Start / restart | `Enter` or `Space` on the menu or results screen | Buttons |
| Mute | `M` | Speaker button |

The game pauses automatically when the tab is hidden or the window loses focus.

## Commands

Requires Node.js 21 or newer (development only; players need just a browser).

```bash
npm install        # installs esbuild (only dev dependency)
npm run dev        # http://localhost:5173 — runs the ES-module sources directly
npm test           # unit + generation fuzz + autopilot tests (node:test)
npm run check      # syntax check + shipped-source lint rules
npm run build      # production bundle -> dist/
npm run preview    # http://localhost:4173 — serves dist/
npm run verify     # check + test + build
node scripts/smoke.mjs [root=.] [outDir=smoke-output]   # headless Chrome browser test + screenshots
```

`scripts/smoke.mjs` needs Chrome or Edge installed (or `CHROME_PATH`). It plays the game in headless Chrome at desktop, phone-portrait and phone-landscape sizes, checking keyboard and touch input, pause/resume, game over, restart, persistence and auto-pause on tab hide, and it fails on any console error.

## Scoring

| Source | Points |
| --- | --- |
| Distance | 1 per metre |
| Energy orb | 25 x multiplier |
| Precision gate | (50 + up to 100 for accuracy + 10 x streak) x multiplier |
| Optional challenge | +250 (first time completed) |

Gate tiers come from how close to the centre you pass: **PERFECT** (75 % or better) and **GOOD** (40 % or better) extend your streak, **OK** keeps it, and a **MISS** (going around the gate) resets it. Earned points are never taken away. The multiplier is `1 + floor(streak / 2)`, capped at x5.

## Project layout

```
index.html, styles.css      entry page + overlay styles
src/main.js                 bootstrap
src/config.js               all tuning constants + coordinate convention
src/core/                   Game (wiring + FSM), GameLoop, GameState, InputManager,
                            Simulation (DOM-free run model), AudioManager, Storage, rng
src/physics/                Collision primitives, PhysicsWorld sub-steps
src/entities/Player.js      player state
src/world/                  Track, PatternLibrary, PatternValidator, SegmentGenerator, DifficultyManager
src/systems/                Score, Progression (records/challenges/skins), Ghost, Particles
src/rendering/              Camera (projection), Renderer, sprites
src/ui/                     HUD (canvas), UI (DOM overlays)
src/platform/               PlatformAdapter (no-op integration boundary)
tests/                      node:test suites
scripts/                    serve, build, check, smoke
docs/                       ARCHITECTURE, GAME_DESIGN, PLATFORM
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) and [docs/PLATFORM.md](docs/PLATFORM.md).
