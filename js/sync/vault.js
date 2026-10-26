// The optional sync password (phase 8; owner 2026-10-22, made optional
// 2026-10-26). vault.json in the cloud folder says which way the folder is
// kept: { mode: 'plain' } (no password: files are compressed JSON) or a
// password folder (no mode, v1): a sync password -> key (PBKDF2-SHA-256, 600 000 rounds,
// random salt) -> each file is AES-256-GCM with its own random IV. Dropbox
// only ever stores scrambled bytes. `vault.json` (salt + an encrypted check
// value) lets a second device verify the passphrase. The key is kept on the
// device as a non-extractable CryptoKey (the passphrase itself is not stored).
import { toBase64, fromBase64 } from '../services/backup.js';

export const VAULT_ITERATIONS = 600000;
export const MIN_PASSPHRASE = 8;
const CHECK = 'SlimeGate vault OK';
const enc = new TextEncoder();
const dec = new TextDecoder();

async function derive(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Bytes -> [12-byte IV | ciphertext].
export async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function open(key, bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u.length < 13) throw new Error('Damaged sync file');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12)));
}

const gz = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
const canGzip = () => typeof CompressionStream === 'function';

// JSON <-> bytes: compressed when the browser can (first byte says how:
// 1 = gzip, 0 = as is); with a key also locked (sealJson / openJson).
export async function packJson(obj) {
  let bytes = enc.encode(JSON.stringify(obj));
  const z = canGzip();
  if (z) bytes = await gz(bytes, new CompressionStream('gzip'));
  const body = new Uint8Array(bytes.length + 1);
  body[0] = z ? 1 : 0;
  body.set(bytes, 1);
  return body;
}
export async function unpackJson(body) {
  let bytes = body.subarray(1);
  if (body[0] === 1) bytes = await gz(bytes, new DecompressionStream('gzip'));
  return JSON.parse(dec.decode(bytes));
}
export async function sealJson(key, obj) { return seal(key, await packJson(obj)); }
export async function openJson(key, sealed) { return unpackJson(await open(key, sealed)); }

// What sync uses: key = null means a folder without a password.
export const encodeJson = (key, obj) => (key ? sealJson(key, obj) : packJson(obj));
export const decodeJson = (key, bytes) => (key ? openJson(key, bytes) : unpackJson(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));

// vault.json for a folder without a password.
export const plainVault = () => ({ app: 'SlimeGate', v: 2, mode: 'plain' });
export const vaultMode = file => (file && file.mode === 'plain' ? 'plain' : 'password');

// A new vault for a passphrase: { file (to upload as vault.json), key }.
export async function createVault(passphrase, { iterations = VAULT_ITERATIONS, min = MIN_PASSPHRASE } = {}) {
  if (String(passphrase).length < min) throw new Error('Use at least ' + min + ' characters');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(passphrase, salt, iterations);
  const check = await seal(key, enc.encode(CHECK));
  return { key, file: { app: 'SlimeGate', v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) }, check: toBase64(check) } };
}

// The key for an existing vault, or null if the passphrase is wrong.
export async function unlockVault(file, passphrase) {
  if (!file || !file.kdf || file.kdf.name !== 'PBKDF2' || !file.check) throw new Error('The sync folder is damaged (vault.json)');
  const it = file.kdf.iterations;
  if (!(it >= 10000 && it <= 10000000)) throw new Error('Unknown vault settings');
  const key = await derive(passphrase, fromBase64(file.kdf.salt), it);
  try {
    const ok = dec.decode(await open(key, fromBase64(file.check)));
    return ok === CHECK ? key : null;
  } catch (_) {
    return null;
  }
}
