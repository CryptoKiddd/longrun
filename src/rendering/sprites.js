/**
 * Pre-rendered glow and ball sprites. Drawing a cached radial gradient with
 * drawImage is far cheaper than shadowBlur or per-frame gradients.
 */
const cache = new Map();

function makeCanvas(size) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(size, size);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** Soft radial glow of the given colour (alpha falls off to 0 at the edge). */
export function glowSprite(color, size = 128) {
  const key = `glow:${color}:${size}`;
  let c = cache.get(key);
  if (c) return c;
  c = makeCanvas(size);
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, color);
  grad.addColorStop(0.18, color);
  grad.addColorStop(0.45, withAlpha(color, 0.35));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  cache.set(key, c);
  return c;
}

/** Soft, fully blended contact shadow (dark centre fading to transparent). */
export function shadowSprite(size = 128) {
  const key = `shadow:${size}`;
  let c = cache.get(key);
  if (c) return c;
  c = makeCanvas(size);
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(0,0,10,0.85)');
  grad.addColorStop(0.35, 'rgba(0,0,10,0.5)');
  grad.addColorStop(0.7, 'rgba(0,0,10,0.15)');
  grad.addColorStop(1, 'rgba(0,0,10,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  cache.set(key, c);
  return c;
}

/** Shaded sphere body: bright core, coloured rim. */
export function ballSprite(core, rim, size = 128) {
  const key = `ball:${core}:${rim}:${size}`;
  let c = cache.get(key);
  if (c) return c;
  c = makeCanvas(size);
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r * 0.7, r * 0.62, r * 0.05, r, r, r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.25, core);
  grad.addColorStop(0.75, rim);
  grad.addColorStop(1, withAlpha(rim, 0.6));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r - 1, 0, Math.PI * 2);
  g.fill();
  cache.set(key, c);
  return c;
}

/** '#rrggbb' -> 'rgba(r,g,b,a)' */
export function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Linear blend of two '#rrggbb' colours -> '#rrggbb'. */
export function mix(a, b, t) {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (s) => {
    const ca = (x >> s) & 255;
    const cb = (y >> s) & 255;
    return Math.round(ca + (cb - ca) * t);
  };
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

export function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${((1 << 24) | (f(0) << 16) | (f(8) << 8) | f(4)).toString(16).slice(1)}`;
}

/** Pixels per metre of the obstacle texture tiles. */
export const TEX_PPM = 128;

/**
 * Procedural, tileable 1 m x 1 m surface textures for obstacle fronts.
 * Drawn once; the renderer maps them onto screen-aligned front faces exactly.
 */
export function obstacleTexture(kind) {
  const key = `tex:${kind}`;
  let c = cache.get(key);
  if (c) return c;
  const S = TEX_PPM;
  c = makeCanvas(S);
  const g = c.getContext('2d');
  const stripes = (a, b, width, period) => {
    g.fillStyle = b;
    g.fillRect(0, 0, S, S);
    g.fillStyle = a;
    for (let k = -S; k < 2 * S; k += period) {
      g.beginPath();
      g.moveTo(k, S);
      g.lineTo(k + width, S);
      g.lineTo(k + width + S, 0);
      g.lineTo(k + S, 0);
      g.closePath();
      g.fill();
    }
  };
  if (kind === 'wall') {
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, '#3a0d2b');
    grad.addColorStop(1, '#16040f');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    // Energy grain: fine diagonal lines.
    g.strokeStyle = 'rgba(255,46,136,0.14)';
    g.lineWidth = 6;
    for (let k = -S; k < 2 * S; k += 22) {
      g.beginPath();
      g.moveTo(k, S);
      g.lineTo(k + S, 0);
      g.stroke();
    }
    // Panel seams, bevel and rivets.
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 4;
    g.strokeRect(2, 2, S - 4, S - 4);
    g.strokeStyle = 'rgba(255,110,180,0.45)';
    g.lineWidth = 2;
    g.strokeRect(7, 7, S - 14, S - 14);
    g.fillStyle = 'rgba(255,170,210,0.8)';
    for (const [x, y] of [[13, 13], [S - 17, 13], [13, S - 17], [S - 17, S - 17]]) g.fillRect(x, y, 4, 4);
    // Glowing core slot.
    g.fillStyle = 'rgba(255,46,136,0.55)';
    g.fillRect(S / 2 - 22, S / 2 - 3, 44, 6);
  } else if (kind === 'hurdle') {
    stripes('#ff2e88', '#1c0611', 22, 44);
    const hi = g.createLinearGradient(0, 0, 0, S);
    hi.addColorStop(0, 'rgba(255,255,255,0.28)');
    hi.addColorStop(0.25, 'rgba(255,255,255,0)');
    hi.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = hi;
    g.fillRect(0, 0, S, S);
  } else if (kind === 'mover') {
    stripes('#ff8a3d', '#1f0c02', 22, 44);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, S * 0.32, S, S * 0.36);
    // Double-headed arrows: "this one moves sideways".
    g.fillStyle = '#ffe0c4';
    const cy = S / 2;
    g.beginPath();
    g.moveTo(18, cy);
    g.lineTo(40, cy - 16);
    g.lineTo(40, cy + 16);
    g.closePath();
    g.moveTo(S - 18, cy);
    g.lineTo(S - 40, cy - 16);
    g.lineTo(S - 40, cy + 16);
    g.closePath();
    g.fill();
    g.fillRect(40, cy - 4, S - 80, 8);
  } else {
    // Gate post: brushed violet metal with a light strip.
    const grad = g.createLinearGradient(0, 0, S, 0);
    grad.addColorStop(0, '#1d1342');
    grad.addColorStop(0.5, '#4b33a0');
    grad.addColorStop(1, '#1d1342');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < S; y += 32) g.fillRect(0, y, S, 3);
    g.fillStyle = '#e4d8ff';
    g.fillRect(S / 2 - 7, 0, 14, S);
  }
  cache.set(key, c);
  return c;
}
