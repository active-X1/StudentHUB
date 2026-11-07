// Upload validation. The file's CONTENT decides its type (magic bytes); the browser's Content-Type and the file name are
// never trusted. SVG, HTML, scripts and executables are not on the allow-list, so nothing uploaded can run in the browser.
import { validationError } from '../utils/errors.js';

export const MAX_BYTES = 5 * 1024 * 1024;          // matches attachments_size_check
export const MAX_ATTACHMENTS_PER_OWNER = 5;
export const ALLOWED = Object.freeze({
  'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'application/pdf': ['pdf'],
  'application/msword': ['doc'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
});
export const INLINE_SAFE = new Set(['image/jpeg', 'image/png', 'image/webp']); // may be displayed in <img>; everything else downloads

const starts = (buf, bytes, at = 0) => buf.length >= at + bytes.length && bytes.every((b, i) => buf[at + i] === b);
const ascii = (buf, from, to) => buf.subarray(from, to).toString('latin1');

/** Reads the zip central directory (no decompression) and returns entry names, or null if it is not a sane zip. */
export function zipEntryNames(buf) {
  if (!starts(buf, [0x50, 0x4b, 0x03, 0x04])) return null;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10); const size = buf.readUInt32LE(eocd + 12); const offset = buf.readUInt32LE(eocd + 16);
  if (count > 5000 || offset + size > buf.length) return null;
  const names = []; let p = offset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const n = buf.readUInt16LE(p + 28); const x = buf.readUInt16LE(p + 30); const c = buf.readUInt16LE(p + 32);
    if (p + 46 + n > buf.length) return null;
    names.push(buf.subarray(p + 46, p + 46 + n).toString('utf8')); p += 46 + n + x + c;
  }
  return names;
}

/** Returns the real MIME type of a supported file, or null. */
export function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (starts(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(buf, 0, 5) === '%PDF-') return 'application/pdf'; // must be at offset 0: no polyglot tolerance
  if (starts(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return buf.includes(Buffer.from('WordDocument', 'utf16le')) ? 'application/msword' : null; // OLE2 container, but only Word (not xls/ppt/msi)
  const names = zipEntryNames(buf);
  if (names && names.includes('[Content_Types].xml') && names.includes('word/document.xml') && !names.some((n) => n.includes('..') || n.startsWith('/') || n.includes('\\'))) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return null;
}

/** Display-safe file name: no paths, control characters or characters meaningful to shells/headers; keeps the extension. */
export function sanitizeFilename(input) {
  let name = String(input ?? '');
  try { name = decodeURIComponent(name); } catch { /* keep raw */ }
  name = name.normalize('NFC').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '');
  if (name.length > 120) { const dot = name.lastIndexOf('.'); const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : ''; name = name.slice(0, 120 - ext.length) + ext; }
  return name || 'file';
}

/** -> { contentType, filename }. Throws a 422 with a clear message when the upload is not acceptable. */
export function validateUpload({ filename, buffer }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw validationError({ file: 'The file is empty.' });
  if (buffer.length > MAX_BYTES) throw validationError({ file: `The file is larger than ${MAX_BYTES / 1048576} MB.` });
  const contentType = sniff(buffer);
  if (!contentType) throw validationError({ file: 'Unsupported file. Allowed: JPEG, PNG, WebP, PDF, DOC, DOCX.' });
  const safe = sanitizeFilename(filename); const ext = safe.includes('.') ? safe.split('.').pop().toLowerCase() : '';
  if (!ALLOWED[contentType].includes(ext)) throw validationError({ file: `The file's contents do not match its name (${ext ? `.${ext}` : 'no extension'}).` });
  return { contentType, filename: safe };
}
