import { assert, assertEqual } from './runner.js';
import { mergeSet, mergeRecord, mergeCanvas, mergeTags } from '../js/sync/merge.js';
import { createVault, unlockVault, sealJson, openJson } from '../js/sync/vault.js';
import { createSyncEngine, PATHS } from '../js/sync/syncEngine.js';
import { apiArg } from '../js/sync/dropboxApi.js';
import { authorizeUrl, redirectUri, pkcePair } from '../js/sync/dropboxAuth.js';
import { createStore } from '../js/core/store.js';
import { newCanvas } from '../js/core/model.js';

// ---- a fake Dropbox (one shared folder for both "devices") -------------------------
function fakeDropbox() {
  const files = new Map(); // path -> { bytes, rev }
  let n = 0;
  const err = (kind, msg) => Object.assign(new Error(msg), { kind });
  const inFolder = (folder, p) => p.startsWith(folder + '/') && !p.slice(folder.length + 1).includes('/');
  return {
    files,
    async rpc(endpoint, args) {
      if (endpoint === 'files/get_metadata') { const f = files.get(args.path); if (!f) throw err('notfound', 'path/not_found'); return { rev: f.rev }; }
      throw err('other', endpoint);
    },
    async upload(path, bytes, mode) {
      const f = files.get(path);
      if (mode === 'add' && f) throw err('conflict', 'path/conflict/file');
      if (mode && mode.update && (!f || f.rev !== mode.update)) throw err('conflict', 'path/conflict/file');
      const rev = 'r' + (++n);
      files.set(path, { bytes: new Uint8Array(bytes), rev });
      return { rev };
    },
    async download(path) { const f = files.get(path); return f ? { bytes: f.bytes, rev: f.rev } : null; },
    async listFolder(folder) {
      const entries = [...files.entries()].filter(([p]) => inFolder(folder, p)).map(([p, f]) => ({ '.tag': 'file', name: p.slice(folder.length + 1), path_lower: p, rev: f.rev }));
      return { entries, cursor: 'c' };
    },
    async remove(path) { return files.delete(path); }
  };
}

const FAST = { iterations: 20000 };
function device(name, dbx, key, { canvasName = 'My first canvas', clock } = {}) {
  const settings = new Map();
  const repo = { saveCanvas() {}, saveTag() {}, deleteCanvas() {}, getSetting: async k => settings.get(k), setSetting: (k, v) => settings.set(k, v) };
  const store = createStore({ repo, now: clock });
  const c = newCanvas(canvasName, clock());
  store.load([c], c.id, []);
  const pics = new Map();
  const pictures = {
    has: id => pics.has(id),
    blobOf: id => pics.get(id) || null,
    importRecord: async r => { pics.set(r.id, { blob: r.blob, w: r.w, h: r.h }); return true; }
  };
  let busy = false;
  const engine = createSyncEngine({ api: dbx, getKey: async () => key, store, pictures, repo, device: name, now: clock, isBusy: () => busy });
  return { store, engine, pics, settings, setBusy: b => { busy = b; } };
}
async function twoDevices() {
  let t = 1000;
  const clock = () => ++t;
  const dbx = fakeDropbox();
  const { key } = await createVault('correct horse', FAST);
  return { dbx, key, A: device('PC', dbx, key, { clock }), B: device('Phone', dbx, key, { clock }), clock };
}

