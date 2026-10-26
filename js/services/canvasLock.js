// Canvas passwords (owner 2026-10-26): a canvas may have a password. It
// protects the canvas's copies — its save files, its JSON export (asked
// first) and its cloud copy — not the canvas on a device that already has
// it open. The canvas keeps only a "lock": the salt + strength + a check
// value (never the password); each device keeps the key it unlocked
// (persist/canvasKeys.js). Same scheme as the sync files: PBKDF2-SHA-256
// 600 000 -> AES-256-GCM.
import { createVault, unlockVault, open } from '../sync/vault.js';
import { fromBase64 } from './backup.js';

export const MIN_PASSWORD = 6;

// { lock, key } for a new password.
export async function makeLock(password, opts = {}) {
  const { key, file } = await createVault(password, { min: MIN_PASSWORD, ...opts });
  return { key, lock: { v: 1, kdf: file.kdf, check: file.check } };
}

// The key for this lock, or null if the password is wrong.
export const unlockWith = (lock, password) => unlockVault(lock, password);

// Does this key open this lock (e.g. after the password was changed elsewhere)?
export async function keyFits(lock, key) {
  if (!lock || !key) return false;
  try { await open(key, fromBase64(lock.check)); return true; } catch (_) { return false; }
}

export function isLock(l) {
  return !!(l && typeof l === 'object' && l.kdf && l.kdf.name === 'PBKDF2' && typeof l.kdf.salt === 'string' && typeof l.check === 'string' && l.kdf.iterations >= 10000 && l.kdf.iterations <= 10000000);
}
