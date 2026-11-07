// Request validation for assignments. Only whitelisted fields are ever read, so extra fields in a request body
// (userId, id, status of someone else's row, createdBy ...) are ignored: there is no mass-assignment path.
import { validationError } from '../utils/errors.js';
import { HASHTAG_RE, MAX_TAGS } from '../utils/hashtags.js';
import { parsePagination, requireDate, requireEnum, requireString } from './common.js';

export const PRIORITIES = ['low', 'medium', 'high'];
export const PERSONAL_STATUSES = ['todo', 'in-progress', 'done'];
export const GENERAL_STATUSES = ['draft', 'published', 'unpublished'];
export const PERSONAL_SORTS = ['due', 'priority', 'title', 'created'];
export const GENERAL_SORTS = ['deadline', 'published', 'title'];

/** Accepts ["#Exams", "exams"] or "#Exams, exams"; rejects invalid entries instead of silently dropping them. */
export function parseTagsStrict(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[\s,]+/);
  const seen = new Map(); const bad = [];
  for (const item of raw) {
    const t = String(item).trim().replace(/^#+/, ''); if (!t) continue;
    if (!HASHTAG_RE.test(t)) { bad.push(String(item).slice(0, 30)); continue; }
    if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  if (bad.length) throw validationError({ tags: `Hashtags may contain only letters, numbers and underscores (invalid: ${bad.join(', ')}).` });
  if (seen.size > MAX_TAGS) throw validationError({ tags: `Use at most ${MAX_TAGS} hashtags.` });
  return [...seen.values()];
}
const has = (o, k) => Object.hasOwn(o, k);
const longText = (v, field, max) => { if (v == null || v === '') return ''; if (typeof v !== 'string' || v.length > max) throw validationError({ [field]: `Must be text of at most ${max} characters.` }); return v; };
const optionalText = (v, field, max) => { if (v === null || v === undefined || v === '') return null; return requireString(v, field, { min: 1, max }); };
const body = (b) => (b && typeof b === 'object' && !Array.isArray(b) ? b : {});

/** Collects field errors so a form shows everything wrong at once. */
function collect(rules) {
  const errors = {}; const out = {};
  for (const [key, fn] of rules) { try { const v = fn(); if (v !== undefined) out[key] = v; } catch (e) { if (e.details) Object.assign(errors, e.details); else throw e; } }
  if (Object.keys(errors).length) throw validationError(errors);
  return out;
}

/** Runs field rules and the tag parser together so ONE response lists every problem. */
function finish(rules, tagsFn) {
  const errors = {}; let patch = {}; let tags;
  const guard = (fn) => { try { return fn(); } catch (e) { if (!e.details) throw e; Object.assign(errors, e.details); return undefined; } };
  patch = guard(() => collect(rules)) ?? {}; tags = guard(tagsFn);
  if (Object.keys(errors).length) throw validationError(errors);
  return { patch, tags };
}

/** create: all required fields must be present. partial (PATCH): only the fields present are validated. -> { patch, tags } */
export function parsePersonalInput(raw, { partial = false } = {}) {
  const b = body(raw); const need = (k, fn) => () => (has(b, k) || !partial ? fn() : undefined);
  return finish([
    ['title', need('title', () => requireString(b.title, 'title', { min: 1, max: 120 }))],
    ['description', need('description', () => longText(b.description, 'description', 1000))],
    ['course', need('course', () => requireString(b.course, 'course', { min: 1, max: 120 }))],
    ['lecturer', () => (has(b, 'lecturer') ? optionalText(b.lecturer, 'lecturer', 120) : (partial ? undefined : null))],
    ['dueDate', need('dueDate', () => requireDate(b.dueDate, 'dueDate'))],
    ['priority', need('priority', () => requireEnum(b.priority, PRIORITIES, 'priority', 'medium'))],
    ['status', need('status', () => requireEnum(b.status, PERSONAL_STATUSES, 'status', 'todo'))],
  ], () => (has(b, 'tags') ? parseTagsStrict(b.tags) : (partial ? undefined : [])));
}
export function parseGeneralInput(raw, { partial = false } = {}) {
  const b = body(raw); const need = (k, fn) => () => (has(b, k) || !partial ? fn() : undefined);
  return finish([
    ['title', need('title', () => requireString(b.title, 'title', { min: 1, max: 160 }))],
    ['course', need('course', () => requireString(b.course, 'course', { min: 1, max: 120 }))],
    ['category', need('category', () => (b.category == null || b.category === '' ? 'Coursework' : requireString(b.category, 'category', { min: 1, max: 60 })))],
    ['description', need('description', () => longText(b.description, 'description', 4000))],
    ['dueDate', need('dueDate', () => requireDate(b.dueDate, 'dueDate'))],
    ['status', need('status', () => requireEnum(b.status, GENERAL_STATUSES, 'status', 'draft'))],
  ], () => (has(b, 'tags') ? parseTagsStrict(b.tags) : (partial ? undefined : [])));
}

const text = (v, field, max) => (v === undefined || v === '' ? null : requireString(v, field, { min: 1, max }));
function queryCommon(q, sorts, defaultSort) {
  const errors = {}; const out = {};
  try { Object.assign(out, parsePagination(q, { defaultLimit: 50, maxLimit: 200 })); } catch (e) { Object.assign(errors, e.details); }
  try { out.sort = requireEnum(q.sort, sorts, 'sort', defaultSort); } catch (e) { Object.assign(errors, e.details); }
  try { out.q = text(q.q, 'q', 100); } catch (e) { Object.assign(errors, e.details); }
  try { out.tag = q.tag === undefined || q.tag === '' ? null : (HASHTAG_RE.test(String(q.tag).replace(/^#/, '')) ? String(q.tag).replace(/^#/, '') : (() => { throw validationError({ tag: 'Invalid hashtag.' }); })()); } catch (e) { Object.assign(errors, e.details); }
  return { out, errors };
}
export function parsePersonalQuery(q = {}) {
  const { out, errors } = queryCommon(q, PERSONAL_SORTS, 'due');
  try { out.status = q.status === undefined || q.status === '' ? null : requireEnum(q.status, PERSONAL_STATUSES, 'status'); } catch (e) { Object.assign(errors, e.details); }
  if (Object.keys(errors).length) throw validationError(errors); return out;
}
export function parseGeneralQuery(q = {}, { admin = false } = {}) {
  const { out, errors } = queryCommon(q, GENERAL_SORTS, 'deadline');
  try { out.course = text(q.course, 'course', 120); } catch (e) { Object.assign(errors, e.details); }
  try { out.status = admin && q.status ? requireEnum(q.status, GENERAL_STATUSES, 'status') : null; } catch (e) { Object.assign(errors, e.details); }
  if (Object.keys(errors).length) throw validationError(errors); return out;
}
