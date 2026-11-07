// Behavioural contract for the assignments/attachments half of a store (memory always; PostgreSQL with TEST_DATABASE_URL).
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';

let n = 0; const uniq = (p) => `${p}${process.pid}${Date.now() % 1e6}${++n}`;
const key = () => randomBytes(24).toString('base64url'); const sha = () => createHash('sha256').update(uniq('c')).digest('hex');
const P = (o = {}) => ({ title: 'Task', description: '', course: 'CSC 201', lecturer: null, dueDate: '2026-07-01', priority: 'medium', status: 'todo', completedAt: null, tags: [], ...o });
const G = (o = {}) => ({ title: 'Lab', course: 'CSC 201', category: 'Coursework', description: '', dueDate: '2026-07-01', status: 'published', publishedAt: new Date('2026-06-01T00:00:00Z'), createdBy: null, tags: [], ...o });
const att = (o = {}) => ({ storageKey: key(), originalFilename: 'notes.pdf', contentType: 'application/pdf', sizeBytes: 1234, checksumSha256: sha(), ...o });

export function runAssignmentsContract(test, label, makeStore) {
  const withStore = (name, fn) => test(`${label}: ${name}`, async () => { const { store, cleanup } = await makeStore(); try { await fn(store); } finally { await cleanup?.(); } });
  const mkUser = (s) => s.createUser({ email: `${uniq('u')}@example.org`, displayName: 'T', role: 'student' });

  withStore('personal assignments are scoped to their owner on every operation', async (s) => {
    const a = await mkUser(s); const b = await mkUser(s); const mine = await s.createPersonalAssignment(a.id, P({ title: 'Mine' }));
    assert.equal(mine.userId, a.id); assert.equal(mine.dueDate, '2026-07-01'); assert.deepEqual(mine.tags, []);
    assert.equal((await s.getPersonalAssignment(a.id, mine.id)).title, 'Mine');
    assert.equal(await s.getPersonalAssignment(b.id, mine.id), null, 'another user cannot read it');
    assert.equal(await s.updatePersonalAssignment(b.id, mine.id, { title: 'Hacked' }), null, 'another user cannot update it');
    assert.deepEqual(await s.deletePersonalAssignment(b.id, mine.id), { deleted: false, storageKeys: [] }, 'another user cannot delete it');
    assert.equal((await s.getPersonalAssignment(a.id, mine.id)).title, 'Mine', 'unchanged');
    assert.equal((await s.listPersonalAssignments(b.id)).total, 0); assert.equal((await s.listPersonalAssignments(a.id)).total, 1);
    assert.equal(await s.getPersonalAssignment(a.id, '10000000-0000-4000-8000-0000000000ff'), null);
  });
  withStore('tags: case-insensitive reuse keeps the first spelling; update replaces, clears or leaves them', async (s) => {
    const u = await mkUser(s); const t1 = uniq('Tag'); const a = await s.createPersonalAssignment(u.id, P({ tags: [t1, 'Zeta'] })); assert.deepEqual(a.tags, [t1, 'Zeta'].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())));
    const b = await s.createPersonalAssignment(u.id, P({ tags: [t1.toLowerCase()] })); assert.deepEqual(b.tags, [t1], 'displayed with the original spelling');
    assert.deepEqual((await s.updatePersonalAssignment(u.id, a.id, { title: 'X' })).tags.length, 2, 'undefined tags = unchanged');
    assert.deepEqual((await s.updatePersonalAssignment(u.id, a.id, {}, ['Only'])).tags, ['Only']); assert.deepEqual((await s.updatePersonalAssignment(u.id, a.id, {}, [])).tags, []);
  });
  withStore('update applies only the given fields', async (s) => {
    const u = await mkUser(s); const a = await s.createPersonalAssignment(u.id, P({ title: 'Old', course: 'C1', description: 'd', lecturer: 'L', priority: 'low' }));
    const done = new Date('2026-06-20T12:00:00Z'); const r = await s.updatePersonalAssignment(u.id, a.id, { title: 'New', status: 'done', completedAt: done, lecturer: null });
    assert.equal(r.title, 'New'); assert.equal(r.course, 'C1'); assert.equal(r.description, 'd'); assert.equal(r.priority, 'low'); assert.equal(r.lecturer, null); assert.equal(r.status, 'done'); assert.equal(r.completedAt.getTime(), done.getTime());
    const back = await s.updatePersonalAssignment(u.id, a.id, { status: 'todo', completedAt: null }); assert.equal(back.completedAt, null);
    assert.equal((await s.updatePersonalAssignment(u.id, a.id, {})).title, 'New', 'an empty patch is a harmless read');
  });
  withStore('personal list: filters, search (wildcards are literal), sorting, pagination', async (s) => {
    const u = await mkUser(s); const tg = uniq('Hot');
    const mk = (o) => s.createPersonalAssignment(u.id, P(o));
    await mk({ title: 'Bravo', course: 'MTH 210', dueDate: '2026-07-03', priority: 'low', status: 'todo', tags: [tg] });
    await mk({ title: 'alpha', course: 'CSC 201', dueDate: '2026-07-01', priority: 'high', status: 'in-progress', description: 'Cover 50% of it' });
    await mk({ title: 'Charlie', course: 'CSC 220', dueDate: '2026-07-02', priority: 'medium', status: 'done', completedAt: new Date('2026-06-01T00:00:00Z'), description: 'under_score' });
    const titles = async (o) => (await s.listPersonalAssignments(u.id, o)).items.map((x) => x.title);
    assert.deepEqual(await titles({ sort: 'due' }), ['alpha', 'Charlie', 'Bravo']); assert.deepEqual(await titles({ sort: 'title' }), ['alpha', 'Bravo', 'Charlie']);
    assert.deepEqual(await titles({ sort: 'priority' }), ['alpha', 'Charlie', 'Bravo']); assert.deepEqual(await titles({ sort: 'created' }), ['Charlie', 'alpha', 'Bravo']);
    assert.deepEqual(await titles({ status: 'done' }), ['Charlie']); assert.deepEqual(await titles({ tag: tg.toUpperCase() }), ['Bravo']);
    assert.deepEqual(await titles({ q: 'CSC' }), ['alpha', 'Charlie']); assert.deepEqual(await titles({ q: 'ALPHA' }), ['alpha']);
    assert.deepEqual(await titles({ q: '50%' }), ['alpha']); assert.deepEqual(await titles({ q: '%' }), ['alpha'], '% is not a wildcard'); assert.deepEqual(await titles({ q: '_' }), ['Charlie'], '_ is not a wildcard'); assert.deepEqual(await titles({ q: 'x\\' }), []);
    const page = await s.listPersonalAssignments(u.id, { sort: 'title', limit: 2, offset: 1 }); assert.deepEqual(page.items.map((x) => x.title), ['Bravo', 'Charlie']); assert.equal(page.total, 3);
  });
  withStore('deleting a personal assignment returns its file keys and removes its attachment rows', async (s) => {
    const u = await mkUser(s); const a = await s.createPersonalAssignment(u.id, P()); const k1 = key(); const k2 = key();
    const x = await s.createAttachment({ ownerType: 'personal', ownerId: a.id, uploadedBy: u.id, ...att({ storageKey: k1 }) }); await s.createAttachment({ ownerType: 'personal', ownerId: a.id, uploadedBy: u.id, ...att({ storageKey: k2 }) });
    const r = await s.deletePersonalAssignment(u.id, a.id); assert.equal(r.deleted, true); assert.deepEqual(r.storageKeys.sort(), [k1, k2].sort());
    assert.equal(await s.getAttachmentForAccess(x.id), null); assert.equal((await s.existingStorageKeys([k1, k2])).size, 0);
    assert.deepEqual(await s.deletePersonalAssignment(u.id, a.id), { deleted: false, storageKeys: [] });
  });
  withStore('general assignments: visibility, filters, sorting, update, delete', async (s) => {
    const admin = await s.createUser({ username: uniq('adm').toLowerCase(), displayName: 'A', role: 'admin', passwordHash: 'h' }); const c = uniq('CRS ');
    const g1 = await s.createGeneralAssignment(G({ title: 'Zulu', course: c, dueDate: '2026-07-05', tags: ['Exams'], createdBy: admin.id, publishedAt: new Date('2026-06-02T00:00:00Z') }));
    const g2 = await s.createGeneralAssignment(G({ title: 'Mike', course: c, dueDate: '2026-07-02', publishedAt: new Date('2026-06-03T00:00:00Z'), description: 'findable words' }));
    const g3 = await s.createGeneralAssignment(G({ title: 'Draft', course: c, status: 'draft', publishedAt: null }));
    assert.equal(g1.createdBy, admin.id); assert.equal(g3.publishedAt, null);
    const titles = async (o) => (await s.listGeneralAssignments({ course: c, ...o })).items.map((x) => x.title);
    assert.deepEqual(await titles({}), ['Mike', 'Zulu'], 'students never see drafts'); assert.deepEqual(await titles({ publishedOnly: false, sort: 'title' }), ['Draft', 'Mike', 'Zulu']);
    assert.deepEqual(await titles({ publishedOnly: false, status: 'draft' }), ['Draft']); assert.deepEqual(await titles({ sort: 'published' }), ['Mike', 'Zulu']); assert.deepEqual(await titles({ tag: 'exams' }), ['Zulu']); assert.deepEqual(await titles({ q: 'FINDABLE' }), ['Mike']);
    const up = await s.updateGeneralAssignment(g3.id, { status: 'published', publishedAt: new Date('2026-06-04T00:00:00Z'), title: 'Now live' }, ['New'], admin.id);
    assert.equal(up.status, 'published'); assert.equal(up.updatedBy, admin.id); assert.deepEqual(up.tags, ['New']); assert.equal(up.course, c);
    assert.equal(await s.updateGeneralAssignment('10000000-0000-4000-8000-0000000000ff', { title: 'x' }, undefined, admin.id), null);
    const k = key(); await s.createAttachment({ ownerType: 'general', ownerId: g1.id, uploadedBy: admin.id, ...att({ storageKey: k }) });
    assert.deepEqual(await s.deleteGeneralAssignment(g1.id), { deleted: true, storageKeys: [k] }); assert.equal(await s.getGeneralAssignment(g1.id), null); assert.deepEqual(await s.deleteGeneralAssignment(g1.id), { deleted: false, storageKeys: [] });
  });
  withStore('attachments: metadata, grouping, access info, deletion, counting, key lookup', async (s) => {
    const u = await mkUser(s); const p = await s.createPersonalAssignment(u.id, P()); const g = await s.createGeneralAssignment(G({ status: 'draft', publishedAt: null }));
    const a1 = await s.createAttachment({ ownerType: 'personal', ownerId: p.id, uploadedBy: u.id, ...att({ originalFilename: 'one.pdf' }) });
    const a2 = await s.createAttachment({ ownerType: 'personal', ownerId: p.id, uploadedBy: u.id, ...att({ originalFilename: 'two.pdf' }) });
    const a3 = await s.createAttachment({ ownerType: 'general', ownerId: g.id, uploadedBy: u.id, ...att({ originalFilename: 'three.pdf' }) });
    assert.equal(a1.name, 'one.pdf'); assert.equal(a1.size, 1234);
    const listed = await s.listAttachments('personal', [p.id, '10000000-0000-4000-8000-0000000000ee']); assert.deepEqual(listed[p.id].map((x) => x.name), ['one.pdf', 'two.pdf']); assert.deepEqual(listed['10000000-0000-4000-8000-0000000000ee'], []);
    assert.deepEqual(await s.listAttachments('personal', []), {});
    const acc = await s.getAttachmentForAccess(a1.id); assert.equal(acc.ownerType, 'personal'); assert.equal(acc.ownerId, p.id); assert.equal(acc.ownerUserId, u.id); assert.equal(acc.generalStatus, null); assert.equal(acc.attachment.name, 'one.pdf'); assert.equal(acc.attachment.status, 'ready');
    const accG = await s.getAttachmentForAccess(a3.id); assert.equal(accG.ownerType, 'general'); assert.equal(accG.generalStatus, 'draft'); assert.equal(accG.ownerUserId, null);
    assert.equal(await s.getAttachmentForAccess('10000000-0000-4000-8000-0000000000dd'), null);
    assert.equal(await s.countAttachments('personal', p.id), 2); assert.equal(await s.countAttachments('general', g.id), 1);
    const keyA2 = (await s.deleteAttachment(a2.id)); assert.match(keyA2, /^[A-Za-z0-9_-]{32}$/); assert.equal(await s.deleteAttachment(a2.id), null); assert.equal(await s.countAttachments('personal', p.id), 1);
    assert.deepEqual([...await s.existingStorageKeys([keyA2, key()])], []);
    await assert.rejects(s.createAttachment({ ownerType: 'wizard', ownerId: p.id, uploadedBy: u.id, ...att() }), /Unknown attachment owner type/);
    const dup = key(); await s.createAttachment({ ownerType: 'personal', ownerId: p.id, uploadedBy: u.id, ...att({ storageKey: dup }) });
    await assert.rejects(s.createAttachment({ ownerType: 'personal', ownerId: p.id, uploadedBy: u.id, ...att({ storageKey: dup }) }), 'a storage key can be used only once');
    assert.deepEqual([...await s.existingStorageKeys([dup])], [dup]);
  });
}
