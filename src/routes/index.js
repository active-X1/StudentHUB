// Express adapter for the API table. Order in app.js: preBody -> express.json -> this router (postBody -> routes -> 404).
import express from 'express';
import { notFound } from '../utils/errors.js';

export function createApiRouter(api) {
  const router = express.Router();
  api.postBody.forEach((m) => router.use(m));
  for (const r of api.routes) router[r.method](r.path, ...r.handlers);
  router.use((req, res, next) => next(notFound('API route not found')));
  return router;
}
