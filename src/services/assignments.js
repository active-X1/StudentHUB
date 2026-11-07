// Assignment rules for students (private assignments) and administrators (general assignments).
// The store scopes every personal query by user id; this layer adds validation, status transitions, audit and file cleanup.
import { notFound } from '../utils/errors.js';
import { parseGeneralInput, parsePersonalInput, parseGeneralQuery, parsePersonalQuery } from '../validators/assignments.js';

const attUrl = (a) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size, url: `/api/v1/attachments/${a.id}` });
export const personalDto = (a, attachments = []) => ({ id: a.id, title: a.title, description: a.description, course: a.course, lecturer: a.lecturer, dueDate: a.dueDate, priority: a.priority, status: a.status, completedAt: a.completedAt, createdAt: a.createdAt, updatedAt: a.updatedAt, tags: a.tags, attachments: attachments.map(attUrl) });
export const generalDto = (a, attachments = [], { admin = false } = {}) => ({
  id: a.id, title: a.title, course: a.course, category: a.category, description: a.description, dueDate: a.dueDate, publishedAt: a.publishedAt, tags: a.tags, attachments: attachments.map(attUrl),
  ...(admin ? { status: a.status, createdBy: a.createdBy, updatedBy: a.updatedBy, createdAt: a.createdAt, updatedAt: a.updatedAt } : {}),
});

export function createAssignmentService({ store, storage, logger, clock = () => new Date() }) {
  /** Removes files after their database rows are gone. A failure leaves an orphan for the sweeper; it never fails the request. */
  async function removeFiles(keys) {
    for (const k of keys) { try { await storage.delete(k); } catch (err) { logger.warn('file_delete_failed', { err }); } }
  }
  const withFiles = async (type, items) => { const m = await store.listAttachments(type, items.map((i) => i.id)); return items.map((i) => [i, m[i.id] ?? []]); };

  return {
    // ----- personal -----
    async listPersonal(userId, query) {
      const { items, total } = await store.listPersonalAssignments(userId, parsePersonalQuery(query));
      return { total, items: (await withFiles('personal', items)).map(([a, f]) => personalDto(a, f)) };
    },
    async getPersonal(userId, id) {
      const a = await store.getPersonalAssignment(userId, id); if (!a) throw notFound();
      return personalDto(a, (await store.listAttachments('personal', [id]))[id]);
    },
    async createPersonal(userId, input) {
      const { patch, tags } = parsePersonalInput(input);
      const a = await store.createPersonalAssignment(userId, { ...patch, tags, completedAt: patch.status === 'done' ? clock() : null });
      return personalDto(a, []);
    },
    async updatePersonal(userId, id, input) {
      const { patch, tags } = parsePersonalInput(input, { partial: true });
      if (Object.hasOwn(patch, 'status')) {
        const current = await store.getPersonalAssignment(userId, id); if (!current) throw notFound();
        patch.completedAt = patch.status === 'done' ? (current.completedAt ?? clock()) : null; // keep the original completion time when re-saving a done task
      }
      const a = await store.updatePersonalAssignment(userId, id, patch, tags); if (!a) throw notFound();
      return personalDto(a, (await store.listAttachments('personal', [id]))[id]);
    },
    async deletePersonal(userId, id) {
      const r = await store.deletePersonalAssignment(userId, id); if (!r.deleted) throw notFound();
      await removeFiles(r.storageKeys); return { ok: true };
    },

    // ----- general (students read; admins manage) -----
    async listGeneral(query, { admin = false } = {}) {
      const q = parseGeneralQuery(query, { admin });
      const { items, total } = await store.listGeneralAssignments({ ...q, publishedOnly: !admin });
      return { total, items: (await withFiles('general', items)).map(([a, f]) => generalDto(a, f, { admin })) };
    },
    async getGeneral(id, { admin = false } = {}) {
      const a = await store.getGeneralAssignment(id); if (!a || (!admin && a.status !== 'published')) throw notFound(); // drafts do not exist for students
      return generalDto(a, (await store.listAttachments('general', [id]))[id], { admin });
    },
    async createGeneral(actor, input) {
      const { patch, tags } = parseGeneralInput(input); const now = clock();
      const a = await store.createGeneralAssignment({ ...patch, tags, createdBy: actor.id, publishedAt: patch.status === 'published' ? now : null });
      await store.writeAudit({ actorId: actor.id, actorLabel: actor.label, action: `Created general assignment "${a.title}" (${a.status})`, entityType: 'general_assignment', entityId: a.id, ip: actor.ip });
      return generalDto(a, [], { admin: true });
    },
    async updateGeneral(actor, id, input) {
      const { patch, tags } = parseGeneralInput(input, { partial: true });
      const current = await store.getGeneralAssignment(id); if (!current) throw notFound();
      if (patch.status === 'published' && !current.publishedAt) patch.publishedAt = clock(); // first publication time is kept across unpublish/republish
      const a = await store.updateGeneralAssignment(id, patch, tags, actor.id); if (!a) throw notFound();
      const verb = patch.status && patch.status !== current.status ? `Changed general assignment "${a.title}" to ${a.status}` : `Edited general assignment "${a.title}"`;
      await store.writeAudit({ actorId: actor.id, actorLabel: actor.label, action: verb, entityType: 'general_assignment', entityId: id, ip: actor.ip });
      return generalDto(a, (await store.listAttachments('general', [id]))[id], { admin: true });
    },
    async deleteGeneral(actor, id) {
      const current = await store.getGeneralAssignment(id); const r = await store.deleteGeneralAssignment(id); if (!r.deleted) throw notFound();
      await store.writeAudit({ actorId: actor.id, actorLabel: actor.label, action: `Deleted general assignment "${current?.title ?? id}"`, entityType: 'general_assignment', entityId: id, ip: actor.ip });
      await removeFiles(r.storageKeys); return { ok: true };
    },
  };
}
