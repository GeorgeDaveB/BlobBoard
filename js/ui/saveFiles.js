// Save & export (phase 7; owner 2026-10-12, reworked 2026-10-26) — canvas
// menu → "Save & export ▸". Everything works on what is loaded:
//  - Save this canvas      -> "<name>.blobboard"; locked with the canvas's own
//                             password if it has one (Password ▸), else plain JSON.
//  - Save all canvases…    -> one file: No password or a password for the
//                             file; canvases with their own password stay
//                             locked with it inside.
//  - Open saved file…      .blobboard (any kind) or .json -> NEW canvases
//                             (tags by name, pictures by fingerprint); asks the
//                             file's and each locked canvas's password.
//  - Export JSON           readable .json (a locked canvas asks its password
//                             first and warns).
//  - Export picture        a PNG of the board you're looking at (2x), groups
//                             shown closed (C11); Share on phones.
import { encryptJson, encryptWithKey, decryptFile, buildPayload, readPayload, backupName, localDay, EXT, BackupError, plainFile, sniffFile, baseName, sealEntry, openEntry } from '../services/backup.js';
import { drawScene } from '../services/exportPng.js';
import { findTagByName } from '../core/model.js';
import { unlockWith, keyFits, MIN_PASSWORD } from '../services/canvasLock.js';
import { APP_VERSION } from '../version.js';
import { toast, choiceDialog, promptDialog, confirmDialog } from './dialogs.js';

// Download, or (phones that can) share. Returns how it went: 'shared' | 'saved' | null.
export async function deliverFile(blob, name, { title = 'Save file' } = {}) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  const canShare = !!(navigator.canShare && navigator.share && matchMedia('(pointer: coarse)').matches && navigator.canShare({ files: [file] }));
  let how = 'download';
  if (canShare) {
    how = await choiceDialog({
      title,
      message: name,
      choices: [
        { label: 'Share…', value: 'share', kind: 'primary', note: 'Drive, mail, chat …' },
        { label: 'Download', value: 'download', note: 'To this device’s Downloads' }
      ]
    });
    if (!how) return null;
  }
  if (how === 'share') {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; } catch (err) { if (err && err.name === 'AbortError') return null; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'saved';
}

function busy(text) {
  const close = toast(text, { ms: 600000 });
  return close;
}

// A new password (twice). null = cancelled.
export async function askNewPassword(title = 'Choose a password', message = 'It can\u2019t be recovered \u2014 keep it safe.') {
  const pw = await promptDialog({
    title,
    message,
    okLabel: 'Next',
    input: { type: 'password', placeholder: 'At least ' + MIN_PASSWORD + ' characters', autocomplete: 'new-password' },
    check: v => (v.length >= MIN_PASSWORD ? '' : 'Use at least ' + MIN_PASSWORD + ' characters')
  });
  if (pw == null) return null;
  const again = await promptDialog({ title: 'Type it again', okLabel: 'OK', input: { type: 'password', autocomplete: 'new-password' }, check: v => (v === pw ? '' : 'The passwords don\u2019t match') });
  return again == null ? null : pw;
}

// Asks a canvas's password until it fits its lock. Resolves the key, or
// null (cancelled).
export async function askCanvasPassword(name, lock, message = 'Type the password of this canvas.') {
  for (;;) {
    const pw = await promptDialog({ title: 'Password for \u201c' + name + '\u201d', message, okLabel: 'OK', input: { type: 'password', autocomplete: 'current-password' } });
    if (pw == null) return null;
    const key = await unlockWith(lock, pw);
    if (key) return key;
    message = 'Wrong password \u2014 try again.';
  }
}

// The key of a locked canvas on this device (asked if this device lacks it
// or it no longer fits). null = no lock; undefined = cancelled.
async function keyFor(store, keys, id) {
  const doc = store.canvas(id);
  if (!doc.lock) return null;
  const k = keys && keys.get(id);
  if (k && await keyFits(doc.lock, k)) return k;
  const key = await askCanvasPassword(doc.name, doc.lock);
  if (!key) return undefined;
  if (keys) keys.set(id, key);
  return key;
}

const pictureBlobOf = pictures => id => (pictures ? pictures.blobOf(id) : null);
const payloadOf = (store, pictures, ids) => buildPayload({ canvases: ids.map(id => store.canvas(id)), tags: store.tags(), pictureBlob: pictureBlobOf(pictures), appVersion: APP_VERSION });
const kb = blob => Math.max(1, Math.round(blob.size / 1024)) + ' KB';

