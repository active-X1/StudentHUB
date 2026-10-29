// Runs every *.test.js under tests/ with the built-in runner. Enumerating files (instead of passing a
// directory or glob) behaves the same on Node 20 and 22. Extra args are passed to `node --test`.
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(path.join(root, 'tests')).filter((f) => f.endsWith('.test.js')).sort();
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit', cwd: root });
process.exit(r.status ?? 1);
