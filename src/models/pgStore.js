// PostgreSQL implementation of the auth store. Every statement is parameterised (no string-built SQL with user data).
// The in-memory twin used by unit tests lives in tests/backend/helpers/memory-store.js; both must satisfy
// tests/backend/helpers/store-contract.js. Dates are JavaScript Dates; hashes are Buffers (bytea).

export class DuplicateError extends Error {
  constructor(field) { super(`Duplicate ${field}`); this.name = 'DuplicateError'; this.field = field; }
}
const UNIQUE = { users_email_lower_key: 'email', users_username_key: 'username', oauth_identities_provider_uid_key: 'oauth_identity' };
function mapError(err) {
  if (err?.code === '23505' && UNIQUE[err.constraint]) return new DuplicateError(UNIQUE[err.constraint]);
  return err;
}

const USER_COLS = `u.id, u.email, u.username, u.display_name, u.password_hash, u.avatar_url, u.department, u.study_level, u.bio, u.status,
  u.email_verified_at, u.must_change_password, u.password_changed_at, u.failed_login_count, u.locked_until, u.last_login_at, u.created_at`;
const ROLE_NAMES = 'COALESCE(ARRAY(SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id ORDER BY r.name), \'{}\')';

export const toUser = (r) => r && ({
  id: r.id, email: r.email, username: r.username, displayName: r.display_name, passwordHash: r.password_hash, avatarUrl: r.avatar_url,
  department: r.department, studyLevel: r.study_level, bio: r.bio, status: r.status, emailVerifiedAt: r.email_verified_at,
  mustChangePassword: r.must_change_password, passwordChangedAt: r.password_changed_at, failedLoginCount: r.failed_login_count,
  lockedUntil: r.locked_until, lastLoginAt: r.last_login_at, createdAt: r.created_at, roles: r.role_names ?? [],
});

