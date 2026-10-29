// HTTP adapters for authentication. Business rules live in services/; this file only maps requests/responses and cookies.
import { appendSetCookie, serializeCookie } from '../middleware/cookies.js';
import { sessionCookieOptions } from '../middleware/session.js';
import { csrfTokenFor } from '../services/tokens.js';
import { toPublicUser } from '../services/auth.js';
import { AppError } from '../utils/errors.js';

const OAUTH_ERROR_CODES = new Set(['oauth_state_invalid', 'oauth_email_in_use', 'oauth_not_allowed', 'oauth_provider_error', 'validation_failed', 'provider_unavailable']);

export function createAuthController({ auth, oauth, sessions, store, config }) {
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
  const features = { google: config.oauth.google.enabled, github: config.oauth.github.enabled, allowedEmailDomains: config.allowedEmailDomains };
  const setSession = (res, token, kind) => appendSetCookie(res, serializeCookie(config.cookies.sessionName, token, sessionCookieOptions(config, kind)));
  const clearSession = (res) => appendSetCookie(res, serializeCookie(config.cookies.sessionName, '', { ...sessionCookieOptions(config, 'admin'), maxAge: 0 }));
  const sessionPayload = (r) => ({ user: toPublicUser(r.user, r.oauthProviders), csrfToken: csrfTokenFor(config.sessionSecret, r.session.id), sessionKind: r.session.kind });

  return {
    async session(req, res) {
      if (!req.auth) return res.json({ authenticated: false, features });
      const providers = await store.listOAuthProviders(req.auth.user.id);
      return res.json({ authenticated: true, user: toPublicUser(req.auth.user, providers), csrfToken: req.auth.csrfToken, sessionKind: req.auth.session.kind, features });
    },
    async register(req, res) {
      const b = body(req); const r = await auth.register({ name: b.name, email: b.email, password: b.password, ip: req.ip, userAgent: req.get('user-agent') });
      setSession(res, r.token, 'user'); return res.status(201).json(sessionPayload(r));
    },
    async login(req, res) {
      const b = body(req); const r = await auth.login({ email: b.email, password: b.password, ip: req.ip, userAgent: req.get('user-agent') });
      setSession(res, r.token, 'user'); return res.json(sessionPayload(r));
    },
    async adminLogin(req, res) {
      const b = body(req); const r = await auth.adminLogin({ username: b.username, password: b.password, ip: req.ip, userAgent: req.get('user-agent') });
      setSession(res, r.token, 'admin'); return res.json(sessionPayload(r));
    },
    async logout(req, res) {
      if (req.auth) await sessions.destroy(req.auth.session.id);
      clearSession(res); return res.json({ ok: true });
    },
    async changePassword(req, res) {
      const b = body(req);
      await auth.changePassword({ user: req.auth.user, session: req.auth.session, currentPassword: b.currentPassword, newPassword: b.newPassword, confirmPassword: b.confirmPassword, ip: req.ip });
      return res.json({ ok: true });
    },
    adminMe(req, res) { return res.json({ user: toPublicUser(req.auth.user), sessionKind: req.auth.session.kind }); },

    oauthStart: (provider) => (req, res) => {
      const { url, cookieValue } = oauth.begin(provider);
      appendSetCookie(res, serializeCookie(config.cookies.oauthName, cookieValue, { httpOnly: true, secure: config.cookies.secure, sameSite: 'Lax', path: '/', maxAge: config.auth.oauthStateTtlMs / 1000 }));
      res.set('Cache-Control', 'no-store'); return res.redirect(url);
    },
    oauthCallback: (provider) => async (req, res) => {
      const clearState = () => appendSetCookie(res, serializeCookie(config.cookies.oauthName, '', { httpOnly: true, secure: config.cookies.secure, sameSite: 'Lax', path: '/', maxAge: 0 }));
      res.set('Cache-Control', 'no-store'); clearState(); // the state is single-use whatever happens next
      if (req.query?.error) return res.redirect('/login.html?error=oauth_denied');
      try {
        const r = await oauth.complete(provider, { code: req.query?.code, state: req.query?.state, cookieValue: req.cookies?.[config.cookies.oauthName], ip: req.ip, userAgent: req.get('user-agent') });
        setSession(res, r.token, 'user'); return res.redirect('/index.html#/home');
      } catch (err) {
        const code = err instanceof AppError && OAUTH_ERROR_CODES.has(err.code) ? err.code : 'oauth_failed';
        return res.redirect(`/login.html?error=${code}`);
      }
    },
  };
}
