// Floating liquid bottom bar on mobile; the same markup becomes a left sidebar on desktop (CSS only).
// Order on mobile: My Assignments, Account, [Home], Feeds, General Assignments.
import { icon } from './icons.js';
import { canInstall, promptInstall } from './pwa.js';
import { openSettings } from './settings-drawer.js';

export const NAV_ITEMS = [
  { route: 'my-assignments', label: 'My Assignments', icon: 'clipboard', pos: 1 },
  { route: 'account', label: 'Account', icon: 'user', pos: 2 },
  { route: 'home', label: 'Home', icon: 'home', center: true },
  { route: 'feeds', label: 'Feeds', icon: 'feed', pos: 3 },
  { route: 'general-assignments', label: 'General Assignments', icon: 'book', pos: 4 },
];

let nav; let blob;

export function renderNav(host) {
  nav = host;
  nav.className = 'bottom-nav'; nav.setAttribute('aria-label', 'Main');
  nav.innerHTML = `
    <div class="nav-brand brand"><span class="brand-mark">${icon('layers')}</span><span>Student Hub</span></div>
    <span class="nav-blob" aria-hidden="true"></span>
    ${NAV_ITEMS.map((i) => i.center
      ? `<a class="nav-item is-home" href="#/home" data-route="home" aria-label="Home"><span class="nav-home-btn">${icon('home')}</span><span class="label sr-only-mobile">Home</span></a>`
      : `<a class="nav-item pos-${i.pos}" href="#/${i.route}" data-route="${i.route}" aria-label="${i.label}">${icon(i.icon)}<span class="label">${i.label}</span></a>`).join('')}
    <div class="nav-extras">
      <button class="btn btn-sm" id="nav-install" hidden>${icon('install')} Install app</button>
      <button class="btn btn-ghost" id="nav-settings">${icon('settings')} Settings</button>
    </div>`;
  blob = nav.querySelector('.nav-blob');
  nav.querySelector('#nav-settings').addEventListener('click', () => openSettings());
  const inst = nav.querySelector('#nav-install');
  inst.addEventListener('click', () => promptInstall());
  const sync = () => { inst.hidden = !canInstall(); };
  window.addEventListener('pwa:installable', sync); window.addEventListener('pwa:changed', sync);
  window.addEventListener('resize', () => requestAnimationFrame(positionBlob));
}
function positionBlob() {
  const active = nav?.querySelector('.nav-item[aria-current="page"]');
  if (!active || active.classList.contains('is-home') || getComputedStyle(blob).display === 'none') { if (blob) blob.style.opacity = '0'; return; }
  const n = nav.getBoundingClientRect(); const a = active.getBoundingClientRect();
  blob.style.opacity = '1'; blob.style.width = `${a.width - 6}px`; blob.style.transform = `translateX(${a.left - n.left + 3}px)`;
}
export function setActive(route) {
  nav?.querySelectorAll('.nav-item').forEach((a) => { if (a.dataset.route === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  requestAnimationFrame(positionBlob);
}
