// Shared test fixtures: config, fake clock, memory store, fast password hashing.
import { loadConfig } from '../../../src/config/index.js';
import { createMemoryStore } from './memory-store.js';
import { createSessionService } from '../../../src/services/sessions.js';
import { createAuthService } from '../../../src/services/auth.js';
import * as realHasher from '../../../src/services/passwords.js';

export const FAST = { N: 1024, r: 8, p: 1 };
export const SECRET = 's'.repeat(48);

export function setup({ env = {}, start = '2026-06-10T10:00:00Z', store = createMemoryStore() } = {}) {
  const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: SECRET, APP_BASE_URL: 'http://localhost:3000', ...env });
  let now = new Date(start); const clock = () => new Date(now);
  const calls = { verify: 0 };
  const hasher = { ...realHasher, verifyPassword: (...a) => { calls.verify += 1; return realHasher.verifyPassword(...a); } };
  const sessions = createSessionService({ store, config, clock });
  const auth = createAuthService({ store, sessions, config, hasher, hasherParams: FAST, clock });
  return { config, store, sessions, auth, clock, calls, hasher, advance: (ms) => { now = new Date(now.getTime() + ms); }, set: (d) => { now = new Date(d); }, now: () => new Date(now) };
}
export const GOOD_PW = 'Tr0ub4dor&3-horse';
export async function addStudent(ctx, { email = 'amara@example.org', password = GOOD_PW, name = 'Amara Nwosu', ...extra } = {}) {
  return ctx.store.createUser({ email, displayName: name, passwordHash: await realHasher.hashPassword(password, FAST), role: 'student', ...extra });
}
export async function addAdmin(ctx, { username = 'admin', password = 'Adm1n-Passphrase-2026!', mustChangePassword = false } = {}) {
  return ctx.store.createUser({ username, displayName: 'Administrator', passwordHash: await realHasher.hashPassword(password, FAST), role: 'admin', mustChangePassword });
}
/** Runs fn and returns the thrown AppError (fails the test if nothing was thrown). */
export async function thrown(promise) { try { await promise; } catch (e) { return e; } throw new Error('expected a rejection'); }
