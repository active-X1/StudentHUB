// Development sample data. Refuses to run in production. Seeds never create admin accounts or passwords.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export async function runSeeds(client, dir, { isProd = false, log = () => {} } = {}) {
  if (isProd) throw new Error('Refusing to run seed data in production.');
  const files = readdirSync(dir).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
  for (const f of files) {
    await client.query('BEGIN');
    try { await client.query(readFileSync(path.join(dir, f), 'utf8')); await client.query('COMMIT'); log(`seeded ${f}`); }
    catch (err) { try { await client.query('ROLLBACK'); } catch { /* ignore */ } throw new Error(`Seed ${f} failed: ${err.message}`, { cause: err }); }
  }
  return files;
}
