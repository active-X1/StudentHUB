# Security notes

## What is real and what is not (Phase 3)
**Real when the API runs** (details in [auth.md](auth.md)): password and OAuth sign-in, server-side sessions, CSRF defences, password change with server-side verification, the admin bootstrap, forced first-login password change, the persisted 3-attempt admin lockout, and server-side admin authorization.
**Still not real:** the content of the admin dashboard and student pages (sample data); file "uploads" (previewed in the browser only); forgot-password and email verification (need email delivery); in **demo mode** (no API) every sign-in/password screen is visual only and says so.

## Rules (now implemented unless marked)
- **Admin bootstrap.** Initial username `admin`; no default password exists in the repository; created once by CLI with a policy-checked password, hashed with scrypt, flagged must-change; the CLI refuses to run if an admin exists. *Not yet:* MFA.
- **Admin lockout.** Three consecutive wrong passwords lock the account until the next calendar day in `SERVER_TIMEZONE`, persisted in PostgreSQL (survives restarts, devices, cleared storage, IP changes), reset on success or expiry, with IP throttling, audit entries, and uniform responses that never reveal whether a username exists.
- **Password change.** The server verifies the old password, enforces strength and confirmation, throttles guessing, and revokes the user's other sessions.
- **Admin access.** Every admin API route requires the admin role and an admin-kind session; the dashboard code is only sent to admin sessions.
- **Uploads (Phase 4).** Validate file content (not just extension/MIME) and size, generate random storage keys, use persistent object storage, and verify ownership on every read so one student can never fetch another's private attachment by changing an ID or URL.
- **Secrets.** `.env` is git-ignored; `.env.example` holds placeholders only; `SESSION_SECRET` is required in production.

## PWA and caching
- The service worker caches only the static shell. It never caches `/admin`, `/api/*`, auth responses, private assignment data, session data or documents.
- Sign-out clears local prototype storage and runtime caches so the next user on a shared device sees nothing.
- Offline drafts (Phase 6) must be labelled "saved on this device" vs "synced to account", with explicit conflict and error handling.
- Service workers require HTTPS or `localhost`.

## Phase 2 additions
- **Security headers (helmet):** CSP with `script-src 'self'` and `script-src-attr 'none'` (the frontend has no inline scripts or handlers), `frame-ancestors 'none'`, `object-src 'none'`, `nosniff`, `no-referrer`, HSTS in production, plus a restrictive `Permissions-Policy`. The policy was checked against the real frontend in a browser (composer previews, drawer, admin, service worker) with no violations. `style-src-attr 'unsafe-inline'` is needed only because the UI sets a few inline `style=""` attributes.
- **Admin UI gate:** `/admin` serves only the public sign-in shell; the dashboard module is sent only to admin sessions. All paths are normalised (case, URL-encoding, `..`) before matching, and `ADMIN_UI_ENABLED=false` hides everything.
- **Config:** invalid or missing settings stop the server at startup; `TRUST_PROXY=true` is rejected (use a hop count) so clients cannot spoof their IP; the database URL is never logged with credentials.
- **Logging:** structured JSON; keys such as `password`, `token`, `cookie`, `authorization`, `secret`, `session`, `database_url` are redacted; inbound `X-Request-Id` values are accepted only if harmless.
- **Errors:** clients get generic messages for server errors; health endpoints reveal no versions or configuration; readiness failures return no connection details.
- **Database:** secrets (passwords, session tokens) stored only as hashes, CHECK constraints at the data layer, ownership via foreign keys, append-only audit log, persisted lockout fields. The seed runner refuses to run in production and never creates an admin or a password.
- **Dependencies:** commit `package-lock.json` after the first `npm install`, and run `npm audit` in CI.

## Phase 3 additions
- **Cookies:** HttpOnly, SameSite=Lax, Secure and `__Host-` prefixed over https; admin cookies are browser-session cookies.
- **CSRF:** SameSite + Origin/Fetch-Metadata check + JSON-only bodies + per-session token (see [auth.md](auth.md)).
- **Sign-in throttling** is stored in PostgreSQL (per email and per IP) in addition to in-memory per-route limits.
- **OAuth:** state cookie, PKCE (Google), exact redirect URIs, verified email only, no automatic account linking.
- **Service worker:** never caches API responses or anything admin-related; sign-out clears runtime caches and local prototype data.
- **Verification limits:** the Express wiring and the PostgreSQL SQL are exercised by tests that need `npm install` / `TEST_DATABASE_URL`; in this repo's default `npm test` run they are skipped, and the same route table and middleware are tested through a Node HTTP harness.
