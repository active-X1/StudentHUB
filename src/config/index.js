// Environment parsing and validation. Pure: `loadConfig(env)` takes an env object so it is easy to test.
// Fails fast with a readable list of problems; never prints secret values.
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const LEVELS = ['debug', 'info', 'warn', 'error'];

export class ConfigError extends Error {
  constructor(problems) { super(`Invalid configuration:\n - ${problems.join('\n - ')}`); this.name = 'ConfigError'; this.problems = problems; }
}

function parseBool(v, fallback) {
  if (v === undefined || v === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|no|off)$/i.test(v)) return false;
  return undefined; // invalid
}
function validTimeZone(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }

export function loadConfig(env = process.env) {
  const problems = [];
  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) problems.push('NODE_ENV must be development, test or production');
  const isProd = nodeEnv === 'production';

  const port = env.PORT === undefined || env.PORT === '' ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) problems.push('PORT must be an integer between 0 and 65535');

  const logLevel = env.LOG_LEVEL || 'info';
  if (!LEVELS.includes(logLevel)) problems.push(`LOG_LEVEL must be one of ${LEVELS.join(', ')}`);

  const timezone = env.SERVER_TIMEZONE || 'UTC';
  if (!validTimeZone(timezone)) problems.push('SERVER_TIMEZONE must be a valid IANA time zone, for example UTC or Africa/Lagos');

  // Trust proxy: a hop count (e.g. 1) or a named/CIDR value. "true" is rejected because trusting every
  // hop lets clients spoof their IP (which would defeat rate limiting and lockouts in Phase 3).
  let trustProxy = false; const tp = env.TRUST_PROXY;
  if (tp !== undefined && tp !== '' && tp !== '0' && tp !== 'false') {
    if (tp === 'true') problems.push('TRUST_PROXY=true is unsafe; use a hop count such as 1');
    else trustProxy = /^\d+$/.test(tp) ? Number(tp) : tp;
  }

  const databaseUrl = env.DATABASE_URL || '';
  if (databaseUrl && !/^postgres(ql)?:\/\//i.test(databaseUrl)) problems.push('DATABASE_URL must start with postgres:// or postgresql://');
  if (isProd && !databaseUrl) problems.push('DATABASE_URL is required in production');

  const poolMax = env.DB_POOL_MAX ? Number(env.DB_POOL_MAX) : 10;
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) problems.push('DB_POOL_MAX must be an integer between 1 and 100');

  const ssl = (env.DB_SSL || 'false').toLowerCase();
  if (!['false', 'true', 'no-verify'].includes(ssl)) problems.push('DB_SSL must be false, true or no-verify');

  const adminUi = parseBool(env.ADMIN_UI_ENABLED, true);
  if (adminUi === undefined) problems.push('ADMIN_UI_ENABLED must be true or false');

  const appBaseUrl = env.APP_BASE_URL || `http://localhost:${port}`;
  let origin = null;
  try { origin = new URL(appBaseUrl).origin; } catch { problems.push('APP_BASE_URL must be a valid URL'); }
  if (isProd && origin && !origin.startsWith('https://')) problems.push('APP_BASE_URL must be https in production (session cookies are Secure)');
  const secureCookies = origin ? origin.startsWith('https://') : isProd;

  // Session secret: signs OAuth state, derives CSRF tokens and keys the login-attempt hashes.
  let sessionSecret = env.SESSION_SECRET || ''; let ephemeralSecret = false;
  if (sessionSecret && sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters (try: openssl rand -base64 48)');
  if (!sessionSecret) {
    if (isProd) problems.push('SESSION_SECRET is required in production');
    else { sessionSecret = randomBytes(48).toString('base64url'); ephemeralSecret = true; }
  }

  const oauth = {};
  for (const name of ['google', 'github']) {
    const id = env[`${name.toUpperCase()}_CLIENT_ID`] || ''; const secret = env[`${name.toUpperCase()}_CLIENT_SECRET`] || '';
    if (Boolean(id) !== Boolean(secret)) problems.push(`${name.toUpperCase()}_CLIENT_ID and ${name.toUpperCase()}_CLIENT_SECRET must be set together`);
    oauth[name] = Object.freeze({ enabled: Boolean(id && secret), clientId: id, clientSecret: secret });
  }
  const allowedEmailDomains = (env.ALLOWED_EMAIL_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  for (const d of allowedEmailDomains) if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) problems.push(`ALLOWED_EMAIL_DOMAINS contains an invalid domain: ${d}`);

  if (problems.length) throw new ConfigError(problems);
  const warnings = [];
  if (isProd && ssl === 'no-verify') warnings.push('DB_SSL=no-verify does not verify the database certificate.');
  if (ephemeralSecret) warnings.push('SESSION_SECRET is not set: using a random per-process secret (OAuth sign-ins and CSRF tokens reset on restart). Set it in .env.');
  if (isProd && !allowedEmailDomains.length) warnings.push('ALLOWED_EMAIL_DOMAINS is empty: anyone with an email address can register. Set it to your institution domain(s) if sign-up should be restricted.');

  return Object.freeze({
    env: nodeEnv, isProd, port, logLevel, timezone, trustProxy, appBaseUrl, warnings,
    adminUiEnabled: adminUi, origin, sessionSecret, ephemeralSecret, allowedEmailDomains: Object.freeze(allowedEmailDomains),
    oauth: Object.freeze(oauth),
    cookies: Object.freeze({ secure: secureCookies, sessionName: secureCookies ? '__Host-sid' : 'sid', oauthName: secureCookies ? '__Host-oauth' : 'oauth' }),
    // Session and lockout policy. Admin sessions are deliberately short.
    auth: Object.freeze({
      userSessionAbsoluteMs: 14 * 24 * 3600e3, userSessionIdleMs: 7 * 24 * 3600e3,
      adminSessionAbsoluteMs: 8 * 3600e3, adminSessionIdleMs: 30 * 60e3,
      adminMaxFailures: 3, userMaxFailuresPerWindow: 8, throttleWindowMs: 15 * 60e3,
      oauthStateTtlMs: 10 * 60e3,
    }),
    db: Object.freeze({ url: databaseUrl || null, poolMax, ssl }),
  });
}

/** Loads ./.env when present (Node 20.12+). Real environment variables always win over the file. */
export function loadEnvFile(file = '.env') {
  if (typeof process.loadEnvFile === 'function' && existsSync(file)) process.loadEnvFile(file);
}

/** Safe-to-log view of the config: the database URL is reduced to host/database, never credentials. */
export function describeConfig(c) {
  let db = 'not configured';
  if (c.db.url) { try { const u = new URL(c.db.url); db = `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`; } catch { db = 'configured'; } }
  return { env: c.env, port: c.port, timezone: c.timezone, logLevel: c.logLevel, trustProxy: c.trustProxy, adminUi: c.adminUiEnabled, oauthProviders: Object.entries(c.oauth).filter(([, v]) => v.enabled).map(([k]) => k), allowedEmailDomains: c.allowedEmailDomains, database: db, dbSsl: c.db.ssl };
}
