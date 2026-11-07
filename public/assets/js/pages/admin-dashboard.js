// Admin dashboard module. The server sends this file ONLY to a signed-in admin session (see adminDashboardGuard).
// Sign-in, lockout and password change are real (Phase 3). The dashboard CONTENT is still SAMPLE data held in memory
// (the admin content APIs arrive with the feature phases), so edits here reset on reload.
import * as mock from '../mock-data.js';
import { icon } from '../components/icons.js';
import { esc, fmtDate, timeAgo, uid, parseTags } from '../components/util.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { applyTheme, currentTheme } from '../storage.js';
import { createFilePicker } from '../components/file-preview.js';

let app; let ctx;
const clone = (v) => JSON.parse(JSON.stringify(v));
const S = {
  tab: 'overview', userQ: '',
  home: clone(mock.announcements), posts: clone(mock.posts), suggestions: clone(mock.suggestions),
  general: [], generalState: 'idle', generalError: '', users: clone(mock.adminUsers), log: clone(mock.auditLog),
};
const TABS = [['overview', 'Overview'], ['home', 'Home content'], ['feed', 'Feed moderation'], ['suggestions', 'Pending suggestions'], ['assignments', 'General assignments'], ['users', 'Users'], ['audit', 'Audit log']];
const sampleBanner = '<div class="demo-banner" role="note"><span><b>Sample content.</b> This section still shows sample data; its admin API arrives in a later phase, and changes here reset on reload.</span></div>';
const liveBanner = '<div class="alert info" role="note">This section is <b>live</b>: changes are saved to the database and recorded in the audit log.</div>';
const banner = (tab) => (tab === 'assignments' ? liveBanner : sampleBanner);
const logAction = (action) => S.log.unshift({ id: uid('l'), actor: 'admin (sample)', action, time: new Date().toISOString() });
const statusBadge = (s) => `<span class="badge ${s === 'published' || s === 'active' ? 'success' : s === 'suspended' ? 'danger' : 'warn'}">${s}</span>`;
const table = (cols, rows) => `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${cols.length}" class="muted">Nothing here yet.</td></tr>`}</tbody></table></div>`;

/* ---------- Dashboard shell ---------- */
function paint() {
  app.innerHTML = `<div class="admin-shell"><header class="admin-top"><div class="brand"><span class="brand-mark">${icon('shield')}</span> Student Hub Admin <span class="badge accent">${esc(ctx.user.name)}</span></div>
    <div class="row"><button class="icon-btn" id="a-theme" aria-label="Toggle theme">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</button><button class="btn btn-sm" id="a-settings">${icon('settings')} Settings</button><button class="btn btn-sm btn-danger" id="a-out">${icon('logout')} Sign out</button></div></header>
    <div class="admin-tabs" role="tablist" aria-label="Admin sections">${TABS.map(([k, l]) => `<button role="tab" id="tab-${k}" aria-selected="${S.tab === k}" data-tab="${k}">${l}${k === 'suggestions' && S.suggestions.length ? ` (${S.suggestions.length})` : ''}</button>`).join('')}</div>
    <main class="admin-main" role="tabpanel" aria-labelledby="tab-${S.tab}" id="panel" tabindex="-1">${banner(S.tab)}${sections[S.tab]()}</main></div>`;
  app.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { S.tab = b.dataset.tab; paint(); });
  if (S.tab === 'assignments' && S.generalState === 'idle') loadGeneral();
  app.querySelector('#a-theme').onclick = () => { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); paint(); };
  app.querySelector('#a-out').onclick = async () => { if (await confirmDialog({ title: 'Sign out of admin?', message: 'Your admin session will end.', confirmLabel: 'Sign out', danger: true })) await ctx.signOut(); };
  app.querySelector('#a-settings').onclick = openSettings;
  const q = app.querySelector('#u-q'); if (q) { q.oninput = (e) => { S.userQ = e.target.value; const pos = e.target.selectionStart; paint(); const n = app.querySelector('#u-q'); n.focus(); n.setSelectionRange(pos, pos); }; }
}
document.addEventListener('click', (e) => { const a = e.target.closest('[data-act]'); if (a && app) actions[a.dataset.act]?.(a.dataset.id); });

/* ---------- Sections ---------- */
const sections = {
  overview() {
    const st = mock.adminStats; const max = Math.max(...st.weekly);
    const kpi = (v, l, note) => `<div class="card kpi"><b>${v}</b><span>${l}</span><small>${note}</small></div>`;
    return `<div class="kpis">${kpi(st.totalUsers.toLocaleString(), 'Registered users', 'sample figure')}${kpi(st.activeUsers.toLocaleString(), 'Active users', `${st.activePeriod} · sample`)}${kpi(S.posts.filter((p) => p.status === 'published').length, 'Published posts', 'live from this demo')}${kpi(S.suggestions.length, 'Pending suggestions', 'live from this demo')}${kpi(S.general.length, 'General assignments', 'live from this demo')}${kpi(st.uploadedResources, 'Uploaded resources', 'sample figure')}</div>
      <section class="card"><h2>Weekly active users (sample)</h2><div class="bars" role="img" aria-label="Sample bar chart of weekly activity">${st.weekly.map((v) => `<span style="height:${(v / max) * 100}%" title="${v}"></span>`).join('')}</div><p class="faint" style="font-size:var(--fs-xs);margin-top:6px">Mon to Sun · sample data</p></section>`;
  },
  home() {
    return `<div class="row between"><h2>Home content</h2><button class="btn btn-primary btn-sm" data-act="new-home">${icon('plus')} New announcement</button></div>
      ${table(['Title', 'Category', 'Status', 'Actions'], S.home.map((a) => `<tr><td>${esc(a.title)}</td><td>${esc(a.category)}</td><td>${statusBadge(a.status)}</td><td><div class="row"><button class="btn btn-sm" data-act="edit-home" data-id="${a.id}">Edit</button><button class="btn btn-sm" data-act="toggle-home" data-id="${a.id}">${a.status === 'published' ? 'Unpublish' : 'Publish'}</button><button class="btn btn-sm btn-danger" data-act="rm-home" data-id="${a.id}">Remove</button></div></td></tr>`))}`;
  },
  feed() {
    return `<h2>Feed moderation</h2>${table(['Post', 'Author', 'Category', 'Status', 'Actions'], S.posts.map((p) => `<tr><td style="min-width:220px">${esc(p.text.slice(0, 80))}…</td><td>${esc(p.author)}</td><td>${esc(p.category)}</td><td>${statusBadge(p.status)}</td><td><div class="row"><button class="btn btn-sm" data-act="toggle-post" data-id="${p.id}">${p.status === 'published' ? 'Unpublish' : 'Publish'}</button><button class="btn btn-sm btn-danger" data-act="rm-post" data-id="${p.id}">Remove</button></div></td></tr>`))}`;
  },
  suggestions() {
    return `<h2>Pending suggestions</h2>${S.suggestions.length ? `<div class="stack">${S.suggestions.map((s) => `<article class="card stack"><div class="row between"><strong>${esc(s.author)}</strong><span class="badge warn">Pending review</span></div><p>${esc(s.text)}</p><div class="row"><span class="badge accent">${esc(s.category)}</span>${(s.tags || []).map((t) => `<span class="hashtag">#${esc(t)}</span>`).join('')}<span class="faint" style="font-size:var(--fs-xs)">${timeAgo(s.date)}${s.attachments ? ` · ${s.attachments} attachment(s)` : ''}</span></div><div class="row"><button class="btn btn-sm btn-primary" data-act="approve" data-id="${s.id}">${icon('check')} Approve & publish</button><button class="btn btn-sm btn-danger" data-act="reject" data-id="${s.id}">Reject</button></div></article>`).join('')}</div>`
      : `<div class="state">${icon('check')}<h3>All caught up</h3><p>No suggestions are waiting for review.</p></div>`}`;
  },
  assignments() {
    const head = `<div class="row between"><h2>General assignments</h2><button class="btn btn-primary btn-sm" data-act="new-ga">${icon('plus')} New assignment</button></div>`;
    if (S.generalState === 'loading' || S.generalState === 'idle') return `${head}<div class="skeleton" style="height:120px" aria-busy="true"></div>`;
    if (S.generalState === 'error') return `${head}<div class="state error" role="alert"><h3>Could not load assignments</h3><p>${esc(S.generalError)}</p><button class="btn btn-sm" data-act="reload-ga">Try again</button></div>`;
    return `${head}
      ${table(['Title', 'Course', 'Due', 'Files', 'Status', 'Actions'], S.general.map((a) => `<tr><td style="min-width:200px">${esc(a.title)}${a.tags.length ? `<div class="faint" style="font-size:var(--fs-xs)">${a.tags.map((t) => `#${esc(t)}`).join(' ')}</div>` : ''}</td><td>${esc(a.course)}</td><td>${fmtDate(a.due, { day: 'numeric', month: 'short' })}</td><td>${a.attachments.length}</td><td>${statusBadge(a.status)}</td><td><div class="row"><button class="btn btn-sm" data-act="edit-ga" data-id="${a.id}">Edit</button><button class="btn btn-sm" data-act="toggle-ga" data-id="${a.id}">${a.status === 'published' ? 'Unpublish' : 'Publish'}</button><button class="btn btn-sm btn-danger" data-act="rm-ga" data-id="${a.id}">Remove</button></div></td></tr>`))}`;
  },

  users() {
    const q = S.userQ.toLowerCase(); const list = S.users.filter((u) => !q || `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(q));
    return `<div class="row between"><h2>Users (sample)</h2><div class="search" style="min-width:220px">${icon('search')}<label class="sr-only" for="u-q">Search users</label><input class="input" id="u-q" type="search" placeholder="Search users" value="${esc(S.userQ)}"></div></div>
      ${table(['Name', 'Email', 'Role', 'Sign-in', 'Status', 'Actions'], list.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.role}</td><td>${u.provider}</td><td>${statusBadge(u.status)}</td><td><button class="btn btn-sm ${u.status === 'active' ? 'btn-danger' : ''}" data-act="toggle-user" data-id="${u.id}" ${u.role === 'admin' ? 'disabled' : ''}>${u.status === 'active' ? 'Suspend' : 'Reactivate'}</button></td></tr>`))}`;
  },
  audit() {
    return `<h2>Audit log (sample)</h2><section class="card">${S.log.map((l) => `<div class="list-item"><span class="dot"></span><div><p>${esc(l.action)}</p><div class="meta">${esc(l.actor)} · ${fmtDate(l.time, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div></div>`).join('')}</section>`;
  },
};

/* ---------- Forms & actions ---------- */
function formModal({ title, fields, extra, onSave }) {
  const f = document.createElement('form'); f.noValidate = true; f.className = 'form-grid';
  const control = (x) => (x.type === 'textarea' ? `<textarea class="textarea" id="m-${x.k}">${esc(x.v || '')}</textarea>`
    : x.type === 'select' ? `<select class="select" id="m-${x.k}">${x.options.map((o) => `<option value="${o}" ${o === x.v ? 'selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input class="input" id="m-${x.k}" type="${x.type || 'text'}" value="${esc(x.v || '')}">`);
  f.innerHTML = fields.map((x) => `<div class="field"><label for="m-${x.k}">${x.l}</label>${control(x)}<span class="error-text" data-err="${x.k}"></span></div>`).join('');
  if (extra) f.appendChild(extra);
  openModal({ title, content: f, actions: [{ label: 'Cancel' }, { label: 'Save', variant: 'primary', onClick: async () => {
    const vals = {}; let bad = false;
    fields.forEach((x) => { vals[x.k] = f.querySelector(`#m-${x.k}`).value.trim(); const e = f.querySelector(`[data-err="${x.k}"]`); e.textContent = x.req && !vals[x.k] ? 'Required.' : ''; if (e.textContent) bad = true; });
    if (bad) return false;
    if ((await onSave(vals, f)) === false) return false; // an async save can keep the dialog open to show server errors
    paint();
  } }] });
}
const find = (arr, id) => arr.find((x) => x.id === id);
const actions = {
  'new-home': () => formModal({ title: 'New announcement', fields: [{ k: 'title', l: 'Title', req: 1 }, { k: 'body', l: 'Body', type: 'textarea', req: 1 }, { k: 'category', l: 'Category', v: 'Department News', req: 1 }], onSave: (v) => { S.home.unshift({ id: uid('a'), ...v, c1: '#0f766e', c2: '#4338ca', status: 'draft', date: new Date().toISOString() }); logAction(`Created announcement “${v.title}” (draft)`); showToast('Draft created. Publish it when ready.', 'success'); } }),
  'edit-home': (id) => { const a = find(S.home, id); formModal({ title: 'Edit announcement', fields: [{ k: 'title', l: 'Title', v: a.title, req: 1 }, { k: 'body', l: 'Body', type: 'textarea', v: a.body, req: 1 }, { k: 'category', l: 'Category', v: a.category, req: 1 }], onSave: (v) => { Object.assign(a, v); logAction(`Edited announcement “${a.title}”`); showToast('Saved (sample).', 'success'); } }); },
  'toggle-home': (id) => { const a = find(S.home, id); a.status = a.status === 'published' ? 'draft' : 'published'; logAction(`${a.status === 'published' ? 'Published' : 'Unpublished'} announcement “${a.title}”`); paint(); },
  'rm-home': async (id) => { const a = find(S.home, id); if (await confirmDialog({ title: 'Remove announcement?', message: `“${esc(a.title)}” will be removed from this demo.`, confirmLabel: 'Remove', danger: true })) { S.home = S.home.filter((x) => x.id !== id); logAction(`Removed announcement “${a.title}”`); paint(); } },
  'toggle-post': (id) => { const p = find(S.posts, id); p.status = p.status === 'published' ? 'unpublished' : 'published'; logAction(`${p.status === 'published' ? 'Published' : 'Unpublished'} post by ${p.author}`); paint(); },
  'rm-post': async (id) => { const p = find(S.posts, id); if (await confirmDialog({ title: 'Remove post?', message: 'This post will be removed from this demo.', confirmLabel: 'Remove', danger: true })) { S.posts = S.posts.filter((x) => x.id !== id); logAction(`Removed post by ${p.author}`); paint(); } },
  approve: (id) => { const s = find(S.suggestions, id); S.suggestions = S.suggestions.filter((x) => x.id !== id); S.posts.unshift({ id: uid('p'), author: s.author, role: 'Student', category: s.category, date: new Date().toISOString(), status: 'published', text: s.text, tags: s.tags || [], likes: 0, liked: false, attachments: [], comments: [] }); logAction(`Approved suggestion from ${s.author}`); showToast('Approved and published (sample).', 'success'); paint(); },
  reject: async (id) => { const s = find(S.suggestions, id); if (await confirmDialog({ title: 'Reject suggestion?', message: `Reject the suggestion from ${esc(s.author)}?`, confirmLabel: 'Reject', danger: true })) { S.suggestions = S.suggestions.filter((x) => x.id !== id); logAction(`Rejected suggestion from ${s.author}`); showToast('Suggestion rejected (sample).', 'info'); paint(); } },
  'new-ga': () => gaForm(),
  'edit-ga': (id) => gaForm(find(S.general, id)),
  'reload-ga': () => { S.generalState = 'idle'; paint(); },
  'toggle-ga': async (id) => {
    const a = find(S.general, id); const next = a.status === 'published' ? 'unpublished' : 'published';
    try { await ctx.request('PATCH', `/admin/assignments/${id}`, { status: next }); S.generalState = 'idle'; showToast(next === 'published' ? 'Published.' : 'Unpublished.', 'success'); paint(); }
    catch (e) { showToast(e.message, 'error'); }
  },
  'rm-ga': async (id) => {
    const a = find(S.general, id);
    if (!await confirmDialog({ title: 'Remove assignment?', message: `“${esc(a.title)}” and its files will be permanently deleted.`, confirmLabel: 'Remove', danger: true })) return;
    try { await ctx.request('DELETE', `/admin/assignments/${id}`); S.generalState = 'idle'; showToast('Assignment removed.', 'success'); paint(); } catch (e) { showToast(e.message, 'error'); }
  },
  'toggle-user': (id) => { const u = find(S.users, id); u.status = u.status === 'active' ? 'suspended' : 'active'; logAction(`${u.status === 'active' ? 'Reactivated' : 'Suspended'} user ${u.name}`); paint(); },
};
const fromAdminGeneral = (a) => ({ id: a.id, title: a.title, course: a.course, category: a.category, description: a.description, due: a.dueDate, status: a.status, tags: a.tags, attachments: a.attachments.map((f) => ({ id: f.id, name: f.name, size: f.size, type: f.contentType, url: f.url, preview: /^image\//.test(f.contentType) ? `${f.url}?inline=1` : undefined })) });
async function loadGeneral() {
  S.generalState = 'loading'; paint();
  try { S.general = (await ctx.request('GET', '/admin/assignments?limit=200&sort=deadline')).items.map(fromAdminGeneral); S.generalState = 'ready'; }
  catch (e) { S.generalState = 'error'; S.generalError = e.status === 401 || e.status === 403 ? 'Your admin session has ended. Reload to sign in again.' : e.message; }
  paint();
}
const FIELD_OF = { title: 'title', course: 'course', dueDate: 'due', category: 'category', description: 'description', tags: 'tags', status: 'status' };
function gaForm(a) {
  const picker = createFilePicker({ initial: a?.attachments ?? [] });
  const extra = document.createElement('div'); extra.className = 'field'; extra.innerHTML = '<span class="label">Attachments</span>'; extra.appendChild(picker.el);
  formModal({
    title: a ? 'Edit assignment' : 'New general assignment', extra,
    fields: [{ k: 'title', l: 'Title', v: a?.title, req: 1 }, { k: 'course', l: 'Course', v: a?.course || mock.COURSES[0], req: 1 }, { k: 'due', l: 'Due date', type: 'date', v: a?.due, req: 1 },
      { k: 'category', l: 'Category', v: a?.category || 'Coursework' }, { k: 'description', l: 'Description', type: 'textarea', v: a?.description }, { k: 'tags', l: 'Hashtags', v: (a?.tags || []).map((t) => `#${t}`).join(' ') },
      { k: 'status', l: 'Status', type: 'select', options: ['draft', 'published', 'unpublished'], v: a?.status || 'draft' }],
    async onSave(v, form) {
      const payload = { title: v.title, course: v.course, dueDate: v.due, category: v.category, description: v.description, tags: v.tags, status: v.status };
      try {
        const saved = (await ctx.request(a ? 'PATCH' : 'POST', a ? `/admin/assignments/${a.id}` : '/admin/assignments', payload)).assignment; const problems = [];
        const kept = new Set(picker.getFiles().filter((x) => x.id).map((x) => x.id));
        for (const old of a?.attachments ?? []) if (!kept.has(old.id)) await ctx.request('DELETE', `/attachments/${old.id}`).catch((e) => problems.push(`${old.name}: ${e.message}`));
        for (const f of picker.getFiles().filter((x) => x.file)) await ctx.uploadFile(`/admin/assignments/${saved.id}/attachments`, f.file).catch((e) => problems.push(`${f.name}: ${e.details?.file || e.message}`));
        S.generalState = 'idle';
        if (problems.length) showToast(`Saved, but some files were not accepted: ${problems.join('; ')}`, 'error', 8000); else showToast('Saved.', 'success');
      } catch (e) {
        const other = [];
        for (const [k, msg] of Object.entries(e.details || {})) { const el = FIELD_OF[k] && form.querySelector(`[data-err="${FIELD_OF[k]}"]`); if (el) el.textContent = msg; else other.push(msg); }
        if (!Object.keys(e.details || {}).length || other.length) showToast(other.join(' ') || e.message, 'error', 6000);
        return false;
      }
    },
  });
}

function openSettings() {
  const f = document.createElement('form'); f.noValidate = true; f.className = 'form-grid';
  f.innerHTML = `<p class="muted" style="font-size:var(--fs-sm)">Changing your password signs out your other sessions. Admin passwords need at least 14 characters.</p>
    <div class="field"><label for="p-old">Current password</label><input class="input" id="p-old" type="password" autocomplete="current-password"><span class="error-text" data-err="currentPassword"></span></div>
    <div class="field"><label for="p-new">New password</label><input class="input" id="p-new" type="password" autocomplete="new-password"><span class="error-text" data-err="newPassword"></span></div>
    <div class="field"><label for="p-conf">Confirm new password</label><input class="input" id="p-conf" type="password" autocomplete="new-password"><span class="error-text" data-err="confirmPassword"></span></div><div class="alert success" id="p-res" hidden></div>`;
  openModal({ title: 'Admin settings · change password', content: f, actions: [{ label: 'Close' }, { label: 'Update password', variant: 'primary', onClick: async () => {
    const g = (id) => f.querySelector(id).value; const fields = ['currentPassword', 'newPassword', 'confirmPassword'];
    fields.forEach((k) => { f.querySelector(`[data-err="${k}"]`).textContent = ''; });
    try { await ctx.changePassword({ currentPassword: g('#p-old'), newPassword: g('#p-new'), confirmPassword: g('#p-conf') }); const r = f.querySelector('#p-res'); r.hidden = false; r.textContent = 'Password updated. Other sessions were signed out.'; f.reset(); showToast('Password updated.', 'success'); }
    catch (e) { const d = e.details || {}; fields.forEach((k) => { if (d[k]) f.querySelector(`[data-err="${k}"]`).textContent = d[k]; }); if (!Object.keys(d).length) showToast(e.message, 'error'); }
    return false;
  } }] });
}

/** Called by admin.js after a successful admin sign-in. ctx: { root, user, signOut(), changePassword(body) }. */
export function mount(context) { ctx = context; app = context.root; paint(); }
