// Loads req.auth ({ user, session, roles, csrfToken }) from the session cookie, or sets it to null.
import { appendSetCookie, serializeCookie } from './cookies.js';
import { csrfTokenFor } from '../services/tokens.js';

export function sessionCookieOptions(config, kind) {
  return { httpOnly: true, secure: config.cookies.secure, sameSite: 'Lax', path: '/', ...(kind === 'admin' ? {} : { maxAge: config.auth.userSessionAbsoluteMs / 1000 }) }; // admin cookies end with the browser session
}
export function loadSession({ sessions, config }) {
  return async (req, res, next) => {
    req.auth = null;
    const token = req.cookies?.[config.cookies.sessionName];
    if (!token) return next();
    try {
      const found = await sessions.authenticate(token);
      if (found) req.auth = { ...found, csrfToken: csrfTokenFor(config.sessionSecret, found.session.id) };
      else appendSetCookie(res, serializeCookie(config.cookies.sessionName, '', { ...sessionCookieOptions(config, 'admin'), maxAge: 0 })); // stale cookie: clear it
      return next();
    } catch (err) { return next(err); }
  };
}
