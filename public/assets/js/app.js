// App shell bootstrap: navigation, router, FAB, settings button, PWA registration.
import { renderNav, setActive } from './components/navigation.js';
import { startRouter, ROUTES, navigate } from './router.js';
import { openSettings } from './components/settings-drawer.js';
import { initPWA } from './components/pwa.js';
import { icon } from './components/icons.js';
import { storage } from './storage.js';
import * as authClient from './auth-client.js';

const view = document.getElementById('view');
const main = document.getElementById('main');
const fab = document.getElementById('fab');

// Auth gate: with a real API, signed-out visitors go to the sign-in page and admin sessions go to /admin.
// With no API (static preview) the app runs in demo mode exactly like Phase 1.
const session = await authClient.getSession();
if (session.mode === 'live' && !session.authenticated) { location.replace('/login.html'); await new Promise(() => {}); }
if (session.mode === 'live' && session.sessionKind === 'admin') { location.replace('/admin/'); await new Promise(() => {}); }

initPWA();
renderNav(document.getElementById('nav'));
document.getElementById('open-settings').addEventListener('click', () => openSettings());
document.getElementById('open-settings').innerHTML = icon('settings');

/** Pages call ctx.setFab({label, icon, onClick}) to show the floating plus button; it is cleared on every route change. */
function setFab(cfg) {
  if (!cfg) { fab.hidden = true; fab.onclick = null; return; }
  fab.innerHTML = icon(cfg.icon || 'plus'); fab.setAttribute('aria-label', cfg.label); fab.title = cfg.label;
  fab.onclick = cfg.onClick; fab.hidden = false;
}

startRouter({
  view,
  ctxFactory: () => ({ navigate, setFab }),
  onRoute(route) {
    setActive(route); setFab(null);
    document.title = `${ROUTES[route].title} · Student Hub (prototype)`;
    window.scrollTo(0, 0);
    requestAnimationFrame(() => main.focus({ preventScroll: true }));
  },
});

// Sensible first-run hint: the whole app is a demo.
if (!storage.get('seenDemoNote', false)) { storage.set('seenDemoNote', true); }
