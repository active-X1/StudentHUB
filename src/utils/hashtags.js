// Hashtag normalisation shared by validators and (later) services. Mirrors the DB check on hashtags.name.
export const HASHTAG_RE = /^[A-Za-z0-9_]{1,50}$/;
export const MAX_TAGS = 10;

/** "#Exams, lecturenotes  #exams" -> ["Exams", "lecturenotes"] (case-insensitive de-duplication, first spelling kept). */
export function parseHashtags(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[\s,]+/);
  const seen = new Map();
  for (const item of raw) {
    const t = String(item).trim().replace(/^#+/, '');
    if (HASHTAG_RE.test(t) && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].slice(0, MAX_TAGS);
}
/** Extracts #tags from free text. */
export function extractHashtags(text) { return parseHashtags([...String(text ?? '').matchAll(/(?:^|\s)#([A-Za-z0-9_]{1,50})\b/g)].map((m) => m[1])); }
