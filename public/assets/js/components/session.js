// Sign-out flow shared by Account and Settings. Phase 1 only clears local prototype data;
// Phase 3 must also revoke the server session and clear any per-user caches.
import { api } from '../api.js';
import { storage } from '../storage.js';
import { confirmDialog } from './modal.js';

export async function clearUserCaches() {
  try { const keys = await caches.keys(); await Promise.all(keys.filter((k) => k.startsWith('studenthub-runtime')).map((k) => caches.delete(k))); } catch { /* no Cache API */ }
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_USER_CACHES' });
}
export async function confirmSignOut() {
  const ok = await confirmDialog({
    title: 'Sign out of the demo?',
    message: 'This clears drafts and preferences stored on this device by the prototype so the next person using a shared device cannot see them. No real session exists yet.',
    confirmLabel: 'Sign out', danger: true,
  });
  if (!ok) return false;
  await api.signOut().catch(() => {});
  storage.clearAll(['theme']);
  await clearUserCaches();
  location.href = '/login.html?signedout=1';
  return true;
}
