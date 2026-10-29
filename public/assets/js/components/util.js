// Small shared helpers (no framework).
export const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}`;
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const initials = (name = '?') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function html(strings, ...vals) {
  const t = document.createElement('template');
  t.innerHTML = String.raw({ raw: strings }, ...vals).trim();
  return t.content.firstElementChild;
}
export function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return iso ? new Date(iso).toLocaleDateString(undefined, opts) : '—';
}
export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
export function daysUntil(iso) {
  const a = new Date(iso); const b = new Date();
  a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
  return Math.round((a - b) / 86400000);
}
export function dueLabel(iso) {
  const d = daysUntil(iso);
  if (d < 0) return `Overdue by ${-d} day${d === -1 ? '' : 's'}`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due in ${d} days`;
}
export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return fmtDate(iso, { day: 'numeric', month: 'short' });
}
export function parseTags(str = '') {
  return [...new Set(String(str).split(/[\s,]+/).map((t) => t.replace(/^#+/, '').replace(/[^\w]/g, '')).filter(Boolean))];
}
export const colorPair = (seed = '') => {
  const pairs = [['#14b8a6', '#6366f1'], ['#f59e0b', '#ef4444'], ['#3b82f6', '#8b5cf6'], ['#10b981', '#0ea5e9'], ['#ec4899', '#f97316']];
  let n = 0; for (const ch of seed) n += ch.charCodeAt(0);
  return pairs[n % pairs.length];
};
export function avatar(name, cls = '') {
  const [c1, c2] = colorPair(name);
  return `<span class="avatar ${cls}" style="--c1:${c1};--c2:${c2}" aria-hidden="true">${esc(initials(name))}</span>`;
}
