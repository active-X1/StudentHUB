// Express application factory. Dependencies are injected so tests can pass a fake db/logger.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { buildCspDirectives } from './config/csp.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { permissionsPolicy } from './middleware/permissionsPolicy.js';
import { adminUiGate, adminDashboardGuard } from './middleware/adminUiGate.js';
import { cookieParser } from './middleware/cookies.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { createApiRouter } from './routes/index.js';
import { buildApi } from './routes/table.js';

export const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp({ config, db = null, logger, api: apiOptions = {} }) {
  const app = express();
  const api = buildApi({ config, db, ...apiOptions });
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(requestId);
  app.use(requestLogger(logger));
  app.use(helmet({
    contentSecurityPolicy: { useDefaults: false, directives: buildCspDirectives(config) },
    strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false, // HSTS only over HTTPS in production
    crossOriginEmbedderPolicy: false,
  }));
  app.use(permissionsPolicy);

  // JSON API. Same-origin only (the frontend is served from this server), so no CORS middleware is installed.
  // Order matters: origin/content-type checks run BEFORE the body is parsed; sessions load after.
  app.use('/api/v1',
    (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); },
    ...api.preBody,
    express.json({ limit: '100kb' }),
    createApiRouter(api));

  // Static frontend. /admin serves only the sign-in shell; the dashboard module is sent to signed-in admin sessions only.
  app.use(adminUiGate(config));
  app.use(adminDashboardGuard({ cookieParser, loadSession: api.postBody[1] ?? ((req, res, next) => { req.auth = null; next(); }) }));
  app.use(express.static(PUBLIC_DIR, {
    dotfiles: 'ignore', cacheControl: false, // the app is not fingerprinted yet, so always revalidate (ETag) to avoid stale JS
    setHeaders(res) { if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-cache'); },
  }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
