import { AppError, notFound } from '../utils/errors.js';

/** Final 404 for anything no earlier handler claimed. API paths get JSON; others get plain text. */
export function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) return next(notFound());
  return res.status(404).type('text/plain').send('Not found');
}

/** Maps errors to a stable JSON shape. Unknown errors are logged in full but never leak details to clients. */
export function errorHandler(logger) {
  // Express identifies error handlers by arity (4 arguments): keep `next` even though it is rarely used.
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    let status = 500; let code = 'internal_error'; let message = 'Something went wrong. Please try again.'; let details;
    if (err instanceof AppError) { ({ status, code, message, details } = err); if (err.headers) res.set(err.headers); }
    else if (err?.type === 'entity.too.large') { status = 413; code = 'payload_too_large'; message = 'The request body is too large.'; }
    else if (err?.type === 'entity.parse.failed') { status = 400; code = 'invalid_json'; message = 'The request body is not valid JSON.'; }
    else if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) { status = err.status; code = 'bad_request'; message = 'The request could not be processed.'; }
    if (status >= 500) logger.error('request_failed', { requestId: res.locals.requestId, method: req.method, path: req.originalUrl.split('?')[0], err });
    return res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: res.locals.requestId } });
  };
}
