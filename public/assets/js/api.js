// API boundary. Every page talks to the backend ONLY through this module.
// Phase 1: USE_MOCK = true → in-memory sample data with simulated latency. Nothing is sent over the network.
// Later phases: set USE_MOCK = false; each method already documents the REST endpoint that replaces it.
import * as mock from './mock-data.js';
import { storage } from './storage.js';
import { uid } from './components/util.js';
import * as authClient from './auth-client.js';

export const API_BASE_URL = '/api/v1'; // Express serves the REST API under this prefix in Phase 2+.
export const USE_MOCK = true;

/** Real HTTP helper for later phases. Auth will use secure httpOnly session cookies (never tokens in localStorage). */
export async function http(method, path, body) {
  const res = await fetch(API_BASE_URL + path, {
    method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.status === 204 ? null : res.json();
}

// ---- Prototype helpers: simulated latency + selectable "API state" (Settings → Prototype tools) ----
const clone = (v) => JSON.parse(JSON.stringify(v));
export function demoState() { return storage.get('demoState', 'normal'); }
async function simulate(fn, ms = 350) {
  const state = demoState();
  await new Promise((r) => setTimeout(r, state === 'slow' ? 1800 : ms));
  if (state === 'error') throw Object.assign(new Error('Simulated network error (prototype setting)'), { simulated: true });
  return clone(fn());
}

// In-memory sample database. Resets on reload; attachments are NOT stored anywhere.
const db = {
  user: clone(mock.currentUser), announcements: clone(mock.announcements), news: clone(mock.news), activity: clone(mock.activity),
  posts: clone(mock.posts), suggestions: [], myAssignments: clone(mock.myAssignments), generalAssignments: clone(mock.generalAssignments),
};
const empty = () => demoState() === 'empty';
const isImageType = (t) => /^image\//.test(t || '');
const mapAttachment = (f) => ({ id: f.id, name: f.name, size: f.size, type: f.contentType, url: f.url, preview: isImageType(f.contentType) ? `${f.url}?inline=1` : undefined });
const fromPersonal = (a) => ({ id: a.id, title: a.title, description: a.description, course: a.course, lecturer: a.lecturer || '', due: a.dueDate, priority: a.priority, status: a.status, tags: a.tags, attachments: a.attachments.map(mapAttachment) });
const fromGeneral = (a) => ({ id: a.id, title: a.title, course: a.course, category: a.category, description: a.description, published: a.publishedAt, due: a.dueDate, tags: a.tags, status: a.status ?? 'published', attachments: a.attachments.map(mapAttachment) });
/** Page shape -> API shape. Only keys that are present are sent, so partial updates (e.g. just `status`) stay partial. */
const PERSONAL_KEYS = ['title', 'description', 'course', 'lecturer', 'priority', 'status', 'tags'];
const toPersonalPayload = (p) => { const o = {}; for (const k of PERSONAL_KEYS) if (k in p) o[k] = k === 'lecturer' ? (p[k] || null) : p[k]; if ('due' in p) o.dueDate = p.due; return o; };
export const toGeneralPayload = (p) => { const o = {}; for (const k of ['title', 'course', 'category', 'description', 'status', 'tags']) if (k in p) o[k] = p[k]; if ('due' in p) o.dueDate = p.due; return o; };
export { fromGeneral };
const liveUser = () => (authClient.isLive() ? authClient.currentSession().user : null);

export const api = {
  // GET /home
  getHome: () => simulate(() => empty() ? { announcements: [], news: [], activity: [] } : { announcements: db.announcements.filter((a) => a.status === 'published'), news: db.news, activity: db.activity }),
  // GET /feed/posts?q=&tag=&category=&sort=
  listPosts: () => simulate(() => empty() ? [] : db.posts.filter((p) => p.status === 'published')),
  // POST /feed/suggestions  (multipart in the real API; files go to object storage after validation)
  submitSuggestion: (input) => simulate(() => {
    const s = { id: uid('sg'), ...input, author: db.user.name, role: 'Student', date: new Date().toISOString(), status: 'pending', attachments: input.attachments.map(({ name, size, type }) => ({ name, size, type })) };
    db.suggestions.unshift(s); return s;
  }, 700),
  listMySuggestions: () => simulate(() => db.suggestions, 100),
  // POST /feed/posts/:id/reactions
  toggleLike: (id) => simulate(() => { const p = db.posts.find((x) => x.id === id); p.liked = !p.liked; p.likes += p.liked ? 1 : -1; return p; }, 120),
  // POST /feed/posts/:id/comments
  addComment: (id, text) => simulate(() => { const c = { id: uid('c'), author: db.user.name, text, date: new Date().toISOString() }; db.posts.find((x) => x.id === id).comments.push(c); return c; }, 150),

  // GET/POST/PATCH/DELETE /me/assignments  (private; server must enforce ownership on every call)
  listMyAssignments: () => (liveUser() ? authClient.request('GET', '/me/assignments?limit=200&sort=due').then((r) => r.items.map(fromPersonal)) : simulate(() => empty() ? [] : db.myAssignments)),
  getMyAssignment: (id) => authClient.request('GET', `/me/assignments/${encodeURIComponent(id)}`).then((r) => fromPersonal(r.assignment)),
  createMyAssignment: (a) => (liveUser() ? authClient.request('POST', '/me/assignments', toPersonalPayload(a)).then((r) => fromPersonal(r.assignment)) : simulate(() => { const n = { id: uid('m'), ...a }; db.myAssignments.unshift(n); return n; }, 250)),
  updateMyAssignment: (id, patch) => (liveUser() ? authClient.request('PATCH', `/me/assignments/${encodeURIComponent(id)}`, toPersonalPayload(patch)).then((r) => fromPersonal(r.assignment)) : simulate(() => { const i = db.myAssignments.findIndex((x) => x.id === id); db.myAssignments[i] = { ...db.myAssignments[i], ...patch }; return db.myAssignments[i]; }, 200)),
  deleteMyAssignment: (id) => (liveUser() ? authClient.request('DELETE', `/me/assignments/${encodeURIComponent(id)}`) : simulate(() => { db.myAssignments = db.myAssignments.filter((x) => x.id !== id); return { ok: true }; }, 200)),
  // POST /me/assignments/:id/attachments (raw bytes); DELETE /attachments/:id
  uploadAttachment: (id, file) => authClient.uploadFile(`/me/assignments/${encodeURIComponent(id)}/attachments`, file),
  deleteAttachment: (id) => authClient.request('DELETE', `/attachments/${encodeURIComponent(id)}`),

  // GET /assignments (published by admins)
  listGeneralAssignments: () => (liveUser() ? authClient.request('GET', '/assignments?limit=200&sort=deadline').then((r) => r.items.map(fromGeneral)) : simulate(() => empty() ? [] : db.generalAssignments.filter((a) => a.status === 'published'))),

  // GET/PATCH /me
  // Live mode: the real signed-in user. Everything else on these pages is still sample data until its phase.
  getProfile: () => simulate(() => {
    const u = liveUser();
    return u ? { id: u.id, name: u.name, email: u.email, provider: u.signInMethod === 'oauth' ? (u.oauthProviders[0] || 'email') : 'email', department: u.department || 'Computer Science', level: u.studyLevel || '', bio: u.bio || '', isSample: false } : db.user;
  }, 150),
  updateProfile: (patch) => simulate(() => Object.assign(db.user, patch), 300),
  setProvider: (provider) => simulate(() => Object.assign(db.user, { provider }), 100),
  // POST /auth/password — the server verifies the current password. Demo mode (no API) changes nothing.
  changePassword: (body) => (liveUser() ? authClient.changePassword(body) : simulate(() => ({ ok: false, demo: true, message: 'Demo mode: no API is running, so no password was verified or changed.' }), 500)),
  // POST /auth/logout — revokes the server session. Demo mode only clears local prototype data.
  signOut: () => (liveUser() ? authClient.logout() : simulate(() => ({ ok: true }), 200)),
};
