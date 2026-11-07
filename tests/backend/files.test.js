import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sniff, validateUpload, sanitizeFilename, zipEntryNames, MAX_BYTES } from '../../src/services/fileType.js';
import { createLocalStorage, newStorageKey, KEY_RE } from '../../src/services/storage/local.js';
import { loadConfig } from '../../src/config/index.js';
import * as S from './helpers/samples.js';

test('sniff: recognises every allowed type by content', () => {
  assert.equal(sniff(S.png()), 'image/png'); assert.equal(sniff(S.jpeg()), 'image/jpeg'); assert.equal(sniff(S.webp()), 'image/webp'); assert.equal(sniff(S.pdf()), 'application/pdf');
  assert.equal(sniff(S.doc()), 'application/msword'); assert.equal(sniff(S.docx()), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});
test('sniff: refuses SVG, HTML, executables, other Office files, polyglots and malformed containers', () => {
  for (const [name, buf] of Object.entries({ svg: S.svg(), html: S.html(), exe: S.exe(), xlsOle: S.xlsLikeOle(), zipNoWord: S.zipWithoutWord(),
    pdfWithLeadingJunk: Buffer.concat([Buffer.from('GIF89a<script>'), S.pdf()]), text: Buffer.from('hello world, this is just text'), empty: Buffer.alloc(0), tiny: Buffer.from([0xff, 0xd8]),
    traversalZip: S.zip([['[Content_Types].xml', 'x'], ['word/document.xml', 'x'], ['../../evil.sh', 'x']]), truncatedZip: S.docx().subarray(0, 60), zipBadDirOffset: Buffer.concat([S.docx().subarray(0, S.docx().length - 6), Buffer.from([0xff, 0xff, 0xff, 0x7f, 0, 0])]) }))
    assert.equal(sniff(buf), null, name);
  assert.equal(sniff('not a buffer'), null); assert.equal(sniff(null), null);
});
test('sniff never throws on arbitrary bytes (fuzz)', () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 400; i++) { const b = Buffer.alloc(Math.floor(rnd() * 300)); for (let j = 0; j < b.length; j++) b[j] = Math.floor(rnd() * 256); assert.doesNotThrow(() => sniff(b)); }
  const mutated = Buffer.from(S.docx()); for (let i = 0; i < mutated.length; i += 7) { const c = Buffer.from(mutated); c[i] ^= 0xff; assert.doesNotThrow(() => sniff(c)); }
  assert.deepEqual(zipEntryNames(S.docx()), ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
});
test('validateUpload: type from content, name must agree, size limits, helpful messages', () => {
  assert.deepEqual(validateUpload({ filename: 'Notes.PDF', buffer: S.pdf() }), { contentType: 'application/pdf', filename: 'Notes.PDF' });
  assert.equal(validateUpload({ filename: 'photo.jpeg', buffer: S.jpeg() }).contentType, 'image/jpeg');
  const bad = (args, re) => assert.throws(() => validateUpload(args), (e) => e.status === 422 && re.test(e.details.file), JSON.stringify(Object.keys(args)));
  bad({ filename: 'malware.pdf', buffer: S.exe() }, /Unsupported/); bad({ filename: 'x.pdf', buffer: S.png() }, /do not match/); bad({ filename: 'x', buffer: S.png() }, /no extension/);
  bad({ filename: 'x.svg', buffer: S.svg() }, /Unsupported/); bad({ filename: 'x.png', buffer: Buffer.alloc(0) }, /empty/); bad({ filename: 'x.docx', buffer: S.doc() }, /do not match/);
  bad({ filename: 'big.png', buffer: Buffer.concat([S.png(), Buffer.alloc(MAX_BYTES)]) }, /larger than 5 MB/);
  assert.equal(validateUpload({ filename: 'x.png', buffer: Buffer.concat([S.png(), Buffer.alloc(MAX_BYTES - S.png().length)]) }).contentType, 'image/png', 'exactly the limit is accepted');
});
test('sanitizeFilename: no paths, controls, bidi tricks or runaway lengths', () => {
  const cases = [['../../etc/passwd', 'passwd'], ['..\\..\\win\\x.pdf', 'x.pdf'], ['..%2f..%2fnotes.pdf', 'notes.pdf'], ['  .hidden.png', 'hidden.png'], ['a\u0000b\nc.png', 'abc.png'],
    ['invoice\u202Efdp.exe', 'invoicefdp.exe'], ['we<ir>d:"name|?*.pdf', 'weirdname.pdf'], ['', 'file'], [undefined, 'file'], ['....', 'file'], ['rés umé.pdf', 'rés umé.pdf']];
  for (const [input, want] of cases) assert.equal(sanitizeFilename(input), want, JSON.stringify(input));
  const long = sanitizeFilename(`${'a'.repeat(300)}.pdf`); assert.equal(long.length, 120); assert.ok(long.endsWith('.pdf'));
});

