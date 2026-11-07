// In-memory twin of src/models/pgAssignments.js. Same interface and semantics (verified by assignments-contract.js).
const clone = (v) => structuredClone(v);
let seq = 0; const newId = () => `10000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
let tick = 0; const stamp = () => new Date(Date.UTC(2026, 0, 1) + (++tick) * 1000); // strictly increasing, like successive now() calls

export function createMemoryAssignments() {
  const personal = new Map(); const general = new Map(); const attachments = new Map(); const tagNames = new Map(); // lower -> display
  const display = (keys) => [...keys].map((k) => tagNames.get(k)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const ensureTags = (tags) => { for (const t of tags) if (!tagNames.has(t.toLowerCase())) tagNames.set(t.toLowerCase(), t); return new Set(tags.map((t) => t.toLowerCase())); };
  const viewP = (r) => r && clone({ ...r, tags: display(r.tagKeys), tagKeys: undefined });
  const viewG = (r) => r && clone({ ...r, tags: display(r.tagKeys), tagKeys: undefined });
  const contains = (r, q, fields) => fields.some((f) => String(r[f] ?? '').toLowerCase().includes(String(q).toLowerCase()));
  const PRIO = { high: 0, medium: 1, low: 2 };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const paginate = (list, limit, offset) => ({ items: list.slice(offset, offset + limit), total: list.length });
  const OWNER = { personal: 'personalAssignmentId', general: 'generalAssignmentId' };
  const pub = (a) => ({ id: a.id, name: a.originalFilename, contentType: a.contentType, size: a.sizeBytes, createdAt: a.createdAt });

  return {
    async createPersonalAssignment(userId, a) {
      const r = { id: newId(), userId, title: a.title, description: a.description, course: a.course, lecturer: a.lecturer ?? null, dueDate: a.dueDate, priority: a.priority, status: a.status, completedAt: a.completedAt ?? null, createdAt: stamp(), updatedAt: stamp(), tagKeys: ensureTags(a.tags) };
      personal.set(r.id, r); return viewP(r);
    },
    async getPersonalAssignment(userId, id) { const r = personal.get(id); return r && r.userId === userId ? viewP(r) : null; },
    async listPersonalAssignments(userId, { status = null, tag = null, q = null, sort = 'due', limit = 50, offset = 0 } = {}) {
      let list = [...personal.values()].filter((r) => r.userId === userId && (!status || r.status === status) && (!tag || r.tagKeys.has(String(tag).toLowerCase())) && (!q || contains(r, q, ['title', 'course', 'description'])));
      const by = { due: (a, b) => cmp(a.dueDate, b.dueDate) || cmp(+a.createdAt, +b.createdAt), priority: (a, b) => PRIO[a.priority] - PRIO[b.priority] || cmp(a.dueDate, b.dueDate), title: (a, b) => cmp(a.title.toLowerCase(), b.title.toLowerCase()), created: (a, b) => +b.createdAt - +a.createdAt };
      list = list.sort(by[sort] ?? by.due); const page = paginate(list, limit, offset); return { items: page.items.map(viewP), total: page.total };
    },
    async updatePersonalAssignment(userId, id, patch, tags) {
      const r = personal.get(id); if (!r || r.userId !== userId) return null;
      for (const k of ['title', 'description', 'course', 'lecturer', 'dueDate', 'priority', 'status', 'completedAt']) if (Object.hasOwn(patch, k)) r[k] = patch[k];
      if (tags !== undefined) r.tagKeys = ensureTags(tags); r.updatedAt = stamp(); return viewP(r);
    },
    async deletePersonalAssignment(userId, id) {
      const r = personal.get(id); if (!r || r.userId !== userId) return { deleted: false, storageKeys: [] };
      const keys = [...attachments.values()].filter((a) => a.personalAssignmentId === id).map((a) => a.storageKey);
      for (const a of [...attachments.values()]) if (a.personalAssignmentId === id) attachments.delete(a.id);
      personal.delete(id); return { deleted: true, storageKeys: keys };
    },

    async createGeneralAssignment(a) {
      const r = { id: newId(), title: a.title, course: a.course, category: a.category, description: a.description, dueDate: a.dueDate, status: a.status, publishedAt: a.publishedAt ?? null, createdBy: a.createdBy ?? null, updatedBy: a.createdBy ?? null, createdAt: stamp(), updatedAt: stamp(), tagKeys: ensureTags(a.tags) };
      general.set(r.id, r); return viewG(r);
    },
    async getGeneralAssignment(id) { return viewG(general.get(id) ?? null); },
    async listGeneralAssignments({ publishedOnly = true, status = null, course = null, tag = null, q = null, sort = 'deadline', limit = 50, offset = 0 } = {}) {
      let list = [...general.values()].filter((r) => (!publishedOnly || r.status === 'published') && (!status || r.status === status) && (!course || r.course === course)
        && (!tag || r.tagKeys.has(String(tag).toLowerCase())) && (!q || contains(r, q, ['title', 'course', 'description'])));
      const by = { deadline: (a, b) => cmp(a.dueDate, b.dueDate), published: (a, b) => (+(b.publishedAt ?? 0)) - (+(a.publishedAt ?? 0)), title: (a, b) => cmp(a.title.toLowerCase(), b.title.toLowerCase()) };
      list = list.sort(by[sort] ?? by.deadline); const page = paginate(list, limit, offset); return { items: page.items.map(viewG), total: page.total };
    },
    async updateGeneralAssignment(id, patch, tags, updatedBy) {
      const r = general.get(id); if (!r) return null;
      for (const k of ['title', 'course', 'category', 'description', 'dueDate', 'status', 'publishedAt']) if (Object.hasOwn(patch, k)) r[k] = patch[k];
      if (tags !== undefined) r.tagKeys = ensureTags(tags); r.updatedBy = updatedBy ?? null; r.updatedAt = stamp(); return viewG(r);
    },
    async deleteGeneralAssignment(id) {
      if (!general.has(id)) return { deleted: false, storageKeys: [] };
      const keys = [...attachments.values()].filter((a) => a.generalAssignmentId === id).map((a) => a.storageKey);
      for (const a of [...attachments.values()]) if (a.generalAssignmentId === id) attachments.delete(a.id);
      general.delete(id); return { deleted: true, storageKeys: keys };
    },

    async createAttachment({ ownerType, ownerId, uploadedBy, storageKey, originalFilename, contentType, sizeBytes, checksumSha256 }) {
      if (!OWNER[ownerType]) throw new Error(`Unknown attachment owner type "${ownerType}"`);
      if ([...attachments.values()].some((a) => a.storageKey === storageKey)) throw new Error('duplicate storage_key');
      const a = { id: newId(), uploadedBy, storageKey, originalFilename, contentType, sizeBytes, checksumSha256, status: 'ready', createdAt: stamp(), personalAssignmentId: null, generalAssignmentId: null, [OWNER[ownerType]]: ownerId };
      attachments.set(a.id, a); return { id: a.id, ownerType, ownerId, name: originalFilename, contentType, size: sizeBytes, createdAt: a.createdAt };
    },
    async listAttachments(ownerType, ownerIds) {
      const col = OWNER[ownerType]; if (!col) throw new Error(`Unknown attachment owner type "${ownerType}"`);
      const out = Object.fromEntries(ownerIds.map((id) => [id, []]));
      for (const a of [...attachments.values()].sort((x, y) => +x.createdAt - +y.createdAt)) if (a.status === 'ready' && out[a[col]]) out[a[col]].push(clone(pub(a)));
      return out;
    },
    async getAttachmentForAccess(id) {
      const a = attachments.get(id); if (!a) return null;
      const p = a.personalAssignmentId ? personal.get(a.personalAssignmentId) : null; const g = a.generalAssignmentId ? general.get(a.generalAssignmentId) : null;
      return { attachment: { id: a.id, storageKey: a.storageKey, name: a.originalFilename, contentType: a.contentType, size: a.sizeBytes, status: a.status },
        ownerType: a.personalAssignmentId ? 'personal' : a.generalAssignmentId ? 'general' : 'other', ownerId: a.personalAssignmentId ?? a.generalAssignmentId, ownerUserId: p?.userId ?? null, generalStatus: g?.status ?? null };
    },
    async deleteAttachment(id) { const a = attachments.get(id); if (!a) return null; attachments.delete(id); return a.storageKey; },
    async countAttachments(ownerType, ownerId) { const col = OWNER[ownerType]; if (!col) throw new Error(`Unknown attachment owner type "${ownerType}"`); return [...attachments.values()].filter((a) => a[col] === ownerId).length; },
    async existingStorageKeys(keys) { const have = new Set([...attachments.values()].map((a) => a.storageKey)); return new Set(keys.filter((k) => have.has(k))); },
  };
}
