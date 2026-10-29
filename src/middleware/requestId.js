import { randomUUID } from 'node:crypto';
const SAFE = /^[A-Za-z0-9._-]{8,64}$/; // inbound ids are accepted only if harmless to log (prevents log injection)
export function requestId(req, res, next) {
  const inbound = req.get('x-request-id');
  const id = inbound && SAFE.test(inbound) ? inbound : randomUUID();
  res.locals.requestId = id; res.set('X-Request-Id', id); next();
}
