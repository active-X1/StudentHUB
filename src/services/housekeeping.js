// Periodic cleanup so expired sessions and old login-attempt rows do not accumulate forever.
const DAY = 86400e3;
export const LOGIN_ATTEMPT_RETENTION_DAYS = 30;

export async function runHousekeeping(store, now = new Date()) {
  await store.deleteExpiredSessions(now);
  await store.deleteLoginAttemptsBefore(new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_DAYS * DAY));
}
/** Runs once at start-up and then hourly. Failures are logged, never thrown. Returns a stop function. */
export function startHousekeeping({ store, logger, intervalMs = 3600e3 }) {
  const tick = () => runHousekeeping(store).catch((err) => logger.error('housekeeping_failed', err));
  tick(); const timer = setInterval(tick, intervalMs); timer.unref();
  return () => clearInterval(timer);
}
