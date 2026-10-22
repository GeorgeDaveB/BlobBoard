// Dropbox sync (phase 8, DESIGN §11): keeps this device's canvases, tags
// and pictures in step with the app folder in Dropbox. Every file there is
// encrypted (vault.js). One run ("cycle"):
//   1. tags.bin        — download if it changed, 3-way merge, upload if needed
//   2. pictures        — upload the ones our canvases use that Dropbox lacks
//   3. canvases/<id>.bin, one by one:
//        only here (new) -> upload · only there (new) -> download
//        deleted there   -> delete here (kept + re-uploaded if edited here)
//        deleted here    -> delete there (kept if edited there)
//        changed there   -> take it (not edited here) or 3-way merge (edited here),
//                           upload "only if Dropbox still has what we saw"
//   4. pictures        — download the ones our canvases use that we lack
// What "the last agreed version" (base) and Dropbox revision of each file
// are is remembered on this device (setting 'sync'). A canvas is "edited
// here" when it differs from its base.
import { mergeCanvas, mergeTags } from './merge.js';
import { sealJson, openJson } from './vault.js';
import { toBase64, fromBase64 } from '../services/backup.js';
import { foldText } from '../core/model.js';

export const PATHS = {
  vault: '/vault.json',
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

export function createSyncEngine({ api, getKey, store, pictures = null, repo, device = 'Device', now = () => Date.now(), isBusy = () => false, onStatus = () => {}, onNotice = () => {} }) {
  let meta = null;
  let running = null;
  let again = false;
  let status = { state: 'idle', pending: 0, lastSync: 0, message: '' };

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

  async function uploadJson(key, path, obj, mode) {
    const r = await api.upload(path, await sealJson(key, obj), mode);
    return r.rev;
  }

  // ---- 1. tags ------------------------------------------------------------------------
  async function syncTags(key) {
    const rev = await getRev(PATHS.tags);
    let remote = null;
    if (rev && rev === meta.tags.rev) remote = meta.tags.base;
    else if (rev) {
      const f = await api.download(PATHS.tags);
      remote = f ? await openJson(key, f.bytes) : null;
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
      const newRev = await uploadJson(key, PATHS.tags, merged, rev ? { update: rev } : 'add');
      meta.tags = { rev: newRev, base: merged };
    } else meta.tags = { rev, base: merged };
    saveMeta();
  }

  // ---- 2 + 4. pictures -------------------------------------------------------------------
  function usedPictures() {
    const ids = new Set();
    for (const c of store.canvasList()) for (const it of Object.values(store.canvas(c.id).items)) if (it.thumbId) ids.add(it.thumbId);
    return ids;
  }
  async function uploadPictures(key, remoteImages) {
    if (!pictures) return;
    for (const id of usedPictures()) {
      if (remoteImages.has(id)) continue;
      const p = pictures.blobOf(id);
      if (!p) continue;
      const data = toBase64(new Uint8Array(await p.blob.arrayBuffer()));
      await uploadJson(key, PATHS.image(id), { w: p.w, h: p.h, type: p.blob.type || 'image/webp', data }, 'overwrite');
      remoteImages.add(id);
    }
  }
  async function downloadPictures(key, remoteImages) {
    if (!pictures) return;
    for (const id of usedPictures()) {
      if (pictures.has(id) || !remoteImages.has(id)) continue;
      const f = await api.download(PATHS.image(id));
      if (!f) continue;
      const p = await openJson(key, f.bytes);
      await pictures.importRecord({ id, blob: new Blob([fromBase64(p.data)], { type: p.type || 'image/webp' }), w: p.w, h: p.h });
    }
  }

  // ---- 3. canvases --------------------------------------------------------------------
  async function backup(key, id, doc) {
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    await uploadJson(key, PATHS.backups(id) + '/' + stamp + '-' + device + '.bin', doc, 'add').catch(() => {});
    const { entries } = await api.listFolder(PATHS.backups(id));
    const files = entries.filter(e => e['.tag'] === 'file').sort((a, b) => (a.name < b.name ? 1 : -1));
    for (const old of files.slice(KEEP_BACKUPS)) await api.remove(old.path_lower || PATHS.backups(id) + '/' + old.name).catch(() => {});
  }

  function guardBusy(id) {
    if (id === store.ui.canvasId && isBusy()) throw new Busy();
  }

  async function download(key, id) {
    const f = await api.download(PATHS.canvas(id));
    if (!f) return null;
    const doc = await openJson(key, f.bytes);
    doc.id = id;
    return { doc, rev: f.rev };
  }

  async function syncCanvas(key, id, remoteRev) {
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
        const rev = await uploadJson(key, path, doc, 'add');
        meta.canvases[id] = { rev, base: doc };
      }
    } else if (!L && remoteRev) {
      if (M && M.rev === remoteRev) {                  // deleted here: delete there too
        await api.remove(path);
        delete meta.canvases[id];
      } else {
        const r = await download(key, id);
        if (!r) return;
        if (M) onNotice('“' + r.doc.name + '” was changed on your other device after you deleted it here, so it came back.');
        store.putCanvasFromSync(r.doc);
        meta.canvases[id] = { rev: r.rev || remoteRev, base: r.doc };
      }
    } else if (L && remoteRev) {
      if (M && M.rev === remoteRev) {                  // Dropbox unchanged since we last saw it
        if (!dirtyCanvas(id)) return;
        const doc = clone(L);
        const rev = await uploadJson(key, path, doc, { update: remoteRev });
        meta.canvases[id] = { rev, base: doc };
      } else {                                         // changed on the other device
        const r = await download(key, id);
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
          if (res.losers.has('mine')) await backup(key, id, L);
          if (res.losers.has('theirs')) await backup(key, id, T);
          if (!same(res.doc, L)) store.putCanvasFromSync(res.doc);
          const doc = clone(store.canvas(id));
          const rev = same(doc, T) ? (r.rev || remoteRev) : await uploadJson(key, path, doc, { update: r.rev || remoteRev });
          meta.canvases[id] = { rev, base: doc };
        }
      }
    } else if (M) {
      delete meta.canvases[id];                        // gone on both sides
    }
    saveMeta();
  }

  // First connection: canvases from both devices are kept. A never-synced
  // canvas here that is empty and shares a name with one in Dropbox is
  // dropped (the "My first canvas" every new device starts with); a
  // non-empty one with the same name gets "(PC)" / "(Phone)" added.
  async function firstConnection(key, remote) {
    if (meta.firstDone || !remote.size) return;
    const remoteNames = new Map();
    for (const id of remote.keys()) {
      if (store.canvas(id)) continue;
      const r = await download(key, id);
      if (r) remoteNames.set(r.doc.name, r);
    }
    for (const c of store.canvasList()) {
      if (meta.canvases[c.id] || remote.has(c.id) || !remoteNames.has(c.name)) continue;
      if (c.count === 0 && store.canvasList().length > 0) {
        const r = remoteNames.get(c.name);
        store.putCanvasFromSync(r.doc);
        meta.canvases[r.doc.id] = { rev: r.rev, base: r.doc };
        store.removeCanvasFromSync(c.id);
      } else {
        store.renameCanvas(c.id, c.name + ' (' + device + ')');
      }
    }
  }

  async function cycle() {
    const key = await getKey();
    await loadMeta();
    setStatus({ state: 'syncing', message: '' });
    const [cv, im] = await Promise.all([api.listFolder(PATHS.canvases), api.listFolder(PATHS.images)]);
    const remote = new Map();
    for (const e of cv.entries) { const id = fileId(e); if (id) remote.set(id, e.rev); }
    const remoteImages = new Set(im.entries.map(fileId).filter(Boolean));
    await syncTags(key);
    await firstConnection(key, remote);
    await uploadPictures(key, remoteImages);
    const ids = new Set([...store.canvasList().map(c => c.id), ...remote.keys(), ...Object.keys(meta.canvases)]);
    for (const id of ids) await syncCanvas(key, id, remote.get(id) || null);
    await downloadPictures(key, remoteImages);
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
          setStatus({ state: 'synced', lastSync: now(), pending: 0, message: '' });
        } catch (err) {
          if (err instanceof Busy) { setStatus({ state: 'waiting', message: 'Waiting for you to finish' }); setTimeout(syncNow, 2000); break; }
          if (err && err.kind === 'conflict' && tries++ < 3) { again = true; continue; }
          const kind = err && err.kind;
          const pending = meta ? pendingCount() : 0;
          if (kind === 'offline') setStatus({ state: 'offline', pending, message: 'Offline' });
          else if (kind === 'auth') setStatus({ state: 'auth', pending, message: 'Sign in to Dropbox again' });
          else if (kind === 'full') setStatus({ state: 'full', pending, message: 'Your Dropbox is full' });
          else if (kind === 'locked') setStatus({ state: 'locked', pending, message: err.message });
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
    pendingCount: () => (meta ? pendingCount() : 0)
  };
}
