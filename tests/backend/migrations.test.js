import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMigrations, applyMigrations, migrationStatus, MIGRATION_FILE_RE } from '../../src/database/migrate.js';
import { runSeeds } from '../../src/database/seed.js';

const REAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'database');

/** In-memory fake of the few statements the runner issues. */
function fakeClient({ applied = [], failOn } = {}) {
  const log = []; const table = new Map(applied.map((a) => [a.id, a.checksum]));
  return { log, table, async query(text, params) {
    const t = text.trim(); log.push(t.split('\n')[0].slice(0, 60));
    if (t.startsWith('SELECT id, checksum')) return { rows: [...table].map(([id, checksum]) => ({ id, checksum })) };
    if (t.startsWith('INSERT INTO schema_migrations')) table.set(params[0], params[1]);
    if (failOn && t.includes(failOn)) throw new Error('boom');
    return { rows: [] };
  } };
}
const mk = (files) => { const d = mkdtempSync(path.join(tmpdir(), 'mig-')); for (const [n, s] of Object.entries(files)) writeFileSync(path.join(d, n), s); return d; };

test('real migrations: well-named, sequential, unique, checksummed', () => {
  const ms = listMigrations(path.join(REAL, 'migrations'));
  assert.ok(ms.length >= 5);
  ms.forEach((m, i) => { assert.match(m.file, MIGRATION_FILE_RE); assert.equal(Number(m.file.slice(0, 4)), i + 1, 'numbers must be sequential with no gaps'); assert.match(m.checksum, /^[0-9a-f]{64}$/); });
});
test('bad names and duplicate numbers are rejected', () => {
  assert.throws(() => listMigrations(mk({ 'init.sql': 'x' })), /Bad migration file name/);
  assert.throws(() => listMigrations(mk({ '0001_a.sql': 'x', '0001_b.sql': 'y' })), /Duplicate migration number/);
});
test('applies pending migrations in order, each in its own transaction, under an advisory lock', async () => {
  const ms = listMigrations(mk({ '0001_a.sql': 'CREATE TABLE a ();', '0002_b.sql': 'CREATE TABLE b ();' }));
  const c = fakeClient(); const r = await applyMigrations(c, ms);
  assert.deepEqual(r.applied, ['0001_a', '0002_b']);
  assert.equal(c.log.filter((l) => l === 'BEGIN').length, 2); assert.equal(c.log.filter((l) => l === 'COMMIT').length, 2);
  assert.ok(c.log[0].includes('pg_advisory_lock') && c.log.at(-1).includes('pg_advisory_unlock'));
  assert.ok(c.log.indexOf('CREATE TABLE a ();') < c.log.indexOf('CREATE TABLE b ();'));
});
test('already-applied migrations are skipped (idempotent)', async () => {
  const ms = listMigrations(mk({ '0001_a.sql': 'CREATE TABLE a ();', '0002_b.sql': 'CREATE TABLE b ();' }));
  const c = fakeClient({ applied: [{ id: '0001_a', checksum: ms[0].checksum }] });
  assert.deepEqual((await applyMigrations(c, ms)).applied, ['0002_b']);
  assert.deepEqual((await applyMigrations(c, ms)).applied, [], 'second run applies nothing');
});
test('editing an applied migration is refused; a missing file is refused', async () => {
  const ms = listMigrations(mk({ '0001_a.sql': 'CREATE TABLE a ();' }));
  await assert.rejects(applyMigrations(fakeClient({ applied: [{ id: '0001_a', checksum: 'deadbeef' }] }), ms), /modified after it was applied/);
  await assert.rejects(applyMigrations(fakeClient({ applied: [{ id: '0009_gone', checksum: 'x' }] }), ms), /file is missing/);
});
test('a failing migration is rolled back, not recorded, and the lock is released', async () => {
  const ms = listMigrations(mk({ '0001_a.sql': 'CREATE TABLE a ();', '0002_b.sql': 'BREAK ME;' }));
  const c = fakeClient({ failOn: 'BREAK ME' });
  await assert.rejects(applyMigrations(c, ms), /Migration 0002_b failed: boom/);
  assert.ok(c.log.includes('ROLLBACK')); assert.ok(c.table.has('0001_a') && !c.table.has('0002_b'));
  assert.ok(c.log.at(-1).includes('pg_advisory_unlock'));
});
test('status reports pending / applied / MODIFIED', async () => {
  const ms = listMigrations(mk({ '0001_a.sql': 'a', '0002_b.sql': 'b', '0003_c.sql': 'c' }));
  const c = fakeClient({ applied: [{ id: '0001_a', checksum: ms[0].checksum }, { id: '0002_b', checksum: 'changed' }] });
  assert.deepEqual((await migrationStatus(c, ms)).map((s) => s.state), ['applied', 'MODIFIED', 'pending']);
});
test('seeds refuse to run in production', async () => {
  await assert.rejects(runSeeds(fakeClient(), path.join(REAL, 'seeds'), { isProd: true }), /Refusing to run seed data in production/);
  const c = fakeClient(); assert.deepEqual(await runSeeds(c, path.join(REAL, 'seeds')), ['001_sample_content.sql']);
});
