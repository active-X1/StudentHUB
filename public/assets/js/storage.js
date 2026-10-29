// Non-sensitive prototype preferences and local drafts ONLY (theme, notification toggles, form drafts).
// Never store passwords, tokens, or private production data here. Everything is namespaced and clearable on sign-out.
const PREFIX = 'studenthub.proto.';

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

export const storage = {
  get(key, fallback = null) {
    return safe(() => {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    }, fallback);
  },
  set(key, value) { return safe(() => { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }, false); },
  remove(key) { safe(() => localStorage.removeItem(PREFIX + key)); },
  /** Remove everything this prototype stored on the device (used by sign-out and "clear local data"). */
  clearAll(keep = []) {
    safe(() => {
      Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && !keep.includes(k.slice(PREFIX.length)))
        .forEach((k) => localStorage.removeItem(k));
    });
  },
  // Drafts are "saved on this device" only — never synced to an account in Phase 1.
  getDraft(name) { return this.get('draft.' + name, null); },
  saveDraft(name, data) { return this.set('draft.' + name, { savedAt: new Date().toISOString(), data }); },
  clearDraft(name) { this.remove('draft.' + name); },
};

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f3f5fa' : '#0a0e16');
  storage.set('theme', theme);
}
export function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'dark'; }
