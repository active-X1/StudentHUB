// Google and GitHub sign-in via the OAuth 2.0 authorization-code flow, implemented directly (no OAuth library).
// Protections: random `state` bound to the browser by a signed, short-lived HttpOnly cookie (CSRF on the callback),
// PKCE for Google, exact redirect URIs built from APP_BASE_URL, a verified provider email, and no silent account linking.
import { createHash } from 'node:crypto';
import { AppError, conflict, validationError } from '../utils/errors.js';
import { newToken, safeEqual, signValue, verifySigned } from './tokens.js';

export const PROVIDERS = Object.freeze({
  google: { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', userUrl: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid email profile', pkce: true },
  github: { authUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', userUrl: 'https://api.github.com/user', emailsUrl: 'https://api.github.com/user/emails', scope: 'read:user user:email', pkce: false },
});
const challengeFor = (verifier) => createHash('sha256').update(verifier).digest('base64url');

export function createOAuthService({ config, store, auth, fetchFn = globalThis.fetch, clock = () => Date.now() }) {
  const redirectUri = (p) => `${config.origin}/api/v1/auth/${p}/callback`;
  const need = (p) => { if (!PROVIDERS[p] || !config.oauth[p]?.enabled) throw new AppError(404, 'provider_unavailable', 'This sign-in method is not available.'); return { def: PROVIDERS[p], cred: config.oauth[p] }; };
  const http = async (url, init = {}) => {
    const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', 'User-Agent': 'student-hub', ...init.headers } });
    if (!res.ok) throw new AppError(502, 'oauth_provider_error', 'The sign-in provider could not complete the request. Please try again.');
    return res.json();
  };

  return {
    /** Returns the provider URL to redirect to, plus the signed cookie value that must be set on the browser. */
    begin(provider) {
      const { def, cred } = need(provider);
      const state = newToken(24); const verifier = newToken(48);
      const params = new URLSearchParams({ client_id: cred.clientId, redirect_uri: redirectUri(provider), response_type: 'code', scope: def.scope, state });
      if (def.pkce) { params.set('code_challenge', challengeFor(verifier)); params.set('code_challenge_method', 'S256'); }
      if (provider === 'google') params.set('prompt', 'select_account');
      return { url: `${def.authUrl}?${params}`, cookieValue: signValue(config.sessionSecret, { p: provider, s: state, v: verifier, exp: clock() + config.auth.oauthStateTtlMs }) };
    },

    async complete(provider, { code, state, cookieValue, ip, userAgent }) {
      const { def, cred } = need(provider);
      const saved = verifySigned(config.sessionSecret, cookieValue, clock());
      if (!saved || saved.p !== provider || typeof state !== 'string' || !safeEqual(saved.s, state) || typeof code !== 'string' || !code || code.length > 2048) {
        throw new AppError(400, 'oauth_state_invalid', 'The sign-in attempt expired or was not started from this browser. Please try again.');
      }
      const body = new URLSearchParams({ client_id: cred.clientId, client_secret: cred.clientSecret, code, redirect_uri: redirectUri(provider), grant_type: 'authorization_code' });
      if (def.pkce) body.set('code_verifier', saved.v);
      const tok = await http(def.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!tok.access_token) throw new AppError(502, 'oauth_provider_error', 'The sign-in provider did not return an access token.');
      const authz = { Authorization: `Bearer ${tok.access_token}` };

      let profile;
      if (provider === 'google') {
        const u = await http(def.userUrl, { headers: authz });
        profile = { id: u.sub, email: u.email, verified: u.email_verified === true, name: u.name, avatar: u.picture };
      } else {
        const u = await http(def.userUrl, { headers: authz });
        const emails = await http(def.emailsUrl, { headers: authz });
        const pick = Array.isArray(emails) ? (emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified)) : null;
        profile = { id: u.id, email: pick?.email, verified: Boolean(pick), name: u.name || u.login, avatar: u.avatar_url };
      }
      const email = String(profile.email ?? '').trim().toLowerCase(); const providerUserId = String(profile.id ?? '');
      if (!providerUserId || !email || !profile.verified) throw validationError({ email: 'Your account needs a verified email address to sign in this way.' });
      auth.checkEmail(email); // institution-domain restriction applies to OAuth sign-up and sign-in alike

      let user = await store.findUserByOAuthIdentity(provider, providerUserId);
      if (!user) {
        // Never auto-link to an existing account that has the same email: its owner may not control that address
        // (email is not verified at password registration). Linking will be an explicit action for a signed-in user.
        if (await store.findUserByEmail(email)) throw conflict('oauth_email_in_use', 'An account with this email already exists. Sign in with your password instead.');
        const displayName = String(profile.name || email.split('@')[0]).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80) || 'Student';
        user = await store.createUser({ email, displayName, role: 'student', emailVerifiedAt: new Date(clock()), avatarUrl: typeof profile.avatar === 'string' && profile.avatar.startsWith('https://') ? profile.avatar : null, oauth: { provider, providerUserId, providerEmail: email } });
      }
      if (user.status !== 'active' || user.roles.includes('admin')) throw new AppError(403, 'oauth_not_allowed', 'This account cannot sign in with Google or GitHub.');
      await store.registerSuccessfulLogin(user.id, new Date(clock()));
      return auth.issueSession(user, 'user', { ip, userAgent });
    },
  };
}
