import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, addStudent, thrown, GOOD_PW } from './helpers/setup.js';
import { createOAuthService } from '../../src/services/oauth.js';
import { verifySigned, signValue } from '../../src/services/tokens.js';

const ENV = { APP_BASE_URL: 'https://hub.example.org', GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', GITHUB_CLIENT_ID: 'hid', GITHUB_CLIENT_SECRET: 'hsecret' };

/** Fake providers. `overrides` replace a response for a URL prefix; return null to simulate an HTTP error. */
function fakeFetch(overrides = {}) {
  const calls = [];
  const defaults = {
    'https://oauth2.googleapis.com/token': { access_token: 'gtok' },
    'https://openidconnect.googleapis.com/v1/userinfo': { sub: 'g-123', email: 'Amara@Example.org', email_verified: true, name: 'Amara Nwosu', picture: 'https://lh3.example/a.png' },
    'https://github.com/login/oauth/access_token': { access_token: 'ghtok' },
    'https://api.github.com/user/emails': [{ email: 'other@example.org', primary: false, verified: true }, { email: 'amara@example.org', primary: true, verified: true }],
    'https://api.github.com/user': { id: 42, login: 'amara', name: null, avatar_url: 'https://avatars.example/42' },
  };
  const table = { ...defaults, ...overrides };
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null });
    const key = Object.keys(table).sort((a, b) => b.length - a.length).find((k) => String(url).startsWith(k));
    const v = table[key]; if (v === null) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => v };
  };
  fn.calls = calls; return fn;
}
function make(env = {}, fetchOverrides = {}) {
  const c = setup({ env: { ...ENV, ...env } }); const fetchFn = fakeFetch(fetchOverrides); let ms = Date.now();
  const oauth = createOAuthService({ config: c.config, store: c.store, auth: c.auth, fetchFn, clock: () => ms });
  return { ...c, oauth, fetchFn, tick: (d) => { ms += d; } };
}
const stateOf = (url) => new URL(url).searchParams.get('state');

