// Minimal cookie parsing/serialisation (no dependency). First occurrence of a name wins; malformed pairs are ignored.
export function parseCookieHeader(header) {
  const out = Object.create(null);
  if (!header || header.length > 4096) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('='); if (i < 1) continue;
    const name = part.slice(0, i).trim(); let value = part.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try { value = decodeURIComponent(value); } catch { continue; }
    if (!(name in out)) out[name] = value;
  }
  return out;
}
export function serializeCookie(name, value, { maxAge, httpOnly = true, secure = false, sameSite = 'Lax', path = '/' } = {}) {
  if (!/^[\w!#$%&'*+.^`|~-]+$/.test(name)) throw new Error('Invalid cookie name');
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (maxAge !== undefined) c += `; Max-Age=${Math.floor(maxAge)}`;
  if (httpOnly) c += '; HttpOnly';
  if (secure) c += '; Secure';
  return c;
}
/** Adds a Set-Cookie header without clobbering earlier ones (works with Express and plain Node responses). */
export function appendSetCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [...(Array.isArray(prev) ? prev : [String(prev)]), cookie] : [cookie]);
}
export function cookieParser(req, res, next) { req.cookies = parseCookieHeader(req.headers.cookie); next(); }
