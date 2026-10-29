import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, addStudent, addAdmin, thrown, GOOD_PW, FAST } from './helpers/setup.js';
import { createAuthService, toPublicUser } from '../../src/services/auth.js';
import { bootstrapAdmin } from '../../src/services/adminBootstrap.js';
import * as passwords from '../../src/services/passwords.js';

const ADMIN_PW = 'Adm1n-Passphrase-2026!';

// ---------- registration ----------
test('register: creates a student, stores only a hash, issues a session', async () => {
  const c = setup(); const r = await c.auth.register({ name: '  Amara   Nwosu ', email: ' Amara@Example.ORG ', password: GOOD_PW, ip: '203.0.113.1' });
  assert.equal(r.user.email, 'amara@example.org'); assert.equal(r.user.displayName, 'Amara Nwosu'); assert.deepEqual(r.user.roles, ['student']);
  assert.match(r.user.passwordHash, /^\$scrypt\$/); assert.ok(!r.user.passwordHash.includes(GOOD_PW)); assert.ok(r.token.length >= 40);
  assert.ok(await c.sessions.authenticate(r.token));
  const pub = toPublicUser(r.user); assert.ok(!('passwordHash' in pub) && !('lockedUntil' in pub) && !JSON.stringify(pub).includes('scrypt'));
});
test('register: field-level validation errors', async () => {
  const c = setup(); const e = await thrown(c.auth.register({ name: 'A', email: 'nope', password: 'short' }));
  assert.equal(e.status, 422); assert.deepEqual(Object.keys(e.details).sort(), ['email', 'name', 'password']);
  const e2 = await thrown(c.auth.register({ name: 'Amara Nwosu', email: 'amara.nwosu@example.org', password: 'Amara-Nwosu-2026!' })); assert.match(e2.details.password, /name, username or email/);
  assert.equal((await thrown(c.auth.register({ name: '<script>', email: 'a@b.co', password: GOOD_PW }))).details.name !== undefined, true);
});
test('register: duplicate email gives a generic conflict and never replaces the account', async () => {
  const c = setup(); await addStudent(c);
  const e = await thrown(c.auth.register({ name: 'Mallory', email: 'AMARA@example.org', password: 'Another-Str0ng-Pass!' }));
  assert.equal(e.status, 409); assert.equal(e.code, 'registration_failed');
  assert.ok(await passwords.verifyPassword(GOOD_PW, (await c.store.findUserByEmail('amara@example.org')).passwordHash), 'original password still works');
});
test('register and OAuth honour the institution email allow-list', async () => {
  const c = setup({ env: { ALLOWED_EMAIL_DOMAINS: 'uni.example.edu' } });
  assert.match((await thrown(c.auth.register({ name: 'Amara N', email: 'a@gmail.com', password: GOOD_PW }))).details.email, /institution email/);
  assert.ok(await c.auth.register({ name: 'Amara N', email: 'a@uni.example.edu', password: GOOD_PW }));
});