test('local storage: round trip, private permissions, random keys, idempotent delete, missing file', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'store-')); const st = createLocalStorage({ dir }); const key = newStorageKey();
  assert.match(key, KEY_RE); assert.notEqual(key, newStorageKey());
  await st.put(key, Buffer.from('hello')); const got = await st.get(key); assert.equal(got.size, 5); let data = ''; for await (const c of got.stream) data += c; assert.equal(data, 'hello');
  const file = path.join(dir, key.slice(0, 2), key.slice(2, 4), key); assert.equal(statSync(file).mode & 0o777, 0o600); assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
  await st.delete(key); await st.delete(key); await assert.rejects(st.get(key), (e) => e.name === 'NotFoundError');
});
test('local storage: hostile keys can never escape the storage root', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'store-')); const st = createLocalStorage({ dir });
  for (const key of ['../../etc/passwd', '..', '/etc/passwd', 'a/b', 'short', `${'a'.repeat(31)}/x`, `${'a'.repeat(32)}.tmp`, 'a'.repeat(129), '..%2f..%2fetc', `${'a'.repeat(30)}..`, '', null, undefined])
    await assert.rejects(st.put(key, Buffer.from('x')), /Invalid storage key/, String(key));
  await assert.rejects(st.get('../../etc/passwd'), /Invalid storage key/); await assert.rejects(st.delete('../x'), /Invalid storage key/);
  assert.deepEqual(readdirSync(dir), [], 'nothing was written');
});
test('local storage: listKeys reports only old, well-formed files (orphan sweep input)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'store-')); const st = createLocalStorage({ dir }); const a = newStorageKey(); const b = newStorageKey();
  await st.put(a, Buffer.from('1')); await st.put(b, Buffer.from('2'));
  const old = path.join(dir, a.slice(0, 2), a.slice(2, 4), a); const t = new Date(Date.now() - 3 * 3600e3); utimesSync(old, t, t);
  assert.deepEqual(await st.listKeys({ olderThanMs: 3600e3 }), [a]); assert.deepEqual((await st.listKeys()).sort(), [a, b].sort());
  assert.deepEqual(await createLocalStorage({ dir: path.join(dir, 'missing') }).listKeys(), []);
});
test('config: storage must be outside public/, required and absolute in production', () => {
  assert.match(loadConfig({}).storage.dir, /student-hub[\\/]storage$|[\\/]storage$/); assert.equal(loadConfig({}).storage.driver, 'local');
  assert.throws(() => loadConfig({ STORAGE_DIR: path.resolve('public/uploads') }), /must not be inside public/);
  assert.throws(() => loadConfig({ STORAGE_DIR: path.resolve('public') }), /must not be inside public/);
  assert.throws(() => loadConfig({ STORAGE_DRIVER: 's3' }), /STORAGE_DRIVER/);
  const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h/d', SESSION_SECRET: 'k'.repeat(40), APP_BASE_URL: 'https://hub.example.org' };
  assert.throws(() => loadConfig(prod), /STORAGE_DIR is required in production/); assert.throws(() => loadConfig({ ...prod, STORAGE_DIR: 'relative/dir' }), /absolute/);
  assert.equal(loadConfig({ ...prod, STORAGE_DIR: '/var/lib/student-hub' }).storage.dir, '/var/lib/student-hub');
});
