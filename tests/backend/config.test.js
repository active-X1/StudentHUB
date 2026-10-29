import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError, describeConfig } from '../../src/config/index.js';

const prodEnv = { NODE_ENV: 'production', DATABASE_URL: 'postgres://u:secretpw@db.internal:5432/hub', SESSION_SECRET: 'k'.repeat(40), APP_BASE_URL: 'https://hub.example.org' };

test('defaults are safe for development', () => {
  const c = loadConfig({});
  assert.equal(c.env, 'development'); assert.equal(c.port, 3000); assert.equal(c.timezone, 'UTC');
  assert.equal(c.trustProxy, false); assert.equal(c.adminUiEnabled, true); assert.equal(c.db.url, null);
  assert.equal(c.ephemeralSecret, true); assert.ok(c.sessionSecret.length >= 48); assert.ok(c.warnings.some((w) => /SESSION_SECRET/.test(w)));
});
test('production requires DATABASE_URL, a strong SESSION_SECRET and an https APP_BASE_URL', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /DATABASE_URL is required in production/);
  assert.throws(() => loadConfig({ ...prodEnv, SESSION_SECRET: '' }), /SESSION_SECRET is required in production/);
  assert.throws(() => loadConfig({ ...prodEnv, SESSION_SECRET: 'short' }), /at least 32 characters/);
  assert.throws(() => loadConfig({ ...prodEnv, APP_BASE_URL: 'http://hub.example.org' }), /must be https in production/);
  const c = loadConfig(prodEnv); assert.equal(c.isProd, true); assert.equal(c.ephemeralSecret, false); assert.equal(c.sessionSecret, prodEnv.SESSION_SECRET);
});
test('cookie names and flags follow the origin scheme (__Host- prefix only over https)', () => {
  assert.deepEqual({ ...loadConfig(prodEnv).cookies }, { secure: true, sessionName: '__Host-sid', oauthName: '__Host-oauth' });
  assert.deepEqual({ ...loadConfig({ APP_BASE_URL: 'http://localhost:3000' }).cookies }, { secure: false, sessionName: 'sid', oauthName: 'oauth' });
});
test('OAuth credentials must be set in pairs; providers are enabled only when complete', () => {
  assert.throws(() => loadConfig({ GOOGLE_CLIENT_ID: 'x' }), /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together/);
  const c = loadConfig({ GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b' }); assert.equal(c.oauth.github.enabled, true); assert.equal(c.oauth.google.enabled, false);
});
test('ALLOWED_EMAIL_DOMAINS is normalised and validated; ADMIN_UI_ENABLED toggles the admin UI', () => {
  assert.deepEqual([...loadConfig({ ALLOWED_EMAIL_DOMAINS: ' Uni.Example.edu , cs.example.edu ' }).allowedEmailDomains], ['uni.example.edu', 'cs.example.edu']);
  assert.throws(() => loadConfig({ ALLOWED_EMAIL_DOMAINS: 'not a domain' }), /invalid domain/); assert.throws(() => loadConfig({ ALLOWED_EMAIL_DOMAINS: '@uni.edu' }), /invalid domain/);
  assert.equal(loadConfig({ ADMIN_UI_ENABLED: 'false' }).adminUiEnabled, false); assert.throws(() => loadConfig({ ADMIN_UI_ENABLED: 'maybe' }), /ADMIN_UI_ENABLED/);
});
test('a production deployment without a domain allow-list gets a warning', () => { assert.ok(loadConfig(prodEnv).warnings.some((w) => /ALLOWED_EMAIL_DOMAINS/.test(w))); assert.ok(!loadConfig({ ...prodEnv, ALLOWED_EMAIL_DOMAINS: 'uni.example.edu' }).warnings.some((w) => /ALLOWED_EMAIL_DOMAINS/.test(w))); });
test('invalid values are all reported together', () => {
  try { loadConfig({ NODE_ENV: 'staging', PORT: 'abc', LOG_LEVEL: 'loud', SERVER_TIMEZONE: 'Mars/Base', DB_POOL_MAX: '0', DB_SSL: 'maybe', DATABASE_URL: 'mysql://x', SESSION_SECRET: 'short' }); assert.fail('should throw'); }
  catch (e) { assert.ok(e instanceof ConfigError); assert.ok(e.problems.length >= 8, e.message); }
});
test('TRUST_PROXY accepts hop counts and rejects "true"', () => {
  assert.equal(loadConfig({ TRUST_PROXY: '1' }).trustProxy, 1);
  assert.equal(loadConfig({ TRUST_PROXY: 'loopback' }).trustProxy, 'loopback');
  assert.throws(() => loadConfig({ TRUST_PROXY: 'true' }), /unsafe/);
});
test('valid time zones are accepted', () => { assert.equal(loadConfig({ SERVER_TIMEZONE: 'Africa/Lagos' }).timezone, 'Africa/Lagos'); });
test('describeConfig never exposes credentials', () => {
  const text = JSON.stringify(describeConfig(loadConfig(prodEnv)));
  assert.ok(!text.includes('secretpw') && !text.includes('u:') && !text.includes('kkkk'), text);
  assert.ok(!JSON.stringify(describeConfig(loadConfig({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'topsecret' }))).includes('topsecret'));
  assert.ok(text.includes('db.internal'));
});
test('config object is frozen', () => { assert.throws(() => { 'use strict'; loadConfig({}).port = 1; }, TypeError); });
