// Content-Security-Policy for the static frontend. Pure (no dependencies) so it can be tested and reused.
// The frontend uses no inline scripts or inline event handlers. It does use inline style="" attributes
// (hence style-src-attr) and blob: URLs for local image previews.
export function buildCspDirectives({ isProd = false } = {}) {
  const d = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'"],
    styleSrcAttr: ["'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    manifestSrc: ["'self'"],
    workerSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  };
  if (isProd) d.upgradeInsecureRequests = []; // would break http://localhost in development
  return d;
}
/** Serialise helmet-style camelCase directives to a header value (used by tests and the Playwright check). */
export function cspHeaderValue(directives) {
  return Object.entries(directives).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), ...v].join(' ')).join('; ');
}