// ---------- student login ----------
test('login: success, and every failure looks identical (no account enumeration)', async () => {
  const c = setup(); await addStudent(c); await addAdmin(c, { username: 'root' });
  await c.store.createUser({ email: 'suspended@example.org', displayName: 'S', role: 'student', passwordHash: await passwords.hashPassword(GOOD_PW, FAST) });
  c.store._users.get((await c.store.findUserByEmail('suspended@example.org')).id).status = 'suspended';
  await c.store.createUser({ email: 'oauthonly@example.org', displayName: 'O', role: 'student' });
  const ok = await c.auth.login({ email: 'Amara@example.org', password: GOOD_PW }); assert.ok(ok.token);
  const failures = [];
  for (const [email, password] of [['amara@example.org', 'wrong-Password-1'], ['nobody@example.org', GOOD_PW], ['suspended@example.org', GOOD_PW], ['oauthonly@example.org', GOOD_PW], ['root@example.org', ADMIN_PW]])
    failures.push(await thrown(c.auth.login({ email, password })));
  for (const f of failures) { assert.equal(f.status, 401); assert.equal(f.code, 'invalid_credentials'); assert.equal(f.message, failures[0].message); assert.equal(f.details, undefined); }
});
test('login: an admin account cannot sign in through the student endpoint', async () => {
  const c = setup(); await c.store.createUser({ email: 'boss@example.org', username: 'boss', displayName: 'Boss', role: 'admin', passwordHash: await passwords.hashPassword(ADMIN_PW, FAST) });
  assert.equal((await thrown(c.auth.login({ email: 'boss@example.org', password: ADMIN_PW }))).code, 'invalid_credentials');
});
test('login: the same amount of hashing work happens for unknown and known accounts', async () => {
  const c = setup(); await addStudent(c);
  c.calls.verify = 0; await thrown(c.auth.login({ email: 'nobody@example.org', password: 'whatever-1A!' })); const unknown = c.calls.verify;
  c.calls.verify = 0; await thrown(c.auth.login({ email: 'amara@example.org', password: 'whatever-1A!' })); const known = c.calls.verify;
  assert.equal(unknown, known); assert.ok(unknown >= 1);
});
test('login: repeated failures are throttled (per email and per IP), then recover after the window', async () => {
  const c = setup(); await addStudent(c);
  for (let i = 0; i < 8; i++) await thrown(c.auth.login({ email: 'amara@example.org', password: `wrong-${i}-Pass!`, ip: `198.51.100.${i}` }));
  const blocked = await thrown(c.auth.login({ email: 'amara@example.org', password: GOOD_PW, ip: '203.0.113.50' }));
  assert.equal(blocked.status, 429); assert.ok(blocked.headers['Retry-After'] > 0, 'even the correct password is refused while throttled');
  c.advance(16 * 60e3); assert.ok(await c.auth.login({ email: 'amara@example.org', password: GOOD_PW, ip: '203.0.113.50' }));
  const c2 = setup(); // one IP hammering many emails
  for (let i = 0; i < 32; i++) await thrown(c2.auth.login({ email: `user${i}@example.org`, password: 'x-Wrong-1A!', ip: '192.0.2.9' }));
  assert.equal((await thrown(c2.auth.login({ email: 'new@example.org', password: 'x-Wrong-1A!', ip: '192.0.2.9' }))).status, 429);
});
test('login: weak legacy hashes are upgraded after a successful sign-in', async () => {
  const c = setup(); const weak = { N: 1024, r: 8, p: 1 };
  const strongerAuth = createAuthService({ store: c.store, sessions: c.sessions, config: c.config, hasher: c.hasher, hasherParams: { N: 2048, r: 8, p: 1 }, clock: c.clock });
  await addStudent(c); const before = (await c.store.findUserByEmail('amara@example.org')).passwordHash;
  await strongerAuth.login({ email: 'amara@example.org', password: GOOD_PW }); const after = (await c.store.findUserByEmail('amara@example.org')).passwordHash;
  assert.notEqual(before, after); assert.match(after, /n=2048/); assert.ok(await passwords.verifyPassword(GOOD_PW, after)); assert.equal(weak.N, 1024);
});

