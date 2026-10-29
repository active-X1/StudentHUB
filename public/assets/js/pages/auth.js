// Sign-in, registration and forgot-password screens.
// LIVE mode (the API is running): real sign-in / registration / Google / GitHub through /api/v1, server-side validation.
// DEMO mode (static preview, no API): behaves like Phase 1 — validates the form, sends nothing, simulates success.
import { icon } from '../components/icons.js';
import * as client from '../auth-client.js';

const page = document.body.dataset.page;
const form = document.getElementById('auth-form');
const msg = document.getElementById('form-msg');
const card = document.querySelector('.auth-card');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let live = false;

// Only these codes are ever shown (the ?error= value is never reflected into the page).
const URL_ERRORS = {
  oauth_denied: 'Sign-in was cancelled. You can try again or use your email and password.',
  oauth_state_invalid: 'That sign-in attempt expired or did not start in this browser. Please try again.',
  oauth_email_in_use: 'An account with this email already exists. Sign in with your password instead.',
  oauth_not_allowed: 'This account cannot sign in with Google or GitHub.',
  oauth_provider_error: 'The sign-in provider had a problem. Please try again in a moment.',
  validation_failed: 'Your provider account needs a verified email address (or an allowed institution email) to sign in this way.',
  oauth_failed: 'Sign-in with that provider failed. Please try again.',
  provider_unavailable: 'That sign-in method is not available.',
};
const pageAlert = document.createElement('div'); pageAlert.className = 'alert error'; pageAlert.setAttribute('role', 'alert'); pageAlert.hidden = true;
card.insertBefore(pageAlert, card.children[2] ?? null);
const showError = (text) => { pageAlert.hidden = !text; pageAlert.textContent = text || ''; };

function strength(pw) { let s = 0; if (pw.length >= 10) s++; if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^\w\s]/.test(pw)) s++; return s; }
const field = (id) => form.querySelector(`#${id}`);
const setErr = (id, text) => { const e = form.querySelector(`[data-err="${id}"]`); if (e) e.textContent = text; field(id)?.setAttribute('aria-invalid', text ? 'true' : 'false'); };
const clearErrors = () => { ['name', 'email', 'password', 'confirm'].forEach((id) => field(id) && setErr(id, '')); showError(''); };

