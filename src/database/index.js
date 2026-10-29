// PostgreSQL access. Returns null when DATABASE_URL is not configured (allowed in development only).
import pg from 'pg';

function sslOption(mode) {
  if (mode === 'true') return { rejectUnauthorized: true };
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  return undefined;
}
export function createDatabase(config, logger) {
  if (!config.db.url) return null;
  const pool = new pg.Pool({
    connectionString: config.db.url, max: config.db.poolMax, ssl: sslOption(config.db.ssl),
    idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, statement_timeout: 15000, application_name: 'student-hub',
  });
  // An error on an idle client must not crash the process.
  pool.on('error', (err) => logger?.error('db_pool_error', err));
  return {
    pool,
    query: (text, params) => pool.query(text, params),
    /** Runs fn(client) inside BEGIN/COMMIT; rolls back and rethrows on any error. */
    async withTransaction(fn) {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const out = await fn(client); await client.query('COMMIT'); return out; }
      catch (err) { try { await client.query('ROLLBACK'); } catch { /* connection already broken */ } throw err; }
      finally { client.release(); }
    },
    async ping() { await pool.query('SELECT 1'); },
    close: () => pool.end(),
  };
}
