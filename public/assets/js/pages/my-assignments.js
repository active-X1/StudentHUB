import { api } from '../api.js';
import { COURSES } from '../mock-data.js';
import { storage } from '../storage.js';
import { icon } from '../components/icons.js';
import { esc, fmtDate, daysUntil, dueLabel, parseTags, debounce, timeAgo } from '../components/util.js';
import { skeletonCards, errorState, emptyState, demoBanner } from '../components/states.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { createFilePicker, attachmentsHTML } from '../components/file-preview.js';

const PRIO = { high: ['danger', 'High'], medium: ['warn', 'Medium'], low: ['success', 'Low'] };
const STATUS = { todo: 'To do', 'in-progress': 'In progress', done: 'Completed' };
const FILTERS = [['all', 'All'], ['active', 'Active'], ['overdue', 'Overdue'], ['soon', 'Due soon'], ['done', 'Completed']];

export async function render(root, ctx) {
  let alive = true; let items = [];
  const state = { filter: 'all', sort: 'due', q: '' };
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1 tabindex="-1">My Assignments</h1><p>Your private to-do list for coursework.</p></div><button class="btn btn-primary btn-sm" id="new-a">${icon('plus')} New</button></div>
    ${demoBanner('Sample data kept in <b>browser memory only</b>. It resets when you reload, and attachments are never uploaded or saved to cloud storage.')}
    <div id="stats"></div>
    <div class="toolbar"><div class="toolbar-row"><div class="search">${icon('search')}<label class="sr-only" for="a-q">Search assignments</label><input class="input" id="a-q" type="search" placeholder="Search title, course or #tag"></div>
      <label class="sr-only" for="a-sort">Sort</label><select class="select" id="a-sort" style="width:auto"><option value="due">Due date</option><option value="priority">Priority</option><option value="title">Title</option></select></div>
      <div class="chips" role="group" aria-label="Filter assignments">${FILTERS.map(([v, l]) => `<button class="chip" data-f="${v}" aria-pressed="${v === 'all'}">${l}</button>`).join('')}</div></div>
    <div id="list" class="stack" aria-live="polite">${skeletonCards(3, 130)}</div></div>`;
  const $ = (s) => root.querySelector(s);

  const isOverdue = (a) => a.status !== 'done' && daysUntil(a.due) < 0;
  const isSoon = (a) => a.status !== 'done' && daysUntil(a.due) >= 0 && daysUntil(a.due) <= 3;
  function visible() {
    const q = state.q.toLowerCase();
    const f = { all: () => true, active: (a) => a.status !== 'done', overdue: isOverdue, soon: isSoon, done: (a) => a.status === 'done' }[state.filter];
    const rank = { high: 0, medium: 1, low: 2 };
    const sorts = { due: (a, b) => new Date(a.due) - new Date(b.due), priority: (a, b) => rank[a.priority] - rank[b.priority], title: (a, b) => a.title.localeCompare(b.title) };
    return items.filter(f).filter((a) => !q || [a.title, a.course, a.description, a.lecturer, ...a.tags.map((t) => `#${t}`)].join(' ').toLowerCase().includes(q)).sort(sorts[state.sort]);
  }
  function paint() {
    $('#stats').innerHTML = `<div class="stats-strip"><div class="stat danger"><b>${items.filter(isOverdue).length}</b><span>Overdue</span></div><div class="stat warn"><b>${items.filter(isSoon).length}</b><span>Due soon</span></div><div class="stat ok"><b>${items.filter((a) => a.status === 'done').length}</b><span>Completed</span></div></div>`;
    const list = visible();
    $('#list').innerHTML = list.length ? list.map(card).join('')
      : items.length ? emptyState({ ico: 'search', title: 'Nothing matches', text: 'Change the filter or search to see more assignments.', actionLabel: 'Show all', actionId: 'show-all' })
        : emptyState({ ico: 'clipboard', title: 'No assignments yet', text: 'Add your first assignment to start tracking deadlines.', actionLabel: 'Add assignment', actionId: 'empty-add' });
    $('#show-all')?.addEventListener('click', () => { state.filter = 'all'; state.q = ''; $('#a-q').value = ''; syncChips(); paint(); });
    $('#empty-add')?.addEventListener('click', () => openForm());
  }
  const syncChips = () => root.querySelectorAll('[data-f]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === state.filter)));
  function card(a) {
    const [pc, pl] = PRIO[a.priority]; const od = isOverdue(a); const done = a.status === 'done';
    return `<article class="card assign ${done ? 'done' : ''}" data-priority="${a.priority}" data-id="${a.id}">
      <div class="assign-head"><div class="row" style="flex-wrap:nowrap;align-items:flex-start"><button class="check" data-toggle="${a.id}" aria-pressed="${done}" aria-label="${done ? 'Mark as not completed' : 'Mark as completed'}: ${esc(a.title)}">${icon('check')}</button><div><h3>${esc(a.title)}</h3><p class="muted" style="font-size:var(--fs-sm)">${esc(a.course)}${a.lecturer ? ` · ${esc(a.lecturer)}` : ''}</p></div></div></div>
      <div class="row"><span class="badge ${done ? 'success' : od ? 'danger' : isSoon(a) ? 'warn' : ''}">${icon('clock', 'width="12" height="12"')} ${done ? `Completed · due ${fmtDate(a.due, { day: 'numeric', month: 'short' })}` : dueLabel(a.due)}</span><span class="badge ${pc}">${pl} priority</span><span class="badge violet">${STATUS[a.status]}</span>${a.attachments.length ? `<span class="badge">${icon('paperclip', 'width="12" height="12"')} ${a.attachments.length}</span>` : ''}</div>
      ${a.tags.length ? `<div class="tags">${a.tags.map((t) => `<a class="hashtag" href="#/feeds?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
      <div class="assign-actions"><button class="btn btn-sm" data-view="${a.id}">View</button><button class="btn btn-sm" data-edit="${a.id}">${icon('edit')} Edit</button><button class="btn btn-sm btn-danger" data-del="${a.id}">${icon('trash')} Delete</button></div></article>`;
  }

  function openView(a) {
    openModal({ title: a.title, content: `<dl class="detail-list"><div><dt>Course</dt><dd>${esc(a.course)}</dd></div>${a.lecturer ? `<div><dt>Lecturer</dt><dd>${esc(a.lecturer)}</dd></div>` : ''}<div><dt>Due</dt><dd>${fmtDate(a.due)} · ${dueLabel(a.due)}</dd></div><div><dt>Priority / status</dt><dd>${PRIO[a.priority][1]} · ${STATUS[a.status]}</dd></div><div><dt>Description</dt><dd>${esc(a.description) || '<span class="muted">No description.</span>'}</dd></div>${a.attachments.length ? `<div><dt>Attachments (preview only)</dt><dd>${attachmentsHTML(a.attachments)}</dd></div>` : ''}</dl>`,
      actions: [{ label: 'Edit', onClick: () => { setTimeout(() => openForm(a), 0); } }, { label: 'Close', variant: 'primary' }] });
  }

  function openForm(existing) {
    const draft = !existing && storage.getDraft('assignment');
    const d = existing || draft?.data || {};
    const picker = createFilePicker({ initial: existing?.attachments || [] });
    const form = document.createElement('form'); form.noValidate = true; form.className = 'form-grid';
    const val = (k, def = '') => esc(d[k] ?? def);
    form.innerHTML = `
      <div class="field"><label for="f-title">Title *</label><input class="input" id="f-title" value="${val('title')}" maxlength="120" autofocus><span class="error-text" data-err="title"></span></div>
      <div class="field"><label for="f-desc">Description</label><textarea class="textarea" id="f-desc" maxlength="1000">${val('description')}</textarea></div>
      <div class="field"><label for="f-course">Course / subject *</label><input class="input" id="f-course" list="courses" value="${val('course')}"><datalist id="courses">${COURSES.map((c) => `<option value="${c}">`).join('')}</datalist><span class="error-text" data-err="course"></span></div>
      <div class="field"><label for="f-lect">Lecturer (optional)</label><input class="input" id="f-lect" value="${val('lecturer')}"></div>
      <div class="field"><label for="f-due">Due date *</label><input class="input" id="f-due" type="date" value="${val('due')}"><span class="error-text" data-err="due"></span></div>
      <div class="grid-2"><div class="field"><label for="f-prio">Priority</label><select class="select" id="f-prio">${Object.entries(PRIO).map(([k, [, l]]) => `<option value="${k}" ${(d.priority || 'medium') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="f-status">Status</label><select class="select" id="f-status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${(d.status || 'todo') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="field"><label for="f-tags">Hashtags (optional)</label><input class="input" id="f-tags" placeholder="#Programming #Exams" value="${esc((d.tags || []).map?.((t) => `#${t}`).join(' ') ?? d.tags ?? '')}"></div>
      <div class="field"><span class="label">Attachments</span><div id="f-picker"></div></div>
      <p class="faint" id="f-draft" style="font-size:var(--fs-xs)">${draft ? `Draft restored — saved on this device (not synced) ${timeAgo(draft.savedAt)}.` : existing ? '' : 'Drafts are saved on this device only and are not synced to an account.'}</p>`;
    form.querySelector('#f-picker').appendChild(picker.el);
    const collect = () => ({ title: form.querySelector('#f-title').value.trim(), description: form.querySelector('#f-desc').value.trim(), course: form.querySelector('#f-course').value.trim(), lecturer: form.querySelector('#f-lect').value.trim(), due: form.querySelector('#f-due').value, priority: form.querySelector('#f-prio').value, status: form.querySelector('#f-status').value, tags: form.querySelector('#f-tags').value });
    if (!existing) form.addEventListener('input', debounce(() => { storage.saveDraft('assignment', collect()); form.querySelector('#f-draft').textContent = 'Draft saved on this device (not synced).'; }, 500));
    openModal({ title: existing ? 'Edit assignment' : 'New assignment', content: form, actions: [{ label: 'Cancel' }, { label: existing ? 'Save changes' : 'Add assignment', variant: 'primary', onClick: async () => {
      const v = collect(); const errs = { title: v.title ? '' : 'Title is required.', course: v.course ? '' : 'Course is required.', due: v.due ? '' : 'Pick a due date.' };
      Object.entries(errs).forEach(([k, m]) => { form.querySelector(`[data-err="${k}"]`).textContent = m; });
      if (Object.values(errs).some(Boolean)) { form.querySelector(`#f-${Object.keys(errs).find((k) => errs[k])}`).focus(); return false; }
      const payload = { ...v, tags: parseTags(v.tags), attachments: picker.getFiles() };
      try {
        if (existing) { const n = await api.updateMyAssignment(existing.id, payload); items = items.map((x) => (x.id === n.id ? { ...x, ...payload } : x)); showToast('Assignment updated.', 'success'); }
        else { const n = await api.createMyAssignment(payload); items.unshift({ ...n, ...payload }); storage.clearDraft('assignment'); showToast('Assignment added (sample data, not saved to a server).', 'success'); }
        paint();
      } catch (e) { showToast(e.message, 'error'); return false; }
    } }] });
  }

  root.addEventListener('click', async (e) => {
    const g = (k) => e.target.closest(`[data-${k}]`)?.dataset[k];
    const find = (id) => items.find((x) => x.id === id);
    if (g('f')) { state.filter = g('f'); syncChips(); paint(); }
    if (g('view')) openView(find(g('view')));
    if (g('edit')) openForm(find(g('edit')));
    if (g('toggle')) { const a = find(g('toggle')); const status = a.status === 'done' ? 'todo' : 'done'; await api.updateMyAssignment(a.id, { status }); a.status = status; paint(); showToast(status === 'done' ? 'Marked as completed.' : 'Marked as not completed.', 'success', 1800); }
    if (g('del')) { const a = find(g('del')); if (await confirmDialog({ title: 'Delete assignment?', message: `“${esc(a.title)}” will be removed from this prototype list.`, confirmLabel: 'Delete', danger: true })) { await api.deleteMyAssignment(a.id); items = items.filter((x) => x.id !== a.id); paint(); showToast('Assignment deleted.', 'success'); } }
  });
  $('#new-a').addEventListener('click', () => openForm());
  ctx.setFab({ label: 'New assignment', onClick: () => openForm() });
  $('#a-q').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); paint(); }, 160));
  $('#a-sort').addEventListener('change', (e) => { state.sort = e.target.value; paint(); });

  async function load() {
    try { items = await api.listMyAssignments(); if (alive) paint(); }
    catch (e) { if (!alive) return; $('#list').innerHTML = errorState(e.simulated ? e.message : 'Could not load your assignments.'); $('#retry').addEventListener('click', () => { $('#list').innerHTML = skeletonCards(3, 130); load(); }); }
  }
  load();
  return () => { alive = false; };
}
