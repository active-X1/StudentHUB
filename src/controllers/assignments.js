// HTTP adapters for assignments and attachments. Authorization is layered: route guards (auth, role, CSRF) -> services
// (ownership, publication state) -> SQL (scoped by user id). Malformed ids answer 404 like unknown ids.
import { isUuid } from '../validators/common.js';
import { AppError, notFound } from '../utils/errors.js';
import { contentDisposition } from '../utils/http.js';

const id = (req, name = 'id') => { const v = req.params?.[name]; if (!isUuid(v)) throw notFound(); return v.toLowerCase(); };

export function createAssignmentsController({ assignments, attachments, store }) {
  const actor = (req) => ({ id: req.auth.user.id, label: req.auth.user.username ?? req.auth.user.email, ip: req.ip });

  async function upload(req, res, ownerType, ownerId) {
    if (!Buffer.isBuffer(req.body)) throw new AppError(415, 'unsupported_media_type', 'Send the file bytes with Content-Type: application/octet-stream.');
    const a = await attachments.upload({ ownerType, ownerId, user: req.auth.user, filename: req.get('x-filename'), buffer: req.body });
    return res.status(201).json({ attachment: { id: a.id, name: a.name, contentType: a.contentType, size: a.size, url: `/api/v1/attachments/${a.id}` } });
  }

  return {
    // ----- students: private assignments -----
    listMine: async (req, res) => res.json(await assignments.listPersonal(req.auth.user.id, req.query)),
    createMine: async (req, res) => res.status(201).json({ assignment: await assignments.createPersonal(req.auth.user.id, req.body) }),
    getMine: async (req, res) => res.json({ assignment: await assignments.getPersonal(req.auth.user.id, id(req)) }),
    updateMine: async (req, res) => res.json({ assignment: await assignments.updatePersonal(req.auth.user.id, id(req), req.body) }),
    deleteMine: async (req, res) => res.json(await assignments.deletePersonal(req.auth.user.id, id(req))),
    async uploadMine(req, res) {
      const ownerId = id(req); if (!await store.getPersonalAssignment(req.auth.user.id, ownerId)) throw notFound(); // scoped lookup = ownership check
      return upload(req, res, 'personal', ownerId);
    },

    // ----- students: published general assignments -----
    listGeneral: async (req, res) => res.json(await assignments.listGeneral(req.query)),
    getGeneral: async (req, res) => res.json({ assignment: await assignments.getGeneral(id(req)) }),

    // ----- admins: general assignments -----
    adminList: async (req, res) => res.json(await assignments.listGeneral(req.query, { admin: true })),
    adminGet: async (req, res) => res.json({ assignment: await assignments.getGeneral(id(req), { admin: true }) }),
    adminCreate: async (req, res) => res.status(201).json({ assignment: await assignments.createGeneral(actor(req), req.body) }),
    adminUpdate: async (req, res) => res.json({ assignment: await assignments.updateGeneral(actor(req), id(req), req.body) }),
    adminDelete: async (req, res) => res.json(await assignments.deleteGeneral(actor(req), id(req))),
    async adminUpload(req, res) {
      const ownerId = id(req); const a = await store.getGeneralAssignment(ownerId); if (!a) throw notFound();
      const r = await upload(req, res, 'general', ownerId);
      await store.writeAudit({ ...{ actorId: req.auth.user.id, actorLabel: actor(req).label, ip: req.ip }, action: `Attached a file to general assignment "${a.title}"`, entityType: 'general_assignment', entityId: ownerId });
      return r;
    },

    // ----- any signed-in user: file download / delete (authorization decided in the attachment service) -----
    async download(req, res) {
      const f = await attachments.open({ id: id(req), user: req.auth.user, wantInline: req.query?.inline === '1' });
      res.status(200).set({
        'Content-Type': f.attachment.contentType, 'Content-Length': String(f.size), 'Content-Disposition': contentDisposition(f.attachment.name, { inline: f.inline }),
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'private, no-store',
      });
      f.stream.on('error', () => { res.destroy(); }); f.stream.pipe(res);
    },
    async deleteAttachment(req, res) {
      const r = await attachments.remove({ id: id(req), user: req.auth.user });
      if (r.ownerType === 'general') await store.writeAudit({ actorId: req.auth.user.id, actorLabel: actor(req).label, action: 'Removed a file from a general assignment', entityType: 'general_assignment', entityId: r.ownerId, ip: req.ip });
      return res.json({ ok: true });
    },
  };
}
