import { SCORING, SPEED } from '../config.js';
import { PALETTE } from '../rendering/Renderer.js';
import { FONT_DISPLAY, FONT_UI } from './fonts.js';

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
const SKEW = -0.18;
const SPEED_SEGMENTS = 12;

/** In-game heads-up display drawn on the canvas (no per-frame DOM writes). */
export class HUD {
  constructor() {
    this.score = new NumberText();
    this.best = new NumberText('', 'BEST ');
    this.distance = new NumberText();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx CSS-pixel transform already set
   * @param {object} hud view model from Game
   */
  draw(ctx, w, h, hud) {
    const pad = Math.max(16, Math.min(28, w * 0.025));
    const narrow = w < 560;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // ---- score (skewed display numerals) ----
    const scoreSize = narrow ? 30 : 38;
    skewed(ctx, pad, pad + scoreSize * 0.86, () => {
      ctx.font = `800 ${scoreSize}px ${FONT_DISPLAY}`;
      shadowText(ctx, this.score.get(hud.score), 0, 0, '#ffffff');
    });
    ctx.font = `800 ${scoreSize}px ${FONT_DISPLAY}`;
    const scoreW = ctx.measureText(this.score.text).width;
    if (hud.best > 0) {
      const beating = hud.score > hud.best;
      ctx.font = `700 12px ${FONT_UI}`;
      spaced(ctx, beating ? 'NEW BEST' : this.best.get(hud.best), pad + 2, pad + scoreSize + 16, beating ? PALETTE.orb : '#7f8fc4', 2.5);
    }

    // ---- multiplier: parallelogram badge + streak pips ----
    const mult = hud.multiplier;
    const bx = pad + scoreW + 18;
    const by = pad + 4;
    const bw = 52;
    const bh = 28;
    parallelogram(ctx, bx, by, bw, bh, 8);
    if (mult > 1) {
      ctx.fillStyle = PALETTE.danger;
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(150,170,255,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.font = `800 15px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = mult > 1 ? '#14010a' : '#9fb0e0';
    ctx.fillText(MULT_LABELS[mult] || `x${mult}`, bx + bw / 2, by + 20);
    ctx.textAlign = 'left';
    if (mult < SCORING.MAX_MULTIPLIER) {
      const per = SCORING.STREAK_PER_MULTIPLIER;
      const filled = hud.streak % per;
      const pw = (bw - 8) / per - 4;
      for (let i = 0; i < per; i++) {
        parallelogram(ctx, bx + 4 + i * (pw + 4), by + bh + 5, pw, 4, 2);
        ctx.fillStyle = i < filled ? PALETTE.perfect : 'rgba(150,170,255,0.25)';
        ctx.fill();
      }
    }

    // ---- distance + segmented speed meter ----
    const dSize = narrow ? 18 : 22;
    const dx = narrow ? pad : w / 2;
    const dy = narrow ? pad + scoreSize + 46 : pad + 24;
    ctx.font = `800 ${dSize}px ${FONT_DISPLAY}`;
    const dText = this.distance.get(hud.distance);
    const dW = ctx.measureText(dText).width;
    const startX = narrow ? dx : dx - (dW + 18) / 2;
    skewed(ctx, startX, dy, () => {
      ctx.font = `800 ${dSize}px ${FONT_DISPLAY}`;
      shadowText(ctx, dText, 0, 0, '#d9e4ff');
      ctx.font = `700 11px ${FONT_UI}`;
      ctx.fillStyle = '#7f8fc4';
      ctx.fillText('M', dW + 5, 0);
    });
    const sp = Math.max(0, Math.min(1, (hud.speed - SPEED.MIN) / (SPEED.MAX + 4 - SPEED.MIN)));
    const segW = narrow ? 6 : 7;
    const meterW = SPEED_SEGMENTS * (segW + 3);
    const mx = narrow ? pad : w / 2 - meterW / 2;
    const lit = Math.max(1, Math.round(sp * SPEED_SEGMENTS));
    for (let i = 0; i < SPEED_SEGMENTS; i++) {
      parallelogram(ctx, mx + i * (segW + 3), dy + 9, segW, 6, 2);
      ctx.fillStyle = i < lit ? (i >= SPEED_SEGMENTS - 3 ? PALETTE.danger : PALETTE.rail) : 'rgba(150,170,255,0.18)';
      ctx.fill();
    }

    // ---- toast (missions / records) ----
    if (hud.toastAlpha > 0) {
      ctx.globalAlpha = hud.toastAlpha;
      ctx.font = `700 ${narrow ? 13 : 14}px ${FONT_UI}`;
      const tw = Math.min(w - 2 * pad, ctx.measureText(hud.toast).width + 48);
      const tx = w / 2 - tw / 2;
      const ty = narrow ? dy + 32 : pad + 56;
      parallelogram(ctx, tx, ty, tw, 34, 10);
      ctx.fillStyle = 'rgba(2,3,11,0.88)';
      ctx.fill();
      parallelogram(ctx, tx, ty, 18, 34, 10);
      ctx.fillStyle = PALETTE.orb;
      ctx.fill();
      ctx.fillStyle = '#fff1c9';
      ctx.fillText(hud.toast, tx + 28, ty + 22, tw - 40);
      ctx.globalAlpha = 1;
    }

    // ---- tutorial hint ----
    if (hud.hint && hud.hintAlpha > 0) {
      ctx.globalAlpha = hud.hintAlpha;
      ctx.font = `700 ${narrow ? 15 : 17}px ${FONT_UI}`;
      const y = hud.hintHigh ? Math.max(pad + 130, h * 0.24) : h * 0.9;
      const tw = ctx.measureText(hud.hint).width + 48;
      parallelogram(ctx, w / 2 - tw / 2, y - 25, tw, 38, 12);
      ctx.fillStyle = 'rgba(2,3,11,0.78)';
      ctx.fill();
      ctx.fillStyle = PALETTE.perfect;
      ctx.textAlign = 'center';
      ctx.fillText(hud.hint, w / 2, y);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  }
}

function shadowText(ctx, text, x, y, color) {
  ctx.fillStyle = 'rgba(0,0,16,0.75)';
  ctx.fillText(text, x + 2, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Draw with an italic-style skew anchored at (x, y). */
function skewed(ctx, x, y, draw) {
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, 0, SKEW, 1, 0, 0);
  draw();
  ctx.restore();
}

/** Letter-spaced small caps (uses ctx.letterSpacing when supported). */
function spaced(ctx, text, x, y, color, spacing) {
  const supported = 'letterSpacing' in ctx;
  if (supported) ctx.letterSpacing = `${spacing}px`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  if (supported) ctx.letterSpacing = '0px';
}

/** Parallelogram path leaning right (matches the DOM cut-corner shapes). */
function parallelogram(ctx, x, y, w, h, lean) {
  ctx.beginPath();
  ctx.moveTo(x + lean, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - lean, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}
