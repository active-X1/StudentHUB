// Exercises the real Express app over HTTP. Requires `npm install` (express + helmet); skipped when they are absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config/index.js';

let createApp = null; let skipReason = false;
try { await import('express'); await import('helmet'); ({ createApp } = await import('../../src/app.js')); }
catch (err) { if (err.code === 'ERR_MODULE_NOT_FOUND') skipReason = 'express/helmet are not installed (run npm install)'; else throw err; }

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const devConfig = loadConfig({ NODE_ENV: 'development' });
const prodConfig = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@localhost:5432/db', APP_BASE_URL: 'https://hub.example.org', SESSION_SECRET: 'k'.repeat(40), STORAGE_DIR: '/var/lib/student-hub' });
const adminOff = loadConfig({ NODE_ENV: 'development', ADMIN_UI_ENABLED: 'false' });

async function withServer(config, db, fn) {
  const server = await new Promise((resolve) => { const s = createApp({ config, db, logger }).listen(0, '127.0.0.1', () => resolve(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
}

test('health, security headers and JSON errors', { skip: skipReason }, async () => {
  await withServer(devConfig, null, async (base) => {
    const r = await fetch(`${base}/api/v1/health`); assert.equal(r.status, 200);
    assert.equal((await r.json()).status, 'ok');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-powered-by'), null); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('permissions-policy'), /camera=\(\)/); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('strict-transport-security'), null, 'no HSTS in development');
    assert.ok(r.headers.get('x-request-id'));

    const nf = await fetch(`${base}/api/v1/nope`); const body = await nf.json();
    assert.equal(nf.status, 404); assert.equal(body.error.code, 'not_found'); assert.ok(body.error.requestId);

    const bad = await fetch(`${base}/api/v1/health`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    assert.ok([400, 404].includes(bad.status)); // POST /health is not routed; malformed JSON is rejected before routing
    const big = await fetch(`${base}/api/v1/health`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'x'.repeat(200000) }) });
    assert.equal(big.status, 413);
  });
  await withServer(prodConfig, null, async (base) => {
    assert.match((await fetch(`${base}/api/v1/health`)).headers.get('strict-transport-security'), /max-age=31536000/);
  });
});

test('readiness follows the database', { skip: skipReason }, async () => {
  await withServer(devConfig, { ping: async () => {} }, async (base) => assert.equal((await fetch(`${base}/api/v1/health/ready`)).status, 200));
  await withServer(devConfig, { ping: async () => { throw new Error('down'); } }, async (base) => {
    const r = await fetch(`${base}/api/v1/health/ready`); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { status: 'unavailable', database: 'down' });
  });
});

test('static frontend: served with revalidation, dotfiles and traversal blocked', { skip: skipReason }, async () => {
  await withServer(devConfig, null, async (base) => {
    const home = await fetch(`${base}/`); assert.equal(home.status, 200); assert.match(home.headers.get('content-type'), /text\/html/); assert.equal(home.headers.get('cache-control'), 'no-cache');
    assert.equal((await fetch(`${base}/service-worker.js`)).status, 200);
    assert.equal((await fetch(`${base}/manifest.json`)).status, 200);
    const miss = await fetch(`${base}/nope.html`); assert.equal(miss.status, 404);
    assert.equal((await fetch(`${base}/assets/images/.gitkeep`)).status, 404, 'dotfiles must not be served');
    assert.notEqual((await fetch(`${base}/..%2f..%2fpackage.json`)).status, 200);
    assert.notEqual((await fetch(`${base}/%2e%2e/package.json`)).status, 200);
  });
});

test('admin UI: the sign-in shell is public, the dashboard module is never sent anonymously, and the flag hides everything', { skip: skipReason }, async () => {
  await withServer(devConfig, null, async (base) => {
    assert.equal((await fetch(`${base}/admin/`)).status, 200);
    assert.match((await fetch(`${base}/admin/`)).headers.get('x-robots-tag'), /noindex/);
    for (const p of ['/assets/js/pages/admin-dashboard.js', '/%61ssets/js/pages/admin-dashboard.js', '/ASSETS/JS/PAGES/ADMIN-DASHBOARD.JS']) assert.equal((await fetch(`${base}${p}`)).status, 404, p);
  });
  await withServer(adminOff, null, async (base) => {
    for (const p of ['/admin', '/admin/', '/ADMIN/', '/%61dmin/', '/assets/js/pages/admin.js']) assert.equal((await fetch(`${base}${p}`, { redirect: 'manual' })).status, 404, p);
    assert.equal((await fetch(`${base}/login.html`)).status, 200);
  });
});

test('API security wiring over real Express: cross-origin writes are refused and auth endpoints exist when a database is configured', { skip: skipReason }, async () => {
  const db = { query: async () => ({ rows: [] }), withTransaction: async () => { throw new Error('unused'); }, ping: async () => {} };
  await withServer(devConfig, db, async (base) => {
    const evil = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
    assert.equal(evil.status, 403);
    const form = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x=1' });
    assert.equal(form.status, 415);
    const session = await fetch(`${base}/api/v1/auth/session`); assert.equal((await session.json()).authenticated, false);
    assert.equal((await fetch(`${base}/api/v1/admin/me`)).status, 401);
  });
});

test('real Express: sign in, create an assignment, upload (raw body), download, and ownership checks', { skip: skipReason }, async () => {
  const { createMemoryStore } = await import('./helpers/memory-store.js'); const { addStudent, FAST, GOOD_PW } = await import('./helpers/setup.js');
  const { Jar, request } = await import('./helpers/client.js'); const { createLocalStorage } = await import('../../src/services/storage/local.js');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const path = await import('node:path'); const S = await import('./helpers/samples.js');
  const store = createMemoryStore(); await addStudent({ store }, { email: 'a@example.org' }); await addStudent({ store }, { email: 'b@example.org' });
  const storage = createLocalStorage({ dir: mkdtempSync(path.join(tmpdir(), 'express-store-')) });
  const cfg = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's'.repeat(48), APP_BASE_URL: 'http://localhost:3000' });
  const server = await new Promise((resolve) => { const sv = createApp({ config: cfg, db: null, logger, api: { store, storage, hasherParams: FAST } }).listen(0, '127.0.0.1', () => resolve(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`; const O = { Origin: cfg.origin }; // the Origin check compares with APP_BASE_URL
  try {
    const sign = async (email) => { const jar = new Jar(); const r = await request(base, 'POST', '/api/v1/auth/login', { json: { email, password: GOOD_PW }, jar, origin: false, headers: O }); assert.equal(r.status, 200); return { jar, csrf: r.body.csrfToken }; };
    const a = await sign('a@example.org'); const b = await sign('b@example.org'); const h = (u, extra = {}) => ({ jar: u.jar, origin: false, headers: { ...O, 'X-CSRF-Token': u.csrf, ...extra } });
    const created = await request(base, 'POST', '/api/v1/me/assignments', { ...h(a), json: { title: 'T', course: 'C', dueDate: '2026-07-01' } }); assert.equal(created.status, 201);
    const id = created.body.assignment.id;
    const up = await request(base, 'POST', `/api/v1/me/assignments/${id}/attachments`, { ...h(a, { 'Content-Type': 'application/octet-stream', 'X-Filename': 'p.png' }), raw: S.png() }); assert.equal(up.status, 201, JSON.stringify(up.body));
    const dl = await request(base, 'GET', `/api/v1/attachments/${up.body.attachment.id}`, h(a)); assert.equal(dl.status, 200); assert.ok(dl.buffer.equals(S.png())); assert.match(dl.headers['content-disposition'], /^attachment/);
    assert.equal((await request(base, 'GET', `/api/v1/attachments/${up.body.attachment.id}`, h(b))).status, 404); assert.equal((await request(base, 'GET', `/api/v1/me/assignments/${id}`, h(b))).status, 404);
    const big = await request(base, 'POST', `/api/v1/me/assignments/${id}/attachments`, { ...h(a, { 'Content-Type': 'application/octet-stream', 'X-Filename': 'big.png' }), raw: Buffer.concat([S.png(), Buffer.alloc(5 * 1024 * 1024)]) }); assert.equal(big.status, 413);
    assert.equal((await request(base, 'PATCH', `/api/v1/me/assignments/${id}`, { ...h(a), json: { status: 'done' } })).body.assignment.status, 'done');
    assert.equal((await request(base, 'DELETE', `/api/v1/me/assignments/${id}`, h(a))).status, 200);
  } finally { await new Promise((r) => server.close(r)); }
});
