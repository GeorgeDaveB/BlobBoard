// Cloud sync (phase 8, DESIGN §11): keeps this device's canvases, tags and
// pictures in step with the app's cloud folder (Dropbox today). One run
// ("cycle"):
//   1. tags.bin        — download if it changed, 3-way merge, upload if needed
//   2. pictures        — upload the ones our canvases use that the cloud lacks
//   3. canvases/<id>.bin, one by one:
//        only here (new) -> upload · only there (new) -> download
//        deleted there   -> delete here (kept + re-uploaded if edited here)
//        deleted here    -> delete there (kept if edited there)
//        changed there   -> take it (not edited here) or 3-way merge (edited here),
//                           upload "only if the cloud still has what we saw"
//   4. pictures        — download the ones our canvases use that we lack
// Passwords are per canvas (owner 2026-10-26): a canvas with a password is
// kept in the cloud locked with its key ({ locked, name, lock, sealed }); one
// without is compressed JSON. A device without the key (or with an old one,
// after the password changed elsewhere) skips that canvas and lists it in
// status.needs, so the UI can ask its password once (keys = this device's
// canvas keys). Tags are never locked; a picture is locked when only
// locked canvases use it.
// What "the last agreed version" (base) and cloud revision of each file are
// is remembered on this device (setting 'sync'). A canvas is "edited here"
// when it differs from its base.
import { mergeCanvas, mergeTags } from './merge.js';
import { packJson, unpackJson, sealJson, openJson } from './vault.js';
import { toBase64, fromBase64 } from '../services/backup.js';
import { keyFits } from '../services/canvasLock.js';
import { foldText } from '../core/model.js';

export const PATHS = {
  vault: '/vault.json', // only from the first phase-8 build (a folder-wide password)
  tags: '/tags.bin',
  canvases: '/canvases',
  canvas: id => '/canvases/' + id + '.bin',
  images: '/images',
  image: id => '/images/' + id + '.bin',
  backups: id => '/backups/' + id
};
export const KEEP_BACKUPS = 20;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = v => JSON.parse(JSON.stringify(v));
const fileId = e => (e && e['.tag'] === 'file' && e.name.endsWith('.bin') ? e.name.slice(0, -4) : null);

class Busy extends Error {}
export class NeedPassword extends Error {
  constructor(id, name, lock) { super('Needs its password'); this.id = id; this.name = name; this.lock = lock; }
}