export const tests = {
  // ---- merge rules ----
  'merge: tag lists combine adds and removes from both sides': () => {
    assertEqual(mergeSet(['a', 'b'], ['a', 'b', 'c'], ['b', 'd']), ['b', 'c', 'd']);
  },

  'merge: different fields both kept; same field -> newer wins and the loser is reported': () => {
    const base = { title: 'T', notes: 'n', updatedAt: 1 };
    const r1 = mergeRecord(base, { title: 'Mine', notes: 'n', updatedAt: 5 }, { title: 'T', notes: 'Theirs', updatedAt: 6 });
    assertEqual([r1.value.title, r1.value.notes, r1.conflicts], ['Mine', 'Theirs', []]);
    const r2 = mergeRecord(base, { title: 'Mine', updatedAt: 5 }, { title: 'Theirs', updatedAt: 9 });
    assertEqual([r2.value.title, r2.conflicts, r2.loser], ['Theirs', ['title'], 'mine']);
  },

  'merge: deleted on one side and edited on the other = kept; untouched = deleted; repairs': () => {
    const base = newCanvas('B', 1);
    base.items.a = { id: 'a', parentId: null, title: 'A', updatedAt: 1 };
    base.items.b = { id: 'b', parentId: null, title: 'B', updatedAt: 1 };
    base.items.k = { id: 'k', parentId: 'b', title: 'K', updatedAt: 1 };
    const mine = JSON.parse(JSON.stringify(base));
    const theirs = JSON.parse(JSON.stringify(base));
    delete mine.items.a;                                 // I deleted a
    theirs.items.a.title = 'A edited'; theirs.items.a.updatedAt = 2; // they edited a
    delete theirs.items.b;                               // they deleted b (k's group)
    const { doc } = mergeCanvas(base, mine, theirs);
    assertEqual(doc.items.a.title, 'A edited', 'edit wins over delete');
    assert(!doc.items.b, 'untouched delete goes through');
    assertEqual(doc.items.k.parentId, null, 'orphan moves to the top level');
    const t = mergeTags([{ id: 't', name: 'X', updatedAt: 1 }], [{ id: 't', name: 'Y', updatedAt: 2 }], [{ id: 't', name: 'X', updatedAt: 1 }, { id: 'u', name: 'New', updatedAt: 3 }]);
    assertEqual(t.tags.map(x => x.name).sort(), ['New', 'Y']);
  },

  // ---- encryption ----
  'vault: right passphrase unlocks, wrong one does not; sealed JSON round-trips': async () => {
    const { key, file } = await createVault('correct horse', FAST);
    assert(await unlockVault(file, 'correct horse'), 'unlocks');
    assertEqual(await unlockVault(file, 'wrong horse!'), null);
    const sealed = await sealJson(key, { title: 'Γεια σου' });
    assert(!new TextDecoder().decode(sealed).includes('Γεια'), 'scrambled');
    assertEqual(await openJson(key, sealed), { title: 'Γεια σου' });
    let msg = '';
    try { await createVault('short', FAST); } catch (e) { msg = e.message; }
    assert(msg.includes('8'), 'minimum length');
  },

  // ---- sign-in pieces ----
  'sign-in: redirect = this folder; authorize URL asks for offline access with PKCE': async () => {
    assertEqual(redirectUri({ origin: 'https://georgedaveb.github.io', pathname: '/BlobBoard/index.html' }), 'https://georgedaveb.github.io/BlobBoard/');
    assertEqual(redirectUri({ origin: 'http://localhost:8000', pathname: '/' }), 'http://localhost:8000/');
    const { verifier, challenge } = await pkcePair();
    assert(verifier.length >= 43 && /^[A-Za-z0-9_-]+$/.test(challenge), 'PKCE values');
    const u = new URL(authorizeUrl({ challenge, state: 's1', redirect: 'http://localhost:8000/', appKey: 'k' }));
    assertEqual([u.searchParams.get('code_challenge_method'), u.searchParams.get('token_access_type'), u.searchParams.get('response_type')], ['S256', 'offline', 'code']);
    assertEqual(apiArg({ path: '/ά' }), '{"path":"/\\u03ac"}', 'header stays ASCII');
  },

  // ---- two devices ----
  'two devices: first connection — A’s canvas reaches B; B’s empty starter canvas is dropped; files encrypted': async () => {
    const { dbx, A, B } = await twoDevices();
    const x = A.store.createItem({ title: 'Secret plan', x: 10, y: 10 });
    await A.engine.syncNow();
    assertEqual(A.engine.status.state, 'synced');
    const path = PATHS.canvas(A.store.ui.canvasId);
    assert(dbx.files.has(path), 'uploaded');
    assert(!new TextDecoder().decode(dbx.files.get(path).bytes).includes('Secret plan'), 'Dropbox only has scrambled bytes');
    await B.engine.syncNow();
    assertEqual(B.store.canvasList().map(c => c.name), ['My first canvas']);
    assertEqual(B.store.canvas(A.store.ui.canvasId).items[x].title, 'Secret plan');
  },

  'two devices: edits to different fields of the same item are both kept': async () => {
    const { A, B } = await twoDevices();
    const x = A.store.createItem({ title: 'T' });
    await A.engine.syncNow();
    await B.engine.syncNow();
    B.store.switchCanvas(A.store.ui.canvasId);
    A.store.updateItem(x, { title: 'Title from PC' });
    B.store.updateItem(x, { notes: 'Notes from phone' });
    await A.engine.syncNow();
    await B.engine.syncNow();   // merges
    await A.engine.syncNow();   // takes the merge
    for (const d of [A, B]) {
      const it = d.store.canvas(A.store.ui.canvasId).items[x];
      assertEqual([it.title, it.notes], ['Title from PC', 'Notes from phone']);
    }
  },

  'two devices: same field on both -> newer wins, the other version goes to backups': async () => {
    const { dbx, A, B } = await twoDevices();
    const cid = A.store.ui.canvasId;
    const x = A.store.createItem({ title: 'T' });
    await A.engine.syncNow();
    await B.engine.syncNow();
    A.store.updateItem(x, { title: 'Older (PC)' });
    B.store.updateItem(x, { title: 'Newer (Phone)' });
    await A.engine.syncNow();
    await B.engine.syncNow();
    await A.engine.syncNow();
    assertEqual([A.store.canvas(cid).items[x].title, B.store.canvas(cid).items[x].title], ['Newer (Phone)', 'Newer (Phone)']);
    assert([...dbx.files.keys()].some(p => p.startsWith(PATHS.backups(cid) + '/')), 'backup written');
  },

  'two devices: delete a canvas on one = deleted on the other; edited there = kept': async () => {
    const { A, B } = await twoDevices();
    const keep = A.store.ui.canvasId;
    const extra = A.store.createCanvas('Extra');
    await A.engine.syncNow();
    await B.engine.syncNow();
    assert(B.store.canvas(extra), 'B has it');
    A.store.deleteCanvas(extra);
    await A.engine.syncNow();
    await B.engine.syncNow();
    assertEqual(B.store.canvas(extra), null, 'deleted on B too');
    // Delete on A while B edits: B's edit wins, it comes back to A.
    const more = A.store.createCanvas('More');
    await A.engine.syncNow();
    await B.engine.syncNow();
    A.store.deleteCanvas(more);
    B.store.switchCanvas(more);
    B.store.createItem({ title: 'Edited on phone' });
    await B.engine.syncNow();
    await A.engine.syncNow();
    assert(A.store.canvas(more), 'came back to A');
    assert(keep);
  },

  'two devices: the same tag made on both becomes one tag; items follow': async () => {
    const { A, B } = await twoDevices();
    const cid = A.store.ui.canvasId;
    const x = A.store.createItem({ title: 'X' });
    await A.engine.syncNow();
    await B.engine.syncNow();
    const ta = A.store.ensureTag('Work');
    A.store.updateItem(x, { tagIds: [ta] });
    const tb = B.store.ensureTag('work');
    await A.engine.syncNow();
    await B.engine.syncNow();
    await A.engine.syncNow();
    assertEqual(B.store.tags().map(t => t.name), ['Work']);
    assertEqual(B.store.canvas(cid).items[x].tagIds, [ta]);
    assert(tb !== ta);
  },

  'two devices: pictures travel (encrypted); waits while you are busy': async () => {
    const { dbx, A, B } = await twoDevices();
    const pid = 'p-' + 'b'.repeat(64);
    A.pics.set(pid, { blob: new Blob([new Uint8Array([7, 7, 7])], { type: 'image/webp' }), w: 4, h: 3 });
    A.store.createItem({ title: 'Pic', thumbId: pid });
    await A.engine.syncNow();
    assert(dbx.files.has(PATHS.image(pid)), 'picture uploaded');
    await B.engine.syncNow();
    assertEqual([B.pics.has(pid), B.pics.get(pid).w], [true, 4]);
    // Busy on B's current canvas: the change waits.
    B.store.switchCanvas(A.store.ui.canvasId);
    A.store.createItem({ title: 'While busy' });
    await A.engine.syncNow();
    B.setBusy(true);
    await B.engine.syncNow();
    assertEqual(B.engine.status.state, 'waiting');
    B.setBusy(false);
    await B.engine.syncNow();
    assert(Object.values(B.store.canvas(A.store.ui.canvasId).items).some(i => i.title === 'While busy'));
  }
};
