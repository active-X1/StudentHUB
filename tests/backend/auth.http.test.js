// End-to-end over HTTP: real route table + middleware + error handler (via the mini-app harness), memory store, fast hashing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMiniApp } from './helpers/mini-app.js';
import { Jar, request } from './helpers/client.js';
import { createMemoryStore } from './helpers/memory-store.js';
import { addStudent, addAdmin, FAST, GOOD_PW } from './helpers/setup.js';

const ADMIN_PW = 'Adm1n-Passphrase-2026!';
async function boot(opts = {}) {
  const store = opts.store ?? createMemoryStore();
  if (!opts.noUsers) { await addStudent({ store }); await addAdmin({ store }); }
  const app = await startMiniApp({ store, hasherParams: FAST, ...opts });
  const api = (method, path, o = {}) => request(app.url, method, `/api/v1${path}`, o);
  return { app, store, api, close: () => app.close() };
}
async function signIn(api, email = 'amara@example.org', password = GOOD_PW) { const jar = new Jar(); const r = await api('POST', '/auth/login', { json: { email, password }, jar }); return { jar, r, csrf: r.body.csrfToken }; }
const cookieAttrs = (setCookie) => Object.fromEntries(setCookie.split(';').slice(1).map((a) => { const [k, v] = a.trim().split('='); return [k.toLowerCase(), v ?? true]; }));

