// HTTP-level tests for assignments and attachments: authorization (IDOR), validation, upload attacks, downloads, cleanup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, existsSync, utimesSync, statSync } from 'node:fs';
import path from 'node:path';
import { startMiniApp } from './helpers/mini-app.js';
import { Jar, request } from './helpers/client.js';
import { createMemoryStore } from './helpers/memory-store.js';
import { addStudent, addAdmin, FAST, GOOD_PW } from './helpers/setup.js';
import { sweepOrphanFiles } from '../../src/services/attachments.js';
import { runHousekeeping } from '../../src/services/housekeeping.js';
import * as S from './helpers/samples.js';

const ADMIN_PW = 'Adm1n-Passphrase-2026!'; const OCT = { 'Content-Type': 'application/octet-stream' };
async function boot(extra = {}) {
  const store = createMemoryStore();
  await addStudent({ store }, { email: 'alice@example.org', name: 'Alice Doe' }); await addStudent({ store }, { email: 'bob@example.org', name: 'Bob Roe' }); await addAdmin({ store }, { mustChangePassword: extra.forceChange ?? false });
  const app = await startMiniApp({ store, hasherParams: FAST });
  const api = (m, p, o) => request(app.url, m, `/api/v1${p}`, o);
  const asUser = async (email) => { const jar = new Jar(); const r = await api('POST', '/auth/login', { json: { email, password: GOOD_PW }, jar }); return { jar, csrf: r.body.csrfToken, id: r.body.user.id }; };
  const asAdmin = async () => { const jar = new Jar(); const r = await api('POST', '/admin/auth/login', { json: { username: 'admin', password: ADMIN_PW }, jar }); return { jar, csrf: r.body.csrfToken, id: r.body.user.id, status: r.status }; };
  const call = (who, m, p, json, o = {}) => api(m, p, { jar: who.jar, headers: { 'X-CSRF-Token': who.csrf, ...o.headers }, ...(json !== undefined ? { json } : {}), ...o });
  const up = (who, p, buf, filename, o = {}) => api('POST', p, { jar: who.jar, raw: buf, headers: { ...OCT, 'X-CSRF-Token': who.csrf, ...(filename !== null ? { 'X-Filename': encodeURIComponent(filename ?? 'file.png') } : {}), ...o.headers } });
  const filesOnDisk = () => { const out = []; const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : out.push(e.name))); walk(app.storageDir); return out; };
  return { app, store, api, asUser, asAdmin, call, up, filesOnDisk, close: () => app.close() };
}
const NEW = { title: 'Binary tree', course: 'CSC 201', dueDate: '2026-07-10', priority: 'high', tags: ['#Programming', 'exams', 'PROGRAMMING'] };

