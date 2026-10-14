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
