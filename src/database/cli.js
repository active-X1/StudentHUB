// Usage: node src/database/cli.js <migrate|status|seed|reset|bootstrap-admin> [--yes] [--password-stdin]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig, loadEnvFile } from '../config/index.js';
import { listMigrations, applyMigrations, migrationStatus } from './migrate.js';
import { runSeeds } from './seed.js';
import { createPgStore } from '../models/pgStore.js';
import { bootstrapAdmin } from '../services/adminBootstrap.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, 'migrations');
const SEEDS = path.join(here, 'seeds');
const [command, ...flags] = process.argv.slice(2);
const log = (m) => console.log(m);

async function readStdin() {
  if (process.stdin.isTTY) throw new Error('--password-stdin expects the password to be piped in, e.g.  printf %s "$PW" | npm run admin:bootstrap -- --password-stdin');
  let data = ''; for await (const chunk of process.stdin) data += chunk; return data.replace(/\r?\n$/, '');
}
/** Adapts a single pg.Client to the { query, withTransaction } shape the store expects. */
const singleClientDb = (client) => ({
  query: (t, p) => client.query(t, p),
  async withTransaction(fn) { await client.query('BEGIN'); try { const out = await fn(client); await client.query('COMMIT'); return out; } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } },
});
function localHost(url) { try { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname); } catch { return false; } }

async function main() {
  loadEnvFile();
  const config = loadConfig();
  if (!config.db.url) throw new Error('DATABASE_URL is not set.');
  const client = new pg.Client({ connectionString: config.db.url, ssl: config.db.ssl === 'false' ? undefined : { rejectUnauthorized: config.db.ssl === 'true' }, application_name: 'student-hub-cli' });
  await client.connect();
  try {
    const migrations = listMigrations(MIGRATIONS);
    if (command === 'migrate') {
      const r = await applyMigrations(client, migrations, { log });
      log(r.applied.length ? `Done. ${r.applied.length} migration(s) applied.` : 'Database is up to date.');
    } else if (command === 'status') {
      (await migrationStatus(client, migrations)).forEach((s) => log(`${s.state.padEnd(8)} ${s.id}`));
    } else if (command === 'seed') {
      await runSeeds(client, SEEDS, { isProd: config.isProd, log });
    } else if (command === 'reset') {
      // Destructive: drops everything in the public schema. Guarded three ways.
      if (config.env !== 'development') throw new Error('db:reset only runs when NODE_ENV=development.');
      if (!localHost(config.db.url)) throw new Error('db:reset only runs against a local database (localhost/127.0.0.1).');
      if (!flags.includes('--yes')) throw new Error('Pass --yes to confirm dropping all data.');
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      const r = await applyMigrations(client, migrations, { log });
      log(`Reset complete. ${r.applied.length} migration(s) applied. Run "npm run db:seed" for sample content.`);
    } else if (command === 'bootstrap-admin') {
      // One-time creation of the first administrator. The password never appears on the command line or in output.
      const password = flags.includes('--password-stdin') ? await readStdin() : process.env.ADMIN_BOOTSTRAP_PASSWORD;
      const r = await bootstrapAdmin({ store: createPgStore(singleClientDb(client)), username: process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin', email: process.env.ADMIN_BOOTSTRAP_EMAIL || null, password });
      log(r.created ? `Administrator "${r.username}" created. A password change is required at first sign-in.\nRemove ADMIN_BOOTSTRAP_PASSWORD from your environment/.env now.` : r.reason);
    } else {
      throw new Error('Unknown command. Use: migrate | status | seed | reset | bootstrap-admin');
    }
  } finally { await client.end(); }
}
main().catch((err) => { console.error(err.message); process.exitCode = 1; });
