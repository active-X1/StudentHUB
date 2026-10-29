// Server-side sessions. The browser holds only a random token (HttpOnly cookie); the database holds its SHA-256 hash.
// A session ends at its absolute expiry, after an idle timeout, on revocation, or when the account is suspended.
import { newToken, sha256 } from './tokens.js';

const TOUCH_EVERY_MS = 60e3; // refresh last_seen_at at most once a minute to avoid a write per request

export function createSessionService({ store, config, clock = () => new Date() }) {
  const policy = (kind) => kind === 'admin'
    ? { absolute: config.auth.adminSessionAbsoluteMs, idle: config.auth.adminSessionIdleMs }
    : { absolute: config.auth.userSessionAbsoluteMs, idle: config.auth.userSessionIdleMs };
  return {
    policy,
    /** Always issues a brand-new token (login rotates the session; fixation is impossible). */
    async create({ userId, kind = 'user', ip, userAgent }) {
      const token = newToken(); const now = clock();
      const session = await store.createSession({ userId, tokenHash: sha256(token), kind, expiresAt: new Date(now.getTime() + policy(kind).absolute), ip, userAgent, now });
      return { token, session };
    },
    /** Returns { session, user, roles } for a valid token, otherwise null (never throws on bad input). */
    async authenticate(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
      const found = await store.findSessionByTokenHash(sha256(token));
      if (!found) return null;
      const { session, user } = found; const now = clock(); const p = policy(session.kind);
      if (session.revokedAt || session.expiresAt <= now) return null;
      if (now.getTime() - session.lastSeenAt.getTime() > p.idle) return null;
      if (user.status !== 'active') return null;
      if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) await store.touchSession(session.id, now);
      return { session, user, roles: user.roles };
    },
    destroy: (sessionId) => store.revokeSession(sessionId, clock()),
    destroyAllExcept: (userId, keepSessionId) => store.revokeUserSessions(userId, keepSessionId, clock()),
  };
}
