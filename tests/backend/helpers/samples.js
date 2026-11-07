// Byte-level sample files for upload tests. Only headers/structure matter: the validator inspects magic bytes and zip structure.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pad = (head, total = 64) => Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, total - head.length), 0x41)]);

export const png = () => readFileSync(path.join(HERE, '..', '..', '..', 'public', 'assets', 'icons', 'icon-192.png')); // a real PNG
export const jpeg = () => pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
export const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32)]);
export const pdf = (body = '1 0 obj\n<<>>\nendobj\n%%EOF') => Buffer.from(`%PDF-1.7\n${body}`);
export const doc = () => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504), Buffer.from('WordDocument', 'utf16le'), Buffer.alloc(64)]);
export const xlsLikeOle = () => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504), Buffer.from('Workbook', 'utf16le'), Buffer.alloc(64)]);

function crc32(buf) { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
/** Minimal stored (uncompressed) zip writer. entries: [[name, string|Buffer], ...] */
export function zip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name); const d = Buffer.from(data); const crc = crc32(d);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, d); centrals.push(ch, n); offset += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
export const docx = () => zip([['[Content_Types].xml', '<Types/>'], ['_rels/.rels', '<Relationships/>'], ['word/document.xml', '<w:document/>']]);
export const zipWithoutWord = () => zip([['[Content_Types].xml', '<Types/>'], ['xl/workbook.xml', '<workbook/>']]);
export const svg = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
export const html = () => Buffer.from('<!doctype html><script>alert(document.cookie)</script>');
export const exe = () => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);
