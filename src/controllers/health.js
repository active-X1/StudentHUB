import { withTimeout } from '../utils/async.js';

/** Liveness: the process is up. Reveals nothing about versions, dependencies or configuration. */
export function liveness(req, res) {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString() });
}
/** Readiness: can we reach PostgreSQL? 503 when not, so load balancers stop routing here. */
export function readiness(db, { timeoutMs = 2000 } = {}) {
  return async (req, res) => {
    if (!db) return res.json({ status: 'ready', database: 'not_configured' });
    try { await withTimeout(db.ping(), timeoutMs, 'database ping'); return res.json({ status: 'ready', database: 'up' }); }
    catch { return res.status(503).json({ status: 'unavailable', database: 'down' }); }
  };
}
