---
paths:
  - "src/world/**"
---

# Course generation rules

- Patterns live in `PatternLibrary.js` and return a `SegmentSpec` in **segment-local** z (0 = segment start). Items: `wall`, `hurdle`, `mover`, `hole`, `gate`, `orb`. Optional `terrain: [{ z0, z1, dh, ease }]` shapes elevation (`z1 === z0` = instant drop, `dh < 0` only).
- Item heights are relative to the local surface. Don't put hazards right after a drop or crest where the camera can't see them.
- Keep the first `leadIn` metres of every pattern free of hazards; the generator grows `leadIn` until validation passes.
- Every spec must pass `validateSegment(spec, zStart)` (tests may pass `{ speed }` to fix the base speed). The validator is a backward reachability DP over (lane, airborne-phase) using conservative movement (70% lateral speed, no air steering, expanded hitboxes). If a pattern keeps failing, fix the pattern — don't loosen the validator.
- Optional `checkpoints` on a spec (`{ z, x }`) assert that a specific route (e.g. a risk-reward line) is itself survivable.
- Generation must be deterministic: use the `rng` passed in `ctx`, never `Math.random()`. The opening (`TRACK.OPENING_LENGTH`) uses a fixed seed for ghost replays; bump `COURSE_VERSION` in `config.js` when you change anything that alters the opening.
- Difficulty is a function of distance (`difficultyAt`). Introduce mechanics via `UNLOCKS`; vary one dimension at a time.
- `tests/generation.test.js` fuzzes thousands of segments; keep it green.
