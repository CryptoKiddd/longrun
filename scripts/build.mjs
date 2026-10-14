// Production build: bundles the ES-module sources into one minified classic
// script so dist/ runs on any static host (including file:// and iframes).
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const result = await build({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outfile: resolve(out, 'game.js'),
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

const MODULE_TAG = '<script type="module" src="src/main.js"></script>';
const html = await readFile(resolve(root, 'index.html'), 'utf8');
if (!html.includes(MODULE_TAG)) {
  throw new Error(`index.html must contain exactly: ${MODULE_TAG}`);
}
await writeFile(resolve(out, 'index.html'), html.replace(MODULE_TAG, '<script defer src="game.js"></script>'));
await copyFile(resolve(root, 'styles.css'), resolve(out, 'styles.css'));

const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
console.log(`Build complete: dist/game.js ${(bytes / 1024).toFixed(1)} KiB`);
