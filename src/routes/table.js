// Builds the API: shared middleware lists and a declarative route table. Express mounts it (routes/index.js) and the
// test harness mounts the SAME table, so middleware order (auth -> CSRF -> rate limit -> handler) is what gets tested.
import { liveness, readiness } from '../controllers/health.js';
import { createAuthController } from '../controllers/auth.js';
import { createSessionService } from '../services/sessions.js';
import { createAuthService } from '../services/auth.js';
import { createOAuthService } from '../services/oauth.js';
import { createPgStore } from '../models/pgStore.js';
import { cookieParser } from '../middleware/cookies.js';
import { loadSession } from '../middleware/session.js';
import { originCheck, requireJsonBody, csrfProtect, csrfProtectIfAuthed } from '../middleware/csrf.js';
import { requireAuth, requireAdmin, passwordChangeGate } from '../middleware/authz.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

export function buildApi({ config, db = null, store, clock, fetchFn, hasherParams, now = () => Date.now() }) {
  const theStore = store ?? (db ? createPgStore(db) : null);
  if (!theStore) return { preBody: [], postBody: [], routes: [{ method: 'get', path: '/health', handlers: [liveness] }, { method: 'get', path: '/health/ready', handlers: [readiness(null)] }], services: {} };
  const sessions = createSessionService({ store: theStore, config, clock });
  const auth = createAuthService({ store: theStore, sessions, config, hasherParams, clock });
  const oauth = createOAuthService({ config, store: theStore, auth, fetchFn, clock: now });
  const c = createAuthController({ auth, oauth, sessions, store: theStore, config });
  const limit = (name, windowMs, max) => createRateLimiter({ name, windowMs, max, clock: now });
  // Every route is behind the forced-password-change gate unless it is one of the few that must stay reachable.
  const route = (method, path, handlers, { exempt = false } = {}) => ({ method, path, handlers: exempt ? handlers : [passwordChangeGate, ...handlers] });

  const routes = [
    route('get', '/health', [liveness], { exempt: true }),
    route('get', '/health/ready', [readiness(db)], { exempt: true }),
    route('get', '/auth/session', [c.session], { exempt: true }),
    route('post', '/auth/register', [limit('register', 3600e3, 10), c.register]),
    route('post', '/auth/login', [limit('login', 15 * 60e3, 30), c.login]),
    route('post', '/auth/logout', [csrfProtectIfAuthed, c.logout], { exempt: true }),
    route('post', '/auth/password', [requireAuth, csrfProtect, limit('password', 15 * 60e3, 10), c.changePassword], { exempt: true }),
    route('post', '/admin/auth/login', [limit('admin-login', 15 * 60e3, 30), c.adminLogin]),
    route('get', '/admin/me', [requireAdmin, c.adminMe]),
  ];
  for (const p of ['google', 'github']) {
    routes.push(route('get', `/auth/${p}`, [limit(`oauth-${p}`, 15 * 60e3, 30), c.oauthStart(p)]));
    routes.push(route('get', `/auth/${p}/callback`, [limit(`oauth-cb-${p}`, 15 * 60e3, 60), c.oauthCallback(p)]));
  }
  return { preBody: [originCheck(config), requireJsonBody], postBody: [cookieParser, loadSession({ sessions, config })], routes, services: { sessions, auth, oauth, store: theStore } };
}
