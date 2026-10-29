// Prototype file picker. Files are only held in browser memory for preview; NOTHING is uploaded or persisted.
// Client-side checks are for user feedback only — the backend MUST validate content, size and ownership.
import { esc, fmtSize } from './util.js';
import { icon } from './icons.js';

export const ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.doc,.docx';
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 5;
const OK_EXT = ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx'];
const ext = (n) => n.split('.').pop().toLowerCase();
export const isImage = (f) => /^image\//.test(f.type) || ['jpg', 'jpeg', 'png', 'webp'].includes(ext(f.name));

export function thumbHTML(f) {
  return `<span class="file-thumb">${f.url && isImage(f) ? `<img src="${f.url}" alt="">` : icon(isImage(f) ? 'image' : 'file')}</span>`;
}
/** Read-only attachment chips for already-"saved" items (metadata only). */
export function attachmentsHTML(list = []) {
  if (!list.length) return '';
  return `<div class="attach-row">${list.map((f) => `<span class="attach" title="${esc(f.name)}">${thumbHTML(f)}<span>${esc(f.name)}${f.size ? ` · ${fmtSize(f.size)}` : ''}</span></span>`).join('')}</div>`;
}

export function createFilePicker({ initial = [], onChange } = {}) {
  let files = [...initial]; // {name,size,type,url?}
  const el = document.createElement('div');
  el.innerHTML = `
    <label class="dropzone" tabindex="0">
      ${icon('upload')}<strong>Add images or documents</strong>
      <small class="muted">JPEG, PNG, WebP, PDF, DOC, DOCX · up to ${MAX_FILES} files, ${MAX_BYTES / 1048576} MB each</small>
      <input type="file" class="sr-only" multiple accept="${ACCEPT}" tabindex="-1">
    </label>
    <p class="hint faint" style="font-size:var(--fs-xs);margin-top:6px">Prototype: files are previewed in your browser only and are <b>not uploaded or saved</b>. Real validation happens on the server in a later phase.</p>
    <div class="alert error" role="alert" hidden></div>
    <ul class="file-list" aria-label="Selected files"></ul>`;
  const input = el.querySelector('input'); const zone = el.querySelector('.dropzone');
  const list = el.querySelector('.file-list'); const err = el.querySelector('.alert');

  function paint() {
    list.innerHTML = files.map((f, i) => `<li class="file-item">${thumbHTML(f)}<div class="file-meta"><strong>${esc(f.name)}</strong><small>${fmtSize(f.size)}</small></div>
      <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove ${esc(f.name)}">${icon('close')}</button></li>`).join('');
    onChange?.(files);
  }
  function add(fileList) {
    const problems = [];
    for (const f of fileList) {
      if (files.length >= MAX_FILES) { problems.push(`Maximum ${MAX_FILES} files.`); break; }
      if (!OK_EXT.includes(ext(f.name))) { problems.push(`“${f.name}” is not a supported type.`); continue; }
      if (f.size > MAX_BYTES) { problems.push(`“${f.name}” is larger than ${MAX_BYTES / 1048576} MB.`); continue; }
      files.push({ name: f.name, size: f.size, type: f.type, url: isImage(f) ? URL.createObjectURL(f) : undefined });
    }
    err.hidden = !problems.length; err.textContent = problems.join(' ');
    paint();
  }
  input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => add([...e.dataTransfer.files]));
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    const [f] = files.splice(Number(b.dataset.rm), 1);
    if (f?.url && !initial.includes(f)) URL.revokeObjectURL(f.url);
    paint();
  });
  paint();
  return { el, getFiles: () => files, reset() { files = []; paint(); } };
}
