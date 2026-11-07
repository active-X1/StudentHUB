// Periodic cleanup so expired sessions and old login-attempt rows do not accumulate forever.
const DAY = 86400e3;
export const LOGIN_ATTEMPT_RETENTION_DAYS = 30;

import { sweepOrphanFiles } from './attachments.js';

export async function runHousekeeping(store, now = new Date(), { storage = null, logger = null } = {}) {
  await store.deleteExpiredSessions(now);
  await store.deleteLoginAttemptsBefore(new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_DAYS * DAY));
  if (storage && logger) await sweepOrphanFiles({ store, storage, logger }); // files whose database rows are gone (crashed uploads, failed cleanups)
}
/** Runs once at start-up and then hourly. Failures are logged, never thrown. Returns a stop function. */
export function startHousekeeping({ store, logger, storage = null, intervalMs = 3600e3 }) {
  const tick = () => runHousekeeping(store, new Date(), { storage, logger }).catch((err) => logger.error('housekeeping_failed', err));
  tick(); const timer = setInterval(tick, intervalMs); timer.unref();
  return () => clearInterval(timer);
}
