// Behavioural contract every auth store must satisfy (memory store always; PostgreSQL store when a database is available).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DuplicateError } from '../../../src/models/pgStore.js';

const T0 = new Date('2026-06-01T10:00:00Z'); const at = (ms) => new Date(T0.getTime() + ms);
const hash = (s) => createHash('sha256').update(s).digest();
let n = 0; const uniq = (p) => `${p}${process.pid}${Date.now() % 1e6}${++n}`;

export function runStoreContract(test, label, makeStore) {
  const withStore = (name, fn) => test(`${label}: ${name}`, async () => { const { store, cleanup } = await makeStore(); try { await fn(store); } finally { await cleanup?.(); } });
  const mkUser = (store, extra = {}) => store.createUser({ email: `${uniq('u')}@example.org`, displayName: 'Test User', passwordHash: '$scrypt$x', role: 'student', ...extra });

  withStore('creates users with their role; lookups ignore case', async (s) => {
    const email = `${uniq('Case')}@Example.org`; const u = await s.createUser({ email, displayName: 'A', passwordHash: 'h', role: 'student' });
    assert.deepEqual(u.roles, ['student']); assert.equal(u.status, 'active'); assert.equal(u.failedLoginCount, 0); assert.equal(u.lockedUntil, null);
    assert.equal((await s.findUserByEmail(email.toUpperCase())).id, u.id); assert.equal((await s.findUserById(u.id)).email, email);
    assert.equal(await s.findUserByEmail('nobody@example.org'), null); assert.equal(await s.findUserById('00000000-0000-4000-8000-0000000000aa'), null);
  });
  withStore('rejects duplicate email/username and unknown roles', async (s) => {
    const email = `${uniq('dup')}@example.org`; await s.createUser({ email, displayName: 'A', role: 'student' });
    await assert.rejects(s.createUser({ email: email.toUpperCase(), displayName: 'B', role: 'student' }), (e) => e instanceof DuplicateError && e.field === 'email');
    const username = uniq('adm').toLowerCase(); await s.createUser({ username, displayName: 'Admin', role: 'admin', passwordHash: 'h' });
    assert.equal((await s.findUserByUsername(username.toUpperCase())).username, username);
    await assert.rejects(s.createUser({ username, displayName: 'B', role: 'admin' }), (e) => e instanceof DuplicateError && e.field === 'username');
    await assert.rejects(s.createUser({ email: `${uniq('r')}@example.org`, displayName: 'C', role: 'wizard' }), /Unknown role/);
  });
  withStore('counts admins', async (s) => {
    const before = await s.countAdmins(); await s.createUser({ username: uniq('boss').toLowerCase(), displayName: 'Boss', role: 'admin', passwordHash: 'h' });
    assert.equal(await s.countAdmins(), before + 1);
  });
  withStore('OAuth users are created atomically with their identity', async (s) => {
    const pid = uniq('g-'); const email = `${uniq('o')}@example.org`;
    const u = await s.createUser({ email, displayName: 'Oauth', role: 'student', emailVerifiedAt: T0, oauth: { provider: 'google', providerUserId: pid, providerEmail: email } });
    assert.equal((await s.findUserByOAuthIdentity('google', pid)).id, u.id); assert.equal(await s.findUserByOAuthIdentity('github', pid), null);
    assert.equal(u.passwordHash, null); assert.deepEqual(await s.listOAuthProviders(u.id), ['google']); assert.deepEqual(await s.listOAuthProviders(await mkUser(s).then((x) => x.id)), []);
    const email2 = `${uniq('o2')}@example.org`;
    await assert.rejects(s.createUser({ email: email2, displayName: 'Twin', role: 'student', oauth: { provider: 'google', providerUserId: pid } }), (e) => e instanceof DuplicateError && e.field === 'oauth_identity');
    assert.equal(await s.findUserByEmail(email2), null, 'a failed identity insert must not leave a half-created user behind');
  });
  withStore('setPassword replaces the hash and clears the forced-change flag', async (s) => {
    const u = await mkUser(s, { mustChangePassword: true }); assert.equal(u.mustChangePassword, true);
    await s.setPassword(u.id, '$scrypt$new'); const after = await s.findUserById(u.id);
    assert.equal(after.passwordHash, '$scrypt$new'); assert.equal(after.mustChangePassword, false);
  });
  withStore('failed-login accounting: counts, locks at the limit, restarts after the lock expires, success resets', async (s) => {
    const u = await mkUser(s); const lockUntil = at(14 * 3600e3);
    const f = (ms) => s.registerFailedLogin(u.id, { now: at(ms), max: 3, lockUntil });
    assert.deepEqual(await f(0), { failedCount: 1, lockedUntil: null });
    assert.deepEqual(await f(1000), { failedCount: 2, lockedUntil: null });
    const third = await f(2000); assert.equal(third.failedCount, 3); assert.equal(third.lockedUntil.getTime(), lockUntil.getTime());
    assert.equal((await s.findUserById(u.id)).lockedUntil.getTime(), lockUntil.getTime(), 'persisted on the user');
    const after = await f(15 * 3600e3); assert.deepEqual(after, { failedCount: 1, lockedUntil: null }, 'an expired lock restarts the counter');
    await f(15 * 3600e3 + 1); await s.registerSuccessfulLogin(u.id, at(16 * 3600e3));
    const ok = await s.findUserById(u.id); assert.equal(ok.failedLoginCount, 0); assert.equal(ok.lockedUntil, null); assert.equal(ok.lastLoginAt.getTime(), at(16 * 3600e3).getTime());
  });
  withStore('sessions: create, find by hash, touch, revoke, revoke-all-except, expiry cleanup', async (s) => {
    const u = await mkUser(s); const h1 = hash(uniq('t1')); const h2 = hash(uniq('t2')); const h3 = hash(uniq('t3'));
    const s1 = await s.createSession({ userId: u.id, tokenHash: h1, kind: 'user', expiresAt: at(3600e3), ip: '203.0.113.5', userAgent: 'UA' });
    const s2 = await s.createSession({ userId: u.id, tokenHash: h2, kind: 'admin', expiresAt: at(3600e3) });
    const found = await s.findSessionByTokenHash(h1); assert.equal(found.session.id, s1.id); assert.equal(found.session.kind, 'user'); assert.equal(found.user.id, u.id); assert.deepEqual(found.user.roles, ['student']);
    assert.equal((await s.findSessionByTokenHash(h2)).session.kind, 'admin'); assert.equal(await s.findSessionByTokenHash(hash('nope')), null);
    await s.touchSession(s1.id, at(5000)); assert.equal((await s.findSessionByTokenHash(h1)).session.lastSeenAt.getTime(), at(5000).getTime());
    await s.revokeUserSessions(u.id, s1.id, at(6000));
    assert.equal((await s.findSessionByTokenHash(h1)).session.revokedAt, null, 'the kept session survives'); assert.ok((await s.findSessionByTokenHash(h2)).session.revokedAt, 'the others are revoked');
    await s.revokeSession(s1.id, at(7000)); assert.ok((await s.findSessionByTokenHash(h1)).session.revokedAt);
    await s.createSession({ userId: u.id, tokenHash: h3, kind: 'user', expiresAt: at(-1000) }); await s.deleteExpiredSessions(at(0));
    assert.equal(await s.findSessionByTokenHash(h3), null, 'expired sessions are deleted'); assert.ok(await s.findSessionByTokenHash(h1), 'recently revoked sessions are kept for a week');
    assert.equal(s2.kind, 'admin');
  });
  withStore('login attempts: failures counted per identifier / ip / admin-ness / window', async (s) => {
    const idA = hash(uniq('idA')); const idB = hash(uniq('idB')); const ip = '198.51.100.7';
    const rec = (identifierHash, succeeded, isAdmin, ms, ipAddr = ip) => s.recordLoginAttempt({ identifierHash, ip: ipAddr, succeeded, isAdmin, now: at(ms), userId: null });
    await rec(idA, false, true, 0); await rec(idA, false, true, 1000); await rec(idA, true, true, 2000); await rec(idA, false, false, 3000); await rec(idB, false, true, 4000, '198.51.100.8');
    assert.equal(await s.countRecentFailures({ identifierHash: idA, since: at(-1), isAdmin: true }), 2, 'successes and non-admin attempts are not counted');
    assert.equal(await s.countRecentFailures({ identifierHash: idA, since: at(500), isAdmin: true }), 1, 'window start is respected');
    assert.equal(await s.countRecentFailures({ identifierHash: idA, since: at(-1), isAdmin: false }), 1);
    assert.equal(await s.countRecentFailures({ ip, since: at(-1), isAdmin: true }), 2, 'by ip'); assert.equal(await s.countRecentFailures({ identifierHash: idB, since: at(-1), isAdmin: true }), 1);
    assert.equal(await s.countRecentFailures({ since: at(-1), isAdmin: true }), 0, 'no key matches nothing');
  });
  withStore('audit entries can be written', async (s) => {
    await s.writeAudit({ actorLabel: 'contract-test', action: 'did a thing', entityType: 'user', entityId: 'x', metadata: { a: 1 }, ip: '203.0.113.9' });
    await s.writeAudit({ actorLabel: 'contract-test', action: 'minimal' });
  });
}
