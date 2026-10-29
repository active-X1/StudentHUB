// Starts the harness with seeded accounts so a browser can be driven against the real frontend + real auth rules.
//   node tests/backend/helpers/serve-for-browser.js   (prints the URL)
// Seeded: student amara@example.org / Tr0ub4dor&3-horse ; admin "admin" / Adm1n-Passphrase-2026! (must change password on first sign-in)
import { startMiniApp } from './mini-app.js';
import { createMemoryStore } from './memory-store.js';
import { addStudent, addAdmin, FAST } from './setup.js';

const store = createMemoryStore(); await addStudent({ store }); await addAdmin({ store }, { mustChangePassword: true });
const fetchFn = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('token') ? { access_token: 't' } : { sub: 'g-1', email: 'g@example.org', email_verified: true, name: 'G User' }) });
const app = await startMiniApp({ store, hasherParams: FAST, fetchFn, env: { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', SERVER_TIMEZONE: 'UTC' } });
console.log(`URL ${app.url}`);
