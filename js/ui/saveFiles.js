// Phase 7 (R4 + owner 2026-10-12), from the canvas menu:
//  - Save (encrypted)…  this canvas or all canvases -> a ".blobboard" file
//    locked with a password, pictures included (services/backup.js).
//  - Open saved file…   adds its canvases as NEW canvases (tags matched by
//    name, pictures by fingerprint).
//  - Export picture     a PNG of the board you're looking at (2x), groups
//    shown closed (C11); Share on phones that support it.
import { encryptJson, decryptFile, buildPayload, readPayload, backupName, isBackupFile, localDay, EXT, BackupError } from '../services/backup.js';
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

export async function saveEncrypted({ store, pictures }) {
  const scope = store.canvasList().length > 1 ? await choiceDialog({
    title: 'Save to a file',
    message: 'A BlobBoard file, locked with a password. Pictures are included.',
    choices: [
      { label: 'This canvas', value: 'one', kind: 'primary', note: '“' + store.canvas().name + '”' },
      { label: 'All canvases', value: 'all', note: store.canvasList().length + ' canvases' }
    ]
  }) : 'one';
  if (!scope) return;
  const pw = await promptDialog({
    title: 'Choose a password',
    message: 'You need it to open the file. It can’t be recovered — keep it safe.',
    okLabel: 'Next',
    input: { type: 'password', placeholder: 'At least ' + MIN_PASSWORD + ' characters', autocomplete: 'new-password' },
    check: v => (v.length >= MIN_PASSWORD ? '' : 'Use at least ' + MIN_PASSWORD + ' characters')
  });
  if (pw == null) return;
  const again = await promptDialog({
    title: 'Type it again',
    okLabel: 'Save',
    input: { type: 'password', autocomplete: 'new-password' },
    check: v => (v === pw ? '' : 'The passwords don’t match')
  });
  if (again == null) return;
  const ids = scope === 'all' ? store.canvasList().map(c => c.id) : [store.ui.canvasId];
  const docs = ids.map(id => store.canvas(id));
  const done = busy('Locking the file…');
  let blob;
  try {
    const payload = await buildPayload({ canvases: docs, tags: store.tags(), pictureBlob: id => (pictures ? pictures.blobOf(id) : null), appVersion: APP_VERSION });
    blob = await encryptJson(payload, pw);
  } catch (err) {
    done();
    toast('Could not save: ' + (err && err.message ? err.message : err));
    return;
  }
  done();
  const how = await deliverFile(blob, backupName(docs.map(d => d.name)), { title: 'Save the file' });
  if (how) toast(how === 'shared' ? 'File shared' : 'File saved (' + Math.max(1, Math.round(blob.size / 1024)) + ' KB)');
}

// Picks a file, asks its password (again if wrong), adds its canvases.
export function openSaved({ store, pictures }) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = EXT + ',application/octet-stream';
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    if (!isBackupFile(buf)) { toast('That is not a BlobBoard save file'); return; }
    let payload = null, message = 'Type the password it was saved with.';
    while (!payload) {
      const pw = await promptDialog({ title: 'Open “' + f.name + '”', message, okLabel: 'Open', input: { type: 'password', autocomplete: 'current-password' } });
      if (pw == null) return;
      const done = busy('Unlocking…');
      try { payload = await decryptFile(buf, pw); } catch (err) {
        done();
        if (err instanceof BackupError && err.code === 'password') { message = 'Wrong password — try again.'; continue; }
        toast(err && err.message ? err.message : 'The file could not be opened');
        return;
      }
      done();
    }
    let data;
    try { data = readPayload(payload); } catch (err) { toast(err.message); return; }
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
  });
  input.click();
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
