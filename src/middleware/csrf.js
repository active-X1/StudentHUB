// Defence in depth against cross-site request forgery for a cookie-session API:
//  1. SameSite=Lax cookies (set elsewhere)
//  2. originCheck: unsafe methods must come from our own origin (Origin header, or Sec-Fetch-Site when Origin is absent)
//  3. requireJsonBody: bodies must be application/json, which a plain cross-site <form> cannot send
//  4. csrfProtect: authenticated unsafe routes need the per-session X-CSRF-Token header
import { AppError, forbidden, unauthorized } from '../utils/errors.js';
import { safeEqual } from '../services/tokens.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function originCheck(config) {
  return (req, res, next) => {
    if (!UNSAFE.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin !== undefined) return origin === config.origin ? next() : next(forbidden('Cross-site requests are not allowed.'));
    const site = req.get('sec-fetch-site');
    return site === 'cross-site' || site === 'same-site' ? next(forbidden('Cross-site requests are not allowed.')) : next();
  };
}
export function requireJsonBody(req, res, next) {
  if (!UNSAFE.has(req.method)) return next();
  const hasBody = Number(req.get('content-length') || 0) > 0 || Boolean(req.get('transfer-encoding'));
  if (hasBody && !/^application\/json(\s*;|$)/i.test(req.get('content-type') || '')) return next(new AppError(415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json.'));
  return next();
}
const csrfFailed = () => new AppError(403, 'csrf_failed', 'Your session could not be verified. Reload the page and try again.');
export function csrfProtect(req, res, next) {
  if (!req.auth) return next(unauthorized());
  const sent = req.get('x-csrf-token');
  return sent && safeEqual(sent, req.auth.csrfToken) ? next() : next(csrfFailed());
}
/** For logout: signed-in requests must prove intent; a request without a session just clears the cookie. */
export function csrfProtectIfAuthed(req, res, next) { return req.auth ? csrfProtect(req, res, next) : next(); }