test('session endpoint: anonymous callers learn only which sign-in options exist', async () => {
  const t = await boot(); try {
    const r = await t.api('GET', '/auth/session'); assert.equal(r.status, 200); assert.deepEqual(r.body, { authenticated: false, features: { google: false, github: false, allowedEmailDomains: [] } });
    assert.deepEqual(r.setCookies, []); assert.equal(r.headers['cache-control'], 'no-store');
  } finally { await t.close(); }
});
test('register -> session cookie is HttpOnly + SameSite=Lax, the response never contains secrets, and /session reflects the login', async () => {
  const t = await boot(); try {
    const jar = new Jar(); const r = await t.api('POST', '/auth/register', { json: { name: 'Kemi Adeyemi', email: 'kemi@example.org', password: 'Zebra-Quartz-77!x' }, jar });
    assert.equal(r.status, 201); assert.equal(r.body.user.email, 'kemi@example.org'); assert.equal(typeof r.body.csrfToken, 'string');
    assert.ok(!JSON.stringify(r.body).match(/scrypt|passwordHash|lockedUntil|failedLogin/));
    const a = cookieAttrs(r.setCookies[0]); assert.ok(r.setCookies[0].startsWith('sid=')); assert.equal(a.httponly, true); assert.equal(a.samesite, 'Lax'); assert.equal(a.path, '/'); assert.ok(Number(a['max-age']) > 86400); assert.equal(a.secure, undefined, 'http test origin');
    const s = await t.api('GET', '/auth/session', { jar }); assert.equal(s.body.authenticated, true); assert.equal(s.body.user.name, 'Kemi Adeyemi'); assert.equal(s.body.csrfToken, r.body.csrfToken);
    const dup = await t.api('POST', '/auth/register', { json: { name: 'Mallory', email: 'KEMI@example.org', password: 'Zebra-Quartz-77!x' } }); assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'registration_failed');
  } finally { await t.close(); }
});
test('login: failures are uniform 401s without cookies; success sets a new session; garbage input never causes a 500', async () => {
  const t = await boot(); try {
    for (const json of [{ email: 'amara@example.org', password: 'wrong' }, { email: 'ghost@example.org', password: GOOD_PW }, { email: {}, password: [] }, {}, { email: 'amara@example.org' }, { email: 5, password: 5 }]) {
      const r = await t.api('POST', '/auth/login', { json }); assert.equal(r.status, 401, JSON.stringify(json)); assert.equal(r.body.error.code, 'invalid_credentials'); assert.deepEqual(r.setCookies, []);
    }
    assert.equal((await t.api('POST', '/auth/login', { raw: '{not json', headers: {} })).body.error.code, 'invalid_json');
    assert.equal((await t.api('POST', '/auth/login', { raw: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200000) }) })).status, 413);
    assert.equal((await signIn(t.api)).r.status, 200);
  } finally { await t.close(); }
});
test('CSRF defences: foreign Origin, cross-site fetch metadata, non-JSON bodies, and missing/forged tokens are all refused', async () => {
  const t = await boot(); try {
    const body = { email: 'amara@example.org', password: GOOD_PW };
    assert.equal((await t.api('POST', '/auth/login', { json: body, origin: false, headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await t.api('POST', '/auth/login', { json: body, origin: false, headers: { Origin: 'null' } })).status, 403);
    assert.equal((await t.api('POST', '/auth/login', { json: body, origin: false, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await t.api('POST', '/auth/login', { json: body, origin: false, headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200, 'same-origin fetch metadata is fine without an Origin header');
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const r = await t.api('POST', '/auth/login', { raw: 'email=amara%40example.org&password=x', headers: { 'Content-Type': type } }); assert.equal(r.status, 415, type);
    }
    const { jar, csrf } = await signIn(t.api);
    assert.equal((await t.api('POST', '/auth/logout', { jar })).body.error.code, 'csrf_failed');
    assert.equal((await t.api('POST', '/auth/logout', { jar, headers: { 'X-CSRF-Token': 'forged' } })).status, 403);
    assert.equal((await t.api('GET', '/auth/session', { jar })).body.authenticated, true, 'still signed in after refused logouts');
    const ok = await t.api('POST', '/auth/logout', { jar, headers: { 'X-CSRF-Token': csrf } }); assert.equal(ok.status, 200); assert.equal((await t.api('GET', '/auth/session', { jar })).body.authenticated, false);
    assert.equal((await t.api('POST', '/auth/logout', { jar: new Jar() })).status, 200, 'logging out without a session is a harmless no-op');
  } finally { await t.close(); }
});
test('a CSRF token is bound to its own session', async () => {
  const t = await boot(); try {
    const a = await signIn(t.api); const b = await signIn(t.api);
    assert.notEqual(a.csrf, b.csrf); assert.equal((await t.api('POST', '/auth/logout', { jar: a.jar, headers: { 'X-CSRF-Token': b.csrf } })).status, 403);
  } finally { await t.close(); }
});
test('stale or forged session cookies are cleared and grant nothing', async () => {
  const t = await boot(); try {
    const jar = new Jar(); jar.cookies.set('sid', 'A'.repeat(43));
    const r = await t.api('GET', '/auth/session', { jar }); assert.equal(r.body.authenticated, false); assert.match(r.setCookies[0], /^sid=; .*Max-Age=0/);
    assert.equal((await t.api('GET', '/admin/me', { jar })).status, 401);
  } finally { await t.close(); }
});
test('change password over HTTP: CSRF required, validation errors per field, other sessions revoked', async () => {
  const t = await boot(); try {
    const a = await signIn(t.api); const b = await signIn(t.api); const NEW = 'Fresh-Passw0rd-42!';
    const send = (json, headers = { 'X-CSRF-Token': a.csrf }) => t.api('POST', '/auth/password', { json, jar: a.jar, headers });
    assert.equal((await t.api('POST', '/auth/password', { json: { currentPassword: GOOD_PW, newPassword: NEW } })).status, 401);
    assert.equal((await send({ currentPassword: GOOD_PW, newPassword: NEW }, {})).status, 403);
    const bad = await send({ currentPassword: 'wrong', newPassword: 'weak', confirmPassword: 'nope' }); assert.equal(bad.status, 422); assert.deepEqual(Object.keys(bad.body.error.details).sort(), ['confirmPassword', 'currentPassword', 'newPassword'].sort().filter((k) => bad.body.error.details[k]));
    assert.equal((await send({ currentPassword: GOOD_PW, newPassword: NEW, confirmPassword: NEW })).status, 200);
    assert.equal((await t.api('GET', '/auth/session', { jar: a.jar })).body.authenticated, true); assert.equal((await t.api('GET', '/auth/session', { jar: b.jar })).body.authenticated, false);
    assert.equal((await signIn(t.api, 'amara@example.org', GOOD_PW)).r.status, 401); assert.equal((await signIn(t.api, 'amara@example.org', NEW)).r.status, 200);
  } finally { await t.close(); }
});
test('rate limiting: the 11th registration from one address in an hour gets 429 with Retry-After', async () => {
  const t = await boot(); try {
    let last; for (let i = 0; i < 11; i++) last = await t.api('POST', '/auth/register', { json: { name: 'Bot', email: `bot${i}@example.org`, password: 'Zebra-Quartz-77!x' }, headers: { 'X-Test-IP': '192.0.2.200' } });
    assert.equal(last.status, 429); assert.equal(last.body.error.code, 'rate_limited'); assert.ok(Number(last.headers['retry-after']) > 0);
    assert.equal((await t.api('POST', '/auth/register', { json: { name: 'Human', email: 'human@example.org', password: 'Zebra-Quartz-77!x' }, headers: { 'X-Test-IP': '192.0.2.201' } })).status, 201, 'other addresses are unaffected');
  } finally { await t.close(); }
});

// ---------- admin ----------
test('admin API: anonymous 401, student 403, admin 200; admin cookie is a browser-session cookie', async () => {
  const t = await boot(); try {
    assert.equal((await t.api('GET', '/admin/me')).status, 401);
    const stu = await signIn(t.api); assert.equal((await t.api('GET', '/admin/me', { jar: stu.jar })).status, 403);
    const jar = new Jar(); const r = await t.api('POST', '/admin/auth/login', { json: { username: 'admin', password: ADMIN_PW }, jar });
    assert.equal(r.status, 200); assert.equal(r.body.sessionKind, 'admin'); assert.equal(cookieAttrs(r.setCookies[0])['max-age'], undefined, 'no Max-Age: ends with the browser session'); assert.equal(cookieAttrs(r.setCookies[0]).httponly, true);
    const me = await t.api('GET', '/admin/me', { jar }); assert.equal(me.status, 200); assert.deepEqual(me.body.user.roles, ['admin']);
    assert.equal((await t.api('POST', '/auth/login', { json: { email: 'admin@example.org', password: ADMIN_PW } })).status, 401, 'admin cannot use the student sign-in');
  } finally { await t.close(); }
});
test('admin lockout over HTTP: 3 wrong passwords -> 423 + Retry-After; the right password is refused afterwards, from another client too', async () => {
  const t = await boot(); try {
    const wrong = (ip) => t.api('POST', '/admin/auth/login', { json: { username: 'admin', password: 'definitely-wrong' }, headers: { 'X-Test-IP': ip } });
    const r1 = await wrong('10.0.0.1'); assert.equal(r1.status, 401); assert.equal(r1.body.error.details.attemptsRemaining, 2);
    assert.equal((await wrong('10.0.0.2')).body.error.details.attemptsRemaining, 1);
    const r3 = await wrong('10.0.0.3'); assert.equal(r3.status, 423); assert.equal(r3.body.error.code, 'sign_in_paused'); assert.ok(Date.parse(r3.body.error.details.lockedUntil) > Date.now()); assert.ok(Number(r3.headers['retry-after']) > 0);
    const jar = new Jar(); const good = await t.api('POST', '/admin/auth/login', { json: { username: 'admin', password: ADMIN_PW }, jar, headers: { 'X-Test-IP': '10.9.9.9' } });
    assert.equal(good.status, 423); assert.deepEqual(jar.cookies.size, 0); assert.equal((await t.api('GET', '/admin/me', { jar })).status, 401);
    const ghost = []; for (let i = 0; i < 3; i++) ghost.push(await t.api('POST', '/admin/auth/login', { json: { username: 'ghost', password: 'nope' }, headers: { 'X-Test-IP': `10.1.0.${i}` } }));
    assert.deepEqual(ghost.map((g) => g.status), [401, 401, 423], 'unknown usernames follow the same sequence');
  } finally { await t.close(); }
});
test('forced password change: a bootstrapped admin can only change the password or sign out until they do', async () => {
  const store = createMemoryStore(); await addAdmin({ store }, { mustChangePassword: true }); const t = await boot({ store, noUsers: true }); try {
    const jar = new Jar(); const r = await t.api('POST', '/admin/auth/login', { json: { username: 'admin', password: ADMIN_PW }, jar }); assert.equal(r.status, 200); assert.equal(r.body.user.mustChangePassword, true);
    const blocked = await t.api('GET', '/admin/me', { jar }); assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'password_change_required');
    assert.equal((await t.api('GET', '/auth/session', { jar })).body.user.mustChangePassword, true, 'session info stays reachable so the UI can show the change form');
    const short = await t.api('POST', '/auth/password', { json: { currentPassword: ADMIN_PW, newPassword: 'Short-Pass-1!' }, jar, headers: { 'X-CSRF-Token': r.body.csrfToken } }); assert.equal(short.status, 422);
    assert.equal((await t.api('POST', '/auth/password', { json: { currentPassword: ADMIN_PW, newPassword: 'A-Much-Longer-Passphrase-9!' }, jar, headers: { 'X-CSRF-Token': r.body.csrfToken } })).status, 200);
    assert.equal((await t.api('GET', '/admin/me', { jar })).status, 200, 'unblocked once the password is changed');
  } finally { await t.close(); }
});
test('admin dashboard module: served only to admin sessions, however the path is spelled; the sign-in shell stays public', async () => {
  const t = await boot(); try {
    const stu = await signIn(t.api); const adm = new Jar(); await t.api('POST', '/admin/auth/login', { json: { username: 'admin', password: ADMIN_PW }, jar: adm });
    const get = (path, jar) => request(t.app.url, 'GET', path, { jar });
    const variants = ['/assets/js/pages/admin-dashboard.js', '/%61ssets/js/pages/admin-dashboard.js', '/ASSETS/JS/PAGES/ADMIN-DASHBOARD.JS', '/assets/js/pages/%2e%2e/pages/admin-dashboard.js', '/assets//js/pages/admin-dashboard.js'];
    for (const v of variants) { assert.equal((await get(v)).status, 404, `anonymous ${v}`); assert.equal((await get(v, stu.jar)).status, 404, `student ${v}`); }
    assert.equal((await get(variants[0], adm)).status, 200); assert.equal((await get(variants[1], adm)).status, 200);
    assert.equal((await get('/admin/')).status, 200, 'sign-in shell is public'); assert.equal((await get('/login.html')).status, 200);
  } finally { await t.close(); }
});
test('ADMIN_UI_ENABLED=false hides every admin UI path, even from admins', async () => {
  const t = await boot({ env: { ADMIN_UI_ENABLED: 'false' } }); try {
    const adm = new Jar(); await t.api('POST', '/admin/auth/login', { json: { username: 'admin', password: ADMIN_PW }, jar: adm });
    for (const p of ['/admin/', '/admin', '/ADMIN/', '/assets/js/pages/admin.js', '/assets/js/pages/admin-dashboard.js']) assert.equal((await request(t.app.url, 'GET', p, { jar: adm })).status, 404, p);
  } finally { await t.close(); }
});

// ---------- OAuth over HTTP ----------
test('OAuth routes: unavailable when not configured; configured flow redirects, validates state, signs in, clears the state cookie', async () => {
  const off = await boot(); try { const r = await request(off.app.url, 'GET', '/api/v1/auth/google'); assert.equal(r.status, 404); assert.equal(r.body.error.code, 'provider_unavailable'); } finally { await off.close(); }
  const fetchFn = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('token') ? { access_token: 't' } : { sub: 'g-9', email: 'newbie@example.org', email_verified: true, name: 'New Bie' }) });
  const t = await boot({ env: { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' }, fetchFn }); try {
    assert.equal((await t.api('GET', '/auth/session')).body.features.google, true);
    const jar = new Jar(); const start = await t.api('GET', '/auth/google', { jar }); assert.equal(start.status, 302); const loc = new URL(start.headers.location); assert.equal(loc.host, 'accounts.google.com');
    assert.ok(start.setCookies[0].startsWith('oauth=')); assert.match(start.setCookies[0], /HttpOnly/); assert.equal(start.headers['cache-control'], 'no-store');
    const state = loc.searchParams.get('state');
    const forged = await t.api('GET', `/auth/google/callback?code=abc&state=${state}`, { jar: new Jar() }); assert.equal(forged.status, 302); assert.equal(forged.headers.location, '/login.html?error=oauth_state_invalid');
    assert.equal((await t.api('GET', '/auth/google/callback?error=access_denied', { jar })).headers.location, '/login.html?error=oauth_denied');
    const jar2 = new Jar(); const start2 = await t.api('GET', '/auth/google', { jar: jar2 }); const state2 = new URL(start2.headers.location).searchParams.get('state');
    const done = await t.api('GET', `/auth/google/callback?code=abc&state=${state2}`, { jar: jar2 }); assert.equal(done.status, 302); assert.equal(done.headers.location, '/index.html#/home');
    assert.ok(done.setCookies.some((c) => c.startsWith('sid=') && /HttpOnly/.test(c))); assert.equal(jar2.get('oauth'), undefined, 'state cookie is single-use');
    const s = await t.api('GET', '/auth/session', { jar: jar2 }); assert.equal(s.body.user.email, 'newbie@example.org'); assert.deepEqual(s.body.user.oauthProviders, ['google']); assert.equal(s.body.user.signInMethod, 'oauth');
    assert.equal((await t.api('GET', `/auth/google/callback?code=abc&state=${state2}`, { jar: jar2 })).headers.location, '/login.html?error=oauth_state_invalid', 'a state cannot be replayed');
    const pw = await t.api('POST', '/auth/password', { json: { currentPassword: 'x', newPassword: 'Fresh-Passw0rd-42!' }, jar: jar2, headers: { 'X-CSRF-Token': s.body.csrfToken } }); assert.equal(pw.body.error.code, 'no_password');
  } finally { await t.close(); }
});
