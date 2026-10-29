import { api } from '../api.js';
import { icon } from '../components/icons.js';
import { esc, avatar, fmtDate, daysUntil, dueLabel, timeAgo } from '../components/util.js';
import { skeletonCards, errorState, emptyState, demoBanner } from '../components/states.js';
import { openModal } from '../components/modal.js';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

export async function render(root, ctx) {
  let alive = true;
  async function load() {
    root.innerHTML = `<div class="page"><h1 class="sr-only" tabindex="-1">Home</h1>${skeletonCards(4, 120)}</div>`;
    try {
      const [home, user, mine, general] = await Promise.all([api.getHome(), api.getProfile(), api.listMyAssignments(), api.listGeneralAssignments()]);
      if (!alive) return;
      paint({ home, user, mine, general });
    } catch (e) {
      if (!alive) return;
      root.innerHTML = `<div class="page">${errorState(e.simulated ? e.message : 'We could not load your home feed.')}</div>`;
      root.querySelector('#retry').addEventListener('click', load);
    }
  }
  function paint({ home, user, mine, general }) {
    const open = mine.filter((a) => a.status !== 'done');
    const overdue = open.filter((a) => daysUntil(a.due) < 0).length;
    const soon = open.filter((a) => { const d = daysUntil(a.due); return d >= 0 && d <= 3; }).length;
    const deadlines = [
      ...open.map((a) => ({ title: a.title, due: a.due, tag: 'Mine', go: 'my-assignments' })),
      ...general.map((a) => ({ title: a.title, due: a.due, tag: 'General', go: 'general-assignments' })),
    ].sort((a, b) => new Date(a.due) - new Date(b.due)).slice(0, 5);
    const first = user.name.split(' ')[0];
    root.innerHTML = `<div class="page">
      ${demoBanner('Prototype with <b>sample data</b>. Nothing here is real or saved to a server.')}
      <section class="hero" aria-labelledby="home-h">
        <div class="greet">${avatar(user.name, 'lg')}<div><p class="muted">${greeting()}</p><h1 id="home-h" tabindex="-1">${esc(first)}, welcome back</h1><p class="muted">${esc(user.department)} · ${esc(user.level)}</p></div></div>
        <div class="stat-row"><div class="stat"><b>${overdue}</b><span>Overdue</span></div><div class="stat"><b>${soon}</b><span>Due in 3 days</span></div><div class="stat"><b>${mine.filter((a) => a.status === 'done').length}</b><span>Completed</span></div></div>
      </section>
      <section aria-labelledby="feat-h"><div class="section-head"><h2 id="feat-h">Announcements</h2></div>
        ${home.announcements.length ? `<div class="featured">${home.announcements.map((a) => `<button class="feature-card" style="--c1:${a.c1};--c2:${a.c2}" data-ann="${a.id}"><span class="badge">${esc(a.category)}</span><div><h3>${esc(a.title)}</h3><p>${esc(a.body.slice(0, 80))}…</p></div></button>`).join('')}</div>`
          : emptyState({ ico: 'bell', title: 'No announcements yet', text: 'Department announcements will appear here once administrators publish them.' })}</section>
      <section aria-labelledby="ql-h"><div class="section-head"><h2 id="ql-h">Quick links</h2></div><div class="quick-links">
        ${[['feeds', 'Feeds', 'feed'], ['my-assignments', 'My Assignments', 'clipboard'], ['general-assignments', 'General Assignments', 'book']].map(([r, l, i]) => `<a class="card interactive quick-link" href="#/${r}"><span class="ico">${icon(i)}</span>${l}</a>`).join('')}</div></section>
      <div class="grid-2">
        <section class="card" aria-labelledby="dl-h"><div class="section-head"><h2 id="dl-h">Upcoming deadlines</h2></div>
          ${deadlines.length ? deadlines.map((d) => { const dt = new Date(d.due); return `<a class="list-item" href="#/${d.go}" style="color:inherit;text-decoration:none"><span class="date-tile"><b>${dt.getDate()}</b><span>${dt.toLocaleString(undefined, { month: 'short' })}</span></span>
            <div><strong>${esc(d.title)}</strong><div class="meta"><span class="badge ${daysUntil(d.due) < 0 ? 'danger' : daysUntil(d.due) <= 2 ? 'warn' : ''}">${dueLabel(d.due)}</span> <span class="badge violet">${d.tag}</span></div></div></a>`; }).join('')
            : emptyState({ ico: 'calendar', title: 'Nothing due', text: 'You are all caught up.' })}</section>
        <section class="card" aria-labelledby="news-h"><div class="section-head"><h2 id="news-h">Department news</h2></div>
          ${home.news.length ? home.news.map((n) => `<button class="list-item" data-news="${n.id}"><span class="dot"></span><div><strong>${esc(n.title)}</strong><div class="meta">${esc(n.meta)}</div></div></button>`).join('') : emptyState({ ico: 'inbox', title: 'No news', text: 'Check back soon.' })}</section>
      </div>
      <section class="card" aria-labelledby="act-h"><div class="section-head"><h2 id="act-h">Recent activity</h2></div>
        ${home.activity.length ? home.activity.map((a) => `<div class="list-item"><span class="dot"></span><div><p>${esc(a.text)}</p><div class="meta">${timeAgo(a.time)}</div></div></div>`).join('') : emptyState({ ico: 'clock', title: 'No activity yet' })}</section>
    </div>`;
    root.querySelectorAll('[data-ann]').forEach((b) => b.addEventListener('click', () => {
      const a = home.announcements.find((x) => x.id === b.dataset.ann);
      openModal({ title: a.title, content: `<p><span class="badge accent">${esc(a.category)}</span> <span class="muted">${fmtDate(a.date)}</span></p><p style="margin-top:12px">${esc(a.body)}</p><p class="faint" style="margin-top:12px;font-size:var(--fs-xs)">Sample content. Administrators will manage announcements from the admin dashboard.</p>`, actions: [{ label: 'Close', variant: 'primary' }] });
    }));
    root.querySelectorAll('[data-news]').forEach((b) => b.addEventListener('click', () => {
      const n = home.news.find((x) => x.id === b.dataset.news);
      openModal({ title: n.title, content: `<p class="muted">${esc(n.meta)}</p><p style="margin-top:12px">This is placeholder article text for the prototype. Real department news will be published by administrators.</p>`, actions: [{ label: 'Close', variant: 'primary' }] });
    }));
  }
  load();
  return () => { alive = false; };
}
