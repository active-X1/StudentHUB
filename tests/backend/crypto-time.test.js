import test from 'node:test';
import assert from 'node:assert/strict';
import { nextLocalMidnight, startOfLocalDay } from '../../src/services/time.js';
import { newToken, sha256, safeEqual, csrfTokenFor, identifierHash, signValue, verifySigned } from '../../src/services/tokens.js';
import { hashPassword, verifyPassword, needsRehash, validatePassword, dummyHash } from '../../src/services/passwords.js';

const FAST = { N: 1024, r: 8, p: 1 };

test('nextLocalMidnight: UTC and fixed-offset zones', () => {
  assert.equal(nextLocalMidnight(new Date('2026-03-10T15:30:00Z'), 'UTC').toISOString(), '2026-03-11T00:00:00.000Z');
  assert.equal(nextLocalMidnight(new Date('2026-03-10T23:59:59Z'), 'UTC').toISOString(), '2026-03-11T00:00:00.000Z');
  // Lagos is UTC+1 all year: 23:30 UTC on the 10th is already 00:30 on the 11th locally, so the next midnight is the 12th local.
  assert.equal(nextLocalMidnight(new Date('2026-03-10T23:30:00Z'), 'Africa/Lagos').toISOString(), '2026-03-11T23:00:00.000Z');
  assert.equal(nextLocalMidnight(new Date('2026-03-10T10:00:00Z'), 'Africa/Lagos').toISOString(), '2026-03-10T23:00:00.000Z');
  assert.equal(nextLocalMidnight(new Date('2026-12-31T12:00:00Z'), 'UTC').toISOString(), '2027-01-01T00:00:00.000Z', 'year rollover');
  assert.equal(nextLocalMidnight(new Date('2028-02-28T12:00:00Z'), 'UTC').toISOString(), '2028-02-29T00:00:00.000Z', 'leap day');
});
test('nextLocalMidnight: DST transitions give 23h and 25h local days correctly', () => {
  // US spring forward 2026-03-08 (EST -> EDT): local midnight on the 9th is 04:00Z, the 8th starts at 05:00Z.
  assert.equal(nextLocalMidnight(new Date('2026-03-08T12:00:00Z'), 'America/New_York').toISOString(), '2026-03-09T04:00:00.000Z');
  assert.equal(startOfLocalDay(new Date('2026-03-08T12:00:00Z'), 'America/New_York').toISOString(), '2026-03-08T05:00:00.000Z');
  // US fall back 2026-11-01 (EDT -> EST): midnight on the 2nd is 05:00Z.
  assert.equal(nextLocalMidnight(new Date('2026-11-01T12:00:00Z'), 'America/New_York').toISOString(), '2026-11-02T05:00:00.000Z');
  // Southern hemisphere: Auckland moves to DST on 2026-09-27 (NZST +12 -> NZDT +13).
  assert.equal(nextLocalMidnight(new Date('2026-09-27T01:00:00Z'), 'Pacific/Auckland').toISOString(), '2026-09-27T11:00:00.000Z');
});
test('lockout is always strictly in the future and within 25 hours', () => {
  for (const tz of ['UTC', 'Africa/Lagos', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland']) {
    for (let h = 0; h < 24 * 400; h += 7) {
      const now = new Date(Date.UTC(2026, 0, 1) + h * 3600000); const next = nextLocalMidnight(now, tz);
      assert.ok(next > now && next - now <= 25 * 3600000, `${tz} ${now.toISOString()} -> ${next.toISOString()}`);
    }
  }
});

test('tokens: unique, hashed to 32 bytes, constant-time compare', () => {
  assert.notEqual(newToken(), newToken()); assert.ok(newToken().length >= 43);
  assert.equal(sha256('x').length, 32); assert.ok(safeEqual('abc', 'abc')); assert.ok(!safeEqual('abc', 'abd')); assert.ok(!safeEqual('abc', 'abcd'));
  assert.equal(csrfTokenFor('s', 'sess1'), csrfTokenFor('s', 'sess1')); assert.notEqual(csrfTokenFor('s', 'sess1'), csrfTokenFor('s', 'sess2')); assert.notEqual(csrfTokenFor('s', 'sess1'), csrfTokenFor('t', 'sess1'));
  assert.ok(identifierHash('k', ' Admin ').equals(identifierHash('k', 'admin')), 'normalised'); assert.ok(!identifierHash('k', 'a').equals(identifierHash('j', 'a')));
});
test('signed values: verify, tamper, expiry, malformed', () => {
  const t = signValue('secret', { state: 'abc', exp: Date.now() + 1000 });
  assert.equal(verifySigned('secret', t).state, 'abc');
  assert.equal(verifySigned('other', t), null);
  const [p, s] = t.split('.'); const forged = Buffer.from(JSON.stringify({ state: 'evil', exp: Date.now() + 1000 })).toString('base64url');
  assert.equal(verifySigned('secret', `${forged}.${s}`), null); assert.equal(verifySigned('secret', `${p}.x`), null);
  assert.equal(verifySigned('secret', signValue('secret', { exp: 1000 }), 2000), null, 'expired');
  for (const bad of [undefined, null, '', 'a', 'a.b.c', 42]) assert.equal(verifySigned('secret', bad), null);
});

test('passwords: hash/verify round trip, salted, rejects wrong and malformed', async () => {
  const h1 = await hashPassword('Correct-Horse-9', FAST); const h2 = await hashPassword('Correct-Horse-9', FAST);
  assert.notEqual(h1, h2, 'unique salts'); assert.match(h1, /^\$scrypt\$n=1024,r=8,p=1\$/);
  assert.ok(await verifyPassword('Correct-Horse-9', h1)); assert.ok(!await verifyPassword('correct-horse-9', h1)); assert.ok(!await verifyPassword('', h1));
  for (const bad of [null, undefined, '', 'plaintext', '$scrypt$n=3,r=8,p=1$AA==$AA==', '$scrypt$n=1073741824,r=8,p=1$AA==$AA==', '$2b$10$abc']) assert.ok(!await verifyPassword('x', bad), String(bad));
  assert.ok(await verifyPassword('pässword-ünïcode-1', await hashPassword('pa\u0308ssword-u\u0308nïcode-1', FAST)), 'NFKC-normalised');
});
test('passwords: rehash detection and dummy hash', async () => {
  const h = await hashPassword('Correct-Horse-9', FAST);
  assert.ok(needsRehash(h, { N: 2048, r: 8, p: 1 })); assert.ok(!needsRehash(h, FAST)); assert.ok(needsRehash('garbage'));
  assert.match(await dummyHash(FAST), /^\$scrypt\$/);
});
test('password policy', () => {
  assert.deepEqual(validatePassword('Tr0ub4dor&3xyz'), []);
  assert.ok(validatePassword('short1A!').some((p) => /at least 10/.test(p)));
  assert.ok(validatePassword('alllowercaseletters').some((p) => /three of/.test(p)));
  assert.ok(validatePassword('Password123').some((p) => /common/.test(p)), 'case-insensitive match against the common list');
  assert.ok(validatePassword('password123').some((p) => /common/.test(p)));
  assert.ok(validatePassword('Amara-Nwosu-2026!', { identifiers: ['amara.nwosu', 'Nwosu'] }).some((p) => /name, username or email/.test(p)));
  assert.ok(validatePassword('a'.repeat(129) + 'A1!').some((p) => /at most/.test(p)));
  assert.ok(validatePassword('Tr0ub4dor&3xy', { kind: 'admin' }).some((p) => /at least 14/.test(p))); assert.deepEqual(validatePassword('Tr0ub4dor&3xyzw', { kind: 'admin' }), []);
  assert.deepEqual(validatePassword(undefined), ['Password is required.']);
});