test('personal assignments: full lifecycle with server-side completion handling and tag normalisation', async () => {
  const t = await boot(); try {
    const a = await t.asUser('alice@example.org'); const c = await t.call(a, 'POST', '/me/assignments', NEW); assert.equal(c.status, 201);
    const d = c.body.assignment; assert.equal(d.status, 'todo'); assert.equal(d.priority, 'high'); assert.deepEqual(d.tags, ['exams', 'Programming']); assert.equal(d.completedAt, null); assert.deepEqual(d.attachments, []); assert.ok(!('userId' in d));
    assert.equal((await t.api('GET', `/me/assignments/${d.id}`, { jar: a.jar })).body.assignment.title, 'Binary tree');
    const done = (await t.call(a, 'PATCH', `/me/assignments/${d.id}`, { status: 'done' })).body.assignment; assert.equal(done.status, 'done'); assert.ok(done.completedAt);
    const again = (await t.call(a, 'PATCH', `/me/assignments/${d.id}`, { status: 'done', title: 'Renamed' })).body.assignment; assert.equal(again.completedAt, done.completedAt, 're-saving keeps the original completion time'); assert.equal(again.title, 'Renamed');
    const back = (await t.call(a, 'PATCH', `/me/assignments/${d.id}`, { status: 'todo', tags: [] })).body.assignment; assert.equal(back.completedAt, null); assert.deepEqual(back.tags, []);
    assert.equal((await t.call(a, 'PATCH', `/me/assignments/${d.id}`, {})).status, 200, 'an empty patch is harmless');
    const list = await t.api('GET', '/me/assignments?sort=title&status=todo', { jar: a.jar }); assert.equal(list.body.total, 1);
    assert.equal((await t.call(a, 'DELETE', `/me/assignments/${d.id}`)).status, 200); assert.equal((await t.api('GET', '/me/assignments', { jar: a.jar })).body.total, 0); assert.equal((await t.call(a, 'DELETE', `/me/assignments/${d.id}`)).status, 404);
  } finally { await t.close(); }
});
test('personal assignments: validation reports every field problem and rejects bad types', async () => {
  const t = await boot(); try {
    const a = await t.asUser('alice@example.org'); const post = (j) => t.call(a, 'POST', '/me/assignments', j);
    const r = await post({ title: '', course: '', dueDate: '2026-02-30', priority: 'urgent', status: 'later', description: 42, tags: ['ok', 'bad-tag', '<script>'] });
    assert.equal(r.status, 422); assert.deepEqual(Object.keys(r.body.error.details).sort(), ['course', 'description', 'dueDate', 'priority', 'status', 'tags', 'title']);
    for (const bad of [null, [], 'x', 5, { title: ['a'], course: {}, dueDate: 20260710 }]) assert.equal((await post(bad)).status, 422, JSON.stringify(bad));
    assert.equal((await post({ ...NEW, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).status, 422); assert.equal((await post({ ...NEW, title: 'x'.repeat(121) })).status, 422);
    assert.equal((await post({ ...NEW, description: 'd'.repeat(1001) })).status, 422); assert.equal((await t.call(a, 'PATCH', '/me/assignments/00000000-0000-4000-8000-000000000001', { priority: 'urgent' })).status, 422);
    for (const q of ['status=x', 'sort=drop', 'limit=0', 'limit=201', 'offset=-1', 'tag=bad-tag', `q=${'x'.repeat(101)}`]) assert.equal((await t.api('GET', `/me/assignments?${q}`, { jar: a.jar })).status, 422, q);
    assert.equal((await post({ title: 'Minimal', course: 'C', dueDate: '2026-07-01' })).body.assignment.priority, 'medium', 'defaults apply');
  } finally { await t.close(); }
});
test('every write needs sign-in AND the CSRF token AND a same-origin request', async () => {
  const t = await boot(); try {
    const anon = new Jar(); for (const [m, p] of [['GET', '/me/assignments'], ['POST', '/me/assignments'], ['GET', '/assignments'], ['GET', '/attachments/00000000-0000-4000-8000-000000000001']]) assert.equal((await t.api(m, p, { jar: anon, json: m === 'POST' ? NEW : undefined })).status, 401, `${m} ${p}`);
    const a = await t.asUser('alice@example.org');
    assert.equal((await t.api('POST', '/me/assignments', { jar: a.jar, json: NEW })).body.error.code, 'csrf_failed'); assert.equal((await t.api('POST', '/me/assignments', { jar: a.jar, json: NEW, headers: { 'X-CSRF-Token': 'x' } })).status, 403);
    assert.equal((await t.api('POST', '/me/assignments', { jar: a.jar, json: NEW, origin: false, headers: { Origin: 'https://evil.example', 'X-CSRF-Token': a.csrf } })).status, 403);
    assert.equal((await t.call(a, 'POST', '/me/assignments', NEW)).status, 201);
    const created = (await t.api('GET', '/me/assignments', { jar: a.jar })).body.items[0];
    assert.equal((await t.api('DELETE', `/me/assignments/${created.id}`, { jar: a.jar })).status, 403, 'DELETE without CSRF'); assert.equal((await t.api('PATCH', `/me/assignments/${created.id}`, { jar: a.jar, json: { title: 'x' } })).status, 403);
  } finally { await t.close(); }
});
test('IDOR: another user can neither see nor change nor download your assignments and files (always 404, never 403)', async () => {
  const t = await boot(); try {
    const alice = await t.asUser('alice@example.org'); const bob = await t.asUser('bob@example.org'); const admin = await t.asAdmin();
    const mine = (await t.call(alice, 'POST', '/me/assignments', NEW)).body.assignment;
    const file = (await t.up(alice, `/me/assignments/${mine.id}/attachments`, S.pdf(), 'secret.pdf')).body.attachment; assert.ok(file.id);
    const missing = (await t.api('GET', '/attachments/00000000-0000-4000-8000-0000000000aa', { jar: bob.jar }));
    for (const [who, label] of [[bob, 'bob'], [admin, 'admin']]) {
      const r = await t.api('GET', `/attachments/${file.id}`, { jar: who.jar }); assert.equal(r.status, 404, `${label} download`); assert.deepEqual(r.body.error.code, missing.body.error.code, 'same answer as a file that does not exist');
      assert.equal((await t.call(who, 'DELETE', `/attachments/${file.id}`)).status, 404, `${label} delete file`);
    }
    for (const [m, p, j] of [['GET', `/me/assignments/${mine.id}`], ['PATCH', `/me/assignments/${mine.id}`, { title: 'Hacked' }], ['DELETE', `/me/assignments/${mine.id}`]]) assert.equal((await t.call(bob, m, p, j)).status, 404, `bob ${m}`);
    assert.equal((await t.up(bob, `/me/assignments/${mine.id}/attachments`, S.png(), 'x.png')).status, 404, 'cannot attach to someone else\'s assignment');
    assert.equal((await t.api('GET', '/me/assignments', { jar: bob.jar })).body.total, 0);
    assert.equal((await t.api('GET', `/me/assignments/${mine.id}`, { jar: alice.jar })).body.assignment.title, 'Binary tree', 'untouched');
    assert.equal((await t.api('GET', `/attachments/${file.id}`, { jar: alice.jar })).buffer.equals(S.pdf()), true, 'the owner still gets the file');
    for (const bad of ['not-a-uuid', '1;DROP TABLE users', '%00', '..%2f..%2fetc%2fpasswd', "' OR '1'='1"]) { assert.equal((await t.api('GET', `/me/assignments/${bad}`, { jar: alice.jar })).status, 404, bad); assert.equal((await t.api('GET', `/attachments/${bad}`, { jar: alice.jar })).status, 404, bad); }
  } finally { await t.close(); }
});
test('mass assignment: ownership and server-managed fields cannot be set from the request body', async () => {
  const t = await boot(); try {
    const alice = await t.asUser('alice@example.org'); const bob = await t.asUser('bob@example.org');
    const r = await t.call(alice, 'POST', '/me/assignments', { ...NEW, userId: bob.id, id: '00000000-0000-4000-8000-0000000000ff', completedAt: '2020-01-01T00:00:00Z', createdAt: '2000-01-01', user_id: bob.id });
    assert.equal(r.status, 201); const d = r.body.assignment; assert.notEqual(d.id, '00000000-0000-4000-8000-0000000000ff'); assert.equal(d.completedAt, null); assert.notEqual(d.createdAt?.slice?.(0, 4), '2000');
    assert.equal((await t.api('GET', '/me/assignments', { jar: bob.jar })).body.total, 0, 'it belongs to the signed-in user');
    const p = await t.call(alice, 'PATCH', `/me/assignments/${d.id}`, { userId: bob.id, completedAt: '2020-01-01T00:00:00Z', status: 'todo' }); assert.equal(p.body.assignment.completedAt, null);
    assert.equal((await t.api('GET', '/me/assignments', { jar: bob.jar })).body.total, 0);
  } finally { await t.close(); }
});

// ---------- uploads ----------
test('upload: content decides the type; downloads are forced to safe headers; the stored key is random', async () => {
  const t = await boot(); try {
    const a = await t.asUser('alice@example.org'); const as = (await t.call(a, 'POST', '/me/assignments', NEW)).body.assignment; const url = `/me/assignments/${as.id}/attachments`;
    const png = await t.up(a, url, S.png(), 'Diagram ../../x.PNG'); assert.equal(png.status, 201); assert.equal(png.body.attachment.name, 'x.PNG', 'path parts are stripped'); assert.equal(png.body.attachment.contentType, 'image/png');
    assert.ok(!JSON.stringify(png.body).includes('storage'), 'the storage key is never exposed');
    const keys = t.filesOnDisk(); assert.equal(keys.length, 1); assert.match(keys[0], /^[A-Za-z0-9_-]{32}$/); assert.ok(!keys[0].toLowerCase().includes('diagram'), 'the file name is not used in the storage path');
    const pdf = await t.up(a, url, S.pdf(), 'plan.pdf'); const get = await t.api('GET', `/me/assignments/${as.id}`, { jar: a.jar }); assert.deepEqual(get.body.assignment.attachments.map((x) => x.name), ['x.PNG', 'plan.pdf']);
    const dl = await t.api('GET', `/attachments/${pdf.body.attachment.id}`, { jar: a.jar }); assert.equal(dl.status, 200); assert.ok(dl.buffer.equals(S.pdf()));
    assert.equal(dl.headers['content-type'], 'application/pdf'); assert.match(dl.headers['content-disposition'], /^attachment; filename="plan.pdf"/); assert.equal(dl.headers['x-content-type-options'], 'nosniff');
    assert.equal(dl.headers['content-security-policy'], "default-src 'none'; sandbox"); assert.match(dl.headers['cache-control'], /no-store/); assert.equal(dl.headers['cross-origin-resource-policy'], 'same-origin'); assert.equal(Number(dl.headers['content-length']), S.pdf().length);
    assert.match((await t.api('GET', `/attachments/${pdf.body.attachment.id}?inline=1`, { jar: a.jar })).headers['content-disposition'], /^attachment/, 'PDFs are never rendered inline');
    assert.match((await t.api('GET', `/attachments/${png.body.attachment.id}?inline=1`, { jar: a.jar })).headers['content-disposition'], /^inline/, 'images may be previewed'); assert.match((await t.api('GET', `/attachments/${png.body.attachment.id}`, { jar: a.jar })).headers['content-disposition'], /^attachment/);
    const row = [...t.store._users.values()].length; assert.ok(row > 0);
  } finally { await t.close(); }
});
test('upload: spoofed, dangerous and malformed files are refused and leave nothing on disk', async () => {
  const t = await boot(); try {
    const a = await t.asUser('alice@example.org'); const as = (await t.call(a, 'POST', '/me/assignments', NEW)).body.assignment; const url = `/me/assignments/${as.id}/attachments`;
    const cases = [['malware.pdf', S.exe()], ['image.png', S.svg()], ['page.png', S.html()], ['report.pdf', S.png()], ['sheet.docx', S.doc()], ['noext', S.png()], ['empty.png', Buffer.alloc(0)], ['book.docx', S.zipWithoutWord()], ['book.doc', S.xlsLikeOle()], ['x.png.exe', S.exe()]];
    for (const [name, buf] of cases) { const r = await t.up(a, url, buf, name); assert.equal(r.status, 422, name); assert.ok(r.body.error.details.file, name); }
    assert.equal((await t.up(a, url, S.png(), null)).status, 422, 'missing X-Filename');
    assert.equal(t.filesOnDisk().length, 0); assert.equal((await t.api('GET', `/me/assignments/${as.id}`, { jar: a.jar })).body.assignment.attachments.length, 0);
    const wrongType = await t.api('POST', url, { jar: a.jar, raw: S.png(), headers: { 'Content-Type': 'image/png', 'X-CSRF-Token': a.csrf, 'X-Filename': 'a.png' } }); assert.equal(wrongType.status, 415);
    const asJson = await t.api('POST', url, { jar: a.jar, json: { file: 'x' }, headers: { 'X-CSRF-Token': a.csrf, 'X-Filename': 'a.png' } }); assert.equal(asJson.status, 415);
    assert.equal((await t.api('POST', url, { jar: a.jar, raw: S.png(), headers: { ...OCT, 'X-Filename': 'a.png' } })).status, 403, 'no CSRF token');
    assert.equal((await t.api('POST', url, { raw: S.png(), headers: { ...OCT, 'X-Filename': 'a.png' } })).status, 401);
  } finally { await t.close(); }
});
test('upload: size limit (413), per-assignment file limit, exact-size boundary and integrity', async () => {
  const t = await boot(); try {
    const a = await t.asUser('alice@example.org'); const as = (await t.call(a, 'POST', '/me/assignments', NEW)).body.assignment; const url = `/me/assignments/${as.id}/attachments`;
    const big = Buffer.concat([S.png(), Buffer.alloc(5 * 1024 * 1024)]); assert.equal((await t.up(a, url, big, 'big.png')).status, 413);
    const exact = Buffer.concat([S.png(), Buffer.alloc(5 * 1024 * 1024 - S.png().length)]); const ok = await t.up(a, url, exact, 'exact.png'); assert.equal(ok.status, 201); assert.equal(ok.body.attachment.size, 5 * 1024 * 1024);
    const dl = await t.api('GET', `/attachments/${ok.body.attachment.id}`, { jar: a.jar }); assert.equal(createHash('sha256').update(dl.buffer).digest('hex'), createHash('sha256').update(exact).digest('hex'), 'bytes survive storage unchanged');
    for (let i = 0; i < 4; i++) assert.equal((await t.up(a, url, S.pdf(`1 0 obj << /N ${i} >> endobj`), `f${i}.pdf`)).status, 201);
    const sixth = await t.up(a, url, S.pdf('six'), 'six.pdf'); assert.equal(sixth.status, 422); assert.match(sixth.body.error.details.file, /up to 5 files/); assert.equal(t.filesOnDisk().length, 5, 'the refused file was not stored');
  } finally { await t.close(); }
});
test('deleting files and assignments removes the stored bytes', async () => {
  const t = await boot(); try {
    const a = await t.asUser('alice@example.org'); const as = (await t.call(a, 'POST', '/me/assignments', NEW)).body.assignment; const url = `/me/assignments/${as.id}/attachments`;
    const f1 = (await t.up(a, url, S.png(), 'a.png')).body.attachment; await t.up(a, url, S.pdf(), 'b.pdf'); assert.equal(t.filesOnDisk().length, 2);
    assert.equal((await t.call(a, 'DELETE', `/attachments/${f1.id}`)).status, 200); assert.equal(t.filesOnDisk().length, 1); assert.equal((await t.api('GET', `/attachments/${f1.id}`, { jar: a.jar })).status, 404);
    assert.equal((await t.call(a, 'DELETE', `/me/assignments/${as.id}`)).status, 200); assert.equal(t.filesOnDisk().length, 0, 'no orphaned files after deleting the assignment');
  } finally { await t.close(); }
});
test('orphan sweeper removes unreferenced old files and keeps referenced or recent ones', async () => {
  const t = await boot(); try {
    const a = await t.asUser('alice@example.org'); const as = (await t.call(a, 'POST', '/me/assignments', NEW)).body.assignment; await t.up(a, `/me/assignments/${as.id}/attachments`, S.png(), 'keep.png');
    const { newStorageKey } = await import('../../src/services/storage/local.js'); const orphanOld = newStorageKey(); const orphanNew = newStorageKey();
    await t.app.storage.put(orphanOld, Buffer.from('x')); await t.app.storage.put(orphanNew, Buffer.from('y'));
    const f = path.join(t.app.storageDir, orphanOld.slice(0, 2), orphanOld.slice(2, 4), orphanOld); const old = new Date(Date.now() - 2 * 3600e3); utimesSync(f, old, old);
    const logger = { info() {}, warn() {}, error() {} };
    await runHousekeeping(t.store, new Date(), { storage: t.app.storage, logger }); assert.ok(!t.filesOnDisk().includes(orphanOld), 'the hourly housekeeping job includes the sweep'); await t.app.storage.put(orphanOld, Buffer.from('x')); utimesSync(f, old, old);
    assert.equal(await sweepOrphanFiles({ store: t.store, storage: t.app.storage, logger }), 1);
    const left = t.filesOnDisk(); assert.ok(!left.includes(orphanOld)); assert.ok(left.includes(orphanNew), 'a fresh unreferenced file may be an in-flight upload'); assert.equal(left.length, 2);
  } finally { await t.close(); }
});

// ---------- general assignments ----------
test('general assignments: students see only published ones; admins manage; drafts and unpublished files stay hidden', async () => {
  const t = await boot(); try {
    const admin = await t.asAdmin(); const stu = await t.asUser('alice@example.org'); const G = { title: 'Lab 3', course: 'CSC 220', dueDate: '2026-07-20', category: 'Lab', tags: ['Databases'], description: 'Normalize it' };
    const draft = (await t.call(admin, 'POST', '/admin/assignments', G)).body.assignment; assert.equal(draft.status, 'draft'); assert.equal(draft.publishedAt, null);
    assert.equal((await t.api('GET', '/assignments', { jar: stu.jar })).body.total, 0); assert.equal((await t.api('GET', `/assignments/${draft.id}`, { jar: stu.jar })).status, 404);
    const file = (await t.up(admin, `/admin/assignments/${draft.id}/attachments`, S.pdf(), 'brief.pdf')).body.attachment;
    assert.equal((await t.api('GET', `/attachments/${file.id}`, { jar: stu.jar })).status, 404, 'files of drafts are not readable by students'); assert.equal((await t.api('GET', `/attachments/${file.id}`, { jar: admin.jar })).status, 200);
    const pub = (await t.call(admin, 'PATCH', `/admin/assignments/${draft.id}`, { status: 'published' })).body.assignment; assert.ok(pub.publishedAt);
    const list = (await t.api('GET', '/assignments', { jar: stu.jar })).body; assert.equal(list.total, 1); assert.ok(!('status' in list.items[0]) && !('createdBy' in list.items[0]), 'students get the public view only'); assert.equal(list.items[0].attachments[0].name, 'brief.pdf');
    assert.ok((await t.api('GET', `/attachments/${file.id}`, { jar: stu.jar })).buffer.equals(S.pdf()), 'students may download published files');
    assert.equal((await t.call(stu, 'DELETE', `/attachments/${file.id}`)).status, 404, 'but never delete them'); assert.equal((await t.up(stu, `/admin/assignments/${draft.id}/attachments`, S.png(), 'x.png')).status, 403);
    const firstPublished = pub.publishedAt; await t.call(admin, 'PATCH', `/admin/assignments/${draft.id}`, { status: 'unpublished' });
    assert.equal((await t.api('GET', '/assignments', { jar: stu.jar })).body.total, 0); assert.equal((await t.api('GET', `/attachments/${file.id}`, { jar: stu.jar })).status, 404);
    assert.equal((await t.call(admin, 'PATCH', `/admin/assignments/${draft.id}`, { status: 'published' })).body.assignment.publishedAt, firstPublished, 'the first publication time is kept');
    assert.equal((await t.api('GET', '/assignments?q=NORMALIZE&course=CSC%20220&tag=databases', { jar: stu.jar })).body.total, 1); assert.equal((await t.api('GET', '/assignments?course=OTHER', { jar: stu.jar })).body.total, 0);
    const audit = t.store._audit.map((x) => x.action); for (const want of [/Created general assignment "Lab 3"/, /Attached a file/, /to published/, /to unpublished/]) assert.ok(audit.some((x) => want.test(x)), String(want));
    assert.equal((await t.call(admin, 'DELETE', `/admin/assignments/${draft.id}`)).status, 200); assert.equal(t.filesOnDisk().length, 0); assert.ok(t.store._audit.some((x) => /Deleted general assignment/.test(x.action)));
  } finally { await t.close(); }
});
test('admin assignment routes: anonymous 401, student 403, admin needs CSRF; admin list can filter by status', async () => {
  const t = await boot(); try {
    const stu = await t.asUser('alice@example.org'); const admin = await t.asAdmin(); const G = { title: 'T', course: 'C', dueDate: '2026-07-20' };
    for (const [m, p] of [['GET', '/admin/assignments'], ['POST', '/admin/assignments'], ['GET', '/admin/assignments/00000000-0000-4000-8000-000000000001']]) { assert.equal((await t.api(m, p, { json: m === 'POST' ? G : undefined })).status, 401, `anon ${m} ${p}`); assert.equal((await t.call(stu, m, p, m === 'POST' ? G : undefined)).status, 403, `student ${m} ${p}`); }
    assert.equal((await t.api('POST', '/admin/assignments', { jar: admin.jar, json: G })).status, 403, 'admin without CSRF'); const d = (await t.call(admin, 'POST', '/admin/assignments', { ...G, status: 'published' })).body.assignment; await t.call(admin, 'POST', '/admin/assignments', G);
    assert.equal((await t.api('GET', '/admin/assignments', { jar: admin.jar })).body.total, 2); assert.equal((await t.api('GET', '/admin/assignments?status=draft', { jar: admin.jar })).body.total, 1);
    assert.equal((await t.call(admin, 'POST', '/admin/assignments', { ...G, status: 'archived' })).status, 422); assert.equal((await t.api('GET', '/assignments', { jar: stu.jar })).body.total, 1);
    assert.equal(d.status, 'published');
  } finally { await t.close(); }
});
test('the forced password change also blocks assignment routes until the admin changes it', async () => {
  const t = await boot({ forceChange: true }); try {
    const admin = await t.asAdmin(); assert.equal(admin.status, 200);
    assert.equal((await t.api('GET', '/admin/assignments', { jar: admin.jar })).body.error.code, 'password_change_required');
    assert.equal((await t.api('GET', '/me/assignments', { jar: admin.jar })).body.error.code, 'password_change_required');
  } finally { await t.close(); }
});
test('pagination bounds and stable totals', async () => {
  const t = await boot(); try {
    const a = await t.asUser('alice@example.org'); for (let i = 0; i < 7; i++) await t.call(a, 'POST', '/me/assignments', { ...NEW, title: `T${i}`, dueDate: `2026-07-0${i + 1}` });
    const p1 = (await t.api('GET', '/me/assignments?limit=3&offset=0&sort=due', { jar: a.jar })).body; const p3 = (await t.api('GET', '/me/assignments?limit=3&offset=6&sort=due', { jar: a.jar })).body;
    assert.equal(p1.total, 7); assert.deepEqual(p1.items.map((x) => x.title), ['T0', 'T1', 'T2']); assert.deepEqual(p3.items.map((x) => x.title), ['T6']);
  } finally { await t.close(); }
});