export function createPgStore(db) {
  const one = async (text, params) => (await db.query(text, params)).rows[0] ?? null;
  return {
    // ---- users ----
    findUserByEmail: async (email) => toUser(await one(`SELECT ${USER_COLS}, ${ROLE_NAMES} AS role_names FROM users u WHERE lower(u.email) = lower($1)`, [email])),
    findUserByUsername: async (username) => toUser(await one(`SELECT ${USER_COLS}, ${ROLE_NAMES} AS role_names FROM users u WHERE u.username = lower($1)`, [username])),
    findUserById: async (id) => toUser(await one(`SELECT ${USER_COLS}, ${ROLE_NAMES} AS role_names FROM users u WHERE u.id = $1`, [id])),
    findUserByOAuthIdentity: async (provider, providerUserId) => toUser(await one(
      `SELECT ${USER_COLS}, ${ROLE_NAMES} AS role_names FROM oauth_identities oi JOIN users u ON u.id = oi.user_id WHERE oi.provider = $1 AND oi.provider_user_id = $2`, [provider, providerUserId])),
    listOAuthProviders: async (userId) => (await db.query('SELECT provider FROM oauth_identities WHERE user_id = $1 ORDER BY provider', [userId])).rows.map((r) => r.provider),
    countAdmins: async () => (await one(`SELECT count(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin'`, [])).n,

    /** Creates the user, its role and (optionally) an OAuth identity atomically. Throws DuplicateError on a taken email/username. */
    createUser: ({ email = null, username = null, displayName, passwordHash = null, emailVerifiedAt = null, mustChangePassword = false, avatarUrl = null, role, oauth = null }) =>
      db.withTransaction(async (c) => {
        try {
          const { rows: [row] } = await c.query(
            `INSERT INTO users (email, username, display_name, password_hash, email_verified_at, must_change_password, avatar_url, password_changed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $4::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
            [email, username, displayName, passwordHash, emailVerifiedAt, mustChangePassword, avatarUrl]);
          const granted = await c.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2', [row.id, role]);
          if (granted.rowCount !== 1) throw new Error(`Unknown role "${role}"`);
          if (oauth) await c.query('INSERT INTO oauth_identities (user_id, provider, provider_user_id, provider_email) VALUES ($1, $2, $3, $4)', [row.id, oauth.provider, oauth.providerUserId, oauth.providerEmail ?? null]);
          const { rows: [full] } = await c.query(`SELECT ${USER_COLS}, ${ROLE_NAMES} AS role_names FROM users u WHERE u.id = $1`, [row.id]);
          return toUser(full);
        } catch (err) { throw mapError(err); }
      }),

    updateProfileName: (userId, displayName) => db.query('UPDATE users SET display_name = $2 WHERE id = $1', [userId, displayName]),
    setPassword: (userId, passwordHash, { mustChangePassword = false } = {}) => db.query(
      'UPDATE users SET password_hash = $2, must_change_password = $3, password_changed_at = now() WHERE id = $1', [userId, passwordHash, mustChangePassword]),

    /**
     * Atomic failed-login accounting (one statement, so concurrent attempts cannot slip past the limit).
     * An expired lock restarts the counter at 1. Reaching `max` sets locked_until = lockUntil.
     */
    async registerFailedLogin(userId, { now, max, lockUntil }) {
      const r = await one(
        `WITH cur AS (
           SELECT CASE WHEN locked_until IS NOT NULL AND locked_until <= $2 THEN 1 ELSE failed_login_count + 1 END AS n,
                  CASE WHEN locked_until IS NOT NULL AND locked_until <= $2 THEN NULL ELSE locked_until END AS still_locked
           FROM users WHERE id = $1 FOR UPDATE)
         UPDATE users u SET failed_login_count = cur.n, last_failed_login_at = $2,
                locked_until = CASE WHEN cur.n >= $3 THEN $4::timestamptz ELSE cur.still_locked END
         FROM cur WHERE u.id = $1 RETURNING u.failed_login_count, u.locked_until`, [userId, now, max, lockUntil]);
      return { failedCount: r.failed_login_count, lockedUntil: r.locked_until };
    },
    registerSuccessfulLogin: (userId, now) => db.query(
      'UPDATE users SET failed_login_count = 0, last_failed_login_at = NULL, locked_until = NULL, last_login_at = $2 WHERE id = $1', [userId, now]),

    // ---- sessions ----
    async createSession({ userId, tokenHash, kind, expiresAt, ip, userAgent, now = null }) {
      const r = await one(
        `INSERT INTO sessions (user_id, token_hash, kind, expires_at, ip_address, user_agent, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), COALESCE($7::timestamptz, now()))
         RETURNING id, user_id, kind, created_at, last_seen_at, expires_at`, [userId, tokenHash, kind, expiresAt, ip ?? null, (userAgent ?? '').slice(0, 300) || null, now]);
      return { id: r.id, userId: r.user_id, kind: r.kind, createdAt: r.created_at, lastSeenAt: r.last_seen_at, expiresAt: r.expires_at, revokedAt: null };
    },
    async findSessionByTokenHash(tokenHash) {
      const r = await one(
        `SELECT s.id AS s_id, s.kind AS s_kind, s.created_at AS s_created_at, s.last_seen_at AS s_last_seen_at, s.expires_at AS s_expires_at, s.revoked_at AS s_revoked_at,
                ${USER_COLS}, ${ROLE_NAMES} AS role_names
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`, [tokenHash]);
      if (!r) return null;
      return { session: { id: r.s_id, userId: r.id, kind: r.s_kind, createdAt: r.s_created_at, lastSeenAt: r.s_last_seen_at, expiresAt: r.s_expires_at, revokedAt: r.s_revoked_at }, user: toUser(r) };
    },
    touchSession: (id, now) => db.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1 AND revoked_at IS NULL', [id, now]),
    revokeSession: (id, now) => db.query('UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [id, now]),
    /** Revokes every active session of a user, optionally keeping one (the session that just changed the password). */
    revokeUserSessions: (userId, exceptSessionId, now) => db.query(
      'UPDATE sessions SET revoked_at = $3 WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)', [userId, exceptSessionId ?? null, now]),
    deleteExpiredSessions: (now) => db.query('DELETE FROM sessions WHERE expires_at < $1 OR revoked_at < $1 - interval \'7 days\'', [now]),

    // ---- login attempts ----
    recordLoginAttempt: ({ userId, identifierHash, ip, succeeded, isAdmin, now }) => db.query(
      'INSERT INTO login_attempts (user_id, identifier_hash, ip_address, succeeded, is_admin_login, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [userId ?? null, identifierHash, ip ?? null, succeeded, isAdmin, now]),
    async countRecentFailures({ identifierHash = null, ip = null, since, isAdmin }) {
      const r = await one(
        `SELECT count(*)::int AS n FROM login_attempts WHERE succeeded = false AND is_admin_login = $4 AND created_at >= $3
         AND (($1::bytea IS NOT NULL AND identifier_hash = $1::bytea) OR ($2::inet IS NOT NULL AND ip_address = $2::inet))`, [identifierHash, ip, since, isAdmin]);
      return r.n;
    },
    deleteLoginAttemptsBefore: (before) => db.query('DELETE FROM login_attempts WHERE created_at < $1', [before]),

    // ---- audit ----
    writeAudit: ({ actorId = null, actorLabel, action, entityType = null, entityId = null, metadata = {}, ip = null }) => db.query(
      'INSERT INTO admin_audit_logs (actor_id, actor_label, action, entity_type, entity_id, metadata, ip_address) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)',
      [actorId, actorLabel, action, entityType, entityId, JSON.stringify(metadata), ip]),
  };
}
