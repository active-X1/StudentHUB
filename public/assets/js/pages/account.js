import { api } from '../api.js';
import { icon } from '../components/icons.js';
import { esc, avatar } from '../components/util.js';
import { skeletonCards, errorState, demoBanner } from '../components/states.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { openSettings } from '../components/settings-drawer.js';
import { confirmSignOut } from '../components/session.js';
import { currentTheme, applyTheme } from '../storage.js';
import { isLive } from '../auth-client.js';

const PROVIDERS = { email: ['Email & password', 'mail'], google: ['Google', 'google'], github: ['GitHub', 'github'] };

export async function render(root) {
  let alive = true;
  async function load() {
    root.innerHTML = `<div class="page"><h1 class="sr-only" tabindex="-1">Account</h1>${skeletonCards(3, 120)}</div>`;
    try { const u = await api.getProfile(); if (alive) paint(u); }
    catch (e) { if (!alive) return; root.innerHTML = `<div class="page">${errorState(e.simulated ? e.message : 'Could not load your account.')}</div>`; root.querySelector('#retry').addEventListener('click', load); }
  }
  function paint(u) {
    const live = isLive(); const [pl, pi] = PROVIDERS[u.provider];
    root.innerHTML = `<div class="page">
      <div class="page-head"><div><h1 tabindex="-1">Account</h1></div><button class="icon-btn" id="acc-settings" aria-label="Open settings">${icon('settings')}</button></div>
      ${live ? demoBanner('You are signed in with a real account. Assignments and feeds still show <b>sample data</b> until their phases; profile editing arrives later.') : demoBanner('Demo mode: no API is running, so this is a placeholder profile.')}
      <section class="card profile-card" aria-label="Profile">${avatar(u.name, 'lg')}<h2>${esc(u.name)}</h2><p class="muted">${esc(u.email)}</p>
        <span class="badge accent">${icon(pi, 'width="12" height="12"')} Signed in with ${pl}</span><p class="muted" style="font-size:var(--fs-sm)">${esc(u.department)} · ${esc(u.level)}${u.bio ? ` · ${esc(u.bio)}` : ''}</p>
        <button class="btn btn-sm" id="edit-profile" ${live ? 'disabled title="Profile editing arrives in a later phase"' : ''}>${icon('edit')} Edit profile</button></section>
      ${live ? '' : `<section class="card" aria-label="Sign-in method preview"><h3>Sign-in method (UI preview)</h3><p class="muted" style="font-size:var(--fs-sm);margin:4px 0 10px">Switch to preview how this page and password settings look for each provider.</p>
        <div class="segmented" role="group" aria-label="Preview sign-in provider">${Object.entries(PROVIDERS).map(([k, [l]]) => `<button data-provider="${k}" aria-pressed="${u.provider === k}">${l}</button>`).join('')}</div></section>`}
      <section class="card menu-list" aria-label="Account options">
        <button class="menu-item" id="m-settings"><span class="ico">${icon('settings')}</span><span class="grow">Settings<small>Appearance, notifications, password</small></span>${icon('chevron', 'width="18" height="18"')}</button>
        <button class="menu-item" id="m-theme"><span class="ico">${icon(currentTheme() === 'dark' ? 'moon' : 'sun')}</span><span class="grow">Theme<small>Currently ${currentTheme()}. Tap to switch.</small></span></button>
        <button class="menu-item" id="m-password"><span class="ico">${icon('lock')}</span><span class="grow">Change password<small>${u.provider === 'email' ? 'Update your password' : `Managed by ${pl}`}</small></span>${icon('chevron', 'width="18" height="18"')}</button>
        <button class="menu-item" id="m-export"><span class="ico">${icon('download')}</span><span class="grow">Export my data<small>Placeholder · needs the backend</small></span></button>
        <button class="menu-item" id="m-delete"><span class="ico">${icon('trash')}</span><span class="grow">Delete account<small>Not available yet</small></span></button>
        <button class="menu-item danger" id="m-signout"><span class="ico">${icon('logout')}</span><span class="grow">Sign out</span></button></section></div>`;
    const $ = (s) => root.querySelector(s);
    $('#acc-settings').onclick = $('#m-settings').onclick = () => openSettings();
    $('#m-password').onclick = () => openSettings('password');
    $('#m-theme').onclick = () => { applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'); paint(u); };
    $('#m-export').onclick = () => showToast('Placeholder: data export will be available with the backend.', 'info');
    $('#m-signout').onclick = () => confirmSignOut();
    $('#m-delete').onclick = async () => { if (await confirmDialog({ title: 'Delete account?', message: 'Account deletion is not available yet. Nothing will be deleted.', confirmLabel: 'Understood', danger: true })) showToast('Nothing was deleted.', 'info'); };
    root.querySelectorAll('[data-provider]').forEach((b) => b.addEventListener('click', async () => { paint(await api.setProvider(b.dataset.provider)); }));
    $('#edit-profile').onclick = () => {
      const form = document.createElement('form'); form.noValidate = true; form.className = 'form-grid';
      form.innerHTML = `<div class="field"><label for="e-name">Profile name</label><input class="input" id="e-name" value="${esc(u.name)}" maxlength="60" autofocus><span class="error-text" id="e-err"></span></div>
        <div class="field"><label for="e-level">Level</label><select class="select" id="e-level">${['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Postgraduate'].map((l) => `<option ${u.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="e-bio">Short bio</label><textarea class="textarea" id="e-bio" maxlength="160">${esc(u.bio || '')}</textarea></div>
        <div class="field"><label for="e-email">Email</label><input class="input" id="e-email" value="${esc(u.email)}" disabled><span class="hint">Email changes will need verification once the backend exists.</span></div>`;
      openModal({ title: 'Edit profile', content: form, actions: [{ label: 'Cancel' }, { label: 'Save', variant: 'primary', onClick: async () => {
        const name = form.querySelector('#e-name').value.trim();
        if (name.length < 2) { form.querySelector('#e-err').textContent = 'Enter at least 2 characters.'; return false; }
        const nu = await api.updateProfile({ name, level: form.querySelector('#e-level').value, bio: form.querySelector('#e-bio').value.trim() });
        showToast('Profile updated (sample, in memory only).', 'success'); paint(nu);
      } }] });
    };
  }
  load();
  return () => { alive = false; };
}
