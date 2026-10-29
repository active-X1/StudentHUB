// Static checks of src/models/pgStore.js: since it cannot run without PostgreSQL here, verify what can be verified
// mechanically. (Behaviour against a real database is covered by tests/backend/integration/.)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPgStore } from '../../src/models/pgStore.js';
import { parseSchema, lintInserts } from './helpers/sql-lint.js';

const schema = parseSchema(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'database', 'migrations'));
const ROW = { n: 1, id: 'id', failed_login_count: 1, locked_until: null, s_id: 's', s_kind: 'user', role_names: [], provider: 'google' };

function recorder() {
  const log = []; const result = { rows: [ROW], rowCount: 1 };
  const client = { query: async (text, params) => { log.push({ text, params }); return result; } };
  return { log, db: { query: client.query, withTransaction: (fn) => fn(client) } };
}
const S = (n) => `SENTINEL_${n}_9f3a`; const D = new Date('2026-06-01T00:00:00Z'); const B = Buffer.alloc(32, 1); const UUID = '00000000-0000-4000-8000-000000000001';
async function exerciseEveryMethod(store) {
  await store.findUserByEmail(S('email')); await store.findUserByUsername(S('user')); await store.findUserById(UUID); await store.findUserByOAuthIdentity('google', S('pid')); await store.countAdmins(); await store.listOAuthProviders(UUID);
  await store.createUser({ email: S('e'), username: S('u'), displayName: S('dn'), passwordHash: S('ph'), emailVerifiedAt: D, mustChangePassword: true, avatarUrl: S('av'), role: 'student', oauth: { provider: 'google', providerUserId: S('p'), providerEmail: S('pe') } });
  await store.updateProfileName(UUID, S('name')); await store.setPassword(UUID, S('hash'), { mustChangePassword: false });
  await store.registerFailedLogin(UUID, { now: D, max: 3, lockUntil: D }); await store.registerSuccessfulLogin(UUID, D);
  await store.createSession({ userId: UUID, tokenHash: B, kind: 'admin', expiresAt: D, ip: S('ip'), userAgent: S('ua'), now: D }); await store.findSessionByTokenHash(B);
  await store.touchSession(UUID, D); await store.revokeSession(UUID, D); await store.revokeUserSessions(UUID, UUID, D); await store.deleteExpiredSessions(D);
  await store.recordLoginAttempt({ userId: UUID, identifierHash: B, ip: S('ip'), succeeded: false, isAdmin: true, now: D }); await store.countRecentFailures({ identifierHash: B, ip: S('ip'), since: D, isAdmin: true }); await store.deleteLoginAttemptsBefore(D);
  await store.writeAudit({ actorId: UUID, actorLabel: S('l'), action: S('a'), entityType: 'user', entityId: UUID, metadata: { x: 1 }, ip: S('ip') });
}

test('every statement: placeholders match parameters exactly, and no value is spliced into the SQL text', async () => {
  const { log, db } = recorder(); await exerciseEveryMethod(createPgStore(db));
  assert.ok(log.length >= 24, `exercised ${log.length} statements`);
  for (const { text, params } of log) {
    const used = [...new Set([...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
    assert.deepEqual(used, Array.from({ length: params.length }, (_, i) => i + 1), `placeholders vs params in: ${text.slice(0, 90)}...`);
    for (const p of params) if (typeof p === 'string' && p.startsWith('SENTINEL_')) assert.ok(!text.includes(p), 'parameter value leaked into SQL text');
    assert.ok(!/\$\{|' *\+|\+ *'/.test(text), 'no string concatenation in SQL');
  }
});
test('every table, insert column and updated column exists in the migrations', async () => {
  const { log, db } = recorder(); await exerciseEveryMethod(createPgStore(db));
  for (const { text } of log) {
    const flat = text.replace(/\s+/g, ' ');
    const ctes = new Set([...flat.matchAll(/WITH (\w+) AS/gi)].map((m) => m[1].toLowerCase()));
    for (const m of flat.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) { const t = m[1].toLowerCase(); assert.ok(schema.tables.has(t) || ctes.has(t), `unknown table "${t}" in: ${flat.slice(0, 80)}`); }
    assert.deepEqual(lintInserts(flat, schema.tables), []);
    const upd = /UPDATE\s+(\w+)(?:\s+\w+)?\s+SET\s+(.*?)(?:\s+WHERE|\s+FROM|\s+RETURNING|$)/i.exec(flat);
    if (upd) { const cols = schema.tables.get(upd[1].toLowerCase()).columns; for (const a of upd[2].matchAll(/(?:^|,\s*)(?:\w+\.)?(\w+)\s*=/g)) assert.ok(cols.has(a[1].toLowerCase()), `UPDATE ${upd[1]} sets unknown column ${a[1]}`); }
  }
});
test('user creation is one transaction (user + role + identity) and refuses unknown roles', async () => {
  const calls = []; const client = { query: async (t) => { calls.push(t.replace(/\s+/g, ' ').slice(0, 40)); return { rows: [{ id: UUID }], rowCount: /user_roles/.test(t) ? 0 : 1 }; } };
  const store = createPgStore({ query: client.query, withTransaction: async (fn) => { calls.push('BEGIN'); try { return await fn(client); } catch (e) { calls.push('ROLLBACK'); throw e; } } });
  await assert.rejects(store.createUser({ email: 'a@b.co', displayName: 'A', role: 'wizard' }), /Unknown role/); assert.ok(calls.includes('ROLLBACK'));
});
test('unique-violation errors are translated; unrelated errors pass through', async () => {
  const mk = (err) => createPgStore({ query: async () => ({ rows: [] }), withTransaction: async (fn) => fn({ query: async (t) => { if (/INSERT INTO users/.test(t)) throw err; return { rows: [], rowCount: 1 }; } }) });
  const dup = (constraint) => Object.assign(new Error('dup'), { code: '23505', constraint });
  await assert.rejects(mk(dup('users_email_lower_key')).createUser({ email: 'a@b.co', displayName: 'A', role: 'student' }), (e) => e.name === 'DuplicateError' && e.field === 'email');
  await assert.rejects(mk(dup('users_username_key')).createUser({ username: 'abc', displayName: 'A', role: 'admin' }), (e) => e.field === 'username');
  await assert.rejects(mk(Object.assign(new Error('boom'), { code: '40001' })).createUser({ email: 'a@b.co', displayName: 'A', role: 'student' }), /boom/);
});
