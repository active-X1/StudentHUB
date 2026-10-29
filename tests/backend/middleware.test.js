import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCspDirectives, cspHeaderValue } from '../../src/config/csp.js';
import { adminUiGate, isAdminUiPath } from '../../src/middleware/adminUiGate.js';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler.js';
import { requestId } from '../../src/middleware/requestId.js';
import { liveness, readiness } from '../../src/controllers/health.js';
import { AppError, validationError } from '../../src/utils/errors.js';

// Minimal fakes for Express req/res.
function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, locals: { requestId: 'req-12345678' }, headersSent: false,
    status(c) { this.statusCode = c; return this; }, set(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) this.headers[a.toLowerCase()] = b; else this.headers[k.toLowerCase()] = v; return this; },
    type() { return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } };
  return res;
}
const silent = { errors: [], error(m, f) { this.errors.push([m, f]); } };

test('CSP: no inline/eval script, no framing, no plugins; HTTPS upgrade only in production', () => {
  const dev = cspHeaderValue(buildCspDirectives({ isProd: false }));
  assert.match(dev, /script-src 'self'(;|$)/); assert.ok(!/unsafe-eval/.test(dev)); assert.match(dev, /frame-ancestors 'none'/);
  assert.match(dev, /object-src 'none'/); assert.match(dev, /script-src-attr 'none'/); assert.ok(!/upgrade-insecure-requests/.test(dev));
  assert.ok(!/script-src[^;]*unsafe-inline/.test(dev));
  assert.match(cspHeaderValue(buildCspDirectives({ isProd: true })), /upgrade-insecure-requests/);
});

test('admin UI path detection resists case, encoding and traversal tricks', () => {
  for (const p of ['/admin', '/admin/', '/ADMIN/', '/Admin/index.html', '/%61dmin/', '/a/../admin/', '//admin/', '\\admin\\', '/assets/js/pages/admin.js', '/ASSETS/js/pages/Admin.JS', '/assets/js/pages/../pages/admin.js', '/assets/js/pages/admin-dashboard.js', '/%41ssets/js/pages/admin-dashboard.js'])
    assert.ok(isAdminUiPath(p), p);
  for (const p of ['/', '/index.html', '/administrator', '/assets/js/pages/home.js', '/login.html']) assert.ok(!isAdminUiPath(p), p);
});
test('admin gate: 404 when disabled, noindex + no-store when enabled', () => {
  let nexted = false; const off = fakeRes();
  adminUiGate({ adminUiEnabled: false })({ path: '/admin/' }, off, () => { nexted = true; });
  assert.equal(off.statusCode, 404); assert.equal(nexted, false);
  const on = fakeRes(); adminUiGate({ adminUiEnabled: true })({ path: '/admin/' }, on, () => { nexted = true; });
  assert.ok(nexted); assert.match(on.headers['x-robots-tag'], /noindex/); assert.equal(on.headers['cache-control'], 'no-store');
  nexted = false; adminUiGate({ adminUiEnabled: false })({ path: '/index.html' }, fakeRes(), () => { nexted = true; }); assert.ok(nexted);
});

test('request id: keeps harmless inbound ids, replaces suspicious ones', () => {
  const run = (hdr) => { const res = fakeRes(); requestId({ get: () => hdr }, res, () => {}); return res.locals.requestId; };
  assert.equal(run('abc-12345678'), 'abc-12345678');
  assert.match(run('x\nInjected: log line'), /^[0-9a-f-]{36}$/); assert.match(run(undefined), /^[0-9a-f-]{36}$/);
});

test('error handler: AppError keeps its status/code, unknown errors are generic and logged', () => {
  const h = errorHandler(silent); const req = { method: 'GET', originalUrl: '/api/v1/x?token=abc' };
  let res = fakeRes(); h(validationError({ title: 'Required' }), req, res, () => {});
  assert.equal(res.statusCode, 422); assert.equal(res.body.error.code, 'validation_failed'); assert.deepEqual(res.body.error.details, { title: 'Required' });
  res = fakeRes(); h(new Error('connection string postgres://u:pw@host leaked'), req, res, () => {});
  assert.equal(res.statusCode, 500); assert.ok(!JSON.stringify(res.body).includes('postgres://'), 'must not leak internals');
  assert.equal(silent.errors.at(-1)[1].path, '/api/v1/x', 'query string must not be logged');
  res = fakeRes(); h(Object.assign(new Error('x'), { type: 'entity.too.large' }), req, res, () => {}); assert.equal(res.statusCode, 413);
  res = fakeRes(); h(Object.assign(new SyntaxError('bad'), { type: 'entity.parse.failed' }), req, res, () => {}); assert.equal(res.statusCode, 400);
  res = fakeRes(); h(new AppError(404, 'not_found', 'Nope'), req, res, () => {}); assert.equal(res.statusCode, 404);
});
test('not-found handler: JSON error for /api, plain text otherwise', () => {
  let err; notFoundHandler({ path: '/api/v1/nope' }, fakeRes(), (e) => { err = e; }); assert.equal(err.status, 404);
  const res = fakeRes(); notFoundHandler({ path: '/nope' }, res, () => assert.fail('should not call next')); assert.equal(res.statusCode, 404);
});

test('health: liveness is minimal; readiness reflects the database', async () => {
  let res = fakeRes(); liveness({}, res); assert.equal(res.body.status, 'ok'); assert.deepEqual(Object.keys(res.body).sort(), ['status', 'time', 'uptimeSeconds']);
  res = fakeRes(); await readiness(null)({}, res); assert.equal(res.body.database, 'not_configured');
  res = fakeRes(); await readiness({ ping: async () => {} })({}, res); assert.equal(res.statusCode, 200); assert.equal(res.body.database, 'up');
  res = fakeRes(); await readiness({ ping: async () => { throw new Error('secret host down'); } })({}, res);
  assert.equal(res.statusCode, 503); assert.ok(!JSON.stringify(res.body).includes('secret'));
  res = fakeRes(); await readiness({ ping: () => new Promise(() => {}) }, { timeoutMs: 20 })({}, res); assert.equal(res.statusCode, 503, 'hung database must time out');
});
