/**
 * Boundary for host-platform features (Y8 or others).
 *
 * This build ships ONLY the local no-op adapter: no third-party SDK is loaded
 * and no SDK method names are assumed. To integrate a platform, implement a
 * subclass using that platform's official, documented API and return it from
 * createPlatformAdapter(). See docs/PLATFORM.md.
 *
 * Rules every adapter must follow:
 *  - requestBreak() may only be called at a safe state boundary (game over /
 *    menu), never during active gameplay. The game is paused while it runs and
 *    resumes when the returned promise settles, whatever the outcome.
 *  - Failures must resolve, never throw, and never block play.
 *  - No fake ads, no deceptive buttons, no forced clicks.
 */
export class PlatformAdapter {
  constructor() {
    this.name = 'local';
  }

  /** Initialise supported features. Must resolve even on failure. */
  async init() {
    return this;
  }

  /** Gameplay started/resumed (for platforms that track active play). */
  gameplayStart() {}

  /** Gameplay stopped (pause, game over, menu). */
  gameplayStop() {}

  /** @returns {boolean} whether an approved leaderboard integration exists */
  get hasLeaderboard() {
    return false;
  }

  /** Submit a score to an approved leaderboard. @returns {Promise<boolean>} */
  async submitScore(_score) {
    return false;
  }

  /** @returns {boolean} whether an approved ad/break integration exists */
  canRequestBreak() {
    return false;
  }

  /**
   * Request a platform-approved break (e.g. an interstitial) at a safe boundary.
   * @param {'game_over'|'menu'} _reason
   * @returns {Promise<boolean>} true if a break was shown
   */
  async requestBreak(_reason) {
    return false;
  }
}

/** Factory: the single place a real integration would be selected. */
export function createPlatformAdapter() {
  return new PlatformAdapter();
}