// ---------- admin login and lockout ----------
test('admin login: success issues an admin-kind session and audits it', async () => {
  const c = setup(); await addAdmin(c); const r = await c.auth.adminLogin({ username: ' ADMIN ', password: ADMIN_PW, ip: '203.0.113.7' });
  assert.equal(r.session.kind, 'admin'); assert.ok(c.store._audit.some((a) => a.action === 'Admin signed in'));
});
test('admin lockout: 3rd consecutive wrong password locks until the next calendar day (SERVER_TIMEZONE)', async () => {
  const c = setup({ env: { SERVER_TIMEZONE: 'Africa/Lagos' }, start: '2026-06-10T10:00:00Z' }); await addAdmin(c);
  const try1 = await thrown(c.auth.adminLogin({ username: 'admin', password: 'wrong-1', ip: '1.1.1.1' })); assert.equal(try1.status, 401); assert.equal(try1.details.attemptsRemaining, 2);
  const try2 = await thrown(c.auth.adminLogin({ username: 'admin', password: 'wrong-2', ip: '2.2.2.2' })); assert.equal(try2.details.attemptsRemaining, 1);
  const try3 = await thrown(c.auth.adminLogin({ username: 'admin', password: 'wrong-3', ip: '3.3.3.3' }));
  assert.equal(try3.status, 423); assert.equal(try3.code, 'sign_in_paused'); assert.equal(try3.details.lockedUntil, '2026-06-10T23:00:00.000Z', 'midnight in Lagos (UTC+1)');
  assert.ok(try3.headers['Retry-After'] > 0);
  assert.ok(c.store._audit.some((a) => /locked/.test(a.action)));
});
test('admin lockout: the correct password is refused (and not even checked) while locked, from any IP', async () => {
  const c = setup(); await addAdmin(c);
  for (let i = 0; i < 3; i++) await thrown(c.auth.adminLogin({ username: 'admin', password: `bad-${i}` }));
  c.calls.verify = 0;
  const e = await thrown(c.auth.adminLogin({ username: 'admin', password: ADMIN_PW, ip: '198.51.100.99' }));
  assert.equal(e.status, 423); assert.equal(c.calls.verify, 0, 'no password verification during a lock');
  c.advance(13 * 3600e3); assert.equal((await thrown(c.auth.adminLogin({ username: 'admin', password: ADMIN_PW }))).status, 423, 'still locked at 23:00Z (before UTC midnight)');
});
test('admin lockout survives a restart (state lives in the database, not in memory)', async () => {
  const c = setup(); await addAdmin(c);
  for (let i = 0; i < 3; i++) await thrown(c.auth.adminLogin({ username: 'admin', password: `bad-${i}` }));
  const restarted = createAuthService({ store: c.store, sessions: c.sessions, config: c.config, hasher: c.hasher, hasherParams: FAST, clock: c.clock });
  assert.equal((await thrown(restarted.adminLogin({ username: 'admin', password: ADMIN_PW }))).status, 423);
});
test('admin lockout: resets at the next calendar day, then restarts the counter at 1', async () => {
  const c = setup(); await addAdmin(c);
  for (let i = 0; i < 3; i++) await thrown(c.auth.adminLogin({ username: 'admin', password: `bad-${i}` }));
  c.set('2026-06-11T00:00:01Z');
  const e = await thrown(c.auth.adminLogin({ username: 'admin', password: 'bad-again' })); assert.equal(e.status, 401); assert.equal(e.details.attemptsRemaining, 2, 'counter restarted');
  assert.ok(await c.auth.adminLogin({ username: 'admin', password: ADMIN_PW }));
  assert.equal((await c.store.findUserByUsername('admin')).failedLoginCount, 0, 'success resets the counter');
});
test('admin lockout: a success in between resets the consecutive count', async () => {
  const c = setup(); await addAdmin(c);
  await thrown(c.auth.adminLogin({ username: 'admin', password: 'bad-1' })); await thrown(c.auth.adminLogin({ username: 'admin', password: 'bad-2' }));
  await c.auth.adminLogin({ username: 'admin', password: ADMIN_PW });
  assert.equal((await thrown(c.auth.adminLogin({ username: 'admin', password: 'bad-3' }))).details.attemptsRemaining, 2);
});
test('admin lockout: unknown usernames behave identically (nothing reveals whether the account exists)', async () => {
  const c = setup(); await addAdmin(c);
  const real = []; const fake = [];
  for (let i = 0; i < 3; i++) { real.push(await thrown(c.auth.adminLogin({ username: 'admin', password: `bad-${i}` }))); fake.push(await thrown(c.auth.adminLogin({ username: 'ghost', password: `bad-${i}` }))); }
  const shape = (e) => ({ status: e.status, code: e.code, message: e.message, keys: Object.keys(e.details ?? {}).sort(), remaining: e.details?.attemptsRemaining, lockedUntil: e.details?.lockedUntil });
  assert.deepEqual(real.map(shape), fake.map(shape));
  assert.equal(shape(fake[2]).status, 423);
  assert.equal((await thrown(c.auth.adminLogin({ username: 'ghost', password: 'anything' }))).status, 423, 'unknown name stays paused for the day');
});
test('admin endpoint ignores non-admin accounts (a student cannot sign in or be locked out through it)', async () => {
  const c = setup(); const s = await addStudent(c, { email: 'stu@example.org' }); c.store._users.get(s.id).username = 'stu';
  assert.equal((await thrown(c.auth.adminLogin({ username: 'stu', password: GOOD_PW }))).status, 401);
  assert.equal((await c.store.findUserById(s.id)).failedLoginCount, 0, 'no counters are kept on student accounts');
});
test('admin login: an IP spraying many usernames is throttled', async () => {
  const c = setup(); await addAdmin(c);
  for (let i = 0; i < 15; i++) await thrown(c.auth.adminLogin({ username: `ghost${i}`, password: 'x', ip: '192.0.2.77' }));
  assert.equal((await thrown(c.auth.adminLogin({ username: 'admin', password: ADMIN_PW, ip: '192.0.2.77' }))).status, 429);
});

