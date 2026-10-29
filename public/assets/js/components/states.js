// Reusable loading / empty / error state markup.
import { icon } from './icons.js';
import { esc } from './util.js';

export const skeletonCards = (n = 3, h = 110) => `<div class="stack" aria-busy="true" aria-label="Loading">${Array.from({ length: n }, () => `<div class="skeleton" style="height:${h}px"></div>`).join('')}</div>`;
export function emptyState({ ico = 'inbox', title, text = '', actionLabel = '', actionId = 'empty-action' }) {
  return `<div class="state">${icon(ico)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${actionLabel ? `<button class="btn btn-sm" id="${actionId}">${esc(actionLabel)}</button>` : ''}</div>`;
}
export function errorState(message = 'Could not load this content.') {
  return `<div class="state error" role="alert">${icon('alert')}<h3>Something went wrong</h3><p>${esc(message)}</p><button class="btn btn-sm" id="retry">${icon('refresh')} Try again</button></div>`;
}
export const demoBanner = (text) => `<div class="demo-banner" role="note">${icon('info', 'width="18" height="18" style="flex:none;margin-top:2px"')}<span>${text}</span></div>`;
