import { api } from '../api.js';
import { icon } from '../components/icons.js';
import { esc, fmtDate, dueLabel, daysUntil, debounce } from '../components/util.js';
import { skeletonCards, errorState, emptyState, demoBanner } from '../components/states.js';
import { openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

export async function render(root) {
  let alive = true; let items = [];
  const state = { q: '', course: 'All', sort: 'deadline' };
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1 tabindex="-1">General Assignments</h1><p>Shared coursework published by the department.</p></div></div>
    ${demoBanner('Sample assignments. <b>Download buttons are placeholders</b>; no real files or server URLs exist in this prototype.')}
    <div class="toolbar"><div class="toolbar-row"><div class="search">${icon('search')}<label class="sr-only" for="g-q">Search general assignments</label><input class="input" id="g-q" type="search" placeholder="Search title, course or #tag"></div>
      <label class="sr-only" for="g-sort">Sort</label><select class="select" id="g-sort" style="width:auto"><option value="deadline">Deadline</option><option value="newest">Newest published</option></select></div>
      <div class="chips" id="g-courses" role="group" aria-label="Filter by course"></div></div>
    <div id="list" class="stack" aria-live="polite">${skeletonCards(3, 140)}</div></div>`;
  const $ = (s) => root.querySelector(s);

  function visible() {
    const q = state.q.toLowerCase();
    return items.filter((a) => (state.course === 'All' || a.course === state.course) && (!q || [a.title, a.course, a.description, a.category, ...a.tags.map((t) => `#${t}`)].join(' ').toLowerCase().includes(q)))
      .sort(state.sort === 'deadline' ? (a, b) => new Date(a.due) - new Date(b.due) : (a, b) => new Date(b.published) - new Date(a.published));
  }
  function paintChips() {
    const courses = ['All', ...new Set(items.map((a) => a.course))];
    $('#g-courses').innerHTML = courses.map((c) => `<button class="chip" data-course="${esc(c)}" aria-pressed="${state.course === c}">${esc(c)}</button>`).join('');
  }
  function paint() {
    const list = visible();
    $('#list').innerHTML = list.length ? list.map((a) => `<article class="card interactive stack"><div class="row between"><span class="badge accent">${esc(a.course)}</span><span class="badge ${daysUntil(a.due) < 0 ? 'danger' : daysUntil(a.due) <= 2 ? 'warn' : ''}">${dueLabel(a.due)}</span></div>
      <h3>${esc(a.title)}</h3><p class="muted" style="font-size:var(--fs-sm)">${esc(a.description.slice(0, 110))}${a.description.length > 110 ? '…' : ''}</p>
      <div class="row between"><div class="tags">${a.tags.map((t) => `<a class="hashtag" href="#/feeds?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div><span class="faint" style="font-size:var(--fs-xs)">Published ${fmtDate(a.published, { day: 'numeric', month: 'short' })}</span></div>
      <div class="row"><button class="btn btn-sm btn-primary" data-open="${a.id}">Open details</button>${a.attachments.length ? `<span class="badge">${icon('paperclip', 'width="12" height="12"')} ${a.attachments.length} attachment${a.attachments.length > 1 ? 's' : ''}</span>` : ''}</div></article>`).join('')
      : items.length ? emptyState({ ico: 'search', title: 'No matching assignments', text: 'Try another course or search term.', actionLabel: 'Clear filters', actionId: 'g-clear' })
        : emptyState({ ico: 'book', title: 'No assignments published', text: 'Administrators have not published any assignments yet.' });
    $('#g-clear')?.addEventListener('click', () => { state.q = ''; state.course = 'All'; $('#g-q').value = ''; paintChips(); paint(); });
  }
  function openDetails(a) {
    openModal({ title: a.title, content: `<dl class="detail-list" style="margin:0"><div><dt>Course</dt><dd>${esc(a.course)} · ${esc(a.category)}</dd></div><div><dt>Published</dt><dd>${fmtDate(a.published)}</dd></div><div><dt>Due</dt><dd>${fmtDate(a.due)} · ${dueLabel(a.due)}</dd></div><div><dt>Description</dt><dd>${esc(a.description)}</dd></div>
      <div><dt>Attachments</dt><dd>${a.attachments.length ? a.attachments.map((f) => `<div class="file-item" style="margin-bottom:8px"><span class="file-thumb">${icon('file')}</span><div class="file-meta"><strong>${esc(f.name)}</strong><small>Placeholder — no real file</small></div><button class="btn btn-sm" data-dl>${icon('download')} Download</button></div>`).join('') : '<span class="muted">No attachments.</span>'}</dd></div></dl>`,
      actions: [{ label: 'Close', variant: 'primary' }] }).body.addEventListener('click', (e) => { if (e.target.closest('[data-dl]')) showToast('Prototype placeholder: downloads need the backend and secure file storage.', 'info', 4200); });
  }
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-course]'); if (c) { state.course = c.dataset.course; paintChips(); paint(); }
    const o = e.target.closest('[data-open]'); if (o) openDetails(items.find((x) => x.id === o.dataset.open));
  });
  $('#g-q').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); paint(); }, 160));
  $('#g-sort').addEventListener('change', (e) => { state.sort = e.target.value; paint(); });
  async function load() {
    try { items = await api.listGeneralAssignments(); if (!alive) return; paintChips(); paint(); }
    catch (e) { if (!alive) return; $('#list').innerHTML = errorState(e.simulated ? e.message : 'Could not load assignments.'); $('#retry').addEventListener('click', () => { $('#list').innerHTML = skeletonCards(3, 140); load(); }); }
  }
  load();
  return () => { alive = false; };
}
