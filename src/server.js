// Process entry point: load config, connect (lazily) to PostgreSQL, start HTTP, shut down gracefully.
import { loadConfig, loadEnvFile, describeConfig, ConfigError } from './config/index.js';
import { createLogger } from './utils/logger.js';
import { createDatabase } from './database/index.js';
import { createApp } from './app.js';
import { createPgStore } from './models/pgStore.js';
import { startHousekeeping } from './services/housekeeping.js';

loadEnvFile();
let config;
try { config = loadConfig(); } catch (err) {
  if (err instanceof ConfigError) { console.error(err.message); process.exit(1); }
  throw err;
}
const logger = createLogger({ level: config.logLevel });
const db = createDatabase(config, logger);
const server = createApp({ config, db, logger }).listen(config.port, () => {
  logger.info('server_started', describeConfig(config));
  config.warnings.forEach((w) => logger.warn(w));
  if (!db) logger.warn('DATABASE_URL is not set: running without a database (readiness reports not_configured).');
});

const stopHousekeeping = db ? startHousekeeping({ store: createPgStore(db), logger }) : () => {};

let stopping = false;
async function shutdown(signal, code = 0) {
  if (stopping) return; stopping = true;
  logger.info('shutdown_started', { signal });
  const force = setTimeout(() => { logger.error('shutdown_forced'); process.exit(1); }, 10000); force.unref();
  server.close(async () => {
    stopHousekeeping();
    try { await db?.close(); } catch (err) { logger.error('db_close_failed', err); }
    logger.info('shutdown_complete'); process.exit(code);
  });
  server.closeIdleConnections?.();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => { logger.error('unhandled_rejection', err instanceof Error ? err : { reason: String(err) }); shutdown('unhandledRejection', 1); });
process.on('uncaughtException', (err) => { logger.error('uncaught_exception', err); shutdown('uncaughtException', 1); });
