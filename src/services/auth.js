// Authentication rules: registration, password sign-in, admin sign-in with persisted lockout, password change.
// Pure of HTTP: depends on a store, a session service, a hasher and a clock, all injectable for tests.
import { AppError, conflict, tooManyRequests, validationError } from '../utils/errors.js';
import { DuplicateError } from '../models/pgStore.js';
import { identifierHash } from './tokens.js';
import { nextLocalMidnight, startOfLocalDay } from './time.js';
import * as defaultHasher from './passwords.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeEmail = (e) => String(e ?? '').trim().toLowerCase();
export const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/;

export const invalidCredentials = () => new AppError(401, 'invalid_credentials', 'Incorrect credentials. Please check and try again.');

/** Public view of a user for API responses. Never includes the password hash or lockout internals. */
export function toPublicUser(user, oauthProviders = []) {
  return {
    id: user.id, name: user.displayName, email: user.email, username: user.username ?? null, roles: user.roles,
    signInMethod: user.passwordHash ? 'password' : 'oauth', oauthProviders, hasPassword: Boolean(user.passwordHash),
    mustChangePassword: Boolean(user.mustChangePassword), department: user.department ?? null, studyLevel: user.studyLevel ?? null, bio: user.bio ?? null,
  };
}

export function createAuthService({ store, sessions, config, hasher = defaultHasher, hasherParams, clock = () => new Date() }) {
  const secret = config.sessionSecret; const a = config.auth;
  const hashPw = (pw) => hasher.hashPassword(pw, hasherParams ?? hasher.DEFAULT_PARAMS);
  const dummy = () => hasher.dummyHash(hasherParams ?? hasher.DEFAULT_PARAMS);
  const retryIn = (until) => Math.max(1, Math.ceil((until.getTime() - clock().getTime()) / 1000));

  function checkEmail(email) {
    if (!EMAIL_RE.test(email) || email.length > 254) throw validationError({ email: 'Enter a valid email address.' });
    if (config.allowedEmailDomains.length && !config.allowedEmailDomains.includes(email.split('@')[1])) {
      throw validationError({ email: `Please use your institution email (${config.allowedEmailDomains.map((d) => `@${d}`).join(', ')}).` });
    }
  }
  const passwordIdentifiers = ({ email, name, username }) => [email?.split('@')[0], username, ...String(name ?? '').split(/\s+/)];

  /** Verifies against the real hash, or a dummy one, so response time does not reveal whether an account exists. */
  async function checkPassword(user, password) {
    if (user?.passwordHash) return hasher.verifyPassword(password, user.passwordHash);
    await hasher.verifyPassword(password, await dummy()); return false;
  }
  async function maybeRehash(user, password) {
    if (hasher.needsRehash(user.passwordHash, hasherParams ?? hasher.DEFAULT_PARAMS)) await store.setPassword(user.id, await hashPw(password), { mustChangePassword: user.mustChangePassword });
  }
  async function issueSession(user, kind, { ip, userAgent }) {
    const { token, session } = await sessions.create({ userId: user.id, kind, ip, userAgent });
    return { token, session, user, oauthProviders: await store.listOAuthProviders(user.id) };
  }

  return {
    checkEmail, issueSession,

    async register({ name, email, password, ip, userAgent }) {
      const errors = {}; const displayName = String(name ?? '').replace(/\s+/g, ' ').trim(); const mail = normalizeEmail(email);
      if (displayName.length < 2 || displayName.length > 80 || /[\u0000-\u001f<>]/.test(displayName)) errors.name = 'Enter your name (2–80 characters, no < or >).';
      try { checkEmail(mail); } catch (e) { errors.email = e.details.email; }
      const problems = hasher.validatePassword(password, { kind: 'user', identifiers: passwordIdentifiers({ email: mail, name: displayName }) });
      if (problems.length) errors.password = problems.join(' ');
      if (Object.keys(errors).length) throw validationError(errors);
      try {
        const user = await store.createUser({ email: mail, displayName, passwordHash: await hashPw(password), role: 'student' });
        return await issueSession(user, 'user', { ip, userAgent });
      } catch (err) {
        if (err instanceof DuplicateError) throw conflict('registration_failed', 'We could not create an account with these details. If you already have an account, sign in instead.');
        throw err;
      }
    },

    /** Student/lecturer sign-in by email. Admin accounts cannot sign in here (they use adminLogin). */
    async login({ email, password, ip, userAgent }) {
      const mail = normalizeEmail(email); const now = clock();
      if (!EMAIL_RE.test(mail) || typeof password !== 'string' || !password || password.length > 128) throw invalidCredentials();
      const idHash = identifierHash(secret, mail); const since = new Date(now.getTime() - a.throttleWindowMs);
      const [byId, byIp] = await Promise.all([
        store.countRecentFailures({ identifierHash: idHash, since, isAdmin: false }),
        ip ? store.countRecentFailures({ ip, since, isAdmin: false }) : 0,
      ]);
      if (byId >= a.userMaxFailuresPerWindow || byIp >= a.userMaxFailuresPerWindow * 4) throw tooManyRequests(a.throttleWindowMs / 1000);
      const user = await store.findUserByEmail(mail);
      const eligible = user && user.status === 'active' && !user.roles.includes('admin');
      const ok = await checkPassword(eligible ? user : null, password);
      await store.recordLoginAttempt({ userId: user?.id ?? null, identifierHash: idHash, ip, succeeded: ok, isAdmin: false, now });
      if (!ok) throw invalidCredentials();
      await store.registerSuccessfulLogin(user.id, now);
      await maybeRehash(user, password);
      return issueSession(user, 'user', { ip, userAgent });
    },

    /**
     * Admin sign-in by username. After `adminMaxFailures` consecutive wrong passwords the account is locked until the next
     * calendar day in SERVER_TIMEZONE. The lock is persisted (survives restarts, devices, cleared storage, IP changes).
     * Unknown usernames follow the same rule using login_attempts, and every response has the same shape, so nothing
     * reveals whether an admin account exists. Password verification is skipped while locked (no oracle during a lock).
     */
    async adminLogin({ username, password, ip, userAgent }) {
      const id = String(username ?? '').trim().toLowerCase(); const now = clock();
      if (!id || id.length > 64 || typeof password !== 'string' || !password || password.length > 128) throw invalidCredentials();
      const idHash = identifierHash(secret, id); const tz = config.timezone; const max = a.adminMaxFailures;
      const paused = (until) => new AppError(423, 'sign_in_paused', 'Sign-in is paused after too many incorrect attempts. Try again after midnight.', { lockedUntil: until.toISOString(), retryAfterSeconds: retryIn(until) }, { 'Retry-After': String(retryIn(until)) });

      const ipFailures = ip ? await store.countRecentFailures({ ip, since: new Date(now.getTime() - a.throttleWindowMs), isAdmin: true }) : 0;
      if (ipFailures >= max * 5) throw tooManyRequests(a.throttleWindowMs / 1000);

      const found = await store.findUserByUsername(id);
      const user = found && found.roles.includes('admin') ? found : null;
      if (user?.lockedUntil && user.lockedUntil > now) throw paused(user.lockedUntil);
      const dayStart = startOfLocalDay(now, tz);
      if (!user) { // unknown name (or not an admin): same rule, derived from recorded attempts
        const today = await store.countRecentFailures({ identifierHash: idHash, since: dayStart, isAdmin: true });
        if (today >= max) throw paused(nextLocalMidnight(now, tz));
      }

      const ok = user?.status === 'active' ? await checkPassword(user, password) : await checkPassword(null, password);
      await store.recordLoginAttempt({ userId: user?.id ?? null, identifierHash: idHash, ip, succeeded: ok, isAdmin: true, now });

      if (!ok) {
        let remaining;
        if (user) {
          const r = await store.registerFailedLogin(user.id, { now, max, lockUntil: nextLocalMidnight(now, tz) });
          if (r.lockedUntil && r.lockedUntil > now) {
            await store.writeAudit({ actorId: user.id, actorLabel: user.username, action: 'Admin account locked after repeated failed sign-ins', entityType: 'user', entityId: user.id, metadata: { lockedUntil: r.lockedUntil.toISOString() }, ip });
            throw paused(r.lockedUntil);
          }
          remaining = max - r.failedCount;
        } else {
          const today = await store.countRecentFailures({ identifierHash: idHash, since: dayStart, isAdmin: true });
          if (today >= max) throw paused(nextLocalMidnight(now, tz));
          remaining = max - today;
        }
        throw new AppError(401, 'invalid_credentials', 'Incorrect username or password.', { attemptsRemaining: remaining });
      }
      await store.registerSuccessfulLogin(user.id, now);
      await maybeRehash(user, password);
      await store.writeAudit({ actorId: user.id, actorLabel: user.username, action: 'Admin signed in', entityType: 'user', entityId: user.id, ip });
      return issueSession(user, 'admin', { ip, userAgent });
    },

    /** Changes the signed-in user's password. The current password is verified server-side and failures are throttled. */
    async changePassword({ user, session, currentPassword, newPassword, confirmPassword, ip }) {
      if (!user.passwordHash) throw new AppError(400, 'no_password', 'Your account signs in with Google or GitHub, so there is no password to change here.');
      const now = clock(); const idHash = identifierHash(secret, `pw-change:${user.id}`);
      if (await store.countRecentFailures({ identifierHash: idHash, since: new Date(now.getTime() - a.throttleWindowMs), isAdmin: false }) >= 5) throw tooManyRequests(a.throttleWindowMs / 1000);
      const errors = {};
      if (typeof currentPassword !== 'string' || !currentPassword) errors.currentPassword = 'Enter your current password.';
      const kind = user.roles.includes('admin') ? 'admin' : 'user';
      const problems = hasher.validatePassword(newPassword, { kind, identifiers: passwordIdentifiers(user) });
      if (problems.length) errors.newPassword = problems.join(' ');
      if (confirmPassword !== undefined && confirmPassword !== newPassword) errors.confirmPassword = 'Passwords do not match.';
      if (Object.keys(errors).length) throw validationError(errors);
      const ok = await hasher.verifyPassword(currentPassword, user.passwordHash);
      await store.recordLoginAttempt({ userId: user.id, identifierHash: idHash, ip, succeeded: ok, isAdmin: false, now });
      if (!ok) throw validationError({ currentPassword: 'Your current password is incorrect.' });
      if (await hasher.verifyPassword(newPassword, user.passwordHash)) throw validationError({ newPassword: 'Choose a password you have not used before.' });
      await store.setPassword(user.id, await hashPw(newPassword), { mustChangePassword: false });
      await sessions.destroyAllExcept(user.id, session.id); // other devices must sign in again with the new password
      if (kind === 'admin') await store.writeAudit({ actorId: user.id, actorLabel: user.username, action: 'Admin changed password', entityType: 'user', entityId: user.id, ip });
      return { ok: true };
    },
  };
}
