# Game design

## Core loop

Start instantly → learn steering on a calm runway → meet obstacles one mechanic at a time → fail from an understandable mistake → see score, records and the gap to your best → restart with one key.

## Readability rules

| Colour | Meaning |
| --- | --- |
| Magenta / pink | Danger: walls, hurdles, gap edges, warning chevrons |
| Orange | Moving barrier (predictable sine motion) |
| Violet | Precision gate posts and beam; a cyan diamond marks the centre |
| Amber | Energy orbs and the BEST distance line |
| Cyan | The player (or the selected cosmetic) and the track rails |

Objects fade in over the last 30 m of the 170 m draw distance, so nothing appears without warning.

## Mechanics and introduction order

| Distance | Mechanic | Notes |
| --- | --- | --- |
| 0 m | Tutorial runway | orb trails only; steering hint |
| 140 m | Slalom, centre block | steer around tall walls |
| 220 m | Precision gate | first one centred and wide |
| 320 m | Hurdles | low bars: jump (air orbs reward it) or steer around partial ones |
| 430 m | Full gap | jump; length scales with speed to leave a comfortable take-off window |
| 560 m | Gate rows | zig-zag precision sequences |
| 650 m | Partial gap | steer to the safe side, or jump the gap for orbs (risk-reward) |
| 800 m | Moving barrier | lateral speed held well below the player's |
| 900 m | Risk-reward lane | a divider makes a narrow orb lane (sometimes with a hurdle) next to a wide safe lane |
| 1500 m | Doorway, gap then gate | combinations |
| 1900 m | Double movers | opposite-phase pair |

## Difficulty

- Difficulty is `1 − (1 − d/5200)^1.7`, where `d` is distance. It rises quickly early, then plateaus.
- Forward speed goes from 14 m/s to 31 m/s along the same curve.
- Hazard spacing, gate width (3.2 m → 2.15 m, always visible), slalom wall width and mover frequency each scale with level. They are tuned separately rather than all at once.
- Hitboxes never change with difficulty.
- A fatigue budget inserts a recovery runway after demanding stretches. The budget allows longer stretches as level rises.

## Fairness guarantees

- Every placed segment passes the validator from **every** entry lane, using a deliberately weaker player model than the real one. See ARCHITECTURE.md for the details.
- The autopilot test plays the real physics through generated courses. In a stress run, 12 seeds × 9 km (well past the max-difficulty plateau) produced no unavoidable deaths.

## Respectful retention

- There are no timers or energy systems, no streak-loss threats, and no pop-ups during play.
- Challenges are optional, visible on the menu and never block play. They reward cosmetics only.
- The ghost shows your best line through the fixed opening, so improvement is visible and learnable.
- The results screen shows the actual gap to your best ("312 points from your best").
