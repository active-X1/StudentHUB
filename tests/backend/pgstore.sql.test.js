// Static checks of src/models/pgStore.js: since it cannot run without PostgreSQL here, verify what can be verified
// mechanically. (Behaviour against a real database is covered by tests/backend/integration/.)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPgStore } from '../../src/models/pgStore.js';
import { parseSchema, lintInserts } from './helpers/sql-lint.js';

const schema = parseSchema(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'database', 'migrations'));
const ROW = { n: 1, id: 'id', failed_login_count: 1, locked_until: null, s_id: 's', s_kind: 'user', role_names: [], provider: 'google', owner_id: '00000000-0000-4000-8000-000000000001', tags: [] };

function recorder() {
  const log = []; const result = { rows: [ROW], rowCount: 1 };
  const client = { query: async (text, params) => { log.push({ text, params: params ? [...params] : [] }); return result; } }; // snapshot: callers may append to their array later
  return { log, db: { query: client.query, withTransaction: (fn) => fn(client) } };
}
const S = (n) => `SENTINEL_${n}_9f3a`; const D = new Date('2026-06-01T00:00:00Z'); const B = Buffer.alloc(32, 1); const UUID = '00000000-0000-4000-8000-000000000001';
async function exerciseAssignments(store) {
  const P = { title: S('t'), description: S('d'), course: S('c'), lecturer: S('l'), dueDate: '2026-07-01', priority: 'high', status: 'done', completedAt: D, tags: [S('tag'), S('tag2')] };
  await store.createPersonalAssignment(UUID, P); await store.getPersonalAssignment(UUID, UUID);
  await store.listPersonalAssignments(UUID, { status: 'todo', tag: S('tag'), q: S('q'), sort: 'priority', limit: 10, offset: 5 }); await store.listPersonalAssignments(UUID);
  await store.updatePersonalAssignment(UUID, UUID, { title: S('n'), description: S('d'), course: S('c'), lecturer: null, dueDate: '2026-07-02', priority: 'low', status: 'todo', completedAt: null }, [S('x')]); await store.updatePersonalAssignment(UUID, UUID, {}, undefined);
  await store.deletePersonalAssignment(UUID, UUID);
  await store.createGeneralAssignment({ title: S('t'), course: S('c'), category: S('cat'), description: S('d'), dueDate: '2026-07-01', status: 'published', publishedAt: D, createdBy: UUID, tags: [S('tag')] });
  await store.getGeneralAssignment(UUID); await store.listGeneralAssignments({ publishedOnly: false, status: 'draft', course: S('c'), tag: S('tag'), q: S('q'), sort: 'published', limit: 5, offset: 1 }); await store.listGeneralAssignments();
  await store.updateGeneralAssignment(UUID, { title: S('n'), course: S('c'), category: S('k'), description: S('d'), dueDate: '2026-07-02', status: 'published', publishedAt: D }, [S('x')], UUID); await store.deleteGeneralAssignment(UUID);
  for (const ownerType of ['personal', 'general']) {
    await store.createAttachment({ ownerType, ownerId: UUID, uploadedBy: UUID, storageKey: S('k'), originalFilename: S('f'), contentType: 'application/pdf', sizeBytes: 5, checksumSha256: S('h') });
    await store.listAttachments(ownerType, [UUID]); await store.countAttachments(ownerType, UUID);
  }
  await store.getAttachmentForAccess(UUID); await store.deleteAttachment(UUID); await store.existingStorageKeys([S('k')]);
}
async function exerciseEveryMethod(store) {
  await exerciseAssignments(store);
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
  assert.ok(log.length >= 60, `exercised ${log.length} statements`);
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
    for (const m of flat.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) { const t = m[1].toLowerCase(); assert.ok(schema.tables.has(t) || ctes.has(t) || t === 'unnest', `unknown table "${t}" in: ${flat.slice(0, 80)}`); }
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

test('sort/filter inputs can never inject SQL: ORDER BY comes only from whitelists, values only from parameters', async () => {
  const { log, db } = recorder(); const store = createPgStore(db); const evil = "'; DROP TABLE users; --";
  await store.listPersonalAssignments(UUID, { sort: evil, q: evil, tag: evil, status: evil, limit: 5, offset: 0 });
  await store.listGeneralAssignments({ sort: evil, q: evil, course: evil, tag: evil, status: evil });
  await store.createPersonalAssignment(UUID, { title: evil, description: evil, course: evil, lecturer: evil, dueDate: '2026-01-01', priority: 'low', status: 'todo', completedAt: null, tags: [evil] });
  for (const { text, params } of log) { assert.ok(!/DROP|--/.test(text), `injection reached the SQL text: ${text.slice(0, 100)}`); assert.ok(!text.includes(evil)); }
  assert.ok(log.some((l) => /ORDER BY p\.due_date ASC/.test(l.text)), 'unknown sort values fall back to the default'); assert.ok(log.some((l) => /ORDER BY g\.due_date ASC/.test(l.text)));
  await assert.rejects(store.createAttachment({ ownerType: "personal'; --", ownerId: UUID, uploadedBy: UUID }), /Unknown attachment owner type/);
  await assert.rejects(store.listAttachments("x'; --", [UUID]), /Unknown attachment owner type/);
});
test('ownership is part of every personal-assignment statement', async () => {
  const { log, db } = recorder(); const store = createPgStore(db);
  await store.getPersonalAssignment(UUID, UUID); await store.listPersonalAssignments(UUID); await store.updatePersonalAssignment(UUID, UUID, { title: 'x' }); await store.updatePersonalAssignment(UUID, UUID, {}); await store.deletePersonalAssignment(UUID, UUID);
  const personalStatements = log.filter((l) => /personal_assignments/.test(l.text) && !/^\s*(INSERT INTO personal_assignments|(INSERT INTO|DELETE FROM) personal_assignment_hashtags)/.test(l.text));
  assert.ok(personalStatements.length >= 8);
  const reread = (t) => /^SELECT .* FROM personal_assignments p WHERE p\.id = \$1$/.test(t.replace(/\s+/g, ' ').trim()); // re-read AFTER ownership was proven in the same transaction
  for (const { text } of personalStatements) assert.ok(/user_id\s*=\s*\$\d/.test(text) || reread(text), `missing ownership filter: ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
  assert.ok(personalStatements.some((l) => /^\s*UPDATE personal_assignments/.test(l.text) && /AND user_id = \$2/.test(l.text)), 'UPDATE is scoped');
  assert.ok(personalStatements.some((l) => /^\s*DELETE FROM personal_assignments/.test(l.text) && /AND user_id = \$2/.test(l.text)), 'DELETE is scoped');
});
