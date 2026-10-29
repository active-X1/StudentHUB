// Small, dependency-free validation helpers used by controllers. Every helper throws a 422 AppError with
// field-level details so clients get consistent error shapes. Validation here is the SERVER's job;
// frontend checks are only for user feedback.
import { validationError } from '../utils/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export function requireUuid(value, field = 'id') {
  if (!isUuid(value)) throw validationError({ [field]: 'Must be a valid UUID.' });
  return value.toLowerCase();
}
/** ?limit=&offset= with sane bounds. Returns integers. */
export function parsePagination(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const errors = {};
  const num = (raw, name, min, max, def) => {
    if (raw === undefined || raw === '') return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) { errors[name] = `Must be an integer between ${min} and ${max}.`; return def; }
    return n;
  };
  const limit = num(query.limit, 'limit', 1, maxLimit, defaultLimit);
  const offset = num(query.offset, 'offset', 0, 100000, 0);
  if (Object.keys(errors).length) throw validationError(errors);
  return { limit, offset };
}
export function requireEnum(value, allowed, field, fallback) {
  if ((value === undefined || value === '') && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) throw validationError({ [field]: `Must be one of: ${allowed.join(', ')}.` });
  return value;
}
export function requireString(value, field, { min = 1, max = 1000, trim = true } = {}) {
  const s = typeof value === 'string' ? (trim ? value.trim() : value) : '';
  if (s.length < min || s.length > max) throw validationError({ [field]: `Must be between ${min} and ${max} characters.` });
  return s;
}
export const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function requireDate(value, field) {
  if (typeof value !== 'string' || !DUE_DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw validationError({ [field]: 'Must be a real date in YYYY-MM-DD format.' });
  }
  return value;
}
