// Browser smoke test via the Chrome DevTools Protocol (no dependencies).
// Usage: node scripts/smoke.mjs [root=.] [outDir=smoke-output]
// Env: CHROME_PATH to override the browser executable.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.argv[2] || '.';
const outDir = resolve(process.argv[3] || 'smoke-output');
const PORT = 5199;
const DEBUG_PORT = 9339;
mkdirSync(outDir, { recursive: true });

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const chromePath = candidates.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome/Edge found; set CHROME_PATH.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [resolve(import.meta.dirname, 'serve.mjs'), root, String(PORT)], { stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'pulse-smoke-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,720',
  'about:blank',
], { stdio: 'ignore' });

const problems = [];
const log = (...a) => console.log('[smoke]', ...a);

async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not ready */
    }
    await sleep(250);
  }
  throw new Error('Chrome debugger did not start');
}

let ws;
let nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`eval failed: ${expr}: ${JSON.stringify(r.exceptionDetails)}`);
  return r.result.value;
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
  log('screenshot', name);
}

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
};
async function key(name, type = 'press') {
  const k = KEYS[name];
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
  if (type !== 'up') await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  if (type !== 'down') await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

const state = () => evaluate('__pulse.fsm.current');

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true;
    await sleep(100);
  }
  problems.push(`timeout waiting for ${label}`);
  return false;
}

async function setViewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, ...(mobile ? { maxTouchPoints: 5 } : {}) });
}

async function load() {
  await send('Page.navigate', { url: `http://localhost:${PORT}/` });
  await waitFor(async () => (await evaluate('!!(window.__pulse && __pulse.fsm.current === "READY")')) === true, 8000, 'READY');
  await sleep(400);
}

async function run() {
  ws = new WebSocket(await cdpConnect());
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`));
      else p.res(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') problems.push(`exception: ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(msg.params.type)) {
      problems.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  // ---------------- desktop ----------------
  await setViewport(1280, 720, false);
  await load();
  await shot('01-desktop-menu');

  await key('Enter');
  await waitFor(async () => (await state()) === 'PLAYING', 2000, 'PLAYING after Enter');
  await sleep(1200);
  await key('ArrowRight', 'down');
  await sleep(500);
  await key('ArrowRight', 'up');
  const x1 = await evaluate('__pulse.sim.player.x');
  if (!(x1 > 0.5)) problems.push(`steering right did not move the player (x=${x1})`);
  await key('ArrowLeft', 'down');
  await sleep(700);
  await key('ArrowLeft', 'up');
  const x2 = await evaluate('__pulse.sim.player.x');
  if (!(x2 < x1)) problems.push(`steering left did not move the player (x=${x2})`);
  await key('Space');
  await sleep(120);
  const y = await evaluate('__pulse.sim.player.y');
  if (!(y > 0.2)) problems.push(`jump did not lift the player (y=${y})`);
  await sleep(1500);
  await shot('02-desktop-playing');

  await key('Escape');
  await waitFor(async () => (await state()) === 'PAUSED', 1000, 'PAUSED');
  const zPaused = await evaluate('__pulse.sim.player.z');
  await sleep(800);
  const zStill = await evaluate('__pulse.sim.player.z');
  if (zStill !== zPaused) problems.push('player moved while paused');
  await shot('03-desktop-paused');
  await key('Escape');
  await waitFor(async () => (await state()) === 'PLAYING', 1000, 'resume');
  const zResumed = await evaluate('__pulse.sim.player.z');
  if (zResumed - zPaused > 2) problems.push(`resume jumped forward ${zResumed - zPaused} m`);

  // Let the run end on its own (no input), at most ~70 s.
  log('waiting for a crash...');
  await waitFor(async () => (await state()) === 'GAME_OVER', 70000, 'GAME_OVER');
  await sleep(1200);
  await shot('04-desktop-gameover');
  const best = await evaluate('__pulse.progression.data.bestScore');
  if (!(best > 0)) problems.push('best score not recorded');

  await key('Space');
  await waitFor(async () => (await state()) === 'PLAYING', 1500, 'restart');
  const z0 = await evaluate('__pulse.sim.player.z');
  if (z0 > 40) problems.push(`restart did not reset distance (z=${z0})`);
  await sleep(1000);
  await shot('05-desktop-restarted');

  // Reload: best score must persist.
  await load();
  const bestAfter = await evaluate('__pulse.progression.data.bestScore');
  if (bestAfter !== best) problems.push(`best score not persisted (${best} -> ${bestAfter})`);
  const menuBest = await evaluate('document.getElementById("menu-best").textContent');
  log('persisted best', bestAfter, 'menu shows', menuBest);

  // ---------------- phone portrait (touch) ----------------
  await setViewport(390, 844, true);
  await load();
  await shot('06-phone-menu');
  const play = await evaluate('(() => { const r = document.getElementById("btn-play").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: play.x, y: play.y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitFor(async () => (await state()) === 'PLAYING', 2000, 'PLAYING after tap');
  await sleep(800);
  // Drag to steer right.
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 600, id: 1 }] });
  for (let i = 1; i <= 6; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120 + i * 12, y: 600, id: 1 }] });
    await sleep(40);
  }
  await sleep(400);
  const tx = await evaluate('__pulse.sim.player.x');
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  if (!(tx > 0.5)) problems.push(`touch drag did not steer (x=${tx})`);
  const jumpVisible = await evaluate('!document.getElementById("btn-jump").hidden');
  if (!jumpVisible) problems.push('jump button not visible on touch device');
  const jb = await evaluate('(() => { const r = document.getElementById("btn-jump").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jb.x, y: jb.y, id: 2 }] });
  await sleep(100);
  const ty = await evaluate('__pulse.sim.player.y');
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  if (!(ty > 0.1)) problems.push(`jump button did not jump (y=${ty})`);
  await sleep(1000);
  await shot('07-phone-playing');

  // ---------------- phone landscape ----------------
  await setViewport(844, 390, true);
  await sleep(500);
  await shot('08-phone-landscape-playing');
  const cw = await evaluate('[__pulse.renderer.cssW, __pulse.renderer.cssH]');
  if (cw[0] !== 844 || cw[1] !== 390) problems.push(`resize not applied: ${cw}`);

  // Hidden tab -> auto pause.
  await evaluate('Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); true');
  if ((await state()) !== 'PAUSED') problems.push('did not pause when the tab became hidden');

  const perf = await evaluate('({ quality: __pulse.renderer.quality, frame: __pulse.frameTimes.avg, particles: __pulse.particles.count, obstacles: __pulse.sim.track.obstacles.length })');
  log('perf', JSON.stringify(perf));
}

let code = 0;
try {
  await run();
} catch (e) {
  problems.push(`smoke script error: ${e.stack || e}`);
}
if (problems.length) {
  code = 1;
  console.error('SMOKE PROBLEMS:\n- ' + problems.join('\n- '));
} else {
  log('all checks passed; screenshots in', outDir);
}
try {
  ws?.close();
} catch {
  /* ignore */
}
chrome.kill();
server.kill();
process.exit(code);
