export class AppError extends Error {
  /** @param {number} status HTTP status  @param {string} code stable machine-readable code  @param {string} message safe to show to clients */
  constructor(status, code, message, details, headers) { super(message); this.name = 'AppError'; this.status = status; this.code = code; this.details = details; this.headers = headers; }
}
export const badRequest = (message = 'Invalid request', details) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this resource') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message);
export const validationError = (details) => new AppError(422, 'validation_failed', 'Some fields are invalid', details);
export const conflict = (code, message) => new AppError(409, code, message);
export const tooManyRequests = (retryAfterSeconds, code = 'too_many_attempts', message = 'Too many attempts. Please try again later.') =>
  new AppError(429, code, message, { retryAfterSeconds }, { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) });
