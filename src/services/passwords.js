// Password hashing (scrypt from Node's crypto: no native dependency) and password policy.
// Format: $scrypt$n=32768,r=8,p=3$<salt b64>$<hash b64>. Parameters live in the hash, so they can be raised later
// (needsRehash() tells the login flow to upgrade a hash after a successful sign-in).
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
// OWASP-listed scrypt profile (32 MiB). Raise N as hardware allows; tests pass cheaper params explicitly.
export const DEFAULT_PARAMS = Object.freeze({ N: 32768, r: 8, p: 3 });
const KEYLEN = 32; const SALT_LEN = 16; const MAX_N = 1 << 20;
const normalize = (pw) => String(pw).normalize('NFKC');

export async function hashPassword(password, params = DEFAULT_PARAMS) {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = await scrypt(normalize(password), salt, KEYLEN, { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r });
  return `$scrypt$n=${params.N},r=${params.r},p=${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
function parse(stored) {
  const m = /^\$scrypt\$n=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(String(stored ?? ''));
  if (!m) return null;
  const [N, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (N < 1024 || N > MAX_N || (N & (N - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 16) return null; // sanity-bound untrusted parameters
  return { N, r, p, salt: Buffer.from(m[4], 'base64'), hash: Buffer.from(m[5], 'base64') };
}
export async function verifyPassword(password, stored) {
  const h = parse(stored);
  if (!h || typeof password !== 'string') return false;
  const key = await scrypt(normalize(password), h.salt, h.hash.length, { N: h.N, r: h.r, p: h.p, maxmem: 256 * h.N * h.r });
  return key.length === h.hash.length && crypto.timingSafeEqual(key, h.hash);
}
export function needsRehash(stored, params = DEFAULT_PARAMS) {
  const h = parse(stored);
  return !h || h.N < params.N || h.r < params.r || h.p < params.p;
}
/** Verifying against this when the account does not exist keeps response time similar for known and unknown users. */
let dummy;
export function dummyHash(params = DEFAULT_PARAMS) { dummy ??= hashPassword(crypto.randomBytes(16).toString('hex'), params); return dummy; }

const COMMON = new Set(['password', 'password1', 'password12', 'password123', 'passw0rd', 'qwerty123', 'qwertyuiop', 'letmein123', 'welcome123', 'admin123', 'administrator',
  'iloveyou123', 'abc123456', '1q2w3e4r5t', '123456789', '1234567890', '12345678910', 'changeme123', 'studenthub', 'student123', 'university1', 'computer123', 'football123', 'monkey1234']);

export const MIN_LENGTH = { user: 10, admin: 14 }; export const MAX_LENGTH = 128;

/**
 * Returns a list of human-readable problems (empty = acceptable). `identifiers` are values the password must not contain
 * (email local part, username, name words). kind "admin" has a longer minimum.
 */
export function validatePassword(password, { kind = 'user', identifiers = [] } = {}) {
  const problems = [];
  if (typeof password !== 'string') return ['Password is required.'];
  const min = MIN_LENGTH[kind] ?? MIN_LENGTH.user;
  if ([...password].length < min) problems.push(`Use at least ${min} characters.`);
  if (password.length > MAX_LENGTH) problems.push(`Use at most ${MAX_LENGTH} characters.`);
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) problems.push('Mix at least three of: lower case, upper case, numbers, symbols.');
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) problems.push('This password is too common.');
  for (const id of identifiers) { const s = String(id ?? '').toLowerCase(); if (s.length >= 4 && lower.includes(s)) { problems.push('Do not include your name, username or email in your password.'); break; } }
  return problems;
}
