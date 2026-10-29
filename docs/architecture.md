# Architecture

## Stack
Frontend: HTML5, CSS3 and vanilla JavaScript (ES modules), no framework, no build step. Backend (Phase 2): Node.js 20.12+, Express 5, helmet, `pg`, PostgreSQL 13+. `npm run dev:static` still serves the frontend alone with a zero-dependency server.

## Routing
Hash routing inside one shell (`public/index.html`): `#/home`, `#/feeds`, `#/my-assignments`, `#/general-assignments`, `#/account`. Query strings work too (`#/feeds?q=%23Exams`).
- Works on any static host and under Express (Express only needs to serve `index.html` at `/`).
- `public/pages/*.html` are tiny redirect stubs for deep links.
- Auth screens (`login.html`, `register.html`, `forgot-password.html`) and the admin page (`/admin` → `admin/index.html`) are separate documents.
- Asset URLs are root-absolute (`/assets/...`), so serve the app from the origin root.

## Module map (`public/assets/js`)
| Module | Role |
|---|---|
| `app.js` | Boot: nav, router, FAB, PWA registration |
| `router.js` | Hash router; lazy-loads `pages/*.js`; each exports `render(container, ctx)` and may return a cleanup function |
| `api.js` | **The only boundary to data.** Mock now (`USE_MOCK = true`); each method documents the REST endpoint that replaces it |
| `mock-data.js` | Fictional sample data (separate from rendering) |
| `storage.js` | Non-sensitive prototype prefs and local drafts only; `clearAll()` used on sign-out |
| `components/` | `navigation`, `settings-drawer`, `modal`, `toast`, `file-preview`, plus `icons`, `states`, `util`, `pwa`, `session` |
| `pages/` | One module per screen (`home`, `feeds`, `my-assignments`, `general-assignments`, `account`, `auth`, `admin`) |

## Replacing mocks with the real API (Phase 2+)
1. Set `USE_MOCK = false` and implement each `api.*` method with `http(method, path, body)` (already written, uses `credentials: 'include'` for httpOnly session cookies).
2. Keep response shapes identical to the mock objects so page modules do not change.
3. Remove the `simulate()` latency wrapper and the "Simulate API state" prototype tool.

## Prototype tools
Settings → *Prototype tools* → "Simulate API state" (normal / slow / empty / error) exercises loading, empty and error UI on every page.

## Design system
`tokens.css` (colors, type, spacing, radii, shadows; dark default, light via `[data-theme="light"]`) → `base.css` → `layout.css` (shell, floating nav) → `components.css` → `pages.css` → `responsive.css` (≥640px, ≥1024px sidebar).

## Backend (Phase 2)
```
request -> requestId -> requestLogger -> helmet (CSP, nosniff, ...) -> permissionsPolicy
        -> /api/v1: no-store -> originCheck -> requireJsonBody -> JSON body (100 kb) -> cookies -> session -> route (limits, auth, CSRF, handler)
        -> adminUiGate -> express.static(public/) -> 404 -> errorHandler
```
- `createApp({ config, db, logger })` receives its dependencies, so tests pass fakes and nothing reads globals.
- `config/index.js` validates the environment once at startup and fails fast with a list of problems (no secrets in the output). `NODE_ENV=production` requires `DATABASE_URL`.
- Errors share one JSON shape `{ error: { code, message, details?, requestId } }`. Unknown errors are logged in full but never leak details to clients; query strings are never logged.
- Same-origin only: the frontend is served by this server, so no CORS middleware is installed. Add an explicit allow-list only if a separate origin ever needs the API.
- Static assets are not fingerprinted yet, so they are served with `Cache-Control: no-cache` (ETag revalidation) to avoid stale JavaScript; the service worker is network-first for the same reason.
- Graceful shutdown on SIGTERM/SIGINT closes the HTTP server and the connection pool (10 s hard stop).
- The router renders each page into a fresh container so page-level event listeners cannot leak between routes.
- `routes/table.js` declares the API as data (middleware lists + a route table) that Express mounts (`routes/index.js`) and that the test harness mounts too, so the real auth -> CSRF -> rate limit -> handler order is tested.
- Layers: controllers (HTTP only) -> services (rules; clock, hasher and fetch injectable) -> models/pgStore (SQL). `tests/backend/helpers/memory-store.js` implements the same store interface and both must pass `store-contract.js`.
- Frontend: `auth-client.js` talks to the API with cookies + CSRF header; with no API it reports demo mode and the app behaves like Phase 1.
