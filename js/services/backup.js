// The app's own save file (phase 7, owner 2026-10-12): ".blobboard" —
// canvases + the tags they use + their pictures, packed as JSON, gzipped
// and encrypted with a password (PBKDF2-SHA-256 → AES-256-GCM, WebCrypto).
// Without the password the file can't be read. Opening one always adds new
// canvases (never overwrites). Files from outside are untrusted: everything
// is checked and repaired before it reaches the store.
//
// File = "BLOBBOARD-ENC1\n" + header JSON + "\n" + encrypted bytes.
// Header: { kdf: { name, hash, iterations, salt }, cipher: { name, iv }, gzip }.
import { sanitizeCanvas, sanitizeTag } from '../core/model.js';

export const MAGIC = 'BLOBBOARD-ENC1\n';
export const EXT = '.blobboard';
export const ITERATIONS = 600000;
export const FORMAT_VERSION = 1;
export const LIMITS = { canvases: 500, pictures: 5000, pictureBytes: 8 * 1024 * 1024, fileBytes: 1024 * 1024 * 1024, side: 4096 };
const PICTURE_TYPES = ['image/webp', 'image/png', 'image/jpeg'];

export class BackupError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}
export function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipeThrough(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
const canGzip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// obj -> Blob (the .blobboard file).
export async function encryptJson(obj, password, { iterations = ITERATIONS } = {}) {
  if (!password) throw new BackupError('password', 'A password is needed');
  let bytes = enc.encode(JSON.stringify(obj));
  const gzip = canGzip();
  if (gzip) bytes = await pipeThrough(bytes, new CompressionStream('gzip'));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const header = { kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) }, cipher: { name: 'AES-GCM', iv: toBase64(iv) }, gzip };
  return new Blob([MAGIC, JSON.stringify(header), '\n', data], { type: 'application/octet-stream' });
}

// Is this (ArrayBuffer / Uint8Array) one of our encrypted files?
export function isBackupFile(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return dec.decode(u.subarray(0, MAGIC.length)) === MAGIC;
}

// File bytes + password -> obj. Throws BackupError: 'format' (not ours /
// damaged header), 'password' (wrong password or damaged data).
export async function decryptFile(buf, password) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!isBackupFile(u)) throw new BackupError('format', 'This is not a BlobBoard save file');
  const nl = u.indexOf(10, MAGIC.length);
  if (nl < 0) throw new BackupError('format', 'The file is damaged');
  let header;
  try { header = JSON.parse(dec.decode(u.subarray(MAGIC.length, nl))); } catch (_) { throw new BackupError('format', 'The file is damaged'); }
  const it = header && header.kdf && header.kdf.iterations;
  if (!header.kdf || header.kdf.name !== 'PBKDF2' || header.kdf.hash !== 'SHA-256' || !(it >= 10000 && it <= 10000000)) throw new BackupError('format', 'Unknown encryption settings');
  if (!header.cipher || header.cipher.name !== 'AES-GCM') throw new BackupError('format', 'Unknown encryption settings');
  let bytes;
  try {
    const key = await deriveKey(password, fromBase64(header.kdf.salt), it);
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(header.cipher.iv) }, key, u.subarray(nl + 1)));
  } catch (_) {
    throw new BackupError('password', 'Wrong password (or the file is damaged)');
  }
  try {
    if (header.gzip) bytes = await pipeThrough(bytes, new DecompressionStream('gzip'));
    return JSON.parse(dec.decode(bytes));
  } catch (_) {
    throw new BackupError('format', 'The file is damaged');
  }
}

// ---- contents ------------------------------------------------------------------------
// payload = { app: 'BlobBoard', v, createdAt, appVersion, canvases: [doc],
//             tags: [tag], pictures: [{ id, type, w, h, data (base64) }] }

