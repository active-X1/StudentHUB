// Runs the shared store contract, concurrency checks and the admin lockout against the REAL PostgreSQL store.
// Skipped unless TEST_DATABASE_URL points at a disposable PostgreSQL 13+ database (a throw-away schema is created and dropped).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMigrations, applyMigrations } from '../../../src/database/migrate.js';
import { createPgStore } from '../../../src/models/pgStore.js';
import { createSessionService } from '../../../src/services/sessions.js';
import { createAuthService } from '../../../src/services/auth.js';
import { bootstrapAdmin } from '../../../src/services/adminBootstrap.js';
import { loadConfig } from '../../../src/config/index.js';
import { runStoreContract } from '../helpers/store-contract.js';

const url = process.env.TEST_DATABASE_URL; const skip = !url && 'set TEST_DATABASE_URL to run';
const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'database', 'migrations');
const FAST = { N: 1024, r: 8, p: 1 };

let shared;
async function env() {
  if (shared) return shared;
  const pg = (await import('pg')).default; const schema = `it_store_${process.pid}_${Date.now()}`;
  const setup = new pg.Client({ connectionString: url }); await setup.connect(); await setup.query(`CREATE SCHEMA ${schema}`);
  // Every pooled connection pins its search_path to the throw-away schema.
  const pool = new pg.Pool({ connectionString: url, max: 10, options: `-c search_path=${schema}` });
  const db = { query: (t, p) => pool.query(t, p), async withTransaction(fn) { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } } };
  const mig = await pool.connect(); try { await applyMigrations(mig, listMigrations(MIGRATIONS)); } finally { mig.release(); }
  shared = { pool, db, store: createPgStore(db), setup, schema }; return shared;
}
after(async () => { if (!shared) return; await shared.pool.end(); await shared.setup.query(`DROP SCHEMA ${shared.schema} CASCADE`); await shared.setup.end(); });

// Same behavioural contract as the in-memory store (tests/backend/store.memory.test.js).
runStoreContract((name, fn) => test(name, { skip }, fn), 'postgres store', async () => ({ store: (await env()).store }));

test('failed-login counting is atomic under concurrency (no lost updates, lock is set)', { skip }, async () => {
  const { store } = await env(); const u = await store.createUser({ username: `race${Date.now() % 1e6}`, displayName: 'Race', role: 'admin', passwordHash: 'h' });
  const now = new Date('2026-06-01T10:00:00Z'); const lockUntil = new Date('2026-06-02T00:00:00Z');
  const results = await Promise.all(Array.from({ length: 10 }, () => store.registerFailedLogin(u.id, { now, max: 3, lockUntil })));
  assert.deepEqual(results.map((r) => r.failedCount).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'every attempt got a distinct count');
  const after = await store.findUserById(u.id); assert.equal(after.failedLoginCount, 10); assert.equal(after.lockedUntil.getTime(), lockUntil.getTime());
});
test('admin bootstrap, forced change and the 3-attempt lockout work end to end on PostgreSQL', { skip }, async () => {
  const { store } = await env(); let now = new Date('2026-06-10T10:00:00Z'); const clock = () => new Date(now);
  const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's'.repeat(48), SERVER_TIMEZONE: 'Africa/Lagos' });
  const sessions = createSessionService({ store, config, clock }); const auth = createAuthService({ store, sessions, config, hasherParams: FAST, clock });
  const PW = 'Adm1n-Passphrase-2026!'; const username = `boot${Date.now() % 1e6}`;
  if (await store.countAdmins() === 0) assert.equal((await bootstrapAdmin({ store, username, password: PW, hasherParams: FAST })).created, true);
  else await store.createUser({ username, displayName: 'Administrator', passwordHash: await (await import('../../../src/services/passwords.js')).hashPassword(PW, FAST), role: 'admin', mustChangePassword: true });
  const first = await auth.adminLogin({ username, password: PW }); assert.equal(first.user.mustChangePassword, true); assert.equal(first.session.kind, 'admin');
  for (let i = 0; i < 2; i++) assert.equal((await auth.adminLogin({ username, password: 'nope-nope' }).catch((e) => e)).status, 401);
  const locked = await auth.adminLogin({ username, password: 'nope-nope' }).catch((e) => e); assert.equal(locked.status, 423); assert.equal(locked.details.lockedUntil, '2026-06-10T23:00:00.000Z');
  assert.equal((await auth.adminLogin({ username, password: PW }).catch((e) => e)).status, 423, 'correct password refused while locked');
  now = new Date('2026-06-10T23:00:01Z'); assert.ok(await auth.adminLogin({ username, password: PW }), 'unlocked at the next local midnight');
  assert.equal((await store.findUserByUsername(username)).failedLoginCount, 0);
});
test('sessions are keyed by token hash and cascade with their user', { skip }, async () => {
  const { store, pool } = await env(); const u = await store.createUser({ email: `cascade${Date.now() % 1e6}@example.org`, displayName: 'C', role: 'student' });
  const hash = Buffer.alloc(32, 7); await store.createSession({ userId: u.id, tokenHash: hash, kind: 'user', expiresAt: new Date(Date.now() + 3600e3) });
  await pool.query('DELETE FROM users WHERE id = $1', [u.id]); assert.equal(await store.findSessionByTokenHash(hash), null);
});
