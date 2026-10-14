// Lightweight lint: syntax-checks every source/test/script file and flags a few
// project rules (no stray console.log or debugger in shipped source).
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dirs = ['src', 'tests', 'scripts'];
const problems = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else if (/\.(m?js)$/.test(e.name)) files.push(p);
  }
  return files;
}

let count = 0;
for (const d of dirs) {
  for (const file of await walk(join(root, d))) {
    count++;
    const rel = relative(root, file).replaceAll('\\', '/');
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (res.status !== 0) problems.push(`${rel}: syntax error\n${res.stderr}`);
    if (rel.startsWith('src/')) {
      const text = await readFile(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (/\bconsole\.log\(/.test(line)) problems.push(`${rel}:${i + 1}: console.log in shipped source`);
        if (/^\s*debugger\b/.test(line)) problems.push(`${rel}:${i + 1}: debugger statement`);
      });
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check: ${count} files OK`);
