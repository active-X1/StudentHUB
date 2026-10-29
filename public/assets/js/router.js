// Hash router (#/route?query). Works on any static host and under Express (Express only needs to serve index.html at "/").
// Each page module exports: render(container, ctx) -> optional cleanup function.
export const ROUTES = {
  home: { title: 'Home', load: () => import('./pages/home.js') },
  feeds: { title: 'Feeds', load: () => import('./pages/feeds.js') },
  'my-assignments': { title: 'My Assignments', load: () => import('./pages/my-assignments.js') },
  'general-assignments': { title: 'General Assignments', load: () => import('./pages/general-assignments.js') },
  account: { title: 'Account', load: () => import('./pages/account.js') },
};

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const route = ROUTES[path] ? path : 'home';
  return { route, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export function navigate(route, query = {}) {
  const qs = new URLSearchParams(query).toString();
  location.hash = `#/${route}${qs ? `?${qs}` : ''}`;
}
/** Update the URL query without re-rendering the page (used by in-page filters). */
export function replaceQuery(route, query) {
  const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v));
  const qs = new URLSearchParams(clean).toString();
  history.replaceState(null, '', `${location.pathname}#/${route}${qs ? `?${qs}` : ''}`);
}

export function startRouter({ view, ctxFactory, onRoute }) {
  let cleanup; let token = 0;
  async function render() {
    const my = ++token; const { route, query } = parseHash();
    try { cleanup?.(); } catch (e) { console.error(e); }
    cleanup = undefined;
    onRoute?.(route);
    // A fresh container per render: pages attach listeners to their root, and reusing one element would leak
    // handlers from earlier pages (stale handlers firing on later pages, or doubling up on revisits).
    const container = document.createElement('div');
    view.replaceChildren(container);
    try {
      const mod = await ROUTES[route].load();
      if (my !== token) return;
      cleanup = await mod.render(container, { ...ctxFactory(route), query });
    } catch (err) {
      console.error(err);
      container.innerHTML = `<div class="state error" role="alert"><h3>Something went wrong</h3><p>This page failed to load.</p><button class="btn" id="reload-btn">Reload</button></div>`;
      container.querySelector('#reload-btn').addEventListener('click', () => location.reload());
    }
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('proto:refresh', render);
  render();
}
