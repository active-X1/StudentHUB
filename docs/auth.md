# Authentication, sessions and admin access (Phase 3)

## Endpoints (`/api/v1`)
| Method + path | Who | Notes |
|---|---|---|
| `GET /auth/session` | anyone | `{ authenticated, user?, csrfToken?, sessionKind?, features }`. `features` says which OAuth providers are configured. Returns 404 when the server runs without a database (the frontend then uses demo mode). |
| `POST /auth/register` | anyone | name, email, password. Rate limited (10/hour/IP). Signs the new student in. |
| `POST /auth/login` | anyone | email + password, **students/lecturers only**. Throttled per email and per IP (persisted in `login_attempts`). |
| `POST /auth/logout` | signed in | Revokes the session server-side. Needs `X-CSRF-Token`. |
| `POST /auth/password` | signed in | `currentPassword`, `newPassword`, `confirmPassword`. Server verifies the current password, revokes **other** sessions. |
| `GET /auth/google`, `/auth/github` (+ `/callback`) | anyone | OAuth 2.0 authorization-code flow. |
| `POST /admin/auth/login` | anyone | username + password. Persisted lockout (below). |
| `GET /admin/me` | admin session | Proves server-side authorization; more admin APIs arrive with the feature phases. |

Error shape: `{ "error": { "code", "message", "details?", "requestId" } }`. Sign-in failures use identical messages for unknown accounts, wrong passwords, suspended accounts and wrong-endpoint accounts.

## Sessions
- The browser gets a random 256-bit token in an **HttpOnly, SameSite=Lax** cookie (`Secure` and the `__Host-` prefix when `APP_BASE_URL` is https). JavaScript never sees it and nothing sensitive is kept in `localStorage`.
- The database stores only `SHA-256(token)` (`sessions.token_hash`). Every sign-in issues a brand-new token (no session fixation).
- Lifetimes (`src/config/index.js`): **users** 14 days absolute / 7 days idle; **admins** 8 hours absolute / 30 minutes idle, and the admin cookie has no `Max-Age` (ends with the browser session). Suspended users are cut off immediately.
- Changing a password revokes the user's other sessions. An hourly job deletes expired sessions and login-attempt rows older than 30 days.
- One cookie name per browser: signing in as admin replaces a student session in the same browser (use a separate profile if you need both).

## Passwords
- Hashed with **scrypt** (Node's built-in `crypto`; N=2^15, r=8, p=3, 32 MiB, per-password salt) in a self-describing format, so parameters can be raised later; weaker hashes are upgraded after a successful sign-in. (Earlier docs mentioned Argon2id/bcrypt; scrypt is an OWASP-listed alternative that needs no native dependency. Swapping is a change to `services/passwords.js` only.)
- Policy (server-side): users 10+ characters, admins 14+, at most 128; at least three of lower/upper/digit/symbol; not in a small common-password list; must not contain the email local part, username or name. Verification time is equalised for unknown accounts.

## CSRF and cross-site protection
1. SameSite=Lax cookies. 2. **Origin check**: unsafe methods must carry `Origin` equal to `APP_BASE_URL`'s origin (or, without it, not be `cross-site`/`same-site` per `Sec-Fetch-Site`) so `APP_BASE_URL` must be the public URL. 3. Bodies must be `application/json` (a cross-site HTML form cannot send that). 4. Signed-in writes need the per-session `X-CSRF-Token` (HMAC of the session id with `SESSION_SECRET`), returned by `/auth/session` and the sign-in responses.

## Admin account
- **Creation:** only from the command line, never through the web. The first administrator is created once:
  ```bash
  ADMIN_BOOTSTRAP_PASSWORD='…14+ chars…' npm run admin:bootstrap
  # or without putting the password in the environment:
  printf '%s' "$PW" | npm run admin:bootstrap -- --password-stdin
  ```
  Username comes from `ADMIN_BOOTSTRAP_USERNAME` (default `admin`). The password must satisfy the admin policy, is never printed, and the account is flagged **must change password**: until the new password is set the API refuses everything except `/auth/session`, `/auth/password` and `/auth/logout`. The command refuses to run if an admin already exists. Remove the variable from your environment afterwards. No default password exists anywhere in the repository.
- **Lockout:** after **3 consecutive wrong passwords** the account is locked until **the start of the next calendar day in `SERVER_TIMEZONE`** (DST-safe). The counter and `locked_until` live in `users` (updated atomically in one SQL statement), so the lock survives restarts, other devices, cleared browser storage and IP changes. It resets on a successful sign-in or when the lock expires. While locked even the correct password is refused and **not checked**. Response `423 sign_in_paused` with `lockedUntil` and `Retry-After`.
- **No account oracle:** unknown usernames, non-admin usernames and real admins return the same status/message/shape sequence (`401` with `attemptsRemaining` 2, 1, then `423`). For names that are not admins the counter is derived from `login_attempts` (failures since local midnight), which differs from the admin rule only in a midnight edge case.
- **Authorization:** admin API routes require the `admin` role **and** a session created by the admin sign-in. The admin sign-in shell at `/admin` is public (it contains no data); the dashboard module `admin-dashboard.js` is sent only to signed-in admin sessions (any spelling of its path, including encoded or differently cased, is normalised before the check). `ADMIN_UI_ENABLED=false` hides all admin UI paths.
- Dashboard **content** is still sample data: sign-in, lockout and password change are real, admin content APIs arrive with the feature phases.

## Google and GitHub
1. Create OAuth apps and register the redirect URIs `APP_BASE_URL/api/v1/auth/google/callback` and `…/github/callback`.
2. Set `GOOGLE_CLIENT_ID/SECRET` and/or `GITHUB_CLIENT_ID/SECRET` (each pair together). Providers without credentials are hidden on the sign-in page.
3. Protections: random `state` bound to the browser by a signed 10-minute HttpOnly cookie (single use), PKCE for Google, exact redirect URI, verified provider email required (GitHub: primary verified email), secrets sent only to the token endpoint.
4. **Policy:** OAuth sign-up creates a student with a verified email. If an account with the same email already exists it is **not** linked automatically (password sign-up does not verify email ownership, so auto-linking would allow account takeover); the user is told to sign in with their password. Explicit linking from the account page is future work. Admin and suspended accounts cannot use OAuth.
5. `ALLOWED_EMAIL_DOMAINS` (comma-separated) restricts registration and OAuth sign-up to institution addresses; recommended in production.

## Not done yet (honest list)
- **Forgot password** and **email verification** need email delivery; the page says so. Until then use OAuth or ask an administrator.
- No profile-edit, account-linking, session-list or "sign out everywhere" UI; no MFA for admins (strongly recommended before real use).
- The in-memory rate limiter is per instance (the sign-in throttle and lockout are in PostgreSQL and are not).
- Registration reveals whether an email is taken (rate limited); fixing that needs email verification.
- Rotating `SESSION_SECRET` invalidates CSRF tokens in flight (clients refetch) and resets the keyed hashes used for unknown-name throttling; sessions and admin lockouts are unaffected.

## Testing
`npm test` covers the services (lockout timing across time zones and DST, no-oracle behaviour, throttling, sessions, password change, bootstrap, OAuth with a fake provider), the middleware, and the **whole HTTP pipeline** through a harness that mounts the real route table (cookies, CSRF, forced change, dashboard guard). The same store contract runs against an in-memory store and, with `TEST_DATABASE_URL`, against PostgreSQL (including a concurrency test of the lockout counter). `tests/backend/app.test.js` exercises the real Express app and needs `npm install`.