// ---------- sessions ----------
test('sessions: admin sessions expire after 30 idle minutes or 8 hours; user sessions last longer; suspended users are cut off', async () => {
  const c = setup(); const admin = await addAdmin(c); const stu = await addStudent(c);
  const a = await c.sessions.create({ userId: admin.id, kind: 'admin' }); const u = await c.sessions.create({ userId: stu.id, kind: 'user' });
  c.advance(29 * 60e3); assert.ok(await c.sessions.authenticate(a.token), 'active within the idle window (and refreshes it)');
  c.advance(29 * 60e3); assert.ok(await c.sessions.authenticate(a.token), 'idle clock was refreshed');
  c.advance(31 * 60e3); assert.equal(await c.sessions.authenticate(a.token), null, 'idle timeout');
  assert.ok(await c.sessions.authenticate(u.token), 'user session still valid after an hour');
  const b = await c.sessions.create({ userId: admin.id, kind: 'admin' });
  for (let i = 0; i < 17; i++) { c.advance(29 * 60e3); await c.sessions.authenticate(b.token); }
  assert.equal(await c.sessions.authenticate(b.token), null, 'absolute 8h limit even when kept active');
  c.store._users.get(stu.id).status = 'suspended'; assert.equal(await c.sessions.authenticate(u.token), null);
});
test('sessions: tokens are random per login, only hashes are stored, junk tokens are rejected', async () => {
  const c = setup(); await addStudent(c);
  const a = await c.auth.login({ email: 'amara@example.org', password: GOOD_PW }); const b = await c.auth.login({ email: 'amara@example.org', password: GOOD_PW });
  assert.notEqual(a.token, b.token); for (const s of c.store._sessions.values()) { assert.equal(s.tokenHash.length, 32); assert.ok(!s.tokenHash.toString('utf8').includes(a.token)); }
  for (const junk of [undefined, null, '', 'short', 'x'.repeat(500), 123, {}]) assert.equal(await c.sessions.authenticate(junk), null);
  await c.sessions.destroy(a.session.id); assert.equal(await c.sessions.authenticate(a.token), null); assert.ok(await c.sessions.authenticate(b.token));
});

// ---------- password change ----------
async function signedIn(c, user) { const r = await c.sessions.create({ userId: user.id, kind: user.roles.includes('admin') ? 'admin' : 'user' }); return { user: await c.store.findUserById(user.id), session: r.session, token: r.token }; }
test('changePassword: success replaces the hash, keeps this session, revokes the others', async () => {
  const c = setup(); const stu = await addStudent(c); const cur = await signedIn(c, stu); const other = await signedIn(c, stu);
  const NEW = 'Brand-New-Passw0rd!';
  assert.deepEqual(await c.auth.changePassword({ user: cur.user, session: cur.session, currentPassword: GOOD_PW, newPassword: NEW, confirmPassword: NEW }), { ok: true });
  assert.ok(await c.sessions.authenticate(cur.token)); assert.equal(await c.sessions.authenticate(other.token), null, 'other devices are signed out');
  await thrown(c.auth.login({ email: 'amara@example.org', password: GOOD_PW })); assert.ok(await c.auth.login({ email: 'amara@example.org', password: NEW }));
});
test('changePassword: wrong current password, weak/mismatched/reused new password, OAuth-only accounts', async () => {
  const c = setup(); const stu = await addStudent(c); const cur = await signedIn(c, stu); const call = (o) => c.auth.changePassword({ user: cur.user, session: cur.session, ...o });
  assert.match((await thrown(call({ currentPassword: 'nope-Wrong-1A!', newPassword: 'Brand-New-Passw0rd!' }))).details.currentPassword, /incorrect/);
  assert.ok((await thrown(call({ currentPassword: GOOD_PW, newPassword: 'weak' }))).details.newPassword);
  assert.ok((await thrown(call({ currentPassword: GOOD_PW, newPassword: 'Brand-New-Passw0rd!', confirmPassword: 'different' }))).details.confirmPassword);
  assert.match((await thrown(call({ currentPassword: GOOD_PW, newPassword: GOOD_PW }))).details.newPassword, /not used before/);
  assert.ok((await thrown(call({ newPassword: 'Brand-New-Passw0rd!' }))).details.currentPassword);
  const o = await c.store.createUser({ email: 'oa@example.org', displayName: 'O', role: 'student' });
  assert.equal((await thrown(c.auth.changePassword({ user: o, session: cur.session, currentPassword: 'x', newPassword: 'Brand-New-Passw0rd!' }))).code, 'no_password');
  assert.ok(await passwords.verifyPassword(GOOD_PW, (await c.store.findUserById(stu.id)).passwordHash), 'failed attempts changed nothing');
});
test('changePassword: guessing the current password is throttled', async () => {
  const c = setup(); const cur = await signedIn(c, await addStudent(c));
  for (let i = 0; i < 5; i++) await thrown(c.auth.changePassword({ user: cur.user, session: cur.session, currentPassword: `guess-${i}-Aa1!`, newPassword: 'Brand-New-Passw0rd!' }));
  assert.equal((await thrown(c.auth.changePassword({ user: cur.user, session: cur.session, currentPassword: GOOD_PW, newPassword: 'Brand-New-Passw0rd!' }))).status, 429);
});
test('changePassword: admins need 14+ characters, the forced-change flag clears, and the change is audited', async () => {
  const c = setup(); const admin = await addAdmin(c, { mustChangePassword: true }); const cur = await signedIn(c, admin); assert.equal(cur.user.mustChangePassword, true);
  assert.match((await thrown(c.auth.changePassword({ user: cur.user, session: cur.session, currentPassword: ADMIN_PW, newPassword: 'Short-Pass-1!' }))).details.newPassword, /at least 14/);
  await c.auth.changePassword({ user: cur.user, session: cur.session, currentPassword: ADMIN_PW, newPassword: 'A-Much-Longer-Passphrase-9!' });
  assert.equal((await c.store.findUserById(admin.id)).mustChangePassword, false); assert.ok(c.store._audit.some((a) => a.action === 'Admin changed password'));
});

