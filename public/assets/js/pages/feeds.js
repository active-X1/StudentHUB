import { api } from '../api.js';
import { HASHTAGS, FEED_CATEGORIES } from '../mock-data.js';
import { replaceQuery } from '../router.js';
import { storage } from '../storage.js';
import { icon } from '../components/icons.js';
import { esc, avatar, fmtDate, timeAgo, debounce, parseTags } from '../components/util.js';
import { skeletonCards, errorState, emptyState, demoBanner } from '../components/states.js';
import { openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { createFilePicker, attachmentsHTML } from '../components/file-preview.js';

export async function render(root, ctx) {
  let alive = true; let posts = []; let suggestions = [];
  const state = { q: ctx.query.q || (ctx.query.tag ? `#${ctx.query.tag}` : ''), category: ctx.query.category || 'All', sort: ctx.query.sort || 'newest' };

  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1 tabindex="-1">Feeds</h1><p>Announcements, class info and study materials.</p></div></div>
    ${demoBanner('Showing <b>sample published posts</b>. Posts you suggest are mocked and go to a pending-review list only.')}
    <div class="toolbar">
      <div class="toolbar-row"><div class="search">${icon('search')}<label class="sr-only" for="feed-q">Search posts by word or #hashtag</label><input class="input" id="feed-q" type="search" placeholder="Search or #hashtag" value="${esc(state.q)}" autocomplete="off"></div>
        <label class="sr-only" for="feed-sort">Sort posts</label><select class="select" id="feed-sort" style="width:auto"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="liked">Most liked</option></select></div>
      <div class="chips" role="group" aria-label="Filter by category" id="cats">${['All', ...FEED_CATEGORIES].map((c) => `<button class="chip" data-cat="${c}" aria-pressed="${state.category === c}">${c}</button>`).join('')}</div>
      <div class="trend"><span class="faint">Trending:</span>${HASHTAGS.map((t) => `<button class="hashtag" data-tag="${t}">#${t}</button>`).join('')}</div>
    </div>
    <div id="filter-bar"></div><div id="suggest-box"></div><div id="results" class="stack" aria-live="polite">${skeletonCards(3, 160)}</div></div>`;
  root.querySelector('#feed-sort').value = state.sort;
  const $ = (s) => root.querySelector(s);

  function matches(p) {
    if (state.category !== 'All' && p.category !== state.category) return false;
    const toks = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return toks.every((t) => t.startsWith('#')
      ? p.tags.some((x) => x.toLowerCase().startsWith(t.slice(1))) && t.length > 1
      : [p.text, p.author, p.category, ...p.tags].join(' ').toLowerCase().includes(t));
  }
  function visible() {
    const list = posts.filter(matches);
    const by = { newest: (a, b) => new Date(b.date) - new Date(a.date), oldest: (a, b) => new Date(a.date) - new Date(b.date), liked: (a, b) => b.likes - a.likes };
    return list.sort(by[state.sort]);
  }
  function syncUrl() { replaceQuery('feeds', { q: state.q, category: state.category === 'All' ? '' : state.category, sort: state.sort === 'newest' ? '' : state.sort }); }
  function clearFilters() { state.q = ''; state.category = 'All'; state.sort = 'newest'; $('#feed-q').value = ''; $('#feed-sort').value = 'newest'; paintChips(); paint(); syncUrl(); }
  function paintChips() { root.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === state.category))); }

  function postHTML(p) {
    return `<article class="card post" data-id="${p.id}">
      <div class="post-head">${avatar(p.author)}<div class="who"><strong>${esc(p.author)} <span class="badge ${p.role === 'Admin' ? 'accent' : p.role === 'Lecturer' ? 'violet' : ''}">${esc(p.role)}</span></strong><span>${fmtDate(p.date)} · ${timeAgo(p.date)}</span></div><span class="badge accent">${esc(p.category)}</span></div>
      <p class="post-text">${esc(p.text.length > 220 ? `${p.text.slice(0, 220)}…` : p.text)}</p>
      ${p.tags.length ? `<div class="tags">${p.tags.map((t) => `<button class="hashtag" data-tag="${t}">#${esc(t)}</button>`).join('')}</div>` : ''}
      ${attachmentsHTML(p.attachments)}
      <div class="post-actions"><button class="act ${p.liked ? 'on' : ''}" data-like="${p.id}" aria-pressed="${p.liked}" aria-label="Like, ${p.likes} likes">${icon('heart')}${p.likes}</button>
        <button class="act" data-open="${p.id}" aria-label="Open post and ${p.comments.length} comments">${icon('comment')}${p.comments.length}</button>
        <button class="act" data-copy="${p.id}" aria-label="Copy post text">${icon('share')}Copy</button>
        <button class="act" data-open="${p.id}" style="margin-left:auto">Open</button></div></article>`;
  }
  function paint() {
    const list = visible(); const filtered = state.q || state.category !== 'All';
    $('#filter-bar').innerHTML = filtered ? `<div class="active-filter"><span>${list.length} result${list.length === 1 ? '' : 's'}${state.q ? ` for <b>${esc(state.q)}</b>` : ''}${state.category !== 'All' ? ` in <b>${esc(state.category)}</b>` : ''}</span><button class="link-btn" id="clear-filters">Clear filters</button></div>` : '';
    $('#filter-bar #clear-filters')?.addEventListener('click', clearFilters);
    $('#results').innerHTML = list.length ? list.map(postHTML).join('')
      : posts.length ? emptyState({ ico: 'search', title: 'No matching posts', text: 'Try a different word or hashtag, or clear your filters.', actionLabel: 'Clear filters', actionId: 'empty-clear' })
        : emptyState({ ico: 'feed', title: 'No posts yet', text: 'Published posts will show up here.' });
    $('#empty-clear')?.addEventListener('click', clearFilters);
  }
  function paintSuggestions() {
    $('#suggest-box').innerHTML = suggestions.length ? `<div class="pending-box"><b>Your suggestions (sample, pending review)</b>${suggestions.map((s) => `<div style="margin-top:6px"><span class="badge warn">Pending review</span> ${esc(s.text.slice(0, 70))}${s.text.length > 70 ? '…' : ''}</div>`).join('')}<p class="faint" style="font-size:var(--fs-xs);margin-top:6px">Mock moderation status — nothing was sent to a server.</p></div>` : '';
  }
  function setTag(tag) { state.q = `#${tag}`; $('#feed-q').value = state.q; paint(); syncUrl(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  async function copy(text, msg) { try { await navigator.clipboard.writeText(text); showToast(msg, 'success', 2000); } catch { showToast('Copy is not available in this browser.', 'error'); } }
  async function like(id) { const p = await api.toggleLike(id); const i = posts.findIndex((x) => x.id === id); posts[i] = p; paint(); }

  function openPost(id) {
    const p = posts.find((x) => x.id === id);
    const body = document.createElement('div');
    const paintBody = () => {
      body.innerHTML = `<div class="post-head" style="margin-bottom:12px">${avatar(p.author)}<div class="who"><strong>${esc(p.author)}</strong><span>${fmtDate(p.date)} · ${esc(p.category)}</span></div></div>
        <p class="post-text">${esc(p.text)}</p><div class="tags" style="margin:10px 0">${p.tags.map((t) => `<button class="hashtag" data-tag="${t}">#${esc(t)}</button>`).join('')}</div>
        ${p.tags.length ? `<button class="btn btn-sm" data-copytags>${icon('hash')} Copy hashtags</button>` : ''}
        ${p.attachments.length ? `<div style="margin-top:12px">${attachmentsHTML(p.attachments)}<p class="faint" style="font-size:var(--fs-xs);margin-top:6px">Attachment previews are placeholders in the prototype; no real files exist.</p></div>` : ''}
        <h3 style="margin:18px 0 6px">Comments (${p.comments.length})</h3>
        ${p.comments.map((c) => `<div class="comment">${avatar(c.author, 'sm')}<div><strong style="font-size:var(--fs-sm)">${esc(c.author)}</strong> <small>${timeAgo(c.date)}</small><p>${esc(c.text)}</p></div></div>`).join('') || '<p class="muted" style="font-size:var(--fs-sm)">No comments yet.</p>'}
        <form class="row" id="cform" style="margin-top:12px;flex-wrap:nowrap"><label class="sr-only" for="ctext">Add a comment</label><input class="input" id="ctext" placeholder="Add a comment (sample)" maxlength="300" required><button class="btn btn-primary" type="submit">Post</button></form>`;
    };
    paintBody();
    const m = openModal({ title: `${p.category} post`, content: body, actions: [{ label: 'Close' }] });
    body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tag]'); if (t) { m.close(); setTag(t.dataset.tag); }
      if (e.target.closest('[data-copytags]')) copy(p.tags.map((x) => `#${x}`).join(' '), 'Hashtags copied');
    });
    body.addEventListener('submit', async (e) => {
      e.preventDefault(); const input = body.querySelector('#ctext'); const text = input.value.trim(); if (!text) return;
      p.comments.push(await api.addComment(p.id, text)); paintBody(); body.querySelector('#ctext').focus(); paint(); showToast('Comment added (sample, not saved).', 'success', 2000);
    });
  }

  function openComposer() {
    const draft = storage.getDraft('post');
    const d = draft?.data || {};
    const picker = createFilePicker();
    const form = document.createElement('form'); form.noValidate = true; form.className = 'form-grid';
    form.innerHTML = `
      <div class="alert info">Suggest a post for admin review. In this prototype, submitting only creates a <b>mock pending-review</b> entry on this page.</div>
      <div class="field"><label for="pc-text">Post text</label><textarea class="textarea" id="pc-text" maxlength="1000" placeholder="Share a resource, question or update…">${esc(d.text || '')}</textarea><span class="error-text" id="pc-err"></span></div>
      <div class="field"><label for="pc-cat">Category</label><select class="select" id="pc-cat">${FEED_CATEGORIES.map((c) => `<option ${d.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label for="pc-tags">Hashtags</label><input class="input" id="pc-tags" placeholder="#Exams #LectureNotes" value="${esc(d.tags || '')}"><span class="hint">Separate with spaces or commas.</span></div>
      <div class="field"><span class="label">Attachments</span><div id="pc-picker"></div></div>
      <p class="faint" id="pc-draft" style="font-size:var(--fs-xs)">${draft ? `Draft restored — saved on this device (not synced) ${timeAgo(draft.savedAt)}.` : 'Text is autosaved as a draft on this device only (not synced to an account).'}</p>`;
    form.querySelector('#pc-picker').appendChild(picker.el);
    const save = debounce(() => { storage.saveDraft('post', { text: form.querySelector('#pc-text').value, category: form.querySelector('#pc-cat').value, tags: form.querySelector('#pc-tags').value }); form.querySelector('#pc-draft').textContent = 'Draft saved on this device (not synced).'; }, 500);
    form.addEventListener('input', save);
    const m = openModal({ title: 'Suggest a post', content: form, actions: [
      { label: 'Cancel' },
      { label: 'Submit for review', variant: 'primary', id: 'pc-submit', onClick: async (mx) => {
        const text = form.querySelector('#pc-text').value.trim();
        if (text.length < 10) { form.querySelector('#pc-err').textContent = 'Please write at least 10 characters.'; form.querySelector('#pc-text').focus(); return false; }
        const btn = mx.el.querySelector('#pc-submit'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Submitting…';
        try {
          const s = await api.submitSuggestion({ text, category: form.querySelector('#pc-cat').value, tags: parseTags(form.querySelector('#pc-tags').value), attachments: picker.getFiles() });
          suggestions.unshift(s); paintSuggestions(); storage.clearDraft('post');
          showToast('Submitted for review (mock). Status: Pending.', 'success', 4200);
        } catch (e) { btn.disabled = false; btn.textContent = 'Submit for review'; showToast(e.message, 'error'); return false; }
      } },
    ] });
    m.el.querySelector('#pc-text').focus();
  }

  root.addEventListener('click', (e) => {
    const tag = e.target.closest('[data-tag]'); if (tag) return setTag(tag.dataset.tag);
    const cat = e.target.closest('[data-cat]'); if (cat) { state.category = cat.dataset.cat; paintChips(); paint(); syncUrl(); return; }
    const lk = e.target.closest('[data-like]'); if (lk) return like(lk.dataset.like);
    const op = e.target.closest('[data-open]'); if (op) return openPost(op.dataset.open);
    const cp = e.target.closest('[data-copy]'); if (cp) { const p = posts.find((x) => x.id === cp.dataset.copy); copy(`${p.text}\n${p.tags.map((t) => `#${t}`).join(' ')}`, 'Post text copied'); }
  });
  $('#feed-q').addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); paint(); syncUrl(); }, 180));
  $('#feed-sort').addEventListener('change', (e) => { state.sort = e.target.value; paint(); syncUrl(); });
  ctx.setFab({ label: 'Suggest a post', onClick: openComposer });

  async function load() {
    $('#results').innerHTML = skeletonCards(3, 160);
    try { [posts, suggestions] = await Promise.all([api.listPosts(), api.listMySuggestions()]); if (!alive) return; paintSuggestions(); paint(); }
    catch (e) { if (!alive) return; $('#results').innerHTML = errorState(e.simulated ? e.message : 'Could not load posts.'); $('#retry').addEventListener('click', load); }
  }
  load();
  return () => { alive = false; };
}
