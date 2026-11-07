# Assignments and file storage (Phase 4)

## Endpoints (`/api/v1`)
| Method + path | Who | Notes |
|---|---|---|
| `GET /me/assignments` | signed in | Your private assignments. Query: `status`, `tag`, `q`, `sort` (due, priority, title, created), `limit` (<=200), `offset`. Returns `{ items, total }`. |
| `POST /me/assignments` | signed in + CSRF | `title`, `course`, `dueDate` (YYYY-MM-DD) required; `description`, `lecturer`, `priority`, `status`, `tags` optional. |
| `GET / PATCH / DELETE /me/assignments/:id` | owner | PATCH is partial. Setting `status` to `done` stamps `completedAt` on the server. |
| `POST /me/assignments/:id/attachments` | owner + CSRF | One file per request, raw bytes (see below). |
| `GET /assignments`, `GET /assignments/:id` | signed in | **Published** general assignments only. Drafts and unpublished ones answer 404. |
| `GET /admin/assignments` (+ `?status=`), `POST`, `GET/PATCH/DELETE /admin/assignments/:id` | admin session (+ CSRF for writes) | Draft -> published -> unpublished. The first publication time is kept. Every change is written to `admin_audit_logs`. |
| `POST /admin/assignments/:id/attachments` | admin + CSRF | Attach files to a general assignment. |
| `GET /attachments/:id` | see rules below | Download. `?inline=1` displays images only. |
| `DELETE /attachments/:id` | owner (personal) / admin (general) + CSRF | Removes the row and the stored file. |

Validation is server-side and reports every problem at once (`details` maps field -> message). Only whitelisted fields are read, so `userId`, `id`, `createdAt` and friends in a request body are ignored.

## Who can read or change a file (one function: `authorize` in `services/attachments.js`)
| File belongs to | Read | Delete |
|---|---|---|
| a personal assignment | its owner **only** (admins included) | its owner |
| a published general assignment | any signed-in user | admins |
| a draft/unpublished general assignment | admins | admins |

Anything else answers **404, never 403**, and malformed ids answer 404 too, so ids cannot be probed. Personal queries also filter by `user_id` in SQL, so a forgotten service-layer check could not leak another user's row.

## Upload pipeline
1. **Transport:** `Content-Type: application/octet-stream`, the name in `X-Filename` (percent-encoded), the CSRF token in `X-CSRF-Token`. One file per request means no multipart parser to attack. Body limit 5 MiB (413 above that).
2. **Validation by content** (`services/fileType.js`), never by the browser's claimed type: JPEG, PNG, WebP (magic bytes), PDF (must start at byte 0, so no polyglots), DOC (OLE2 *and* a `WordDocument` stream, so xls/ppt/msi are refused), DOCX (zip central directory must contain `[Content_Types].xml` and `word/document.xml`, no `..`/absolute entries; nothing is ever decompressed). SVG, HTML, scripts, executables and other Office files are refused. The extension must agree with the detected type.
3. **Name:** sanitised for display (paths, control characters, bidi overrides removed; max 120 characters). It is **never** used in a storage path.
4. **Limits:** 5 files per assignment, 60 uploads/hour per user (120 for admins).
5. **Storage:** random 192-bit key, SHA-256 recorded, then the metadata row. If the row cannot be written the file is deleted again.
6. **Download headers:** `Content-Type` from the detected type, `Content-Disposition: attachment` (inline only for JPEG/PNG/WebP on request), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: private, no-store`.

## Storage
`STORAGE_DRIVER=local` (the only driver) writes under `STORAGE_DIR`: `<root>/<key[0:2]>/<key[2:4]>/<key>`, files `0600` in `0700` directories, atomic temp-file + rename, keys validated against `^[A-Za-z0-9_-]{32,128}$`, and every resolved path must stay inside the root. The directory must be **outside `public/`** (the server refuses to start otherwise) and, in production, absolute and set explicitly.

**Operating notes**
- The directory must be on a **persistent volume** and included in backups (database and files must be restored together).
- One server, or several servers sharing the same volume. Ephemeral containers / serverless need an object-store driver: implement `put/get/delete/listKeys` like `services/storage/local.js` (an S3 driver is **not included**: it needs an SDK dependency that could not be installed or tested here).
- Cleanup: deleting an assignment or attachment removes the database rows first, then the files. An hourly job deletes files older than an hour that no row references (crashed uploads, failed cleanups).
- There is **no malware scanning**. Files are served as downloads with a locked-down CSP, but if students share files with each other at scale, add a scanner (the `attachments.status` column already supports `pending`/`rejected`).

## Known limits
- Concurrent uploads to one assignment can briefly exceed the 5-file limit (no database-level counter).
- The student pages load up to 200 assignments and filter/sort in the browser; the API supports server-side filtering and paging for when that is not enough.
- General-assignment attachments of unpublished assignments are admin-only, but a student who already downloaded a file keeps it (obviously).
- Feed posts and their attachments arrive in Phase 5 (`attachments` already has the owner columns).
