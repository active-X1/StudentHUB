// Runs the REAL migrations and seeds against a REAL PostgreSQL 13+ database in a throw-away schema.
// Skipped unless TEST_DATABASE_URL is set, e.g.:
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/student_hub_test npm test
// Use a disposable database; the test creates and drops its own schema but never touches `public`.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMigrations, applyMigrations } from '../../../src/database/migrate.js';
import { runSeeds } from '../../../src/database/seed.js';

const url = process.env.TEST_DATABASE_URL;
const DB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'database');
const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;

async function expectPg(promise, code, label) {
  try { await promise; } catch (e) { assert.equal(e.code, code, `${label}: expected ${code}, got ${e.code} (${e.message})`); return e; }
  assert.fail(`${label}: expected SQLSTATE ${code} but the statement succeeded`);
}

test('migrations + seeds + constraints on real PostgreSQL', { skip: !url && 'set TEST_DATABASE_URL to run' }, async (t) => {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: url }); await client.connect();
  const schema = `it_${process.pid}_${Date.now()}`;
  await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET search_path TO ${schema}`);
  const q = (text, params) => client.query(text, params);
  try {
    const migrations = listMigrations(path.join(DB, 'migrations'));
    await t.test('applies all migrations, and a second run is a no-op', async () => {
      assert.equal((await applyMigrations(client, migrations)).applied.length, migrations.length);
      assert.equal((await applyMigrations(client, migrations)).applied.length, 0);
    });
    await t.test('seeds load and can be re-run', async () => {
      await runSeeds(client, path.join(DB, 'seeds')); await runSeeds(client, path.join(DB, 'seeds'));
      assert.equal((await q('SELECT count(*)::int AS n FROM users')).rows[0].n, 4);
      assert.equal((await q('SELECT count(*)::int AS n FROM general_assignments')).rows[0].n, 5);
      assert.equal((await q("SELECT count(*)::int AS n FROM user_roles WHERE role_id = 3")).rows[0].n, 0, 'no admin is seeded');
      assert.equal((await q('SELECT count(*)::int AS n FROM users WHERE password_hash IS NOT NULL')).rows[0].n, 0);
    });
    await t.test('uniqueness and CHECK constraints', async () => {
      await expectPg(q("INSERT INTO users (email, display_name) VALUES ('MENSAH@example.org', 'Dup')"), '23505', 'email unique ignoring case');
      await expectPg(q("INSERT INTO users (display_name) VALUES ('No identifier')"), '23514', 'email or username required');
      await expectPg(q("INSERT INTO users (username, display_name) VALUES ('Admin', 'Bad case')"), '23514', 'username must be lowercase');
      await expectPg(q("INSERT INTO hashtags (name) VALUES ('exams')"), '23505', 'hashtag unique ignoring case');
      await expectPg(q("INSERT INTO hashtags (name) VALUES ('bad-tag')"), '23514', 'hashtag format');
      await expectPg(q(`INSERT INTO personal_assignments (user_id, title, course, due_date, status) VALUES ('${U(4)}', 'T', 'C', current_date, 'done')`), '23514', 'done needs completed_at');
      await expectPg(q(`INSERT INTO personal_assignments (user_id, title, course, due_date, priority) VALUES ('${U(4)}', 'T', 'C', current_date, 'urgent')`), '23514', 'priority enum');
      await expectPg(q(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ('${U(4)}', '\\x00', now() + interval '1 day')`), '23514', 'token hash must be 32 bytes');
    });
    await t.test('foreign keys and ownership cascade', async () => {
      await expectPg(q("INSERT INTO personal_assignments (user_id, title, course, due_date) VALUES ('00000000-0000-4000-8000-0000000000ff', 'T', 'C', current_date)"), '23503', 'owner must exist');
      const before = (await q(`SELECT count(*)::int AS n FROM personal_assignments WHERE user_id = '${U(4)}'`)).rows[0].n; assert.ok(before > 0);
      await q(`DELETE FROM users WHERE id = '${U(4)}'`);
      assert.equal((await q(`SELECT count(*)::int AS n FROM personal_assignments WHERE user_id = '${U(4)}'`)).rows[0].n, 0, 'private assignments are removed with their owner');
    });
    await t.test('attachments: exactly one owner, validated metadata', async () => {
      const base = `'${'a'.repeat(40)}', 'file.pdf', 'application/pdf', 1000, '${'b'.repeat(64)}'`;
      await expectPg(q(`INSERT INTO attachments (storage_key, original_filename, content_type, size_bytes, checksum_sha256) VALUES (${base})`), '23514', 'needs an owner');
      await expectPg(q(`INSERT INTO attachments (general_assignment_id, feed_post_id, storage_key, original_filename, content_type, size_bytes, checksum_sha256) VALUES ('${'00000000-0000-4000-8000-000000004001'}', '00000000-0000-4000-8000-000000001001', ${base})`), '23514', 'only one owner');
      await q(`INSERT INTO attachments (general_assignment_id, storage_key, original_filename, content_type, size_bytes, checksum_sha256) VALUES ('00000000-0000-4000-8000-000000004001', ${base})`);
      await expectPg(q(`INSERT INTO attachments (feed_post_id, storage_key, original_filename, content_type, size_bytes, checksum_sha256) VALUES ('00000000-0000-4000-8000-000000001001', ${base})`), '23505', 'storage key unique');
      await expectPg(q("INSERT INTO attachments (feed_post_id, storage_key, original_filename, content_type, size_bytes, checksum_sha256) VALUES ('00000000-0000-4000-8000-000000001001', 'c' || repeat('d', 39), 'x.exe', 'application/x-msdownload', 10, repeat('e', 64))"), '23514', 'content type allow-list');
      await expectPg(q("INSERT INTO attachments (feed_post_id, storage_key, original_filename, content_type, size_bytes, checksum_sha256) VALUES ('00000000-0000-4000-8000-000000001001', 'f' || repeat('g', 39), 'x.pdf', 'application/pdf', 99999999, repeat('e', 64))"), '23514', 'size limit');
    });
    await t.test('audit log is append-only; accounts with history cannot be hard-deleted', async () => {
      await q(`INSERT INTO admin_audit_logs (actor_id, actor_label, action) VALUES ('${U(1)}', 'test', 'created thing')`);
      assert.match((await expectPg(q("UPDATE admin_audit_logs SET action = 'tampered'"), 'P0001', 'no update')).message, /append-only/);
      await expectPg(q('DELETE FROM admin_audit_logs'), 'P0001', 'no delete');
      await expectPg(q('TRUNCATE admin_audit_logs'), 'P0001', 'no truncate');
      await expectPg(q(`DELETE FROM users WHERE id = '${U(1)}'`), '23503', 'actor with audit history is protected');
    });
    await t.test('updated_at trigger and full-text search', async () => {
      await q('SELECT pg_sleep(0.02)');
      await q("UPDATE general_assignments SET title = title || '!' WHERE id = '00000000-0000-4000-8000-000000004001'");
      assert.equal((await q("SELECT updated_at > created_at AS moved FROM general_assignments WHERE id = '00000000-0000-4000-8000-000000004001'")).rows[0].moved, true);
      const hit = await q("SELECT id FROM feed_posts WHERE search_vector @@ plainto_tsquery('english', 'quicksort')"); assert.equal(hit.rows.length, 1);
    });
    await t.test('moderation consistency', async () => {
      await expectPg(q(`UPDATE post_suggestions SET status = 'approved' WHERE id = '00000000-0000-4000-8000-000000003001'`), '23514', 'reviewed_at required once not pending');
      await q(`UPDATE post_suggestions SET status = 'approved', reviewed_at = now(), reviewed_by = '${U(2)}' WHERE id = '00000000-0000-4000-8000-000000003001'`);
    });
  } finally {
    await client.query('RESET search_path'); await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end();
  }
});