document.querySelectorAll('.pw-toggle').forEach((b) => {
  b.innerHTML = icon('eye');
  b.addEventListener('click', () => {
    const input = document.getElementById(b.dataset.toggle); const show = input.type === 'password';
    input.type = show ? 'text' : 'password'; b.innerHTML = icon(show ? 'eyeoff' : 'eye'); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
});

const params = new URLSearchParams(location.search);
if (params.get('signedout')) { msg.hidden = false; msg.className = 'alert info'; msg.textContent = 'You were signed out and local data on this device was cleared.'; }
if (URL_ERRORS[params.get('error')]) showError(URL_ERRORS[params.get('error')]);

const pwInput = field('password');
if (page === 'register' && pwInput) pwInput.addEventListener('input', () => {
  const m = document.getElementById('pw-meter'); const s = strength(pwInput.value);
  m.style.width = `${s * 25}%`; m.style.background = s < 2 ? 'var(--danger)' : s < 4 ? 'var(--warn)' : 'var(--success)';
});

// Map server field errors (details) onto the form.
function applyServerErrors(err) {
  const d = err.details || {}; let shown = false;
  for (const [k, id] of [['name', 'name'], ['email', 'email'], ['password', 'password'], ['newPassword', 'password']]) if (d[k] && field(id)) { setErr(id, d[k]); shown = true; }
  return shown;
}
function describe(err) {
  if (err.code === 'invalid_credentials') return 'Incorrect email or password.';
  if (err.status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (err.code === 'registration_failed') return err.message;
  if (err.status === 403 && err.code === 'csrf_failed') return 'Your session could not be verified. Reload the page and try again.';
  return err.status === undefined ? 'Could not reach the server. Check your connection and try again.' : 'Something went wrong. Please try again.';
}

function validateLocally() {
  let ok = true; const fail = (id, t) => { setErr(id, t); ok = false; };
  const v = (id) => field(id)?.value.trim() ?? '';
  if (page === 'register' && v('name').length < 2) fail('name', 'Enter your profile name.');
  if (!EMAIL.test(v('email'))) fail('email', 'Enter a valid email address.');
  if (page === 'login' && !pwInput.value) fail('password', 'Enter your password.');
  if (page === 'register') {
    if (pwInput.value.length < 10 || strength(pwInput.value) < 3) fail('password', 'Use 10+ characters with mixed case and a number or symbol.');
    if (field('confirm').value !== pwInput.value) fail('confirm', 'Passwords do not match.');
  }
  return ok;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault(); clearErrors();
  if (!validateLocally()) { form.querySelector('[aria-invalid="true"]')?.focus(); return; }
  const submit = form.querySelector('button[type="submit"]'); const label = submit.textContent;
  msg.hidden = true;

  if (!live) { // demo mode: nothing is sent anywhere
    msg.hidden = false; msg.className = 'alert success';
    if (page === 'forgot') msg.textContent = 'Demo: if this were live, a reset link would be sent if the email is registered. No email was sent.';
    else { msg.textContent = page === 'login' ? 'Demo sign-in successful (nothing was verified). Opening the app…' : 'Demo account created (nothing was saved). Opening the app…'; submit.disabled = true; setTimeout(() => { location.href = '/index.html#/home'; }, 900); }
    return;
  }
  submit.disabled = true; submit.textContent = 'Please wait…';
  try {
    if (page === 'login') await client.login({ email: field('email').value, password: pwInput.value });
    else await client.register({ name: field('name').value, email: field('email').value, password: pwInput.value });
    location.href = '/index.html#/home';
  } catch (err) {
    if (!applyServerErrors(err)) showError(describe(err));
    submit.disabled = false; submit.textContent = label; form.querySelector('[aria-invalid="true"]')?.focus();
  }
});

// ---- boot: detect live vs demo ----
(async () => {
  const s = await client.getSession();
  live = s.mode === 'live';
  const demoBanner = document.getElementById('demo-banner');
  if (live) {
    demoBanner?.remove();
    if (s.authenticated) { location.replace(s.sessionKind === 'admin' ? '/admin/' : '/index.html#/home'); return; }
    if (page === 'forgot') { // password reset needs email delivery, which is not built yet: say so honestly
      form.hidden = true; card.querySelector('.auth-foot')?.insertAdjacentHTML('beforebegin', '<div class="alert info" role="status">Password reset by email is not available yet. If you cannot sign in, ask a department administrator for help, or sign in with Google or GitHub if you used them before.</div>');
    }
    const oauthStack = document.querySelector('.stack'); const divider = document.querySelector('.divider');
    let any = false;
    document.querySelectorAll('[data-oauth]').forEach((b) => {
      const p = b.dataset.oauth.toLowerCase(); const enabled = Boolean(s.features?.[p]);
      b.hidden = !enabled; any ||= enabled; b.addEventListener('click', () => client.startOAuth(p));
    });
    if (!any) { oauthStack?.setAttribute('hidden', ''); divider?.setAttribute('hidden', ''); }
    if (s.features?.allowedEmailDomains?.length) field('email')?.insertAdjacentHTML('afterend', `<span class="hint faint" style="font-size:var(--fs-xs)">Use your institution email (${s.features.allowedEmailDomains.map((d) => `@${d}`).join(', ')}).</span>`);
  } else {
    document.querySelectorAll('[data-oauth]').forEach((b) => b.addEventListener('click', () => {
      const n = document.getElementById('oauth-note'); n.hidden = false;
      n.textContent = `${b.dataset.oauth} sign-in needs the server API (not running in this preview). Use the form below to explore the demo.`;
    }));
  }
})();
