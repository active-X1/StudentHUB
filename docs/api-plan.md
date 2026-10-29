# API plan

**Implemented:** health (`/health`, `/health/ready`) and authentication (`/auth/*`, `/admin/auth/login`, `/admin/me`, see `docs/auth.md`). Everything else below is planned for later phases; forgot/reset password is deferred until email delivery exists. The database schema for all of it already exists (see `docs/database.md`).

Base path `/api/v1`, JSON, session cookies (httpOnly, Secure, SameSite). Every route validates input server-side and checks authorization server-side.

## Auth
`POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `POST /auth/forgot-password` · `POST /auth/reset-password` · `GET /auth/google` + callback · `GET /auth/github` + callback · `POST /me/password` (old + new, server-verified)
Admin: `POST /admin/auth/login` (3-failure lockout until next calendar day in the configured server timezone, persisted in the database).

## Student
`GET /home` · `GET /feed/posts?q&tag&category&sort` · `POST /feed/suggestions` · `POST /feed/posts/:id/reactions` · `POST /feed/posts/:id/comments` · `GET|POST /me/assignments` · `PATCH|DELETE /me/assignments/:id` (ownership enforced) · `GET /assignments` · `GET|PATCH /me` · `POST /me/attachments` (signed upload) · `GET /me/attachments/:id` (authorized, short-lived URL)

## Admin (server-side role check on every route)
`/admin/dashboard` · `/admin/home-content` · `/admin/posts` · `/admin/suggestions/:id/approve|reject` · `/admin/assignments` · `/admin/users` · `/admin/audit-logs`

## PostgreSQL model (migrations in `src/database/migrations`)
`users`, `roles` / `user_roles`, `oauth_identities`, `sessions`, `personal_assignments`, `general_assignments`, `feed_posts`, `attachments` (random storage key, owner, checksum, validated MIME/size), `hashtags`, `post_hashtags`, `post_suggestions` (status: pending/approved/rejected, reviewer, reviewed_at), `comments`, `reactions`, `notifications`, `admin_audit_logs`, `login_attempts` / lockout state.
Use foreign keys, indexes (hashtag name, post published_at, assignment owner + due date), `created_at`/`updated_at` timestamps, and ownership constraints. PostgreSQL is the agreed database.