// Save this canvas: with its own password if it has one.
export async function saveThisCanvas({ store, pictures, keys }) {
  const doc = store.canvas();
  const key = await keyFor(store, keys, doc.id);
  if (key === undefined) return;
  const done = busy(key ? 'Locking the file\u2026' : 'Making the file\u2026');
  let blob;
  try {
    const payload = await payloadOf(store, pictures, [doc.id]);
    blob = key ? await encryptWithKey(payload, key, doc.lock.kdf) : plainFile(payload);
  } catch (err) { done(); toast('Could not save: ' + (err && err.message ? err.message : err)); return; }
  done();
  const how = await deliverFile(blob, backupName([doc.name]), { title: 'Save this canvas' });
  if (how) toast((how === 'shared' ? 'File shared' : 'File saved') + ' (' + kb(blob) + (key ? ', with the canvas password)' : ')'));
}

// Save all canvases: one file, with or without a file password; canvases
// with their own password stay locked with it inside.
export async function saveAllCanvases({ store, pictures, keys }) {
  const list = store.canvasList();
  const how = await choiceDialog({
    title: 'Save all ' + list.length + ' canvases',
    message: 'Pictures are included. Canvases with their own password stay locked with it.',
    choices: [
      { label: 'No password', value: 'none', kind: 'primary', note: 'Opens anywhere BlobBoard runs' },
      { label: 'With a password for this file\u2026', value: 'pw', note: 'Only opens with the password' }
    ]
  });
  if (!how) return;
  let filePw = null;
  if (how === 'pw') { filePw = await askNewPassword('Password for this file'); if (!filePw) return; }
  const plainIds = [], lockedIds = [];
  for (const c of list) (store.canvas(c.id).lock ? lockedIds : plainIds).push(c.id);
  const lockedKeys = new Map();
  for (const id of lockedIds) {
    const k = await keyFor(store, keys, id);
    if (k === undefined) return;
    lockedKeys.set(id, k);
  }
  const done = busy('Making the file\u2026');
  let blob;
  try {
    const payload = await payloadOf(store, pictures, plainIds);
    payload.lockedCanvases = [];
    for (const id of lockedIds) {
      const doc = store.canvas(id);
      payload.lockedCanvases.push(await sealEntry(lockedKeys.get(id), doc.lock, doc.name, await payloadOf(store, pictures, [id])));
    }
    blob = filePw ? await encryptJson(payload, filePw) : plainFile(payload);
  } catch (err) { done(); toast('Could not save: ' + (err && err.message ? err.message : err)); return; }
  done();
  const res = await deliverFile(blob, backupName(list.map(c => c.name)), { title: 'Save all canvases' });
  if (res) toast((res === 'shared' ? 'File shared' : 'File saved') + ' (' + kb(blob) + ')');
}

// Export JSON: this canvas or all, readable by anyone (a locked canvas asks
// its password first and you confirm).
export async function exportJson({ store, pictures, keys }) {
  let ids = [store.ui.canvasId];
  if (store.canvasList().length > 1) {
    const scope = await choiceDialog({
      title: 'Export JSON',
      message: 'A readable .json file, pictures included.',
      choices: [
        { label: 'This canvas', value: 'one', kind: 'primary', note: '\u201c' + store.canvas().name + '\u201d' },
        { label: 'All canvases', value: 'all', note: store.canvasList().length + ' canvases' }
      ]
    });
    if (!scope) return;
    if (scope === 'all') ids = store.canvasList().map(c => c.id);
  }
  const locked = ids.filter(id => store.canvas(id).lock);
  for (const id of locked) {
    const doc = store.canvas(id);
    const key = await askCanvasPassword(doc.name, doc.lock, 'This canvas has a password. Type it to export it.');
    if (!key) return;
  }
  if (locked.length) {
    const ok = await confirmDialog({ title: 'Export without a password?', message: 'This JSON file won\u2019t have a password \u2014 anyone with the file can read ' + (locked.length === 1 ? '\u201c' + store.canvas(locked[0]).name + '\u201d' : 'these canvases') + '.', okLabel: 'Export' });
    if (!ok) return;
  }
  const payload = await payloadOf(store, pictures, ids);
  for (const c of payload.canvases) delete c.lock;
  const blob = plainFile(payload);
  const name = baseName(backupName(ids.map(id => store.canvas(id).name))) + '.json';
  const how = await deliverFile(blob, name, { title: 'Export JSON' });
  if (how) toast(how === 'shared' ? 'JSON shared' : 'JSON saved (' + kb(blob) + ')');
}

