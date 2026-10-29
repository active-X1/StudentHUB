// Random tokens, hashing, HMACs and signed values. Everything here is deterministic given its inputs (except newToken).
import crypto from 'node:crypto';

export const newToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest(); // Buffer (matches sessions.token_hash bytea)
export const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest(); // Buffer
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
/** Per-session CSRF token: unguessable without SESSION_SECRET, bound to one session, never stored. */
export const csrfTokenFor = (secret, sessionId) => hmac(secret, `csrf:${sessionId}`).toString('base64url');
/** Keyed hash of a login identifier so failed attempts for unknown names can be throttled without storing the name. */
export const identifierHash = (secret, identifier) => hmac(secret, `login-id:${String(identifier).trim().toLowerCase()}`);

/** value -> "payload.signature" (base64url). Used for the short-lived OAuth state cookie. */
export function signValue(secret, value) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${hmac(secret, `signed:${payload}`).toString('base64url')}`;
}
/** Returns the original value, or null if the signature is wrong, the format is bad, or `exp` (ms epoch) has passed. */
export function verifySigned(secret, token, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, hmac(secret, `signed:${payload}`).toString('base64url'))) return null;
  try { const v = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return v && (v.exp === undefined || v.exp > now) ? v : null; }
  catch { return null; }
}
