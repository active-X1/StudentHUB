// Forward-only SQL migration runner. Works with any client exposing query(text, params) (pg.Client/PoolClient or a test fake).
// - Files: src/database/migrations/NNNN_description.sql, applied in order, each inside one transaction.
// - Applied migrations are recorded with a SHA-256 checksum; editing an applied file is refused (write a new migration instead).
// - A session-level advisory lock serialises concurrent runners. Use ONE dedicated connection for the whole run.
// - Statements that cannot run in a transaction (e.g. CREATE INDEX CONCURRENTLY) are not supported here.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const MIGRATION_FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 727274001;

export function listMigrations(dir) {
  const names = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set();
  return names.map((file) => {
    const m = MIGRATION_FILE_RE.exec(file);
    if (!m) throw new Error(`Bad migration file name "${file}" (expected NNNN_snake_case.sql)`);
    if (seen.has(m[1])) throw new Error(`Duplicate migration number ${m[1]}`);
    seen.add(m[1]);
    const sql = readFileSync(path.join(dir, file), 'utf8');
    return { id: file.replace(/\.sql$/, ''), file, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

async function ensureTable(client) {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
}
async function appliedMap(client) {
  const { rows } = await client.query('SELECT id, checksum FROM schema_migrations ORDER BY id');
  return new Map(rows.map((r) => [r.id, r.checksum]));
}
function assertNoDrift(migrations, applied) {
  const byId = new Map(migrations.map((m) => [m.id, m]));
  for (const [id, checksum] of applied) {
    const m = byId.get(id);
    if (!m) throw new Error(`Migration ${id} is recorded as applied but its file is missing.`);
    if (m.checksum !== checksum) throw new Error(`Migration ${id} was modified after it was applied. Create a new migration instead of editing it.`);
  }
}

export async function withAdvisoryLock(client, fn) {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try { return await fn(); } finally { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); }
}

export async function applyMigrations(client, migrations, { log = () => {} } = {}) {
  return withAdvisoryLock(client, async () => {
    await ensureTable(client);
    const applied = await appliedMap(client);
    assertNoDrift(migrations, applied);
    const pending = migrations.filter((m) => !applied.has(m.id));
    for (const m of pending) {
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [m.id, m.checksum]);
        await client.query('COMMIT');
        log(`applied ${m.id}`);
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* connection broken */ }
        throw new Error(`Migration ${m.id} failed: ${err.message}`, { cause: err });
      }
    }
    return { applied: pending.map((m) => m.id), alreadyApplied: [...applied.keys()] };
  });
}

export async function migrationStatus(client, migrations) {
  await ensureTable(client);
  const applied = await appliedMap(client);
  return migrations.map((m) => ({ id: m.id, state: !applied.has(m.id) ? 'pending' : applied.get(m.id) === m.checksum ? 'applied' : 'MODIFIED' }));
}
