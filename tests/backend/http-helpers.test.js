import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCookieHeader, serializeCookie, appendSetCookie } from '../../src/middleware/cookies.js';
import { createRateLimiter } from '../../src/middleware/rateLimit.js';
import { originCheck, requireJsonBody, csrfProtect, csrfProtectIfAuthed } from '../../src/middleware/csrf.js';
import { requireAdmin, passwordChangeGate } from '../../src/middleware/authz.js';
import { sessionCookieOptions } from '../../src/middleware/session.js';
import { loadConfig } from '../../src/config/index.js';

const hdr = (h = {}) => ({ get: (n) => h[n.toLowerCase()], method: h.method ?? 'POST' });
const run = (mw, req) => { let out; mw(req, {}, (e) => { out = e ?? 'next'; }); return out; };

test('cookie parsing is tolerant and safe; serialisation sets the expected attributes', () => {
  const c = parseCookieHeader('a=1; b="two"; bad; =x; c=%E0%A4%A; d=%20hi; a=second');
  assert.equal(c.a, '1', 'first wins'); assert.equal(c.b, 'two'); assert.equal(c.d, ' hi'); assert.ok(!('bad' in c) && !('c' in c));
  assert.deepEqual(Object.keys(parseCookieHeader('x'.repeat(5000))), [], 'oversized header ignored'); assert.equal(Object.getPrototypeOf(parseCookieHeader('a=1')), null, 'no prototype pollution surface');
  assert.equal(parseCookieHeader('__proto__=x').__proto__, 'x');
  const s = serializeCookie('__Host-sid', 'a b', { maxAge: 3600.9, secure: true }); assert.match(s, /^__Host-sid=a%20b; Path=\/; SameSite=Lax; Max-Age=3600; HttpOnly; Secure$/);
  assert.ok(!/Max-Age/.test(serializeCookie('x', 'y'))); assert.throws(() => serializeCookie('bad name', 'y')); assert.throws(() => serializeCookie('a=b', 'y'));
  assert.ok(!/\n|\r/.test(serializeCookie('x', 'a\r\nSet-Cookie: evil=1')), 'values are encoded (no header injection)');
});
test('appendSetCookie keeps earlier cookies', () => {
  const headers = {}; const res = { getHeader: (k) => headers[k], setHeader: (k, v) => { headers[k] = v; } };
  appendSetCookie(res, 'a=1'); appendSetCookie(res, 'b=2'); assert.deepEqual(headers['Set-Cookie'], ['a=1', 'b=2']);
});
test('session cookie options: user cookies persist, admin cookies end with the browser session; https gets Secure and __Host-', () => {
  const https = loadConfig({ APP_BASE_URL: 'https://hub.example.org' }); const user = sessionCookieOptions(https, 'user'); const admin = sessionCookieOptions(https, 'admin');
  assert.equal(user.secure, true); assert.equal(user.httpOnly, true); assert.equal(user.sameSite, 'Lax'); assert.equal(user.maxAge, 14 * 86400); assert.equal(admin.maxAge, undefined); assert.equal(user.path, '/');
});
test('rate limiter: fixed window per key, resets, independent keys, bounded memory', () => {
  let t = 0; const lim = createRateLimiter({ name: 't', windowMs: 1000, max: 2, clock: () => t });
  const hit = (ip) => run(lim, { ip });
  assert.equal(hit('a'), 'next'); assert.equal(hit('a'), 'next'); const blocked = hit('a'); assert.equal(blocked.status, 429); assert.equal(blocked.headers['Retry-After'], '1');
  assert.equal(hit('b'), 'next'); t = 1001; assert.equal(hit('a'), 'next');
  const big = createRateLimiter({ name: 'big', windowMs: 1e9, max: 1, clock: () => 0 }); for (let i = 0; i < 60000; i++) run(big, { ip: `ip${i}` }); assert.equal(run(big, { ip: 'fresh' }), 'next', 'memory is capped, not unbounded');
});
test('originCheck and requireJsonBody', () => {
  const cfg = { origin: 'https://hub.example.org' }; const oc = originCheck(cfg);
  assert.equal(run(oc, hdr({ method: 'GET', origin: 'https://evil.example' })), 'next', 'safe methods are not checked');
  assert.equal(run(oc, hdr({ origin: 'https://hub.example.org' })), 'next'); assert.equal(run(oc, hdr({ origin: 'https://hub.example.org.evil.example' })).status, 403);
  assert.equal(run(oc, hdr({ origin: 'http://hub.example.org' })).status, 403, 'scheme must match'); assert.equal(run(oc, hdr({})), 'next', 'non-browser clients send neither header');
  assert.equal(run(oc, hdr({ 'sec-fetch-site': 'same-site' })).status, 403); assert.equal(run(oc, hdr({ 'sec-fetch-site': 'same-origin' })), 'next');
  assert.equal(run(requireJsonBody, hdr({ 'content-length': '5', 'content-type': 'text/plain' })).status, 415); assert.equal(run(requireJsonBody, hdr({ 'content-length': '5', 'content-type': 'application/json; charset=utf-8' })), 'next');
  assert.equal(run(requireJsonBody, hdr({ 'content-length': '0' })), 'next'); assert.equal(run(requireJsonBody, hdr({ 'content-length': '5', 'content-type': 'application/jsonx' })).status, 415);
});
test('csrfProtect, requireAdmin and passwordChangeGate decisions', () => {
  const auth = { csrfToken: 'tok', roles: ['student'], session: { kind: 'user' }, user: { mustChangePassword: false } };
  assert.equal(run(csrfProtect, { ...hdr({ 'x-csrf-token': 'tok' }), auth }), 'next'); assert.equal(run(csrfProtect, { ...hdr({ 'x-csrf-token': 'nope' }), auth }).code, 'csrf_failed');
  assert.equal(run(csrfProtect, { ...hdr({}), auth }).code, 'csrf_failed'); assert.equal(run(csrfProtect, { ...hdr({}), auth: null }).status, 401); assert.equal(run(csrfProtectIfAuthed, { ...hdr({}), auth: null }), 'next');
  assert.equal(run(requireAdmin, { auth: null }).status, 401); assert.equal(run(requireAdmin, { auth }).status, 403);
  assert.equal(run(requireAdmin, { auth: { ...auth, roles: ['admin'], session: { kind: 'user' } } }).status, 403, 'admin role without an admin-kind session is refused');
  assert.equal(run(requireAdmin, { auth: { ...auth, roles: ['admin'], session: { kind: 'admin' } } }), 'next');
  assert.equal(run(passwordChangeGate, { auth }), 'next'); assert.equal(run(passwordChangeGate, { auth: { ...auth, user: { mustChangePassword: true } } }).code, 'password_change_required'); assert.equal(run(passwordChangeGate, { auth: null }), 'next');
});
