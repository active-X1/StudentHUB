// Tiny JSON-lines logger with secret redaction. Logs to stdout/stderr so the platform can collect them.
const ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /(pass(word)?|secret|token|authorization|cookie|api[-_]?key|database[-_]?url|session|credential)/i;

export function redact(value, depth = 0) {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1);
  return out;
}
export function createLogger({ level = 'info', stream = process.stdout, errStream = process.stderr, base = {} } = {}) {
  const min = ORDER[level] ?? ORDER.info;
  const write = (lvl, msg, fields = {}) => {
    if (ORDER[lvl] < min) return;
    const f = fields instanceof Error ? { err: fields } : fields;
    const line = JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...base, ...redact(f) });
    (ORDER[lvl] >= ORDER.warn ? errStream : stream).write(`${line}\n`);
  };
  return { debug: (m, f) => write('debug', m, f), info: (m, f) => write('info', m, f), warn: (m, f) => write('warn', m, f), error: (m, f) => write('error', m, f) };
}
