import { Game } from './core/Game.js';

/** Entry point: boot the game once the DOM is ready. */
function boot() {
  const canvas = document.getElementById('game');
  if (!canvas || !canvas.getContext) return;
  const game = new Game({ canvas });
  game.init().catch((err) => {
    // Surface boot failures instead of leaving a blank screen.
    console.error('PULSE failed to start', err);
    const loading = document.getElementById('screen-loading');
    if (loading) loading.textContent = 'Sorry, the game failed to start. Please reload.';
  });
  // Exposed for debugging and automated smoke tests only.
  globalThis.__pulse = game;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
