// Optional zero-dependency static host for the frontend prototype (npm run dev:static). Needs no `npm install`.
// The real server is src/server.js (Express, Phase 2).
// Serves /public and maps /admin -> public/admin/index.html. NOT a security boundary:
// the real backend must enforce server-side role checks on every admin page and API endpoint.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

export function createServer({ headers = {} } = {}) {
  return http.createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin/index.html';
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.normalize(path.join(ROOT, pathname));
      if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const body = await readFile(file);
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        'Cache-Control': file.endsWith('service-worker.js') ? 'no-cache' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
        ...(pathname.startsWith('/admin') ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, () => {
    console.log(`Student Hub prototype running at http://localhost:${PORT}`);
    console.log(`Admin prototype UI:           http://localhost:${PORT}/admin`);
  });
}