// Picks a .blobboard / .json file and reads it (asking the file's password
// if it has one). Resolves { name, payload, password } or null.
function pickAndRead() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = EXT + ',.json,application/json,application/octet-stream';
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) { resolve(null); return; }
      const buf = new Uint8Array(await f.arrayBuffer());
      const kind = sniffFile(buf);
      if (kind.kind === 'plain') { resolve({ name: f.name, payload: kind.payload, password: null }); return; }
      if (kind.kind !== 'locked') { toast('That is not a BlobBoard file'); resolve(null); return; }
      let message = 'Type the file\u2019s password.';
      for (;;) {
        const pw = await promptDialog({ title: 'Open \u201c' + f.name + '\u201d', message, okLabel: 'Open', input: { type: 'password', autocomplete: 'current-password' } });
        if (pw == null) { resolve(null); return; }
        const done = busy('Unlocking\u2026');
        try { const payload = await decryptFile(buf, pw); done(); resolve({ name: f.name, payload, password: pw }); return; } catch (err) {
          done();
          if (err instanceof BackupError && err.code === 'password') { message = 'Wrong password \u2014 try again.'; continue; }
          toast(err && err.message ? err.message : 'The file could not be opened');
          resolve(null);
          return;
        }
      }
    });
    input.click();
  });
}

// Adds a read payload's pictures, tags and canvases; returns the new canvas ids.
async function importData(store, pictures, data) {
  if (pictures) for (const p of data.pictures) await pictures.importRecord(p);
  const tagMap = new Map();
  for (const t of data.tags) {
    const isNew = !findTagByName(store.tags(), t.name);
    const id = store.ensureTag(t.name);
    if (!id) continue;
    if (isNew) store.updateTag(id, { color: t.color });
    tagMap.set(t.id, id);
  }
  return data.canvases.map(doc => store.importCanvas(doc, { tagMap }));
}

// Open saved file: its canvases are added as new canvases.
export async function openSaved({ store, pictures, keys }) {
  const got = await pickAndRead();
  if (!got) return;
  let data;
  try { data = readPayload(got.payload); } catch (err) { toast(err.message); return; }
  const made = await importData(store, pictures, data);
  // A canvas saved with its own password: the password just typed is its key.
  for (const id of made) {
    const doc = store.canvas(id);
    if (doc.lock && got.password && keys) { const k = await unlockWith(doc.lock, got.password); if (k) keys.set(id, k); }
  }
  // Canvases locked inside a multi-canvas file: ask each one's password.
  let skipped = 0;
  for (const entry of data.locked) {
    let message = 'This canvas has its own password.';
    let opened = null;
    for (;;) {
      const pw = await promptDialog({ title: 'Password for \u201c' + entry.name + '\u201d', message, okLabel: 'Open', input: { type: 'password', autocomplete: 'current-password' } });
      if (pw == null) break;
      opened = await openEntry(entry, pw).catch(() => null);
      if (opened) break;
      message = 'Wrong password \u2014 try again (Cancel skips this canvas).';
    }
    if (!opened) { skipped++; continue; }
    let sub;
    try { sub = readPayload(opened.payload); } catch (_) { skipped++; continue; }
    const ids = await importData(store, pictures, sub);
    for (const id of ids) if (keys) keys.set(id, opened.key);
    made.push(...ids);
  }
  if (!made.length) { toast(skipped ? 'Nothing opened' : 'The file has no canvases'); return; }
  store.switchCanvas(made[0]);
  toast('Opened ' + made.length + ' canvas' + (made.length === 1 ? '' : 'es') + (skipped ? ' (' + skipped + ' locked one' + (skipped === 1 ? '' : 's') + ' skipped)' : '') + (data.skipped ? ' (' + data.skipped + ' damaged parts left out)' : ''));
}

export async function exportPicture({ store, board }) {
  // C11: groups closed in the picture.
  if (store.ui.expanded.length) store.setExpanded([]);
  await new Promise(r => setTimeout(r, 150)); // let the closed groups lay out
  const canvas = drawScene(board.exportScene(), 2);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  if (!blob) { toast('Could not make the picture'); return; }
  const day = localDay();
  const safe = String(store.canvas().name).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'BlobBoard';
  const how = await deliverFile(blob, safe + '-' + day + '.png', { title: 'Export picture' });
  if (how === 'saved') toast('Picture saved');
}