// ---------- admin bootstrap ----------
test('bootstrapAdmin: creates the first admin with a forced password change; refuses weak passwords and a second admin', async () => {
  const c = setup(); const run = (o) => bootstrapAdmin({ store: c.store, hasherParams: FAST, ...o });
  await assert.rejects(run({ password: undefined }), /No password supplied/);
  await assert.rejects(run({ password: 'admin' }), /rejected/); await assert.rejects(run({ password: 'Short-Pass-1!' }), /at least 14/);
  await assert.rejects(run({ username: 'Bad Name!', password: ADMIN_PW }), /ADMIN_BOOTSTRAP_USERNAME/);
  await assert.rejects(run({ username: 'admin', password: 'Admin-Passphrase-1!' }), /rejected/, 'must not contain the username');
  assert.deepEqual(await run({ password: ADMIN_PW }), { created: true, username: 'admin' });
  const u = await c.store.findUserByUsername('admin'); assert.equal(u.mustChangePassword, true); assert.deepEqual(u.roles, ['admin']); assert.ok(await passwords.verifyPassword(ADMIN_PW, u.passwordHash));
  assert.equal((await run({ password: 'Another-Passphrase-2!' })).created, false); assert.equal(await c.store.countAdmins(), 1);
  assert.ok(c.store._audit.some((a) => a.action === 'Initial administrator created'));
  assert.ok(await c.auth.adminLogin({ username: 'admin', password: ADMIN_PW }), 'the bootstrapped admin can sign in');
});

// ---------- housekeeping ----------
import { runHousekeeping, startHousekeeping, LOGIN_ATTEMPT_RETENTION_DAYS } from '../../src/services/housekeeping.js';
test('housekeeping: removes expired sessions and login attempts older than the retention window', async () => {
  const c = setup(); const stu = await addStudent(c); const calls = [];
  const store = { deleteExpiredSessions: async (d) => calls.push(['sessions', d]), deleteLoginAttemptsBefore: async (d) => calls.push(['attempts', d]) };
  const now = new Date('2026-07-01T00:00:00Z'); await runHousekeeping(store, now);
  assert.deepEqual(calls[0], ['sessions', now]); assert.equal(calls[1][1].toISOString(), new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_DAYS * 86400e3).toISOString());
  const old = await c.sessions.create({ userId: stu.id }); c.advance(15 * 86400e3); await runHousekeeping(c.store, c.now()); assert.equal(await c.sessions.authenticate(old.token), null);
  let logged = 0; const stop = startHousekeeping({ store: { deleteExpiredSessions: async () => { throw new Error('db down'); }, deleteLoginAttemptsBefore: async () => {} }, logger: { error: () => { logged += 1; } }, intervalMs: 1e9 });
  await new Promise((r) => setTimeout(r, 20)); stop(); assert.equal(logged, 1, 'a failing job is logged, not thrown');
});
