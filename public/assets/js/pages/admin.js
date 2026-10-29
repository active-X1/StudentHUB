// Admin sign-in shell. Public by design: it contains no admin data or dashboard code. After a real server-side sign-in
// (username + password, persisted lockout) it loads the dashboard module, which the server sends to admin sessions only.
import * as client from '../auth-client.js';
import { icon } from '../components/icons.js';
import { esc } from '../components/util.js';
import { showToast } from '../components/toast.js';

const app = document.getElementById('app');
const fmt = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
let watcher;

function shell(inner) {
  app.innerHTML = `<main class="auth-wrap"><div class="card auth-card"><div class="brand"><span class="brand-mark">${icon('shield')}</span> Admin</div>${inner}</div></main>`;
}
function showDemo() {
  shell(`<div class="alert warn" role="status"><b>Admin sign-in needs the server.</b> This page is running without the API (static preview). Start the full server with <code>npm start</code> and a configured database, then create the first administrator with <code>npm run admin:bootstrap</code>.</div>`);
}
function showLogin({ error, locked, remaining } = {}) {
  shell(`<div><h1>Administrator sign-in</h1><p class="muted">Authorized staff only. Sign-in attempts are rate limited and logged.</p></div>
    ${locked ? `<div class="alert warn" role="alert"><b>Sign-in is paused.</b> Too many incorrect attempts. You can try again after ${esc(fmt(locked))}.</div>` : ''}
    ${error ? `<div class="alert error" role="alert">${esc(error)}${remaining !== undefined ? ` ${remaining} attempt${remaining === 1 ? '' : 's'} left before sign-in is paused for the day.` : ''}</div>` : ''}
    <form id="a-login" class="form-grid" novalidate>
      <div class="field"><label for="au">Username</label><input class="input" id="au" autocomplete="username" autocapitalize="none" spellcheck="false" ${locked ? 'disabled' : 'autofocus'}></div>
      <div class="field"><label for="ap">Password</label><input class="input" id="ap" type="password" autocomplete="current-password" ${locked ? 'disabled' : ''}></div>
      <button class="btn btn-primary btn-block" id="a-submit" ${locked ? 'disabled' : ''}>Sign in</button>
    </form>`);
  app.querySelector('#a-login').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = app.querySelector('#a-submit'); const username = app.querySelector('#au').value.trim(); const password = app.querySelector('#ap').value;
    if (!username || !password) return showLogin({ error: 'Enter your username and password.' });
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Signing in…';
    try { await client.adminLogin({ username, password }); await boot(); }
    catch (err) {
      if (err.code === 'sign_in_paused') showLogin({ locked: err.details.lockedUntil });
      else if (err.status === 429) showLogin({ error: 'Too many attempts from this network. Please wait a few minutes and try again.' });
      else if (err.code === 'invalid_credentials') showLogin({ error: 'Incorrect username or password.', remaining: err.details.attemptsRemaining });
      else showLogin({ error: err.status === undefined ? 'Could not reach the server.' : err.message });
    }
  });
}
function showForcedChange(user) {
  shell(`<div><h1>Set a new password</h1><p class="muted">Welcome, ${esc(user.name)}. This account was created with a temporary password, so you must choose a new one (at least 14 characters) before continuing.</p></div>
    <div class="alert error" id="fc-err" role="alert" hidden></div>
    <form id="fc" class="form-grid" novalidate>
      <div class="field"><label for="fc-old">Current (temporary) password</label><input class="input" id="fc-old" type="password" autocomplete="current-password"><span class="error-text" data-err="currentPassword"></span></div>
      <div class="field"><label for="fc-new">New password</label><input class="input" id="fc-new" type="password" autocomplete="new-password"><span class="error-text" data-err="newPassword"></span></div>
      <div class="field"><label for="fc-conf">Confirm new password</label><input class="input" id="fc-conf" type="password" autocomplete="new-password"><span class="error-text" data-err="confirmPassword"></span></div>
      <button class="btn btn-primary btn-block">Change password</button>
      <button type="button" class="btn btn-ghost btn-block" id="fc-out">Sign out</button>
    </form>`);
  app.querySelector('#fc-out').onclick = async () => { await client.logout(); await boot(); };
  app.querySelector('#fc').addEventListener('submit', async (e) => {
    e.preventDefault(); const v = (id) => app.querySelector(id).value; const keys = ['currentPassword', 'newPassword', 'confirmPassword'];
    keys.forEach((k) => { app.querySelector(`[data-err="${k}"]`).textContent = ''; });
    try { await client.changePassword({ currentPassword: v('#fc-old'), newPassword: v('#fc-new'), confirmPassword: v('#fc-conf') }); await boot(); }
    catch (err) { const d = err.details || {}; keys.forEach((k) => { if (d[k]) app.querySelector(`[data-err="${k}"]`).textContent = d[k]; }); if (!Object.keys(d).length) { const b = app.querySelector('#fc-err'); b.hidden = false; b.textContent = err.message; } }
  });
}
async function openDashboard(session) {
  try {
    const mod = await import('/assets/js/pages/admin-dashboard.js');
    app.innerHTML = '';
    mod.mount({
      root: app, user: session.user,
      signOut: async () => { await client.logout(); await boot(); },
      changePassword: client.changePassword,
    });
    // If the server ends the session (idle timeout, suspension, password change elsewhere) return to sign-in.
    clearInterval(watcher);
    watcher = setInterval(async () => { const s = await client.getSession(); if (s.mode === 'live' && !(s.authenticated && s.sessionKind === 'admin')) { clearInterval(watcher); showToast('Your admin session ended. Please sign in again.', 'info', 5000); await boot(); } }, 60000);
  } catch { shell('<div class="alert error" role="alert">The dashboard could not be loaded. Your session may have expired.</div><button class="btn btn-block" id="reload">Reload</button>'); app.querySelector('#reload').onclick = () => location.reload(); }
}

async function boot() {
  clearInterval(watcher);
  const s = await client.getSession();
  if (s.mode !== 'live') return s.mode === 'offline' ? shell('<div class="alert warn">You appear to be offline. Admin tools need a connection.</div>') : showDemo();
  if (s.authenticated && s.sessionKind === 'admin') return s.user.mustChangePassword ? showForcedChange(s.user) : openDashboard(s);
  return showLogin();
}
boot();
