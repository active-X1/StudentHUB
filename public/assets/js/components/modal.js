// Accessible modal / bottom sheet with focus trap, Escape handling and focus restore.
import { esc } from './util.js';
import { icon } from './icons.js';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let locks = 0;

export function trapFocus(container, e) {
  if (e.key !== 'Tab') return;
  const items = [...container.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0]; const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
/** Reference-counted: the app behind modals/drawers is inert while at least one is open. */
export function lockBackground() { locks += 1; document.getElementById('app')?.setAttribute('inert', ''); document.body.style.overflow = 'hidden'; }
export function unlockBackground() { locks = Math.max(0, locks - 1); if (!locks) { document.getElementById('app')?.removeAttribute('inert'); document.body.style.overflow = ''; } }

/**
 * openModal({ title, content: string|Node, actions: [{label, variant, onClick(ctx) -> false to keep open}], onClose })
 * Returns { el, body, close }.
 */
export function openModal({ title, content, actions = [], onClose, labelledBy = 'modal-title' } = {}) {
  const previous = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${labelledBy}">
      <div class="modal-head"><h2 id="${labelledBy}">${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close dialog">${icon('close')}</button></div>
      <div class="modal-body"></div>
      ${actions.length ? '<div class="modal-actions"></div>' : ''}
    </div>`;
  const dialog = overlay.firstElementChild;
  const body = overlay.querySelector('.modal-body');
  if (typeof content === 'string') body.innerHTML = content; else if (content) body.appendChild(content);

  let closed = false;
  const ctx = { el: overlay, body, close };
  function close(result) {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    unlockBackground();
    previous?.focus?.();
    onClose?.(result);
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close('escape'); } else trapFocus(dialog, e);
  }
  const bar = overlay.querySelector('.modal-actions');
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `btn ${a.variant ? 'btn-' + a.variant : ''}`; b.textContent = a.label;
    if (a.id) b.id = a.id;
    b.addEventListener('click', async () => { if ((await a.onClick?.(ctx)) !== false) close(a.value ?? a.label); });
    bar.appendChild(b);
  });
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close('overlay'); });
  overlay.querySelector('[data-close]').addEventListener('click', () => close('close'));
  document.body.appendChild(overlay);
  lockBackground();
  document.addEventListener('keydown', onKey, true);
  (overlay.querySelector('[autofocus]') || overlay.querySelector('.modal-body ' + FOCUSABLE.split(',').join(', .modal-body ')) || overlay.querySelector('[data-close]')).focus();
  return ctx;
}

/** Promise-based confirm dialog. Resolves true when confirmed. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    openModal({
      title, content: `<p class="muted">${message}</p>`, labelledBy: 'confirm-title',
      actions: [
        { label: 'Cancel', onClick: () => { answer = false; } },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => { answer = true; } },
      ],
      onClose: () => resolve(answer),
    });
  });
}
