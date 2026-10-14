---
paths:
  - "src/rendering/**"
  - "src/ui/**"
  - "styles.css"
  - "index.html"
---

# Rendering & UI rules

- The renderer is a read-only view. It may interpolate (`prev*` → current with `alpha`) but must never write gameplay state.
- All world objects go through `Camera.project` so track, obstacles, orbs and particles share one projection (including the cosmetic curve).
- Glow: use cached sprites from `sprites.js` or the two-pass stroke helper. No `shadowBlur` in loops, no full-screen filters.
- No per-frame DOM writes. The HUD is drawn on the canvas; DOM overlays change only on state transitions.
- Palette: navy background, cyan player, magenta = danger, violet = gates, amber = orbs, orange = moving hazards. Keep danger readable over decoration.
- Respect `settings.reducedEffects` (no shake/flash/banking) and the auto quality level.
- Test at phone portrait (360×740), landscape (740×360) and desktop sizes; the track must fit the width at the player's depth.
