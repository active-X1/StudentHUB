// PWA foundation: service-worker registration (localhost/HTTPS only) + install prompt handling.
let deferred = null;
export const canInstall = () => !!deferred;

export function initPWA() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; window.dispatchEvent(new Event('pwa:installable')); });
  window.addEventListener('appinstalled', () => { deferred = null; window.dispatchEvent(new Event('pwa:changed')); });
  // Service workers require HTTPS or localhost; file:// will not work.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('/service-worker.js').catch((err) => console.warn('Service worker registration failed:', err));
  }
}
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null; window.dispatchEvent(new Event('pwa:changed'));
  return outcome;
}