export function createSyncEngine({ api, keys = null, store, pictures = null, repo, device = 'Device', now = () => Date.now(), isBusy = () => false, onStatus = () => {}, onNotice = () => {} }) {
  let meta = null;
  let running = null;
  let again = false;
  let needs = new Map(); // canvasId -> { id, name, lock }
  let status = { state: 'idle', pending: 0, lastSync: 0, message: '', needs: [] };

  async function loadMeta() {
    if (!meta) meta = (await repo.getSetting('sync')) || null;
    if (!meta) meta = { canvases: {}, tags: { rev: null, base: null }, firstDone: false };
    return meta;
  }
  function saveMeta() { repo.setSetting('sync', clone(meta)); }
  function setStatus(s) { status = { ...status, ...s }; onStatus({ ...status }); }

  const dirtyCanvas = id => {
    const doc = store.canvas(id), m = meta.canvases[id];
    return !!doc && (!m || !same(doc, m.base));
  };
  const pendingCount = () => store.canvasList().filter(c => dirtyCanvas(c.id)).length + (meta.tags.base && !same(store.allTags(), meta.tags.base) ? 1 : 0);

  async function getRev(path) {
    try { return (await api.rpc('files/get_metadata', { path })).rev || null; } catch (err) { if (err.kind === 'notfound') return null; throw err; }
  }

  // ---- what goes into the files ---------------------------------------------------
  async function keyOf(id, lock) {
    const k = keys && keys.get(id);
    return k && (await keyFits(lock, k)) ? k : null;
  }
  async function encodeCanvas(doc) {
    if (!doc.lock) return packJson(doc);
    const k = await keyOf(doc.id, doc.lock);
    if (!k) throw new NeedPassword(doc.id, doc.name, doc.lock);
    return packJson({ locked: 1, name: doc.name, lock: doc.lock, sealed: toBase64(await sealJson(k, doc)) });
  }
  async function decodeCanvas(id, bytes) {
    const obj = await unpackJson(bytes);
    if (!obj || !obj.locked) return obj;
    const k = await keyOf(id, obj.lock);
    if (!k) throw new NeedPassword(id, obj.name, obj.lock);
    return openJson(k, fromBase64(obj.sealed));
  }
  async function uploadCanvas(path, doc, mode) {
    const r = await api.upload(path, await encodeCanvas(doc), mode);
    return r.rev;
  }

  // ---- 1. tags ------------------------------------------------------------------------
  async function syncTags() {
    const rev = await getRev(PATHS.tags);
    let remote = null;
    if (rev && rev === meta.tags.rev) remote = meta.tags.base;
    else if (rev) {
      const f = await api.download(PATHS.tags);
      remote = f ? await unpackJson(f.bytes) : null;
    }
    const local = store.allTags();
    const byId = (a, b) => (a.id < b.id ? -1 : 1);
    let merged = (remote ? mergeTags(meta.tags.base, local, remote).tags : local).slice().sort(byId);
    // The same name made on both devices: keep the older tag, move items over.
    const byName = new Map();
    const remap = new Map();
    for (const t of merged.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : 1))) {
      if (t.deleted) continue;
      const k = foldText(t.name);
      if (byName.has(k)) remap.set(t.id, byName.get(k));
      else byName.set(k, t.id);
    }
    if (remap.size) merged = merged.map(t => (remap.has(t.id) ? { ...t, deleted: true, updatedAt: now() } : t));
    if (!same(merged, local)) store.setTagsFromSync(merged);
    if (remap.size) store.remapTagIds(remap);
    if (!remote || !same(merged, remote)) {
      const r = await api.upload(PATHS.tags, await packJson(merged), rev ? { update: rev } : 'add');
      meta.tags = { rev: r.rev, base: merged };
    } else meta.tags = { rev, base: merged };
    saveMeta();
  }

  // ---- 2 + 4. pictures -------------------------------------------------------------------
  // Picture id -> the canvases (ids) that use it.
  function pictureUsers() {
    const users = new Map();
    for (const c of store.canvasList()) {
      for (const it of Object.values(store.canvas(c.id).items)) {
        if (!it.thumbId) continue;
        if (!users.has(it.thumbId)) users.set(it.thumbId, []);
        users.get(it.thumbId).push(c.id);
      }
    }
    return users;
  }
  async function uploadPictures(remoteImages) {
    if (!pictures) return;
    for (const [id, users] of pictureUsers()) {
      if (remoteImages.has(id)) continue;
      const p = pictures.blobOf(id);
      if (!p) continue;
      const body = { w: p.w, h: p.h, type: p.blob.type || 'image/webp', data: toBase64(new Uint8Array(await p.blob.arrayBuffer())) };
      // Only locked canvases use it: lock it with the first one's key.
      const lockedOnly = users.every(cid => store.canvas(cid).lock);
      let file;
      if (lockedOnly) {
        const doc = store.canvas(users[0]);
        const k = await keyOf(doc.id, doc.lock);
        if (!k) continue; // its canvas waits for its password too
        file = { locked: 1, canvasId: doc.id, lock: doc.lock, sealed: toBase64(await sealJson(k, body)) };
      } else file = body;
      await api.upload(PATHS.image(id), await packJson(file), 'overwrite');
      remoteImages.add(id);
    }
  }
  async function downloadPictures(remoteImages) {
    if (!pictures) return;
    for (const id of pictureUsers().keys()) {
      if (pictures.has(id) || !remoteImages.has(id)) continue;
      const f = await api.download(PATHS.image(id));
      if (!f) continue;
      let p = await unpackJson(f.bytes);
      if (p.locked) {
        const k = await keyOf(p.canvasId, p.lock);
        if (!k) continue;
        p = await openJson(k, fromBase64(p.sealed));
      }
      await pictures.importRecord({ id, blob: new Blob([fromBase64(p.data)], { type: p.type || 'image/webp' }), w: p.w, h: p.h });
    }
  }

  // ---- 3. canvases --------------------------------------------------------------------
  async function backup(id, doc) {
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    try { await api.upload(PATHS.backups(id) + '/' + stamp + '-' + device + '.bin', await encodeCanvas(doc), 'add'); } catch (_) { return; }
    const { entries } = await api.listFolder(PATHS.backups(id));
    const files = entries.filter(e => e['.tag'] === 'file').sort((a, b) => (a.name < b.name ? 1 : -1));
    for (const old of files.slice(KEEP_BACKUPS)) await api.remove(old.path_lower || PATHS.backups(id) + '/' + old.name).catch(() => {});
  }

  function guardBusy(id) {
    if (id === store.ui.canvasId && isBusy()) throw new Busy();
  }

  async function download(id) {
    const f = await api.download(PATHS.canvas(id));
    if (!f) return null;
    const doc = await decodeCanvas(id, f.bytes);
    doc.id = id;
    return { doc, rev: f.rev };
  }

  async function syncCanvas(id, remoteRev) {
    const L = store.canvas(id);
    const M = meta.canvases[id];
    const path = PATHS.canvas(id);
    if (L && !remoteRev) {
      if (M && !dirtyCanvas(id)) {                     // deleted on the other device
        guardBusy(id);
        store.removeCanvasFromSync(id);
        delete meta.canvases[id];
      } else {
        if (M) onNotice('“' + L.name + '” was deleted on your other device but you changed it here, so it was kept.');
        const doc = clone(L);
        const rev = await uploadCanvas(path, doc, 'add');
        meta.canvases[id] = { rev, base: doc };
      }
    } else if (!L && remoteRev) {
      if (M && M.rev === remoteRev) {                  // deleted here: delete there too
        await api.remove(path);
        delete meta.canvases[id];
      } else {
        const r = await download(id);
        if (!r) return;
        if (M) onNotice('“' + r.doc.name + '” was changed on your other device after you deleted it here, so it came back.');
        store.putCanvasFromSync(r.doc);
        meta.canvases[id] = { rev: r.rev || remoteRev, base: r.doc };
      }
    } else if (L && remoteRev) {
      if (M && M.rev === remoteRev) {                  // the cloud unchanged since we last saw it
        if (!dirtyCanvas(id)) return;
        const doc = clone(L);
        const rev = await uploadCanvas(path, doc, { update: remoteRev });
        meta.canvases[id] = { rev, base: doc };
      } else {                                         // changed on the other device
        const r = await download(id);
        if (!r) return;
        const T = r.doc;
        if (M && !dirtyCanvas(id)) {
          guardBusy(id);
          store.putCanvasFromSync(T);
          meta.canvases[id] = { rev: r.rev || remoteRev, base: T };
        } else if (same(L, T)) {
          meta.canvases[id] = { rev: r.rev || remoteRev, base: T };
        } else {
          const res = mergeCanvas(M ? M.base : null, clone(L), T);
          guardBusy(id);
          if (res.losers.has('mine')) await backup(id, L);
          if (res.losers.has('theirs')) await backup(id, T);
          if (!same(res.doc, L)) store.putCanvasFromSync(res.doc);
          const doc = clone(store.canvas(id));
          const rev = same(doc, T) ? (r.rev || remoteRev) : await uploadCanvas(path, doc, { update: r.rev || remoteRev });
          meta.canvases[id] = { rev, base: doc };
        }
      }
    } else if (M) {
      delete meta.canvases[id];                        // gone on both sides
    }
    saveMeta();
  }

  // First connection: canvases from both devices are kept. A never-synced
  // canvas here that is empty and shares a name with one in the cloud is
  // dropped (the "My first canvas" every new device starts with); a
  // non-empty one with the same name gets "(PC)" / "(Phone)" added.
  async function firstConnection(remote) {
    if (meta.firstDone || !remote.size) return;
    const remoteNames = new Map();
    for (const id of remote.keys()) {
      if (store.canvas(id)) continue;
      let r = null;
      try { r = await download(id); } catch (err) { if (err instanceof NeedPassword) { remoteNames.set(err.name, null); continue; } throw err; }
      if (r) remoteNames.set(r.doc.name, r);
    }
    for (const c of store.canvasList()) {
      if (meta.canvases[c.id] || remote.has(c.id) || !remoteNames.has(c.name)) continue;
      const r = remoteNames.get(c.name);
      if (c.count === 0 && r) {
        store.putCanvasFromSync(r.doc);
        meta.canvases[r.doc.id] = { rev: r.rev, base: r.doc };
        store.removeCanvasFromSync(c.id);
      } else if (c.count > 0) {
        store.renameCanvas(c.id, c.name + ' (' + device + ')');
      }
    }
  }

  async function cycle() {
    await loadMeta();
    setStatus({ state: 'syncing', message: '' });
    // A folder from the first phase-8 build (one password for everything)
    // can't be read any more: only Start over helps.
    const old = await api.download(PATHS.vault).catch(() => null);
    if (old) {
      let v = null;
      try { v = JSON.parse(new TextDecoder().decode(old.bytes)); } catch (_) { v = null; }
      if (v && v.mode !== 'plain') throw Object.assign(new Error('This cloud folder was set up with an older sync password — use Start over'), { kind: 'legacy' });
    }
    const [cv, im] = await Promise.all([api.listFolder(PATHS.canvases), api.listFolder(PATHS.images)]);
    const remote = new Map();
    for (const e of cv.entries) { const id = fileId(e); if (id) remote.set(id, e.rev); }
    const remoteImages = new Set(im.entries.map(fileId).filter(Boolean));
    needs = new Map();
    await syncTags();
    await firstConnection(remote);
    await uploadPictures(remoteImages);
    const ids = new Set([...store.canvasList().map(c => c.id), ...remote.keys(), ...Object.keys(meta.canvases)]);
    for (const id of ids) {
      try { await syncCanvas(id, remote.get(id) || null); } catch (err) {
        if (!(err instanceof NeedPassword)) throw err;
        needs.set(id, { id, name: err.name, lock: err.lock });
      }
    }
    await downloadPictures(remoteImages);
    meta.firstDone = true;
    saveMeta();
  }

  // Runs a cycle (only one at a time; asked again while running = once more).
  async function syncNow() {
    if (running) { again = true; return running; }
    running = (async () => {
      let tries = 0;
      do {
        again = false;
        try {
          await cycle();
          const list = [...needs.values()];
          setStatus({ state: list.length ? 'needs' : 'synced', lastSync: now(), pending: 0, needs: list, message: list.length ? list.length + ' canvas' + (list.length === 1 ? ' needs its' : 'es need their') + ' password' : '' });
        } catch (err) {
          if (err instanceof Busy) { setStatus({ state: 'waiting', message: 'Waiting for you to finish' }); setTimeout(syncNow, 2000); break; }
          if (err && err.kind === 'conflict' && tries++ < 3) { again = true; continue; }
          const kind = err && err.kind;
          const pending = meta ? pendingCount() : 0;
          if (kind === 'offline') setStatus({ state: 'offline', pending, message: 'Offline' });
          else if (kind === 'auth') setStatus({ state: 'auth', pending, message: 'Sign in again' });
          else if (kind === 'full') setStatus({ state: 'full', pending, message: 'The cloud storage is full' });
          else setStatus({ state: 'error', pending, message: (err && err.message) || String(err) });
          break;
        }
      } while (again);
    })().finally(() => { running = null; });
    return running;
  }

  return {
    syncNow,
    get status() { return { ...status }; },
    get running() { return !!running; },
    async reset() { meta = { canvases: {}, tags: { rev: null, base: null }, firstDone: false }; saveMeta(); },
    pendingCount: () => (meta ? pendingCount() : 0),
    // The cloud copy's lock + name of a canvas (to ask its password).
    async remoteLock(id) {
      const f = await api.download(PATHS.canvas(id));
      if (!f) return null;
      const obj = await unpackJson(f.bytes);
      return obj && obj.locked ? { name: obj.name, lock: obj.lock } : null;
    }
  };
}
