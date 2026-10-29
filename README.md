# Student Hub

A shared academic home for a Computer Science department: announcements, feeds with hashtag search, private assignments, department-published assignments, and an admin dashboard.

**Status: Phase 3.** Real authentication is in: registration and sign-in, secure server-side sessions, Google and GitHub OAuth, password change, a command-line admin bootstrap with forced password change, a persisted 3-attempt admin lockout, and server-side admin authorization. Assignments, feeds and admin content are **still sample data** until Phases 4-5. See [docs/auth.md](docs/auth.md) for the design, the limits, and what is not done yet (notably: forgot-password and email verification need email delivery).

## Run locally
Requires Node.js 20.12+ and, for the API, PostgreSQL 13+.

```bash
npm install
cp .env.example .env            # then set DATABASE_URL
createdb student_hub            # or create the database any other way
npm run db:migrate              # create the schema
npm run db:seed                 # optional: development sample content (no admin, no passwords)
npm run admin:bootstrap         # create the first administrator (see docs/auth.md; needs ADMIN_BOOTSTRAP_PASSWORD or --password-stdin)
npm start                       # http://localhost:3000   (admin sign-in: /admin)
```
Set `SESSION_SECRET` in `.env` (32+ random characters; required in production). Without `DATABASE_URL` the server still starts (development only), the auth API is absent, and the frontend runs in **demo mode** exactly like Phase 1.

**Frontend only, no install or database:** `npm run dev:static` serves `public/` with a zero-dependency server.

Use `localhost` (or HTTPS): ES modules and service workers do not work from `file://`.

## Tests
```bash
npm test                                                           # unit + structure tests; no database needed
TEST_DATABASE_URL=postgres://localhost/student_hub_test npm test   # also runs the PostgreSQL integration test
```
`npm run build:sw` regenerates the service-worker precache list after adding frontend files (a test checks it).
Tests that need Express/helmet (`tests/backend/app.test.js`) or a database (`tests/backend/integration/`) are **skipped, not failed**, when those are unavailable. Run them at least once on a machine with `npm install` and PostgreSQL before relying on the server.

## What works in the prototype
- **Home**, **Feeds**, **My Assignments**, **General Assignments**, **Account** with a floating liquid bottom bar on mobile (order: My Assignments, Account, **Home**, Feeds, General Assignments) and a sidebar on desktop.
- Feeds: search, `#hashtag` filtering, category filters, sorting, post detail with comments and likes, copy hashtags/text, and a composer that creates a **mock pending-review** suggestion.
- My Assignments: add, edit, view, filter, sort, complete, delete, with file previews.
- General Assignments: search, course filter, sort, details; downloads are placeholders.
- Settings drawer (about 75% of phone width; overlay, close button, Escape, focus trap), light/dark theme, notification placeholders, change-password form design, sign-out confirmation.
- Sign-in, registration, forgot-password (demo validation only).
- `/admin`: real sign-in (lockout, forced password change, short sessions) in front of a dashboard whose **content is sample data**: KPI cards, home content, feed moderation, suggestions, general assignments, users, audit log. No admin link appears in the student UI.
- PWA: manifest, icons, install prompt (where supported), cautious service worker.
- Settings → **Prototype tools** simulates slow, empty and error API states.

## Limitations (Phase 1)
- All data is in browser memory and resets on reload; only theme, notification toggles and form drafts use `localStorage` (and are cleared on sign-out).
- Selected files are previewed locally and never uploaded or stored.
- Forgot-password, email verification, profile editing and account linking are not built (see [docs/auth.md](docs/auth.md)). Sign-in, OAuth, password change and the admin lockout are real when the API runs; in demo mode (no API) they are visual only.
- Student suggestions and admin moderation do not share state (separate pages, separate in-memory data).
- The API currently exposes only `GET /api/v1/health` and `/api/v1/health/ready`. The frontend uses mock data until the feature phases connect it.

## Structure
```
public/                 static frontend (index.html, auth pages, manifest, service worker, assets/, admin/)
src/server.js, app.js   process entry point and Express app factory
src/config/             env validation (index.js) and the Content-Security-Policy (csp.js)
src/middleware/         request id, logging, errors, admin-UI gate, permissions policy
src/routes, controllers /api/v1 route table (shared by Express and tests) and HTTP adapters
src/services           auth rules, sessions, passwords, OAuth, admin bootstrap, housekeeping
src/models             SQL data access (pgStore.js)
src/validators, utils   input validation helpers, logger, errors, hashtags
src/database/           pool, migration runner, seed runner, CLI, migrations/, seeds/
scripts/                run-tests.js, static-server.js (frontend-only dev server)
tests/frontend, backend unit, structure and (optional) integration tests
docs/                   architecture, auth, database, api-plan, security
```
See [docs/architecture.md](docs/architecture.md), [docs/auth.md](docs/auth.md), [docs/database.md](docs/database.md), [docs/api-plan.md](docs/api-plan.md) and [docs/security.md](docs/security.md).

## Roadmap
1. **Phase 1 (done):** responsive frontend prototype with mock data.
2. **Phase 2 (done):** Node.js + Express foundation, PostgreSQL schema, migrations, seeds, security headers, tests.
3. **Phase 3 (done):** real authentication, secure sessions, Google/GitHub OAuth, admin bootstrap, password change, three-failed-attempt admin lockout.
4. **Phase 4:** persistent personal assignments, general assignments, secure file storage.
5. **Phase 5:** feeds, hashtags, suggestions, moderation, admin publishing.
6. **Phase 6:** PWA installation polish, safe offline drafts, synchronization, conflict handling.
7. **Phase 7:** automated tests, security review, deployment, backups, documentation.

## License
MIT
