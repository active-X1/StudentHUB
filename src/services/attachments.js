// File attachments. Upload: validate by content, store under a random key, record metadata. Download/delete: ONE
// authorization function (`authorize`) decides who may touch a file, and it answers 404 (never 403) so IDs cannot be probed.
import { createHash } from 'node:crypto';
import { AppError, notFound, validationError } from '../utils/errors.js';
import { MAX_ATTACHMENTS_PER_OWNER, validateUpload, INLINE_SAFE } from './fileType.js';
import { newStorageKey } from './storage/local.js';

export function createAttachmentService({ store, storage, logger }) {
  /** Returns the access record when `user` may use the attachment, otherwise throws 404. */
  function authorize(access, user, { forWrite = false } = {}) {
    if (!access || access.attachment.status !== 'ready') throw notFound();
    const isAdmin = user.roles.includes('admin');
    if (access.ownerType === 'personal') { if (access.ownerUserId === user.id) return access; throw notFound(); } // private: the owner only, admins included
    if (access.ownerType === 'general') {
      if (isAdmin) return access;
      if (!forWrite && access.generalStatus === 'published') return access; // students may read published assignments' files, never change them
    }
    throw notFound();
  }

  return {
    /** Callers must already have proven access to the owning assignment (route guard + scoped lookup). */
    async upload({ ownerType, ownerId, user, filename, buffer }) {
      if (!filename || typeof filename !== 'string') throw validationError({ file: 'A file name is required.' });
      const { contentType, filename: safeName } = validateUpload({ filename, buffer });
      if (await store.countAttachments(ownerType, ownerId) >= MAX_ATTACHMENTS_PER_OWNER) throw validationError({ file: `You can attach up to ${MAX_ATTACHMENTS_PER_OWNER} files.` });
      const storageKey = newStorageKey();
      await storage.put(storageKey, buffer);
      try {
        return await store.createAttachment({ ownerType, ownerId, uploadedBy: user.id, storageKey, originalFilename: safeName, contentType, sizeBytes: buffer.length, checksumSha256: createHash('sha256').update(buffer).digest('hex') });
      } catch (err) {
        await storage.delete(storageKey).catch((e) => logger.warn('file_delete_failed', { err: e })); // do not leave an unreferenced file behind
        throw err;
      }
    },
    /** -> { attachment, stream, size, inline } for an authorized reader. */
    async open({ id, user, wantInline = false }) {
      const { attachment } = authorize(await store.getAttachmentForAccess(id), user);
      let file;
      try { file = await storage.get(attachment.storageKey); }
      catch (err) { logger.error('attachment_file_missing', { err, attachmentId: id }); throw new AppError(404, 'not_found', 'Not found'); }
      return { attachment, stream: file.stream, size: file.size, inline: wantInline && INLINE_SAFE.has(attachment.contentType) };
    },
    async remove({ id, user }) {
      const access = authorize(await store.getAttachmentForAccess(id), user, { forWrite: true });
      const key = await store.deleteAttachment(id); if (key) await storage.delete(key).catch((err) => logger.warn('file_delete_failed', { err }));
      return { ok: true, ownerType: access.ownerType, ownerId: access.ownerId };
    },
  };
}

/** Deletes stored files that no attachment row references and that are older than `olderThanMs` (crashed uploads, failed cleanups). */
export async function sweepOrphanFiles({ store, storage, logger, olderThanMs = 3600e3 }) {
  if (!storage.listKeys) return 0;
  const keys = await storage.listKeys({ olderThanMs }); if (!keys.length) return 0;
  const known = await store.existingStorageKeys(keys); let removed = 0;
  for (const k of keys.filter((x) => !known.has(x))) { try { await storage.delete(k); removed += 1; } catch (err) { logger.warn('orphan_delete_failed', { err }); } }
  if (removed) logger.info('orphan_files_removed', { removed });
  return removed;
}
