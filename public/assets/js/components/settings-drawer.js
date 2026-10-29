// Right-hand settings drawer (≈75% width on phones). Overlay, close button, Escape, focus trap, restore focus.
import { api } from '../api.js';
import { storage, applyTheme, currentTheme } from '../storage.js';
import { icon } from './icons.js';
import { esc } from './util.js';
import { trapFocus, lockBackground, unlockBackground } from './modal.js';
import { showToast } from './toast.js';
import { confirmSignOut } from './session.js';
import { canInstall, promptInstall } from './pwa.js';
import { isLive } from '../auth-client.js';

let drawer; let overlay; let previous; let isOpen = false;
const NOTIFS = [['announcements', 'Announcements', 'New department announcements'], ['deadlines', 'Deadline reminders', 'Before your assignments are due'], ['replies', 'Replies', 'Comments on your posts']];

function strength(pw) {
  let s = 0; if (pw.length >= 10) s++; if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^\w\s]/.test(pw)) s++;
  return s;
}
function build() {
  overlay = document.createElement('div'); overlay.className = 'drawer-overlay'; overlay.addEventListener('click', closeSettings);
  drawer = document.createElement('aside'); drawer.className = 'drawer'; drawer.id = 'settings-drawer';
  drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-labelledby', 'settings-title');
  document.body.append(overlay, drawer);
  drawer.addEventListener('click', onClick); drawer.addEventListener('change', onChange); drawer.addEventListener('submit', onSubmit); drawer.addEventListener('input', onInput);
}
async function paint() {
  const user = await api.getProfile().catch(() => ({ provider: 'email' }));
  const notif = storage.get('notif', { announcements: true, deadlines: true, replies: false });
  const theme = currentTheme(); const demo = storage.get('demoState', 'normal');
  const pwBlock = user.provider === 'email' ? `
    <form id="pw-form" novalidate class="form-grid">
      <div class="field"><label for="pw-old">Current password</label><input class="input" id="pw-old" type="password" autocomplete="current-password"><span class="error-text" data-err="old"></span></div>
      <div class="field"><label for="pw-new">New password</label><input class="input" id="pw-new" type="password" autocomplete="new-password"><div class="meter" aria-hidden="true"><span id="pw-meter"></span></div><span class="hint">10+ characters with upper/lower case, a number or symbol.</span><span class="error-text" data-err="new"></span></div>
      <div class="field"><label for="pw-confirm">Confirm new password</label><input class="input" id="pw-confirm" type="password" autocomplete="new-password"><span class="error-text" data-err="confirm"></span></div>
      ${isLive() ? '<p class="faint" style="font-size:var(--fs-xs)">Changing your password signs you out on your other devices.</p>' : '<div class="alert warn">Demo mode: no API is running, so nothing is verified, changed or stored.</div>'}
      <div class="alert" id="pw-result" hidden></div>
      <button class="btn btn-primary" type="submit">Update password</button>
    </form>` : `<div class="alert info">You signed in with ${user.provider === 'google' ? 'Google' : 'GitHub'}. Your password is managed by that provider, so there is no password to change here.</div>`;
  drawer.innerHTML = `
    <div class="drawer-head"><h2 id="settings-title">Settings</h2><button class="icon-btn" data-act="close" aria-label="Close settings">${icon('close')}</button></div>
    <div class="drawer-body">
      <section class="drawer-section"><h3>Appearance</h3>
        <div class="segmented" role="group" aria-label="Theme">
          <button type="button" data-theme-set="light" aria-pressed="${theme === 'light'}">Light</button>
          <button type="button" data-theme-set="dark" aria-pressed="${theme === 'dark'}">Dark</button></div></section>
      <section class="drawer-section"><h3>Notifications</h3><p class="faint" style="font-size:var(--fs-xs)">Placeholder: no notifications are sent in this prototype.</p>
        ${NOTIFS.map(([k, t, d]) => `<div class="setting-row"><div><label for="n-${k}">${t}</label><small>${d}</small></div>
          <span class="switch"><input type="checkbox" id="n-${k}" data-notif="${k}" ${notif[k] ? 'checked' : ''}><span class="track"></span></span></div>`).join('')}</section>
      <section class="drawer-section"><h3>Change password</h3>${pwBlock}</section>
      <section class="drawer-section"><h3>App</h3>
        <button class="btn btn-block" data-act="install" ${canInstall() ? '' : 'disabled'}>${icon('install')} ${canInstall() ? 'Install Student Hub' : 'Install not available here'}</button>
        <p class="faint" style="font-size:var(--fs-xs);margin-top:6px">Installing needs a supported browser and HTTPS or localhost.</p></section>
      <section class="drawer-section"><h3>Prototype tools</h3>
        <div class="field"><label for="demo-state">Simulate API state</label>
          <select class="select" id="demo-state">${[['normal', 'Normal'], ['slow', 'Slow (loading states)'], ['empty', 'Empty data'], ['error', 'Network error']].map(([v, l]) => `<option value="${v}" ${demo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <button class="btn btn-sm" style="margin-top:8px" data-act="clear-local">Clear local prototype data</button></section>
      <button class="btn btn-danger btn-block" data-act="signout">${icon('logout')} Sign out</button>
    </div>`;
}
function onClick(e) {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.act === 'close') closeSettings();
  if (t.dataset.themeSet) { applyTheme(t.dataset.themeSet); drawer.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); window.dispatchEvent(new Event('theme:changed')); }
  if (t.dataset.act === 'install') promptInstall().then((o) => showToast(o === 'accepted' ? 'Installing…' : 'Install dismissed', 'info'));
  if (t.dataset.act === 'clear-local') { storage.clearAll(['theme']); showToast('Local prototype data cleared (theme kept).', 'success'); }
  if (t.dataset.act === 'signout') { closeSettings(); confirmSignOut(); }
}
function onChange(e) {
  if (e.target.dataset.notif) { const n = storage.get('notif', {}); n[e.target.dataset.notif] = e.target.checked; storage.set('notif', n); showToast('Preference saved on this device (not synced).', 'success', 2200); }
  if (e.target.id === 'demo-state') { storage.set('demoState', e.target.value); window.dispatchEvent(new Event('proto:refresh')); showToast(`API state: ${e.target.value}`, 'info', 2000); }
}
function onInput(e) {
  if (e.target.id === 'pw-new') { const m = drawer.querySelector('#pw-meter'); const s = strength(e.target.value); m.style.width = `${s * 25}%`; m.style.background = s < 2 ? 'var(--danger)' : s < 4 ? 'var(--warn)' : 'var(--success)'; }
}
async function onSubmit(e) {
  if (e.target.id !== 'pw-form') return;
  e.preventDefault();
  const v = (id) => drawer.querySelector(id).value;
  const errs = { old: '', new: '', confirm: '' };
  if (!v('#pw-old')) errs.old = 'Enter your current password.';
  if (strength(v('#pw-new')) < 3 || v('#pw-new').length < 10) errs.new = 'Use 10+ characters mixing cases, numbers or symbols.';
  else if (v('#pw-new') === v('#pw-old')) errs.new = 'New password must differ from the current one.';
  if (v('#pw-confirm') !== v('#pw-new')) errs.confirm = 'Passwords do not match.';
  Object.entries(errs).forEach(([k, m]) => { drawer.querySelector(`[data-err="${k}"]`).textContent = m; });
  const res = drawer.querySelector('#pw-result');
  if (Object.values(errs).some(Boolean)) { res.hidden = true; return; }
  res.hidden = true;
  const map = { currentPassword: 'old', newPassword: 'new', confirmPassword: 'confirm' };
  try {
    const out = await api.changePassword({ currentPassword: v('#pw-old'), newPassword: v('#pw-new'), confirmPassword: v('#pw-confirm') });
    res.hidden = false; res.className = out.demo ? 'alert info' : 'alert success';
    res.textContent = out.demo ? out.message : 'Password updated. Your other devices were signed out.';
    if (!out.demo) { e.target.reset(); drawer.querySelector('#pw-meter').style.width = '0'; }
  } catch (err) {
    for (const [field, key] of Object.entries(map)) if (err.details?.[field]) drawer.querySelector(`[data-err="${key}"]`).textContent = err.details[field];
    if (!Object.keys(err.details ?? {}).length) { res.hidden = false; res.className = 'alert error'; res.textContent = err.status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : err.message; }
  }
}
function onKey(e) { if (!isOpen) return; if (e.key === 'Escape') closeSettings(); else trapFocus(drawer, e); }

export async function openSettings(focusSection) {
  if (isOpen) return;
  if (!drawer) { build(); document.addEventListener('keydown', onKey); }
  previous = document.activeElement; await paint();
  isOpen = true; lockBackground();
  overlay.classList.add('open'); drawer.classList.add('open');
  requestAnimationFrame(() => {
    if (focusSection === 'password') drawer.querySelector('#pw-old')?.focus(); else drawer.querySelector('[data-act="close"]').focus();
  });
}
export function closeSettings() {
  if (!isOpen) return; isOpen = false;
  overlay.classList.remove('open'); drawer.classList.remove('open'); unlockBackground(); previous?.focus?.();
}
