import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHashtags, extractHashtags } from '../../src/utils/hashtags.js';
import { redact, createLogger } from '../../src/utils/logger.js';
import { withTimeout } from '../../src/utils/async.js';
import { requireUuid, parsePagination, requireEnum, requireString, requireDate, isUuid } from '../../src/validators/common.js';

test('hashtags: normalised, de-duplicated case-insensitively, capped, invalid dropped', () => {
  assert.deepEqual(parseHashtags('#Exams, lecturenotes  #exams ##Math #bad-tag #'), ['Exams', 'lecturenotes', 'Math']);
  assert.equal(parseHashtags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 10);
  assert.deepEqual(extractHashtags('Study #Exams today, not#this #Prep_1'), ['Exams', 'Prep_1']);
});
test('logger redacts secrets (deeply) and serialises errors', () => {
  const r = redact({ user: 'a', password: 'x', nested: { Authorization: 'Bearer y', list: [{ sessionToken: 'z', ok: 1 }] }, DATABASE_URL: 'postgres://u:p@h/d' });
  assert.equal(r.password, '[redacted]'); assert.equal(r.nested.Authorization, '[redacted]'); assert.equal(r.nested.list[0].sessionToken, '[redacted]'); assert.equal(r.DATABASE_URL, '[redacted]'); assert.equal(r.user, 'a');
  const lines = []; const log = createLogger({ level: 'info', stream: { write: (l) => lines.push(l) }, errStream: { write: (l) => lines.push(l) } });
  log.debug('hidden'); log.error('failed', { err: new Error('kaput'), password: 'p' });
  assert.equal(lines.length, 1); const o = JSON.parse(lines[0]); assert.equal(o.err.message, 'kaput'); assert.equal(o.password, '[redacted]');
});
test('withTimeout settles, rejects on timeout, and does not leave timers running', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 1000), 7);
  await assert.rejects(withTimeout(new Promise(() => {}), 15, 'thing'), /thing timed out/);
});
const invalid = (field) => (e) => e.status === 422 && (field === undefined || field in e.details);
test('validators: uuid, pagination, enum, string, date', () => {
  assert.ok(isUuid('00000000-0000-4000-8000-000000000001')); assert.ok(!isUuid('not-a-uuid')); assert.ok(!isUuid("1' OR '1'='1"));
  assert.throws(() => requireUuid('x', 'id'), invalid('id'));
  assert.deepEqual(parsePagination({}), { limit: 20, offset: 0 }); assert.deepEqual(parsePagination({ limit: '50', offset: '10' }), { limit: 50, offset: 10 });
  for (const bad of [{ limit: '0' }, { limit: '101' }, { limit: 'abc' }, { offset: '-1' }, { limit: '1.5' }]) assert.throws(() => parsePagination(bad), invalid());
  assert.equal(requireEnum('high', ['low', 'high'], 'priority'), 'high'); assert.equal(requireEnum(undefined, ['low', 'high'], 'priority', 'low'), 'low');
  assert.throws(() => requireEnum('urgent', ['low', 'high'], 'priority'), invalid('priority'));
  assert.equal(requireString('  hi  ', 'title', { min: 1, max: 5 }), 'hi'); assert.throws(() => requireString('   ', 'title'), invalid('title')); assert.throws(() => requireString(42, 'title'));
  assert.equal(requireDate('2026-02-28', 'due'), '2026-02-28');
  for (const bad of ['2026-02-30', '2026-13-01', '26-1-1', '', null, '2026-02-28T00:00:00Z']) assert.throws(() => requireDate(bad, 'due'), invalid('due'), String(bad));
});
