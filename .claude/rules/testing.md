---
paths:
  - "tests/**"
---

# Testing rules

- Use `node:test` + `node:assert/strict`; no test dependencies.
- Tests import from `src/` directly — only DOM-free modules. If you need the DOM, factor the logic into a pure module first.
- Drive time explicitly (`GameLoop.advance(dt)`, `Simulation.step(dt, intent)`); never use real timers.
- Storage tests use an in-memory storage object, never real `localStorage`.
- Browser smoke test: `node scripts/smoke.mjs` (headless Chrome over CDP) — run after UI/rendering changes.
