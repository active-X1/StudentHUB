// Fixed-window, in-memory rate limiter. PER INSTANCE: behind several instances the effective limit multiplies, which is why
// sign-in throttling and the admin lockout are ALSO enforced from PostgreSQL (login_attempts / users), not just here.
import { tooManyRequests } from '../utils/errors.js';

export function createRateLimiter({ name, windowMs, max, keyFn = (req) => req.ip ?? 'unknown', clock = () => Date.now() }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = clock();
    if (hits.size > 10000) { for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); if (hits.size > 50000) hits.clear(); }
    const key = `${name}:${keyFn(req)}`; let e = hits.get(key);
    if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(key, e); }
    e.count += 1;
    return e.count > max ? next(tooManyRequests((e.reset - now) / 1000, 'rate_limited', 'Too many requests. Please slow down and try again shortly.')) : next();
  };
}
