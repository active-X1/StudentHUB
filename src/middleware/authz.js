import { AppError, forbidden, unauthorized } from '../utils/errors.js';

export const requireAuth = (req, res, next) => (req.auth ? next() : next(unauthorized()));
/** Admin routes need an admin ROLE and a session created by the admin sign-in (kind "admin"). */
export function requireAdmin(req, res, next) {
  if (!req.auth) return next(unauthorized());
  return req.auth.roles.includes('admin') && req.auth.session.kind === 'admin' ? next() : next(forbidden());
}
/** Accounts flagged must_change_password (the bootstrapped admin) can do nothing but change the password or sign out. */
export function passwordChangeGate(req, res, next) {
  return req.auth?.user.mustChangePassword ? next(new AppError(403, 'password_change_required', 'You must change your password before continuing.')) : next();
}
