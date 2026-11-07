// Express adapter for the API table. Order in app.js: preBody -> express.json -> this router (postBody -> routes -> 404).
import express from 'express';
import { notFound } from '../utils/errors.js';
import { MAX_BYTES } from '../services/fileType.js';

export function createApiRouter(api) {
  const router = express.Router();
  api.postBody.forEach((m) => router.use(m));
  // Upload routes read the raw bytes (one file per request, no multipart parser to attack); everything else is JSON.
  const raw = express.raw({ type: 'application/octet-stream', limit: MAX_BYTES });
  for (const r of api.routes) router[r.method](r.path, ...(r.body === 'raw' ? [raw] : []), ...r.handlers);
  router.use((req, res, next) => next(notFound('API route not found')));
  return router;
}
