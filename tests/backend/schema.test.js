import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSchema, lintSchema, lintInserts, splitTop } from './helpers/sql-lint.js';

const DB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'database');
const schema = parseSchema(path.join(DB, 'migrations'));

const EXPECTED = ['users', 'roles', 'user_roles', 'oauth_identities', 'sessions', 'login_attempts', 'personal_assignments', 'general_assignments',
  'feed_posts', 'post_suggestions', 'hashtags', 'post_hashtags', 'personal_assignment_hashtags', 'general_assignment_hashtags',
  'comments', 'reactions', 'attachments', 'notifications', 'admin_audit_logs'];

test('linter helper splits only at top level and ignores commas in strings', () => {
  assert.deepEqual(splitTop("a int, b text CHECK (b IN ('x','y')), c text DEFAULT '{2,3}'"), ['a int', "b text CHECK (b IN ('x','y'))", "c text DEFAULT '{2,3}'"]);
});

test('every planned entity has a table', () => {
  for (const name of EXPECTED) assert.ok(schema.tables.has(name), `missing table ${name}`);
});

test('schema structure: keys, foreign keys, FK indexes, ON DELETE, triggers', () => {
  assert.deepEqual(lintSchema(schema), []);
});

test('security-relevant schema constraints are present', () => {
  const t = (n) => schema.tables.get(n);
  assert.ok(!t('users').columns.has('password'), 'plaintext password column must not exist');
  assert.ok(t('users').columns.has('password_hash') && t('users').columns.has('failed_login_count') && t('users').columns.has('locked_until'), 'persisted lockout fields');
  assert.ok(t('sessions').columns.has('token_hash') && !t('sessions').columns.has('token'), 'sessions store only a token hash');
  assert.ok(t('attachments').constraints.includes('attachments_single_owner_check'), 'attachments must have exactly one owner');
  assert.ok(t('attachments').columns.has('storage_key') && t('attachments').columns.has('checksum_sha256'));
  assert.ok(t('personal_assignments').fks.some((f) => f.column === 'user_id' && f.table === 'users'), 'personal assignments are owned by a user');
  assert.ok(schema.triggers.some((g) => g.table === 'admin_audit_logs' && g.events.includes('DELETE')), 'audit log is append-only');
  assert.ok(schema.triggers.some((g) => g.table === 'admin_audit_logs' && g.events.includes('TRUNCATE')), 'audit log cannot be truncated');
  assert.ok(schema.indexes.some((i) => i.table === 'feed_posts' && /search_vector/.test(i.items[0])), 'full-text search index on posts');
  assert.ok(schema.indexes.some((i) => i.table === 'personal_assignments' && i.items.join() === 'user_id,due_date'), 'owner + due date index');
});

test('seed files only use real tables/columns and never create admins or passwords', () => {
  const seeds = path.join(DB, 'seeds');
  for (const f of readdirSync(seeds).filter((x) => x.endsWith('.sql'))) {
    const sql = readFileSync(path.join(seeds, f), 'utf8');
    assert.deepEqual(lintInserts(sql, schema.tables), []);
    assert.ok(!/password_hash/i.test(sql), 'seeds must not set passwords');
    assert.ok(!/user_roles[\s\S]*?,\s*3\s*\)/i.test(sql.replace(/--[^\n]*/g, '')), 'seeds must not grant the admin role (role id 3)');
    assert.ok(!/username/i.test(sql.replace(/--[^\n]*/g, '')), 'seeds must not create the admin username');
  }
});

test('the linter really catches problems (mutation check)', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(path.join(tmpdir(), 'lint-'));
  writeFileSync(path.join(dir, '0001_bad.sql'), `
    CREATE TABLE parents (id uuid PRIMARY KEY, updated_at timestamptz);
    CREATE TABLE kids (
      id uuid PRIMARY KEY,
      parent_id uuid NOT NULL REFERENCES parents (id),
      ghost_id uuid REFERENCES nowhere (id) ON DELETE CASCADE,
      opt_id uuid NOT NULL REFERENCES parents (id) ON DELETE SET NULL
    );
    CREATE INDEX kids_bad_idx ON kids (missing_col);
    CREATE TABLE no_pk (a int);
  `);
  const problems = lintSchema(parseSchema(dir)).join('\n');
  for (const expected of ['missing explicit ON DELETE', 'unknown table nowhere', 'SET NULL on a NOT NULL', 'no index starting with it',
    'has no column missing_col', 'no primary key', 'has updated_at but no set_updated_at trigger']) assert.ok(problems.includes(expected), `linter missed: ${expected}\n${problems}`);
});
