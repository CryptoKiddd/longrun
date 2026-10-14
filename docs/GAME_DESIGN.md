# Game design

## Core loop

Start instantly → learn steering on a calm runway → meet obstacles one mechanic at a time → fail from an understandable mistake → see score, records and the gap to your best → restart with one key.

## Readability rules

| Colour | Meaning |
| --- | --- |
| Magenta / pink | Danger: walls, hurdles, gap edges, warning chevrons |
| Orange | Moving barrier (predictable sine motion) |
| White-cyan line | A ramp lip or drop-off edge: the deck ends there |
| Violet | Precision gate posts and beam; a cyan diamond marks the centre |
| Amber | Energy orbs and the BEST distance line |
| Cyan | The player (or the selected cosmetic) and the track rails |

Objects fade in over the last 30 m of the 170 m draw distance, so nothing appears without warning.

## Mechanics and introduction order

| Distance | Mechanic | Notes |
| --- | --- | --- |
| 0 m | Tutorial runway | orb trails only; steering hint |
| 110 m | Slalom, centre block | steer around tall walls |
| 150 m | Rolling hills | eased crests; at speed they pop the ball into the air |
| 190 m | Precision gate | first one centred and wide |
| 250 m | Hurdles | low bars: jump (air orbs reward it) or steer around partial ones |
| 300 m | Downhill run | the ball accelerates (+14 m/s per unit of grade) |
| 340 m | Full gap | jump; length scales with speed |
| 420 m | Ramp jump | the lip launches you over a gap; jumping at the lip goes higher |
| 470 m | Gate rows | zig-zag precision sequences |
| 540 m | Partial gap | steer to the safe side, or jump the gap for orbs (risk-reward) |
| 600 m | Drop-off | the deck ends and continues lower, sometimes across a gap |
| 660 m | Moving barrier | lateral speed held below the player's |
| 740 m | Risk-reward lane | narrow orb lane (often with a hurdle) beside a wide lane that has its own wall |
| 1000 m | Doorway, gap then gate | combinations |
| 1150 m | Downhill slalom | weaving while accelerating |
| 1300 m | Double movers | phase-offset pair |

## Difficulty

- Difficulty is `1 − (1 − d/3800)^1.7`, where `d` is distance. It rises quickly early, then plateaus.
- Forward speed goes from 16 m/s to 36 m/s along the same curve. Downhill grades add up to +5.6 m/s; uphills slow you.
- Hazard spacing (1.0 s → 0.5 s), gate width (2.9 m → 1.9 m, always visible), slalom wall width, mover speed, ramp steepness and gap length, and drop height each scale with level. They are tuned separately rather than all at once.
- Hitboxes never change with difficulty.
- A fatigue budget inserts a recovery runway after demanding stretches. The budget allows longer stretches as level rises.

## Fairness guarantees

- Every placed segment passes the validator from **every** entry lane, using a deliberately weaker player model than the real one. See ARCHITECTURE.md for the details.
- The autopilot test plays the real physics through generated courses. In a stress run, 12 seeds × 7 km (past the max-difficulty plateau, with terrain) produced no unavoidable deaths.

## Respectful retention

- There are no timers or energy systems, no streak-loss threats, and no pop-ups during play.
- Challenges are optional, visible on the menu and never block play. They reward cosmetics only.
- The ghost shows your best line through the fixed opening, so improvement is visible and learnable.
- The results screen shows the actual gap to your best ("312 points from your best").
