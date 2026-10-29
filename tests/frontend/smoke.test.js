import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../scripts/static-server.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUB = path.join(ROOT, 'public');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(PUB);
const byExt = (e) => files.filter((f) => f.endsWith(e));
const exists = (url) => existsSync(path.join(PUB, url.split(/[?#]/)[0]));

test('every JavaScript file has valid syntax', () => {
  for (const f of byExt('.js')) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}\n${r.stderr}`);
  }
});

test('HTML references and JS imports resolve to real files', () => {
  for (const f of byExt('.html')) {
    const src = readFileSync(f, 'utf8');
    for (const [, u] of src.matchAll(/(?:href|src)="(\/[^"#]*)"/g)) assert.ok(exists(u), `${path.relative(PUB, f)} -> ${u}`);
  }
  for (const f of byExt('.js').filter((x) => !x.endsWith('service-worker.js'))) {
    const src = readFileSync(f, 'utf8');
    for (const [, u] of src.matchAll(/(?:from|import\()\s*'(\.{1,2}\/[^']+)'/g)) {
      assert.ok(existsSync(path.resolve(path.dirname(f), u)), `${path.relative(PUB, f)} imports missing ${u}`);
    }
  }
});

test('service worker precache list exists, excludes admin, and manifest is valid', () => {
  const sw = readFileSync(path.join(PUB, 'service-worker.js'), 'utf8');
  const list = [...sw.matchAll(/^\s+'(\/[^']*)',?$/gm)].map((m) => m[1]);
  assert.ok(list.length > 20);
  for (const u of list.filter((x) => x !== '/')) assert.ok(exists(u), `precache missing ${u}`);
  assert.ok(!list.some((u) => u.includes('admin')), 'admin files must not be precached');
  const m = JSON.parse(readFileSync(path.join(PUB, 'manifest.json'), 'utf8'));
  for (const i of m.icons) assert.ok(exists(i.src), i.src);
});

test('no admin link in the student shell and no hard-coded secrets', () => {
  const shell = readFileSync(path.join(PUB, 'index.html'), 'utf8') + readFileSync(path.join(PUB, 'assets/js/components/navigation.js'), 'utf8');
  assert.ok(!/href="[^"]*admin/i.test(shell), 'student UI must not link to /admin');
  for (const f of [...byExt('.js'), ...byExt('.html')]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/(admin123|password123|BEGIN (RSA|PRIVATE)|client_secret\s*[:=]\s*['"][^'"]+['"])/i.test(src), `possible secret in ${f}`);
  }
});

test('server serves the app, /admin, and returns 404 / blocks traversal', async () => {
  const srv = createServer(); await new Promise((r) => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/admin`)).status, 200);
    assert.equal((await fetch(`${base}/nope.html`)).status, 404);
    assert.notEqual((await fetch(`${base}/..%2f..%2fpackage.json`)).status, 200);
  } finally { srv.close(); }
});

test('service worker precache list is in sync with the files on disk and never includes admin code', async () => {
  const { precacheList } = await import('../../scripts/generate-sw.js');
  const sw = readFileSync(path.join(PUB, 'service-worker.js'), 'utf8');
  const listed = [...sw.slice(sw.indexOf('PRECACHE:START'), sw.indexOf('PRECACHE:END')).matchAll(/'(\/[^']*)'/g)].map((m) => m[1]);
  assert.deepEqual(listed, precacheList(), 'run `npm run build:sw` after adding or removing frontend files');
  assert.ok(!listed.some((u) => /admin/i.test(u)));
  assert.ok(listed.includes('/assets/js/auth-client.js'));
});
