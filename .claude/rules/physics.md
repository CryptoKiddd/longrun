---
paths:
  - "src/physics/**"
  - "src/entities/**"
  - "src/core/Simulation.js"
  - "src/core/GameLoop.js"
---

# Physics rules

- Units: metres, seconds, m/s, m/s². Axes: +x right, +y up, +z forward. Gravity is subtracted from `vy`; jump velocity is positive.
- `Player.y` = ABSOLUTE height of the ball **bottom**. Surface height is `world.heightAt(z)`; collisions use surface-relative height (`y - heightAt(z) + radius`).
- Grounded balls follow the surface only while `v^2 * H'' >= -g` and no downward step occurred; otherwise they leave the ground keeping `vy`. Jumps ADD `JUMP_VELOCITY` to the current `vy`.
- Terrain may only step DOWN (ramp lips, drop-offs); an upward step is a wall the ball crashes into.
- Fixed step `PHYSICS.DT` (1/120 s). Never scale physics by frame delta; never read `performance.now()` inside physics.
- Step order (in `PhysicsWorld.step`): savePrevious → forward → updateMovers → horizontal → rails → vertical → collisions. Changing it affects swept collision correctness; update tests if you do.
- Friction applies only when there is no steering input (or above the analog cap). Do not apply friction in a way that cancels acceleration each step.
- Use swept tests (`sweptSphereAABB`, `segmentPointDistSq`, `crossPlaneZ`) between `prev*` and current positions — never end-of-step overlap only.
- Movers are tested in the obstacle's frame (relative motion). Their x is `moverX(o, playerZ)` — a function of distance, not time.
- Every behaviour change needs a test in `tests/physics.test.js` or `tests/collision.test.js`.
