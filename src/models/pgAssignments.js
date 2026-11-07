// SQL for personal assignments, general assignments, hashtags and attachment metadata.
// Ownership is enforced IN THE QUERY (WHERE user_id = $n): a caller can never receive or change another user's row, even
// if a service-layer check were forgotten. Dynamic parts (ORDER BY, SET columns) come only from fixed whitelists below.
const likePattern = (q) => `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;
const OWNER_COL = { personal: 'personal_assignment_id', general: 'general_assignment_id' };

const P_COLS = `p.id, p.user_id, p.title, p.description, p.course, p.lecturer, to_char(p.due_date, 'YYYY-MM-DD') AS due_date, p.priority, p.status,
  p.completed_at, p.created_at, p.updated_at,
  ARRAY(SELECT h.name FROM personal_assignment_hashtags t JOIN hashtags h ON h.id = t.hashtag_id WHERE t.assignment_id = p.id ORDER BY lower(h.name)) AS tags`;
const G_COLS = `g.id, g.title, g.course, g.category, g.description, to_char(g.due_date, 'YYYY-MM-DD') AS due_date, g.status, g.published_at, g.created_by, g.updated_by,
  g.created_at, g.updated_at,
  ARRAY(SELECT h.name FROM general_assignment_hashtags t JOIN hashtags h ON h.id = t.hashtag_id WHERE t.assignment_id = g.id ORDER BY lower(h.name)) AS tags`;
const P_SORT = { due: 'p.due_date ASC, p.created_at ASC, p.id', priority: "CASE p.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, p.due_date ASC, p.id", title: 'lower(p.title) ASC, p.id', created: 'p.created_at DESC, p.id' };
const G_SORT = { deadline: 'g.due_date ASC, g.id', published: 'g.published_at DESC NULLS LAST, g.id', title: 'lower(g.title) ASC, g.id' };
const P_SET = { title: 'title', description: 'description', course: 'course', lecturer: 'lecturer', dueDate: 'due_date', priority: 'priority', status: 'status', completedAt: 'completed_at' };
const G_SET = { title: 'title', course: 'course', category: 'category', description: 'description', dueDate: 'due_date', status: 'status', publishedAt: 'published_at' };

const personal = (r) => r && ({ id: r.id, userId: r.user_id, title: r.title, description: r.description, course: r.course, lecturer: r.lecturer, dueDate: r.due_date, priority: r.priority, status: r.status, completedAt: r.completed_at, createdAt: r.created_at, updatedAt: r.updated_at, tags: r.tags ?? [] });
const general = (r) => r && ({ id: r.id, title: r.title, course: r.course, category: r.category, description: r.description, dueDate: r.due_date, status: r.status, publishedAt: r.published_at, createdBy: r.created_by, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at, tags: r.tags ?? [] });

export function createPgAssignments(db) {
  const rows = async (text, params, c = db) => (await c.query(text, params)).rows;
  const one = async (text, params, c = db) => (await rows(text, params, c))[0] ?? null;

  /** Replaces the tag set of one assignment (call inside a transaction). `kind` selects the join table from a fixed pair. */
  async function setTags(c, kind, id, tags) {
    const table = kind === 'personal' ? 'personal_assignment_hashtags' : 'general_assignment_hashtags';
    await c.query(`DELETE FROM ${table} WHERE assignment_id = $1`, [id]);
    if (!tags.length) return;
    await c.query('INSERT INTO hashtags (name) SELECT t FROM unnest($1::text[]) AS t ON CONFLICT DO NOTHING', [tags]);
    await c.query(`INSERT INTO ${table} (assignment_id, hashtag_id) SELECT $1, h.id FROM hashtags h WHERE lower(h.name) = ANY($2::text[]) ON CONFLICT DO NOTHING`, [id, tags.map((t) => t.toLowerCase())]);
  }
  function buildSet(map, patch, params) {
    const sets = [];
    for (const [key, col] of Object.entries(map)) if (Object.hasOwn(patch, key)) { params.push(patch[key]); sets.push(`${col} = $${params.length}`); }
    return sets;
  }

  return {
    // ---------------- personal ----------------
    createPersonalAssignment: (userId, a) => db.withTransaction(async (c) => {
      const r = await one(`INSERT INTO personal_assignments (user_id, title, description, course, lecturer, due_date, priority, status, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [userId, a.title, a.description, a.course, a.lecturer, a.dueDate, a.priority, a.status, a.completedAt], c);
      await setTags(c, 'personal', r.id, a.tags);
      return personal(await one(`SELECT ${P_COLS} FROM personal_assignments p WHERE p.id = $1`, [r.id], c));
    }),
    getPersonalAssignment: async (userId, id) => personal(await one(`SELECT ${P_COLS} FROM personal_assignments p WHERE p.id = $1 AND p.user_id = $2`, [id, userId])),
    async listPersonalAssignments(userId, { status = null, tag = null, q = null, sort = 'due', limit = 50, offset = 0 } = {}) {
      const params = [userId]; const where = ['p.user_id = $1'];
      if (status) { params.push(status); where.push(`p.status = $${params.length}`); }
      if (tag) { params.push(String(tag).toLowerCase()); where.push(`EXISTS (SELECT 1 FROM personal_assignment_hashtags t JOIN hashtags h ON h.id = t.hashtag_id WHERE t.assignment_id = p.id AND lower(h.name) = $${params.length})`); }
      if (q) { params.push(likePattern(q)); where.push(`(p.title ILIKE $${params.length} OR p.course ILIKE $${params.length} OR p.description ILIKE $${params.length})`); }
      const total = (await one(`SELECT count(*)::int AS n FROM personal_assignments p WHERE ${where.join(' AND ')}`, params)).n;
      params.push(limit, offset);
      const items = await rows(`SELECT ${P_COLS} FROM personal_assignments p WHERE ${where.join(' AND ')} ORDER BY ${P_SORT[sort] ?? P_SORT.due} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      return { items: items.map(personal), total };
    },
    updatePersonalAssignment: (userId, id, patch, tags) => db.withTransaction(async (c) => {
      const params = [id, userId]; const sets = buildSet(P_SET, patch, params);
      if (sets.length) { if (!(await one(`UPDATE personal_assignments SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING id`, params, c))) return null; }
      else if (!(await one('SELECT id FROM personal_assignments WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId], c))) return null;
      if (tags !== undefined) await setTags(c, 'personal', id, tags);
      return personal(await one(`SELECT ${P_COLS} FROM personal_assignments p WHERE p.id = $1`, [id], c));
    }),
    /** Deletes the assignment (and, by cascade, its attachment rows). Returns the storage keys whose files must now be removed. */
    deletePersonalAssignment: (userId, id) => db.withTransaction(async (c) => {
      const keys = (await rows('SELECT a.storage_key FROM attachments a JOIN personal_assignments p ON p.id = a.personal_assignment_id WHERE p.id = $1 AND p.user_id = $2', [id, userId], c)).map((r) => r.storage_key);
      const gone = await one('DELETE FROM personal_assignments WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId], c);
      return { deleted: Boolean(gone), storageKeys: gone ? keys : [] };
    }),

    // ---------------- general ----------------
    createGeneralAssignment: (a) => db.withTransaction(async (c) => {
      const r = await one(`INSERT INTO general_assignments (title, course, category, description, due_date, status, published_at, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`, [a.title, a.course, a.category, a.description, a.dueDate, a.status, a.publishedAt, a.createdBy], c);
      await setTags(c, 'general', r.id, a.tags);
      return general(await one(`SELECT ${G_COLS} FROM general_assignments g WHERE g.id = $1`, [r.id], c));
    }),
    getGeneralAssignment: async (id) => general(await one(`SELECT ${G_COLS} FROM general_assignments g WHERE g.id = $1`, [id])),
    async listGeneralAssignments({ publishedOnly = true, status = null, course = null, tag = null, q = null, sort = 'deadline', limit = 50, offset = 0 } = {}) {
      const params = []; const where = ['TRUE'];
      if (publishedOnly) where.push("g.status = 'published'");
      if (status) { params.push(status); where.push(`g.status = $${params.length}`); }
      if (course) { params.push(course); where.push(`g.course = $${params.length}`); }
      if (tag) { params.push(String(tag).toLowerCase()); where.push(`EXISTS (SELECT 1 FROM general_assignment_hashtags t JOIN hashtags h ON h.id = t.hashtag_id WHERE t.assignment_id = g.id AND lower(h.name) = $${params.length})`); }
      if (q) { params.push(likePattern(q)); where.push(`(g.title ILIKE $${params.length} OR g.course ILIKE $${params.length} OR g.description ILIKE $${params.length})`); }
      const total = (await one(`SELECT count(*)::int AS n FROM general_assignments g WHERE ${where.join(' AND ')}`, params)).n;
      params.push(limit, offset);
      const items = await rows(`SELECT ${G_COLS} FROM general_assignments g WHERE ${where.join(' AND ')} ORDER BY ${G_SORT[sort] ?? G_SORT.deadline} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      return { items: items.map(general), total };
    },
    updateGeneralAssignment: (id, patch, tags, updatedBy) => db.withTransaction(async (c) => {
      const params = [id, updatedBy]; const sets = ['updated_by = $2', ...buildSet(G_SET, patch, params)];
      if (!(await one(`UPDATE general_assignments SET ${sets.join(', ')} WHERE id = $1 RETURNING id`, params, c))) return null;
      if (tags !== undefined) await setTags(c, 'general', id, tags);
      return general(await one(`SELECT ${G_COLS} FROM general_assignments g WHERE g.id = $1`, [id], c));
    }),
    deleteGeneralAssignment: (id) => db.withTransaction(async (c) => {
      const keys = (await rows('SELECT storage_key FROM attachments WHERE general_assignment_id = $1', [id], c)).map((r) => r.storage_key);
      const gone = await one('DELETE FROM general_assignments WHERE id = $1 RETURNING id', [id], c);
      return { deleted: Boolean(gone), storageKeys: gone ? keys : [] };
    }),

    // ---------------- attachments (metadata) ----------------
    async createAttachment({ ownerType, ownerId, uploadedBy, storageKey, originalFilename, contentType, sizeBytes, checksumSha256 }) {
      const col = OWNER_COL[ownerType]; if (!col) throw new Error(`Unknown attachment owner type "${ownerType}"`);
      const r = await one(`INSERT INTO attachments (uploaded_by, ${col}, storage_key, original_filename, content_type, size_bytes, checksum_sha256, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready') RETURNING id, created_at`, [uploadedBy, ownerId, storageKey, originalFilename, contentType, sizeBytes, checksumSha256]);
      return { id: r.id, ownerType, ownerId, name: originalFilename, contentType, size: sizeBytes, createdAt: r.created_at };
    },
    /** -> { [ownerId]: [{ id, name, contentType, size, createdAt }] } for ready attachments. */
    async listAttachments(ownerType, ownerIds) {
      const col = OWNER_COL[ownerType]; if (!col) throw new Error(`Unknown attachment owner type "${ownerType}"`);
      const out = Object.fromEntries(ownerIds.map((id) => [id, []])); if (!ownerIds.length) return out;
      for (const r of await rows(`SELECT id, ${col} AS owner_id, original_filename, content_type, size_bytes, created_at FROM attachments WHERE ${col} = ANY($1::uuid[]) AND status = 'ready' ORDER BY created_at, id`, [ownerIds]))
        out[r.owner_id].push({ id: r.id, name: r.original_filename, contentType: r.content_type, size: Number(r.size_bytes), createdAt: r.created_at });
      return out;
    },
    /** Everything the authorization decision needs, in one query. */
    async getAttachmentForAccess(id) {
      const r = await one(`SELECT a.id, a.storage_key, a.original_filename, a.content_type, a.size_bytes, a.status, a.personal_assignment_id, a.general_assignment_id,
          p.user_id AS personal_owner_id, g.status AS general_status
        FROM attachments a LEFT JOIN personal_assignments p ON p.id = a.personal_assignment_id LEFT JOIN general_assignments g ON g.id = a.general_assignment_id WHERE a.id = $1`, [id]);
      if (!r) return null;
      const ownerType = r.personal_assignment_id ? 'personal' : r.general_assignment_id ? 'general' : 'other';
      return { attachment: { id: r.id, storageKey: r.storage_key, name: r.original_filename, contentType: r.content_type, size: Number(r.size_bytes), status: r.status },
        ownerType, ownerId: r.personal_assignment_id ?? r.general_assignment_id, ownerUserId: r.personal_owner_id ?? null, generalStatus: r.general_status ?? null };
    },
    deleteAttachment: async (id) => (await one('DELETE FROM attachments WHERE id = $1 RETURNING storage_key', [id]))?.storage_key ?? null,
    async countAttachments(ownerType, ownerId) {
      const col = OWNER_COL[ownerType]; if (!col) throw new Error(`Unknown attachment owner type "${ownerType}"`);
      return (await one(`SELECT count(*)::int AS n FROM attachments WHERE ${col} = $1`, [ownerId])).n;
    },
    async existingStorageKeys(keys) { return new Set(keys.length ? (await rows('SELECT storage_key FROM attachments WHERE storage_key = ANY($1::text[])', [keys])).map((r) => r.storage_key) : []); },
  };
}
