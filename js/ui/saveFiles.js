// Phase 7 (R4 + owner 2026-10-12, 2026-10-26), from the canvas menu:
//  - Save to file…        this canvas or all -> ".blobboard", no password by
//                         default or with one; pictures included.
//  - Open saved file…     .blobboard (with or without a password) or .json;
//                         adds its canvases as NEW canvases (tags matched by
//                         name, pictures by fingerprint).
//  - Change file password… a copy without a password, or with a new one.
//  - Export JSON          the same contents as readable .json.
//  - Export picture     a PNG of the board you're looking at (2x), groups
//    shown closed (C11); Share on phones that support it.
import { encryptJson, decryptFile, buildPayload, readPayload, backupName, localDay, EXT, BackupError, plainFile, sniffFile, baseName } from '../services/backup.js';
import { drawScene } from '../services/exportPng.js';
import { findTagByName } from '../core/model.js';
import { APP_VERSION } from '../version.js';
import { toast, choiceDialog, promptDialog } from './dialogs.js';

const MIN_PASSWORD = 6;

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

// Which canvases: this one or all (asked only when there are several).
async function pickScope(store, title) {
  if (store.canvasList().length <= 1) return [store.ui.canvasId];
  const scope = await choiceDialog({
    title,
    message: 'Pictures are included.',
    choices: [
      { label: 'This canvas', value: 'one', kind: 'primary', note: '\u201c' + store.canvas().name + '\u201d' },
      { label: 'All canvases', value: 'all', note: store.canvasList().length + ' canvases' }
    ]
  });
  if (!scope) return null;
  return scope === 'all' ? store.canvasList().map(c => c.id) : [store.ui.canvasId];
}

// A new file password (twice). null = cancelled.
async function askNewPassword() {
  const pw = await promptDialog({
    title: 'Choose a password',
    message: 'You need it to open the file. It can\u2019t be recovered \u2014 keep it safe.',
    okLabel: 'Next',
    input: { type: 'password', placeholder: 'At least ' + MIN_PASSWORD + ' characters', autocomplete: 'new-password' },
    check: v => (v.length >= MIN_PASSWORD ? '' : 'Use at least ' + MIN_PASSWORD + ' characters')
  });
  if (pw == null) return null;
  const again = await promptDialog({ title: 'Type it again', okLabel: 'OK', input: { type: 'password', autocomplete: 'new-password' }, check: v => (v === pw ? '' : 'The passwords don\u2019t match') });
  return again == null ? null : pw;
}

// No password (default) or with one. Resolves null (none), a string, or undefined (cancelled).
async function askFilePassword(title) {
  const how = await choiceDialog({
    title,
    choices: [
      { label: 'No password', value: 'none', kind: 'primary', note: 'Opens anywhere BlobBoard runs' },
      { label: 'With a password\u2026', value: 'pw', note: 'Only opens with the password' }
    ]
  });
  if (!how) return undefined;
  if (how === 'none') return null;
  const pw = await askNewPassword();
  return pw == null ? undefined : pw;
}

const payloadOf = (store, pictures, ids) => buildPayload({ canvases: ids.map(id => store.canvas(id)), tags: store.tags(), pictureBlob: id => (pictures ? pictures.blobOf(id) : null), appVersion: APP_VERSION });
const kb = blob => Math.max(1, Math.round(blob.size / 1024)) + ' KB';

// Save to file (.blobboard): no password by default, or with one.
export async function saveToFile({ store, pictures }) {
  const ids = await pickScope(store, 'Save to a file');
  if (!ids) return;
  const pw = await askFilePassword('Save \u2014 protect the file with a password?');
  if (pw === undefined) return;
  const done = busy(pw ? 'Locking the file\u2026' : 'Making the file\u2026');
  let blob;
  try {
    const payload = await payloadOf(store, pictures, ids);
    blob = pw ? await encryptJson(payload, pw) : plainFile(payload);
  } catch (err) {
    done();
    toast('Could not save: ' + (err && err.message ? err.message : err));
    return;
  }
  done();
  const how = await deliverFile(blob, backupName(ids.map(id => store.canvas(id).name)), { title: 'Save the file' });
  if (how) toast(how === 'shared' ? 'File shared' : 'File saved (' + kb(blob) + (pw ? ', with a password)' : ')'));
}

// Export JSON (.json): the same contents as readable JSON, never a password.
export async function exportJson({ store, pictures }) {
  const ids = await pickScope(store, 'Export JSON');
  if (!ids) return;
  const blob = plainFile(await payloadOf(store, pictures, ids));
  const name = baseName(backupName(ids.map(id => store.canvas(id).name))) + '.json';
  const how = await deliverFile(blob, name, { title: 'Export JSON' });
  if (how) toast(how === 'shared' ? 'JSON shared' : 'JSON saved (' + kb(blob) + ')');
}

// Picks a .blobboard / .json file and reads it (asking its password if it
// has one). Resolves { name, payload } or null.
function pickAndRead(title) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = EXT + ',.json,application/json,application/octet-stream';
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) { resolve(null); return; }
      const buf = new Uint8Array(await f.arrayBuffer());
      const kind = sniffFile(buf);
      if (kind.kind === 'plain') { resolve({ name: f.name, payload: kind.payload }); return; }
      if (kind.kind !== 'locked') { toast('That is not a BlobBoard file'); resolve(null); return; }
      let message = 'Type the file\u2019s password.';
      for (;;) {
        const pw = await promptDialog({ title: title + ' \u201c' + f.name + '\u201d', message, okLabel: 'Open', input: { type: 'password', autocomplete: 'current-password' } });
        if (pw == null) { resolve(null); return; }
        const done = busy('Unlocking\u2026');
        try { const payload = await decryptFile(buf, pw); done(); resolve({ name: f.name, payload }); return; } catch (err) {
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

// Open saved file: its canvases are added as new canvases.
export async function openSaved({ store, pictures }) {
  const got = await pickAndRead('Open');
  if (!got) return;
  let data;
  try { data = readPayload(got.payload); } catch (err) { toast(err.message); return; }
  // Pictures (same fingerprint = already here), then tags by name.
  if (pictures) for (const p of data.pictures) await pictures.importRecord(p);
  const tagMap = new Map();
  for (const t of data.tags) {
    const isNew = !findTagByName(store.tags(), t.name);
    const id = store.ensureTag(t.name);
    if (!id) continue;
    if (isNew) store.updateTag(id, { color: t.color });
    tagMap.set(t.id, id);
  }
  const made = data.canvases.map(doc => store.importCanvas(doc, { tagMap }));
  if (!made.length) { toast('The file has no canvases'); return; }
  store.switchCanvas(made[0]);
  toast('Opened ' + made.length + ' canvas' + (made.length === 1 ? '' : 'es') + (data.skipped ? ' (' + data.skipped + ' damaged parts left out)' : ''));
}

// Change file password: a copy of a file with no password or a new one
// (the original file is not changed).
export async function changeFilePassword() {
  const got = await pickAndRead('Change password of');
  if (!got) return;
  try { readPayload(got.payload); } catch (err) { toast(err.message); return; }
  const pw = await askFilePassword('New copy of \u201c' + got.name + '\u201d');
  if (pw === undefined) return;
  const done = busy('Making the copy\u2026');
  let blob;
  try { blob = pw ? await encryptJson(got.payload, pw) : plainFile(got.payload); } catch (err) { done(); toast(err.message); return; }
  done();
  const how = await deliverFile(blob, baseName(got.name) + EXT, { title: 'Save the copy' });
  if (how) toast(pw ? 'Copy saved with the new password' : 'Copy saved without a password');
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