// Collects canvases + the tags and pictures they use. pictureBlob(id) ->
// { blob, w, h } | null.
export async function buildPayload({ canvases, tags, pictureBlob, appVersion = '' }) {
  const usedTags = new Set(), usedPics = new Set();
  for (const c of canvases) for (const it of Object.values(c.items)) {
    for (const t of it.tagIds || []) usedTags.add(t);
    if (it.thumbId) usedPics.add(it.thumbId);
  }
  const pictures = [];
  for (const id of usedPics) {
    const p = await pictureBlob(id);
    if (!p) continue;
    pictures.push({ id, type: p.blob.type || 'image/webp', w: p.w, h: p.h, data: toBase64(new Uint8Array(await p.blob.arrayBuffer())) });
  }
  return {
    app: 'BlobBoard',
    v: FORMAT_VERSION,
    createdAt: Date.now(),
    appVersion,
    canvases: JSON.parse(JSON.stringify(canvases)),
    tags: tags.filter(t => usedTags.has(t.id)).map(t => ({ id: t.id, name: t.name, color: t.color })),
    pictures
  };
}

// Untrusted payload -> { canvases, tags, pictures: [{ id, blob, w, h }],
// skipped }. Throws BackupError('format') if it isn't a BlobBoard save.
export function readPayload(p) {
  if (!p || typeof p !== 'object' || p.app !== 'BlobBoard' || !Array.isArray(p.canvases)) throw new BackupError('format', 'This is not a BlobBoard save');
  if (typeof p.v === 'number' && p.v > FORMAT_VERSION) throw new BackupError('format', 'This file was made by a newer BlobBoard — update the app first');
  let skipped = 0;
  const canvases = [];
  for (const raw of p.canvases.slice(0, LIMITS.canvases)) {
    try { canvases.push(sanitizeCanvas(JSON.parse(JSON.stringify(raw))).doc); } catch (_) { skipped++; }
  }
  const tags = (Array.isArray(p.tags) ? p.tags : []).map(sanitizeTag).filter(Boolean);
  const pictures = [];
  for (const raw of (Array.isArray(p.pictures) ? p.pictures : []).slice(0, LIMITS.pictures)) {
    try {
      if (!raw || !/^p-[0-9a-f]{64}$/.test(raw.id) || !PICTURE_TYPES.includes(raw.type) || typeof raw.data !== 'string') throw 0;
      const w = Math.round(raw.w), h = Math.round(raw.h);
      if (!(w > 0 && h > 0 && w <= LIMITS.side && h <= LIMITS.side)) throw 0;
      const bytes = fromBase64(raw.data);
      if (!bytes.length || bytes.length > LIMITS.pictureBytes) throw 0;
      pictures.push({ id: raw.id, blob: new Blob([bytes], { type: raw.type }), w, h });
    } catch (_) { skipped++; }
  }
  return { canvases, tags, pictures, skipped };
}

// File name: "Life.blobboard", or "BlobBoard-all-2026-10-12.blobboard".
// The local date as YYYY-MM-DD (file names).
export function localDay(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
}

export function backupName(canvasNames, date = new Date()) {
  const day = localDay(date);
  const safe = s => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Canvas';
  return (canvasNames.length === 1 ? safe(canvasNames[0]) : 'BlobBoard-all-' + day) + EXT;
}

// ---- files without a password (owner 2026-10-26: a password is optional) ----
// The same contents as plain JSON text — "Save to file" without a password
// (.blobboard) and "Export JSON" (.json). Opening works for both.
export function plainFile(payload) {
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

// What a picked file is: { kind: 'locked' } (needs a password),
// { kind: 'plain', payload }, or { kind: 'unknown' }.
export function sniffFile(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (isBackupFile(u)) return { kind: 'locked' };
  try {
    const payload = JSON.parse(new TextDecoder().decode(u));
    if (payload && payload.app === 'BlobBoard') return { kind: 'plain', payload };
  } catch (_) { /* not JSON */ }
  return { kind: 'unknown' };
}

// "Life.blobboard" -> "Life" (for copies and exports).
export const baseName = name => String(name || 'BlobBoard').replace(/\.(blobboard|json)$/i, '');
