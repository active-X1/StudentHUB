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
import { originCheck, requireJsonBodyExcept, csrfProtect, csrfProtectIfAuthed } from '../middleware/csrf.js';
import { requireAuth, requireAdmin, passwordChangeGate } from '../middleware/authz.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { createAssignmentsController } from '../controllers/assignments.js';
import { createAssignmentService } from '../services/assignments.js';
import { createAttachmentService } from '../services/attachments.js';
import { createStorage } from '../services/storage/index.js';
import { createLogger } from '../utils/logger.js';

export const UPLOAD_PATHS = [/^\/me\/assignments\/[^/]+\/attachments$/, /^\/admin\/assignments\/[^/]+\/attachments$/];

export function buildApi({ config, db = null, store, clock, fetchFn, hasherParams, now = () => Date.now(), storage = null, logger = createLogger({ level: 'warn' }) }) {
  const theStore = store ?? (db ? createPgStore(db) : null);
  if (!theStore) return { preBody: [], postBody: [], routes: [{ method: 'get', path: '/health', handlers: [liveness] }, { method: 'get', path: '/health/ready', handlers: [readiness(null)] }], services: {} };
  const sessions = createSessionService({ store: theStore, config, clock });
  const auth = createAuthService({ store: theStore, sessions, config, hasherParams, clock });
  const oauth = createOAuthService({ config, store: theStore, auth, fetchFn, clock: now });
  const c = createAuthController({ auth, oauth, sessions, store: theStore, config });
  const theStorage = storage ?? createStorage(config);
  const attachments = createAttachmentService({ store: theStore, storage: theStorage, logger });
  const assignments = createAssignmentService({ store: theStore, storage: theStorage, logger, clock });
  const a = createAssignmentsController({ assignments, attachments, store: theStore });
  const byUser = (req) => req.auth?.user.id ?? req.ip;
  const limit = (name, windowMs, max) => createRateLimiter({ name, windowMs, max, clock: now });
  // Every route is behind the forced-password-change gate unless it is one of the few that must stay reachable.
  const route = (method, path, handlers, { exempt = false, body } = {}) => ({ method, path, body, handlers: exempt ? handlers : [passwordChangeGate, ...handlers] });
  const userLimit = (name, windowMs, max) => createRateLimiter({ name, windowMs, max, keyFn: byUser, clock: now });
  const read = [requireAuth]; const write = [requireAuth, csrfProtect]; const adminRead = [requireAdmin]; const adminWrite = [requireAdmin, csrfProtect];

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

    // students: private assignments
    route('get', '/me/assignments', [...read, a.listMine]),
    route('post', '/me/assignments', [...write, userLimit('assignment-write', 3600e3, 200), a.createMine]),
    route('get', '/me/assignments/:id', [...read, a.getMine]),
    route('patch', '/me/assignments/:id', [...write, userLimit('assignment-write', 3600e3, 200), a.updateMine]),
    route('delete', '/me/assignments/:id', [...write, userLimit('assignment-write', 3600e3, 200), a.deleteMine]),
    route('post', '/me/assignments/:id/attachments', [...write, userLimit('upload', 3600e3, 60), a.uploadMine], { body: 'raw' }),
    // students: published general assignments
    route('get', '/assignments', [...read, a.listGeneral]),
    route('get', '/assignments/:id', [...read, a.getGeneral]),
    // files
    route('get', '/attachments/:id', [...read, a.download]),
    route('delete', '/attachments/:id', [...write, a.deleteAttachment]),
    // admins: general assignments
    route('get', '/admin/assignments', [...adminRead, a.adminList]),
    route('post', '/admin/assignments', [...adminWrite, userLimit('admin-write', 3600e3, 300), a.adminCreate]),
    route('get', '/admin/assignments/:id', [...adminRead, a.adminGet]),
    route('patch', '/admin/assignments/:id', [...adminWrite, userLimit('admin-write', 3600e3, 300), a.adminUpdate]),
    route('delete', '/admin/assignments/:id', [...adminWrite, userLimit('admin-write', 3600e3, 300), a.adminDelete]),
    route('post', '/admin/assignments/:id/attachments', [...adminWrite, userLimit('admin-upload', 3600e3, 120), a.adminUpload], { body: 'raw' }),
  ];
  for (const p of ['google', 'github']) {
    routes.push(route('get', `/auth/${p}`, [limit(`oauth-${p}`, 15 * 60e3, 30), c.oauthStart(p)]));
    routes.push(route('get', `/auth/${p}/callback`, [limit(`oauth-cb-${p}`, 15 * 60e3, 60), c.oauthCallback(p)]));
  }
  return { preBody: [originCheck(config), requireJsonBodyExcept(UPLOAD_PATHS)], postBody: [cookieParser, loadSession({ sessions, config })], routes, services: { sessions, auth, oauth, assignments, attachments, store: theStore, storage: theStorage } };
}
