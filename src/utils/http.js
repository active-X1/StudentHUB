/** Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name; the name is already sanitised, but we escape anyway. */
export function contentDisposition(filename, { inline = false } = {}) {
  const ascii = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
