// Runs cloud sync for the app (phase 8; today the cloud is Dropbox): sign-in
// state, the folder's optional sync password, and WHEN to sync —
//   · on start, and when the app comes back to the front or back online
//   · 2 s after you stop changing things (at most 10 s while you keep going)
//   · when the cloud says something changed (long-poll), else every 60 s
// The cloud folder's vault.json says whether it has a sync password
// (owner 2026-10-26: optional, can be added / removed / changed later).
// The UI (ui/syncPanel.js) asks the questions and shows the state.
import { createDropboxAuth } from './dropboxAuth.js';
import { createDropboxApi } from './dropboxApi.js';
import { createVault, unlockVault, open, encodeJson, decodeJson, plainVault, vaultMode } from './vault.js';
import { createSyncEngine, PATHS } from './syncEngine.js';
import { fromBase64 } from '../services/backup.js';

const QUIET_MS = 2000, MAX_WAIT_MS = 10000, SAFETY_MS = 60000;

// api: another cloud's storage with the same calls (tests use a fake one).
export function createSyncController({ repo, store, pictures, isBusy = () => false, device = 'Device', onChange = () => {}, onNotice = () => {}, api: cloud = null }) {
  const auth = createDropboxAuth({ repo });
  const api = cloud || createDropboxApi({ getToken: () => auth.getToken(), refresh: () => auth.refresh() });
  let key = null;            // CryptoKey when the folder has a sync password
  let mode = null;           // 'plain' | 'password' (what this device last saw)
  let vaultRev = null;
  let engine = null;
  let phase = 'off';         // off | setup (connected, folder not chosen/unlocked) | on | stopped
  let status = { state: 'off' };
  let timer = 0, firstChange = 0, safety = 0, polling = false, stopped = false;

  const emit = () => onChange({ phase, mode, ...status, pending: engine ? engine.pendingCount() : 0 });
  const lockedError = msg => Object.assign(new Error(msg), { kind: 'locked' });
  const enc = obj => new TextEncoder().encode(JSON.stringify(obj));

  async function readVault() {
    const f = await api.download(PATHS.vault);
    if (!f) return null;
    return { file: JSON.parse(new TextDecoder().decode(f.bytes)), rev: f.rev };
  }

  async function remember(k, m, rev) {
    key = k;
    mode = m;
    vaultRev = rev;
    await repo.setSetting('syncKey', k);
    repo.setSetting('syncMode', m);
    repo.setSetting('syncVaultRev', rev);
  }

  // Before every cycle: is the folder still kept the way we think? (Another
  // device may have added, removed or changed the sync password.)
  async function getKey() {
    let rev = null;
    try { rev = (await api.rpc('files/get_metadata', { path: PATHS.vault })).rev; } catch (err) { if (err.kind !== 'notfound') throw err; }
    if (!rev) { phase = 'setup'; throw lockedError('The cloud folder was emptied — set up sync again'); }
    if (rev !== vaultRev) {
      const v = await readVault();
      if (vaultMode(v.file) === 'plain') {
        if (mode === 'password') onNotice('The sync password was removed on your other device.');
        await remember(null, 'plain', v.rev);
      } else {
        let ok = false;
        try { ok = !!key && (await open(key, fromBase64(v.file.check))) && true; } catch (_) { ok = false; }
        if (!ok) {
          await remember(null, 'password', null);
          phase = 'setup';
          throw lockedError('Your other device set a new sync password — type it here');
        }
        vaultRev = v.rev;
        repo.setSetting('syncVaultRev', v.rev);
      }
    }
    if (mode === 'password' && !key) { phase = 'setup'; throw lockedError('Type your sync password'); }
    return mode === 'plain' ? null : key;
  }

  function start() {
    phase = 'on';
    stopped = false;
    engine = createSyncEngine({
      api, getKey, store, pictures, repo, device, isBusy,
      onStatus: s => { status = s; if (s.state === 'locked') phase = 'setup'; emit(); },
      onNotice
    });
    engine.syncNow();
    longpoll();
    clearInterval(safety);
    safety = setInterval(() => { if (phase === 'on' && document.visibilityState === 'visible') engine.syncNow(); }, SAFETY_MS);
    emit();
  }

  function stop() {
    stopped = true;
    clearTimeout(timer);
    clearInterval(safety);
    engine = null;
  }

  async function longpoll() {
    if (polling) return;
    polling = true;
    while (!stopped && phase === 'on') {
      try {
        const cursor = await api.latestCursor('');
        const r = await api.longpoll(cursor, 60);
        if (stopped) break;
        if (r.changes && engine) await engine.syncNow();
        if (r.backoff) await new Promise(res => setTimeout(res, r.backoff * 1000));
      } catch (_) {
        await new Promise(res => setTimeout(res, 30000)); // offline / error: try later
      }
    }
    polling = false;
  }

  // Local edits: sync shortly after you stop (changes from sync itself don't count).
  store.on(change => {
    if (change.remote || phase !== 'on' || !engine) return;
    if (!['data', 'canvases', 'tags'].includes(change.type)) return;
    const t = Date.now();
    if (!firstChange) firstChange = t;
    clearTimeout(timer);
    const delay = Math.max(0, Math.min(QUIET_MS, firstChange + MAX_WAIT_MS - t));
    timer = setTimeout(() => { firstChange = 0; if (engine) engine.syncNow(); }, delay);
    status = { ...status, state: status.state === 'synced' ? 'saving' : status.state };
    emit();
  });
  document.addEventListener('visibilitychange', () => { if (phase === 'on' && engine) engine.syncNow(); });
  window.addEventListener('online', () => { if (phase === 'on' && engine) engine.syncNow(); });

  // Every synced file rewritten for a new key (null = no password), then
  // vault.json last. Used to add / remove / change the sync password.
  async function rewriteAll(oldKey, newKey, vaultFile, onProgress) {
    const { entries } = await api.listFolder('', { recursive: true });
    const files = entries.filter(e => e['.tag'] === 'file' && e.name.endsWith('.bin'));
    let done = 0;
    for (const e of files) {
      const path = e.path_display || e.path_lower;
      const f = await api.download(path);
      if (f) {
        const obj = await decodeJson(oldKey, f.bytes);
        await api.upload(path, await encodeJson(newKey, obj), 'overwrite');
      }
      if (onProgress) onProgress(++done, files.length);
    }
    const r = await api.upload(PATHS.vault, enc(vaultFile), 'overwrite');
    return r.rev;
  }

  return {
    get phase() { return phase; },
    get mode() { return mode; },
    get status() { return { phase, mode, ...status, pending: engine ? engine.pendingCount() : 0 }; },

    // On start: finish a sign-in we came back from; resume if already set up.
    // Returns the sign-in result ('connected' | 'denied' | 'failed' | null).
    async init() {
      const back = await auth.handleRedirect();
      if (await auth.isConnected()) {
        key = (await repo.getSetting('syncKey')) || null;
        mode = (await repo.getSetting('syncMode')) || (key ? 'password' : null);
        vaultRev = (await repo.getSetting('syncVaultRev')) || null;
        if (mode === 'plain' || (mode === 'password' && key)) start();
        else { phase = 'setup'; status = { state: 'locked' }; emit(); }
      } else emit();
      return back;
    },

    connect: () => auth.connect(),

    // How the cloud folder is kept: 'plain' | 'password' | null (not set up yet).
    async folderMode() { const v = await readVault(); return v ? vaultMode(v.file) : null; },

    // First device: keep the folder with a sync password (string) or without
    // (null). 'exists' if another device set it up meanwhile.
    async createFolder(password) {
      let k = null, file = plainVault();
      if (password) ({ key: k, file } = await createVault(password));
      let r;
      try { r = await api.upload(PATHS.vault, enc(file), 'add'); } catch (err) {
        if (err.kind === 'conflict') return 'exists';
        throw err;
      }
      await remember(k, password ? 'password' : 'plain', r.rev);
      start();
      return 'ok';
    },

    // A folder without a password: just join it.
    async join() {
      const v = await readVault();
      if (!v) return 'none';
      if (vaultMode(v.file) !== 'plain') return 'password';
      await remember(null, 'plain', v.rev);
      start();
      return 'ok';
    },

    // A folder with a sync password: type it. false = wrong.
    async unlock(password) {
      const v = await readVault();
      if (!v) return 'none';
      if (vaultMode(v.file) === 'plain') return this.join();
      const k = await unlockVault(v.file, password);
      if (!k) return false;
      await remember(k, 'password', v.rev);
      start();
      return true;
    },

    // Add (string), remove (null) or change the sync password: every file in
    // the folder is rewritten. Your other devices follow (asked once for a
    // new password).
    async setPassword(password, onProgress) {
      if (phase !== 'on') throw new Error('Sync is not on');
      const oldKey = mode === 'password' ? key : null;
      if (engine) await engine.syncNow();
      stop();
      let k = null, file = plainVault();
      if (password) ({ key: k, file } = await createVault(password));
      try {
        const rev = await rewriteAll(oldKey, k, file, onProgress);
        await remember(k, password ? 'password' : 'plain', rev);
      } finally {
        start();
      }
    },

    // Forgot the sync password: empties the cloud folder and uploads this
    // device's boards (with a new password, or none).
    async startOver(password) {
      const { entries } = await api.listFolder('');
      for (const e of entries) await api.remove(e.path_lower || '/' + e.name);
      stop();
      const e2 = createSyncEngine({ api, getKey: async () => null, store, repo });
      await e2.reset();
      return this.createFolder(password);
    },

    syncNow() { if (engine) return engine.syncNow(); },

    async disconnect() {
      stop();
      await auth.disconnect();
      await remember(null, null, null);
      repo.setSetting('sync', null);
      phase = 'off';
      status = { state: 'off' };
      emit();
    },

    // Another window took over: stop syncing here.
    pause() { stop(); phase = 'stopped'; status = { state: 'stopped' }; emit(); }
  };
}
