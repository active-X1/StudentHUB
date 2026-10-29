// Admin UI gate. /admin serves only the sign-in shell; the dashboard module is served to authenticated admin sessions only
// (adminDashboardAuth). Turning ADMIN_UI_ENABLED off makes every admin UI path answer 404 like any unknown path.
// Real authorization for data lives in requireAdmin on /api/v1/admin/*.
import path from 'node:path';

export const DASHBOARD_PATH = '/assets/js/pages/admin-dashboard.js';

export function normalizeRequestPath(rawPath) {
  let p = rawPath;
  try { p = decodeURIComponent(rawPath); } catch { /* malformed encoding: static handler will reject it */ }
  return path.posix.normalize(p.replace(/\\/g, '/')).replace(/\/{2,}/g, '/').toLowerCase();
}
export function isAdminUiPath(rawPath) {
  const p = normalizeRequestPath(rawPath);
  return p === '/admin' || p.startsWith('/admin/') || p === '/assets/js/pages/admin.js' || p === DASHBOARD_PATH;
}
export function adminUiGate(config) {
  return (req, res, next) => {
    if (!isAdminUiPath(req.path)) return next();
    if (!config.adminUiEnabled) return res.status(404).type('text/plain').send('Not found');
    res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
    return next();
  };
}

/**
 * The dashboard module is only sent to a signed-in admin session; everyone else gets the same 404 as an unknown file.
 * It loads the session itself (only for this one path) so ordinary static requests never touch the database. The path is
 * normalised first, so encoded or differently-cased spellings cannot bypass it.
 */
export function adminDashboardGuard({ cookieParser, loadSession }) {
  return (req, res, next) => {
    if (normalizeRequestPath(req.path) !== DASHBOARD_PATH) return next();
    cookieParser(req, res, () => loadSession(req, res, (err) => {
      if (err) return next(err);
      const a = req.auth;
      if (a?.roles.includes('admin') && a.session.kind === 'admin') { res.set('Cache-Control', 'no-store'); return next(); }
      return res.status(404).type('text/plain').send('Not found');
    }));
  };
}
