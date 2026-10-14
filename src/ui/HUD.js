import { SCORING, SPEED } from '../config.js';
import { PALETTE } from '../rendering/Renderer.js';

/** Fast integer formatting with thousands separators. */
export function formatInt(n) {
  const s = String(Math.max(0, Math.floor(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return out;
}

/** Caches the formatted string until the number changes (no per-frame churn). */
class NumberText {
  constructor(suffix = '', prefix = '') {
    this.value = -1;
    this.text = '';
    this.suffix = suffix;
    this.prefix = prefix;
  }
  get(v) {
    const n = Math.floor(v);
    if (n !== this.value) {
      this.value = n;
      this.text = this.prefix + formatInt(n) + this.suffix;
    }
    return this.text;
  }
}

const MULT_LABELS = ['x0', 'x1', 'x2', 'x3', 'x4', 'x5'];
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** In-game heads-up display, drawn on the canvas (no per-frame DOM writes). */
export class HUD {
  constructor() {
    this.score = new NumberText();
    this.best = new NumberText('', 'BEST ');
    this.distance = new NumberText(' m');
  }

  /**
   * @param {CanvasRenderingContext2D} ctx (CSS-pixel transform already set)
   * @param {object} h HUD view model from Game
   */
  draw(ctx, w, h, hud) {
    const pad = Math.max(14, Math.min(24, w * 0.025));
    const narrow = w < 560;
    ctx.textBaseline = 'alphabetic';

    // Score + best.
    const scoreSize = narrow ? 28 : 34;
    ctx.textAlign = 'left';
    ctx.font = `800 ${scoreSize}px ${FONT}`;
    shadowText(ctx, this.score.get(hud.score), pad, pad + scoreSize * 0.85, '#ffffff');
    const scoreW = ctx.measureText(this.score.text).width;
    ctx.font = `600 12px ${FONT}`;
    const beating = hud.best > 0 && hud.score > hud.best;
    if (hud.best > 0) shadowText(ctx, beating ? 'NEW BEST!' : this.best.get(hud.best), pad, pad + scoreSize + 14, beating ? PALETTE.orb : '#8fa3d9');

    // Multiplier chip with streak pips.
    const mx = pad + scoreW + 14;
    const my = pad + 4;
    const mult = hud.multiplier;
    const chipW = 44;
    ctx.globalAlpha = mult > 1 ? 1 : 0.55;
    roundRect(ctx, mx, my, chipW, 26, 13);
    ctx.fillStyle = mult > 1 ? 'rgba(167,123,255,0.28)' : 'rgba(80,100,160,0.2)';
    ctx.fill();
    ctx.strokeStyle = mult > 1 ? PALETTE.gate : '#4a5a90';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = `800 15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(MULT_LABELS[mult] || `x${mult}`, mx + chipW / 2, my + 18);
    if (mult < SCORING.MAX_MULTIPLIER) {
      const per = SCORING.STREAK_PER_MULTIPLIER;
      const filled = hud.streak % per;
      for (let i = 0; i < per; i++) {
        ctx.fillStyle = i < filled ? PALETTE.perfect : 'rgba(140,160,220,0.35)';
        ctx.fillRect(mx + 8 + i * ((chipW - 16) / per), my + 30, (chipW - 16) / per - 3, 3);
      }
    }
    ctx.globalAlpha = 1;

    // Distance + speed (top centre on wide screens, under score on narrow).
    const dx = narrow ? pad : w / 2;
    const dy = narrow ? pad + scoreSize + 40 : pad + 22;
    ctx.textAlign = narrow ? 'left' : 'center';
    ctx.font = `700 ${narrow ? 15 : 19}px ${FONT}`;
    shadowText(ctx, this.distance.get(hud.distance), dx, dy, '#d6e4ff');
    const barW = narrow ? 70 : 96;
    const bx = narrow ? pad : w / 2 - barW / 2;
    const sp = Math.max(0, Math.min(1, (hud.speed - SPEED.MIN) / (SPEED.MAX - SPEED.MIN)));
    ctx.fillStyle = 'rgba(80,100,160,0.35)';
    ctx.fillRect(bx, dy + 7, barW, 3);
    ctx.fillStyle = PALETTE.rail;
    ctx.fillRect(bx, dy + 7, barW * (0.08 + 0.92 * sp), 3);

    // Challenge / unlock toast.
    if (hud.toastAlpha > 0) {
      ctx.globalAlpha = hud.toastAlpha;
      ctx.font = `700 ${narrow ? 13 : 15}px ${FONT}`;
      ctx.textAlign = 'center';
      const tw = Math.min(w - 2 * pad, ctx.measureText(hud.toast).width + 36);
      const ty = narrow ? dy + 30 : pad + 52;
      roundRect(ctx, w / 2 - tw / 2, ty, tw, 32, 16);
      ctx.fillStyle = 'rgba(10,14,40,0.85)';
      ctx.fill();
      ctx.strokeStyle = PALETTE.orb;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff1c9';
      ctx.fillText(hud.toast, w / 2, ty + 21, tw - 20);
      ctx.globalAlpha = 1;
    }

    // Tutorial hint.
    if (hud.hint && hud.hintAlpha > 0) {
      ctx.globalAlpha = hud.hintAlpha;
      ctx.font = `700 ${narrow ? 15 : 18}px ${FONT}`;
      ctx.textAlign = 'center';
      // Portrait puts the hint in the sky (clear of JUMP); otherwise bottom centre.
      const y = hud.hintHigh ? Math.max(pad + 130, h * 0.24) : h * 0.9;
      const tw = ctx.measureText(hud.hint).width + 40;
      roundRect(ctx, w / 2 - tw / 2, y - 24, tw, 36, 18);
      ctx.fillStyle = 'rgba(4,8,28,0.7)';
      ctx.fill();
      ctx.fillStyle = PALETTE.perfect;
      ctx.fillText(hud.hint, w / 2, y);
      ctx.globalAlpha = 1;
    }
  }
}

function shadowText(ctx, text, x, y, color) {
  ctx.fillStyle = 'rgba(0,0,16,0.7)';
  ctx.fillText(text, x + 1.5, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
