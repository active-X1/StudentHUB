// Tiny HTTP client with a cookie jar, used by tests (node:http gives full control of headers such as Origin).
import http from 'node:http';

export class Jar {
  constructor() { this.cookies = new Map(); }
  absorb(setCookies = []) {
    for (const sc of setCookies) {
      const [pair, ...attrs] = sc.split(';'); const i = pair.indexOf('='); const name = pair.slice(0, i).trim(); const value = pair.slice(i + 1);
      const maxAge = attrs.map((a) => a.trim()).find((a) => /^max-age=/i.test(a));
      if (maxAge && Number(maxAge.split('=')[1]) <= 0) this.cookies.delete(name); else this.cookies.set(name, value);
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  get(name) { return this.cookies.get(name); }
}

export function request(baseUrl, method, path, { json, headers = {}, jar, origin = true, raw } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl); const body = raw ?? (json !== undefined ? JSON.stringify(json) : undefined);
    const h = { ...(origin && method !== 'GET' ? { Origin: new URL(baseUrl).origin } : {}), ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}), ...headers };
    if (jar?.cookies.size) h.Cookie = jar.header();
    const req = http.request(url, { method, headers: h }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; });
      res.on('end', () => {
        const setCookies = res.headers['set-cookie'] ?? []; jar?.absorb(setCookies);
        let parsed = data; try { parsed = JSON.parse(data); } catch { /* keep text */ }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, setCookies });
      });
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
