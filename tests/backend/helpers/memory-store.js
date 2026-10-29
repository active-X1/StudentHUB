// In-memory implementation of the auth store, mirroring src/models/pgStore.js semantics (verified by store-contract.js).
import { DuplicateError } from '../../../src/models/pgStore.js';

const ROLES = ['student', 'lecturer', 'admin'];
const clone = (v) => structuredClone(v);
const key = (buf) => Buffer.from(buf).toString('hex');

export function createMemoryStore() {
  const users = new Map(); const sessions = new Map(); const identities = []; const attempts = []; const audit = []; let seq = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const view = (u) => u && clone(u);
  const byEmail = (e) => [...users.values()].find((u) => u.email && e && u.email.toLowerCase() === e.toLowerCase()) ?? null;
  const byUsername = (n) => [...users.values()].find((u) => u.username && n && u.username === String(n).toLowerCase()) ?? null;

  return {
    _audit: audit, _attempts: attempts, _sessions: sessions, _users: users,
    async findUserByEmail(email) { return view(byEmail(email)); },
    async findUserByUsername(username) { return view(byUsername(username)); },
    async findUserById(id) { return view(users.get(id) ?? null); },
    async findUserByOAuthIdentity(provider, pid) { const i = identities.find((x) => x.provider === provider && x.providerUserId === pid); return i ? view(users.get(i.userId)) : null; },
    async listOAuthProviders(userId) { return identities.filter((i) => i.userId === userId).map((i) => i.provider).sort(); },
    async countAdmins() { return [...users.values()].filter((u) => u.roles.includes('admin')).length; },

    async createUser({ email = null, username = null, displayName, passwordHash = null, emailVerifiedAt = null, mustChangePassword = false, avatarUrl = null, role, oauth = null }) {
      if (!ROLES.includes(role)) throw new Error(`Unknown role "${role}"`);
      if (email && byEmail(email)) throw new DuplicateError('email');
      if (username && byUsername(username)) throw new DuplicateError('username');
      if (oauth && identities.some((x) => x.provider === oauth.provider && x.providerUserId === oauth.providerUserId)) throw new DuplicateError('oauth_identity');
      const u = { id: newId(), email, username, displayName, passwordHash, avatarUrl, department: null, studyLevel: null, bio: null, status: 'active', emailVerifiedAt,
        mustChangePassword, passwordChangedAt: passwordHash ? new Date() : null, failedLoginCount: 0, lockedUntil: null, lastLoginAt: null, createdAt: new Date(), roles: [role] };
      users.set(u.id, u);
      if (oauth) identities.push({ userId: u.id, provider: oauth.provider, providerUserId: oauth.providerUserId });
      return view(u);
    },
    async updateProfileName(userId, displayName) { users.get(userId).displayName = displayName; },
    async setPassword(userId, passwordHash, { mustChangePassword = false } = {}) { Object.assign(users.get(userId), { passwordHash, mustChangePassword, passwordChangedAt: new Date() }); },
    async registerFailedLogin(userId, { now, max, lockUntil }) {
      const u = users.get(userId); const expired = u.lockedUntil && u.lockedUntil <= now;
      const n = expired ? 1 : u.failedLoginCount + 1; const still = expired ? null : u.lockedUntil;
      u.failedLoginCount = n; u.lockedUntil = n >= max ? lockUntil : still;
      return { failedCount: n, lockedUntil: u.lockedUntil };
    },
    async registerSuccessfulLogin(userId, now) { Object.assign(users.get(userId), { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }); },

    async createSession({ userId, tokenHash, kind, expiresAt, ip, userAgent, now = null }) {
      const at = now ?? new Date();
      const s = { id: newId(), userId, tokenHash: Buffer.from(tokenHash), kind, createdAt: at, lastSeenAt: at, expiresAt, revokedAt: null, ip, userAgent };
      sessions.set(s.id, s); const { tokenHash: _t, ...pub } = s; return clone(pub);
    },
    async findSessionByTokenHash(tokenHash) {
      const s = [...sessions.values()].find((x) => key(x.tokenHash) === key(tokenHash)); if (!s) return null;
      const { tokenHash: _t, ...pub } = s; return { session: clone(pub), user: view(users.get(s.userId)) };
    },
    async touchSession(id, now) { const s = sessions.get(id); if (s && !s.revokedAt) s.lastSeenAt = now; },
    async revokeSession(id, now) { const s = sessions.get(id); if (s && !s.revokedAt) s.revokedAt = now; },
    async revokeUserSessions(userId, except, now) { for (const s of sessions.values()) if (s.userId === userId && !s.revokedAt && s.id !== except) s.revokedAt = now; },
    async deleteExpiredSessions(now) { for (const [id, s] of sessions) if (s.expiresAt < now || (s.revokedAt && s.revokedAt < new Date(now.getTime() - 7 * 864e5))) sessions.delete(id); },

    async recordLoginAttempt(a) { attempts.push({ ...a, identifierHash: Buffer.from(a.identifierHash), createdAt: a.now }); },
    async countRecentFailures({ identifierHash = null, ip = null, since, isAdmin }) {
      return attempts.filter((a) => !a.succeeded && a.isAdmin === isAdmin && a.createdAt >= since
        && ((identifierHash && key(a.identifierHash) === key(identifierHash)) || (ip && a.ip === ip))).length;
    },
    async deleteLoginAttemptsBefore(before) { for (let i = attempts.length - 1; i >= 0; i--) if (attempts[i].createdAt < before) attempts.splice(i, 1); },
    async writeAudit(e) { audit.push({ metadata: {}, ...clone(e), createdAt: new Date() }); },
  };
}
