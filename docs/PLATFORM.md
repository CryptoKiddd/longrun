# Platform integration (Y8 and others)

## Current state

- The game is fully standalone: no network requests, no SDK, no login, no ads.
- `src/platform/PlatformAdapter.js` defines the integration boundary, and `createPlatformAdapter()` returns a no-op adapter.
- The repository contains no Y8 SDK documentation, so **no Y8 API calls are implemented or assumed**.

## Hooks already wired in `Game`

| Adapter method | Called when |
| --- | --- |
| `init()` | once at startup (failures are swallowed) |
| `gameplayStart()` | run start and resume |
| `gameplayStop()` | pause, game over, return to menu |
| `submitScore(score)` | game over (result ignored if it fails) |
| `requestBreak(reason)` | **not called yet.** If added, call it only from the results or menu screen, with the game in `GAME_OVER` or `READY` |

## Steps to integrate with Y8

1. Read the current official Y8 developer documentation and confirm which features (account, leaderboards, ads) are permitted for this game and how to load them.
2. Create a subclass of `PlatformAdapter` that wraps only the documented APIs. Load any SDK script asynchronously, and make every method resolve, never reject, if the SDK is missing.
3. Return the subclass from `createPlatformAdapter()`, preferably behind a build flag or host check so the plain build stays SDK-free.
4. If ads are allowed, request them only at the game-over → restart boundary. Never show them during `PLAYING`. Keep the game paused until the promise settles, and resume normally even if the ad fails or is blocked.
5. Re-run `npm run verify` and `node scripts/smoke.mjs dist` before uploading `dist/`.

## Never do

- Fake ads, or buttons styled to look like game controls that open ads
- Forced clicks, or ad-triggered crashes and lockouts
- Attempts to bypass a platform's ad rules or blockers
- Ads or interruptions during active gameplay

## Pre-publish checklist

- [ ] `npm run verify` passes; `node scripts/smoke.mjs dist` passes
- [ ] Upload the contents of `dist/` (`index.html`, `game.js`, `styles.css`). All paths are relative.
- [ ] Test inside an iframe at the platform's embed size, desktop and mobile
- [ ] Provide platform assets: thumbnails/icons, description, controls text (see README)
- [ ] Confirm the platform's rules on local storage and audio autoplay (the game only starts audio after a user gesture)
