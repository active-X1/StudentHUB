// Browser client for the Phase 3 auth API. Cookies are HttpOnly (JavaScript never sees the session token);
// state-changing calls send the per-session CSRF token returned by the API. NOTHING sensitive is stored in localStorage.
let csrfToken = null;
let current = { mode: 'demo' };
/** The most recent result of getSession() (so pages can ask whether a real signed-in session exists). */
export const currentSession = () => current;
export const isLive = () => current.mode === 'live' && current.authenticated === true;

export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.details = details ?? {}; }
}
async function call(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(`/api/v1${path}`, { method, credentials: 'same-origin', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await res.json(); } catch { /* not JSON: the static dev server answers 404 text */ }
  if (!res.ok) { const e = data?.error; throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `Request failed (${res.status})`, e?.details); }
  if (data?.csrfToken) csrfToken = data.csrfToken;
  return data;
}

/**
 * -> { mode: 'live', authenticated, user?, sessionKind?, features }   the API is running
 *    { mode: 'demo' }                                                  no API (static dev server, or the server has no database)
 *    { mode: 'offline' }                                               the network is unreachable
 */
export async function getSession() {
  try { current = { mode: 'live', ...(await call('GET', '/auth/session')) }; }
  catch (err) {
    if (err instanceof ApiError) current = err.status === 404 ? { mode: 'demo' } : { mode: 'live', authenticated: false, features: {}, error: err };
    else current = { mode: 'offline' };
  }
  return current;
}
export const register = (b) => call('POST', '/auth/register', b);
export const login = (b) => call('POST', '/auth/login', b);
export const adminLogin = (b) => call('POST', '/admin/auth/login', b);
export const changePassword = (b) => call('POST', '/auth/password', b);
export async function logout() { try { await call('POST', '/auth/logout'); } finally { csrfToken = null; current = { mode: current.mode, authenticated: false, features: current.features }; } }
export const startOAuth = (provider) => { location.href = `/api/v1/auth/${encodeURIComponent(provider)}`; };