test('begin: exact redirect URI, state, PKCE for Google only, signed cookie bound to the provider', () => {
  const c = make();
  const g = c.oauth.begin('google'); const gu = new URL(g.url);
  assert.equal(gu.origin + gu.pathname, 'https://accounts.google.com/o/oauth2/v2/auth'); assert.equal(gu.searchParams.get('redirect_uri'), 'https://hub.example.org/api/v1/auth/google/callback');
  assert.equal(gu.searchParams.get('client_id'), 'gid'); assert.equal(gu.searchParams.get('code_challenge_method'), 'S256'); assert.ok(gu.searchParams.get('code_challenge')); assert.ok(!g.url.includes('gsecret'), 'client secret never appears in the URL');
  const saved = verifySigned(c.config.sessionSecret, g.cookieValue); assert.equal(saved.p, 'google'); assert.equal(saved.s, stateOf(g.url)); assert.ok(saved.v.length >= 43);
  const h = new URL(c.oauth.begin('github').url); assert.equal(h.searchParams.get('code_challenge'), null); assert.equal(h.searchParams.get('scope'), 'read:user user:email');
  assert.notEqual(stateOf(c.oauth.begin('google').url), stateOf(g.url), 'state is unique per attempt');
});
test('unknown or unconfigured providers are unavailable', () => {
  const c = make({ GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '' });
  for (const p of ['github', 'facebook', '__proto__', 'constructor']) assert.throws(() => c.oauth.begin(p), (e) => e.status === 404 && e.code === 'provider_unavailable');
});
test('google sign-in creates a verified student once, then signs the same user in again', async () => {
  const c = make(); const { url, cookieValue } = c.oauth.begin('google');
  const r = await c.oauth.complete('google', { code: 'abc', state: stateOf(url), cookieValue, ip: '203.0.113.4' });
  assert.equal(r.user.email, 'amara@example.org'); assert.deepEqual(r.user.roles, ['student']); assert.equal(r.user.passwordHash, null); assert.ok(r.user.emailVerifiedAt); assert.deepEqual(r.oauthProviders, ['google']);
  assert.ok(await c.sessions.authenticate(r.token));
  const tokenCall = c.fetchFn.calls.find((x) => x.url.includes('oauth2.googleapis.com')); assert.equal(tokenCall.body.client_secret, 'gsecret'); assert.ok(tokenCall.body.code_verifier); assert.equal(tokenCall.body.grant_type, 'authorization_code');
  assert.ok(c.fetchFn.calls.filter((x) => !x.url.includes('oauth2.googleapis.com')).every((x) => !JSON.stringify(x).includes('gsecret')), 'the secret goes only to the token endpoint');
  const again = c.oauth.begin('google'); const r2 = await c.oauth.complete('google', { code: 'def', state: stateOf(again.url), cookieValue: again.cookieValue });
  assert.equal(r2.user.id, r.user.id); assert.equal([...c.store._users.values()].length, 1);
});
test('github sign-in uses the primary verified email', async () => {
  const c = make(); const { url, cookieValue } = c.oauth.begin('github');
  const r = await c.oauth.complete('github', { code: 'abc', state: stateOf(url), cookieValue });
  assert.equal(r.user.email, 'amara@example.org'); assert.equal(r.user.displayName, 'amara'); assert.equal(c.fetchFn.calls.find((x) => x.url.includes('github.com/login/oauth/access_token')).body.code_verifier, undefined);
});
test('state protection: missing, mismatched, tampered, expired, replayed-for-another-provider cookies are all refused before any provider call', async () => {
  const c = make(); const g = c.oauth.begin('google'); const st = stateOf(g.url);
  const attempts = [
    { state: st, cookieValue: undefined }, { state: 'other', cookieValue: g.cookieValue }, { state: undefined, cookieValue: g.cookieValue },
    { state: st, cookieValue: g.cookieValue.slice(0, -2) + 'xx' }, { state: st, cookieValue: signValue('wrong-secret', { p: 'google', s: st, v: 'v', exp: Date.now() + 1e6 }) },
  ];
  for (const a of attempts) assert.equal((await thrown(c.oauth.complete('google', { code: 'abc', ...a }))).code, 'oauth_state_invalid');
  assert.equal((await thrown(c.oauth.complete('github', { code: 'abc', state: st, cookieValue: g.cookieValue }))).code, 'oauth_state_invalid', 'a Google state cannot complete a GitHub sign-in');
  assert.equal((await thrown(c.oauth.complete('google', { code: '', state: st, cookieValue: g.cookieValue }))).code, 'oauth_state_invalid');
  c.tick(11 * 60e3); assert.equal((await thrown(c.oauth.complete('google', { code: 'abc', state: st, cookieValue: g.cookieValue }))).code, 'oauth_state_invalid', 'expired after 10 minutes');
  assert.equal(c.fetchFn.calls.length, 0, 'no request was made to the provider');
});
test('unverified or missing provider email is refused', async () => {
  for (const [provider, override] of [['google', { 'https://openidconnect.googleapis.com/v1/userinfo': { sub: 'g1', email: 'a@example.org', email_verified: false } }],
    ['google', { 'https://openidconnect.googleapis.com/v1/userinfo': { sub: 'g1', email_verified: true } }], ['github', { 'https://api.github.com/user/emails': [{ email: 'a@example.org', primary: true, verified: false }] }], ['github', { 'https://api.github.com/user/emails': [] }]]) {
    const c = make({}, override); const { url, cookieValue } = c.oauth.begin(provider);
    const e = await thrown(c.oauth.complete(provider, { code: 'abc', state: stateOf(url), cookieValue })); assert.equal(e.status, 422); assert.equal(c.store._users.size, 0);
  }
});
test('an existing account with the same email is never silently linked or taken over', async () => {
  const c = make(); const stu = await addStudent(c, { email: 'amara@example.org' }); const { url, cookieValue } = c.oauth.begin('google');
  const e = await thrown(c.oauth.complete('google', { code: 'abc', state: stateOf(url), cookieValue })); assert.equal(e.status, 409); assert.equal(e.code, 'oauth_email_in_use');
  assert.deepEqual(await c.store.listOAuthProviders(stu.id), []); assert.ok(await c.auth.login({ email: 'amara@example.org', password: GOOD_PW }), 'the password account is untouched');
});
test('suspended and admin accounts cannot use OAuth; provider failures become 502', async () => {
  const c = make(); const first = c.oauth.begin('google'); const r = await c.oauth.complete('google', { code: 'a', state: stateOf(first.url), cookieValue: first.cookieValue });
  c.store._users.get(r.user.id).status = 'suspended'; let n = c.oauth.begin('google');
  assert.equal((await thrown(c.oauth.complete('google', { code: 'a', state: stateOf(n.url), cookieValue: n.cookieValue }))).status, 403);
  c.store._users.get(r.user.id).status = 'active'; c.store._users.get(r.user.id).roles = ['admin']; n = c.oauth.begin('google');
  assert.equal((await thrown(c.oauth.complete('google', { code: 'a', state: stateOf(n.url), cookieValue: n.cookieValue }))).code, 'oauth_not_allowed');
  for (const override of [{ 'https://oauth2.googleapis.com/token': null }, { 'https://oauth2.googleapis.com/token': {} }, { 'https://openidconnect.googleapis.com/v1/userinfo': null }]) {
    const d = make({}, override); const b = d.oauth.begin('google');
    assert.equal((await thrown(d.oauth.complete('google', { code: 'a', state: stateOf(b.url), cookieValue: b.cookieValue }))).status, 502);
  }
});
test('the institution email allow-list applies to OAuth sign-up', async () => {
  const c = make({ ALLOWED_EMAIL_DOMAINS: 'uni.example.edu' }); const { url, cookieValue } = c.oauth.begin('google');
  assert.match((await thrown(c.oauth.complete('google', { code: 'a', state: stateOf(url), cookieValue }))).details.email, /institution email/); assert.equal(c.store._users.size, 0);
});
