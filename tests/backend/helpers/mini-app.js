// Test harness: serves the REAL route table, middleware, error handler and static-gating over node:http, because Express
// cannot be installed in every environment. It mirrors the Express contract the code relies on (req.get/ip/query/path/cookies,
// res.status/set/json/send/redirect, async handlers rejecting into the error handler). It is NOT a substitute for
// tests/backend/app.test.js, which runs the actual Express app once dependencies are installed.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../../src/config/index.js';
import { buildApi } from '../../../src/routes/table.js';
import { adminUiGate, adminDashboardGuard } from '../../../src/middleware/adminUiGate.js';
import { cookieParser } from '../../../src/middleware/cookies.js';
import { errorHandler, notFoundHandler } from '../../../src/middleware/errorHandler.js';
import { notFound } from '../../../src/utils/errors.js';
import { requestId } from '../../../src/middleware/requestId.js';
import { MAX_BYTES } from '../../../src/services/fileType.js';
import { createLocalStorage } from '../../../src/services/storage/local.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildCspDirectives, cspHeaderValue } from '../../../src/config/csp.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const silent = { debug() {}, info() {}, warn() {}, error(m, f) { if (process.env.MINI_APP_LOG) console.error(m, f); } };

function decorate(req, res, urlObj, relPath) {
  res.locals = {}; req.get = (n) => req.headers[n.toLowerCase()];
  req.ip = req.headers['x-test-ip'] || req.socket.remoteAddress; req.path = relPath; req.query = Object.fromEntries(urlObj.searchParams);
  res.status = (c) => { res.statusCode = c; return res; };
  res.set = (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) res.setHeader(a, b); else res.setHeader(k, v); return res; };
  res.type = (t) => { res.setHeader('Content-Type', t === 'text/plain' ? 'text/plain; charset=utf-8' : t); return res; };
  res.json = (b) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(b)); return res; };
  res.send = (b) => { res.end(b); return res; };
  res.redirect = (url) => { res.statusCode = 302; res.setHeader('Location', url); res.end(); return res; };
}
function runChain(handlers, req, res, done) {
  let i = 0;
  const next = (err) => {
    if (err) return done(err);
    const h = handlers[i++]; if (!h) return done();
    try { const r = h(req, res, next); if (r?.catch) r.catch(next); } catch (e) { next(e); }
  };
  next();
}
const compile = (p) => { const names = []; const re = new RegExp(`^${p.replace(/:([A-Za-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`); return { re, names }; };
async function readRaw(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size <= MAX_BYTES) chunks.push(c); }
  if (size > MAX_BYTES) throw Object.assign(new Error('too large'), { type: 'entity.too.large' });
  return /^application\/octet-stream/i.test(req.headers['content-type'] || '') ? Buffer.concat(chunks) : undefined;
}
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size <= 100 * 1024) chunks.push(c); } // keep draining so the client can read our 413
  if (size > 100 * 1024) throw Object.assign(new Error('too large'), { type: 'entity.too.large' });
  if (!chunks.length) return undefined;
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new SyntaxError('bad json'), { type: 'entity.parse.failed' }); }
}

/** env: extra config env. opts: { store, clock, now, fetchFn, hasherParams, serveStatic }. Returns { url, config, services, close }. */
export async function startMiniApp({ env = {}, ...opts } = {}) {
  let handler = (req, res) => res.end();
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's'.repeat(48), APP_BASE_URL: `http://127.0.0.1:${port}`, ...env });
  const storageDir = opts.storageDir ?? mkdtempSync(path.join(tmpdir(), 'hub-storage-'));
  const storage = opts.storage ?? createLocalStorage({ dir: storageDir });
  const api = buildApi({ config, ...opts, storage });
  const routes = api.routes.map((r) => ({ ...r, ...compile(r.path) }));
  const logger = silent; const onError = errorHandler(logger);
  const gate = adminUiGate(config);
  const guard = adminDashboardGuard({ cookieParser, loadSession: api.postBody[1] ?? ((req, res, next) => { req.auth = null; next(); }) });

  const csp = cspHeaderValue(buildCspDirectives({ isProd: false }));
  handler = async (req, res) => {
    res.setHeader('Content-Security-Policy', csp); // the same policy helmet sends in the real app
    const urlObj = new URL(req.url, `http://127.0.0.1:${port}`); const finish = (err) => (err ? onError(err, req, res, () => {}) : null);
    try {
      if (urlObj.pathname.startsWith('/api/v1')) {
        const rel = urlObj.pathname.slice('/api/v1'.length) || '/'; decorate(req, res, urlObj, rel); res.setHeader('Cache-Control', 'no-store');
        let route = null; req.params = {};
        for (const r of routes) { const m = r.method.toUpperCase() === req.method && r.re.exec(rel); if (m) { route = r; r.names.forEach((n, i) => { req.params[n] = decodeURIComponent(m[i + 1]); }); break; } }
        const read = async (rq, rs, nx) => { try { rq.body = route?.body === 'raw' ? await readRaw(rq) : await readJson(rq); nx(); } catch (e) { nx(e); } };
        return runChain([requestId, ...api.preBody, read, ...api.postBody, ...(route ? route.handlers : [(rq, rs, nx) => nx(notFound('API route not found'))])], req, res, finish);
      }
      decorate(req, res, urlObj, urlObj.pathname);
      return runChain([requestId, gate, guard, async (rq, rs, nx) => { // static files (decoded like express.static does)
        if (opts.serveStatic === false) return nx();
        let p; try { p = decodeURIComponent(urlObj.pathname); } catch { return rs.status(400).end(); }
        if (p.endsWith('/')) p += 'index.html';
        const file = path.normalize(path.join(PUBLIC, p));
        if (!file.startsWith(PUBLIC) || path.basename(file).startsWith('.')) return nx();
        try { const data = await readFile(file); rs.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream'); rs.setHeader('Cache-Control', 'no-cache'); return rs.end(data); } catch { return nx(); }
      }, notFoundHandler], req, res, finish);
    } catch (e) { return finish(e); }
  };
  return { url: `http://127.0.0.1:${port}`, config, services: api.services, storage, storageDir, close: () => new Promise((r) => server.close(r)) };
}
