// One-time creation of the initial administrator. Run from the command line (never from the web).
// The password comes from the environment/stdin, is validated against the admin policy, hashed with scrypt, and never logged.
import { USERNAME_RE } from './auth.js';
import * as defaultHasher from './passwords.js';

export async function bootstrapAdmin({ store, username = 'admin', password, email = null, hasher = defaultHasher, hasherParams }) {
  const name = String(username).trim().toLowerCase();
  if (!USERNAME_RE.test(name)) throw new Error('ADMIN_BOOTSTRAP_USERNAME must be 3-32 characters: lowercase letters, digits, dot, underscore or hyphen.');
  if (!password) throw new Error('No password supplied. Set ADMIN_BOOTSTRAP_PASSWORD or pipe it in with --password-stdin.');
  const problems = hasher.validatePassword(password, { kind: 'admin', identifiers: [name, email?.split('@')[0]] });
  if (problems.length) throw new Error(`Admin password rejected: ${problems.join(' ')}`);
  if (await store.countAdmins() > 0) return { created: false, reason: 'An administrator already exists. Nothing was changed.' };
  const user = await store.createUser({
    username: name, email: email ? String(email).trim().toLowerCase() : null, displayName: 'Administrator',
    passwordHash: await hasher.hashPassword(password, hasherParams ?? hasher.DEFAULT_PARAMS), role: 'admin',
    mustChangePassword: true, // forced change on first sign-in
  });
  await store.writeAudit({ actorId: user.id, actorLabel: 'bootstrap-cli', action: 'Initial administrator created', entityType: 'user', entityId: user.id });
  return { created: true, username: name };
}
