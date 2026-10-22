// Runs Dropbox sync for the app (phase 8): sign-in state, the sync
// passphrase (vault), and WHEN to sync —
//   · on start, and when the app comes back to the front or back online
//   · 2 s after you stop changing things (at most 10 s while you keep going)
//   · when Dropbox says something changed (long-poll), else every 60 s
// The UI (ui/syncPanel.js) asks for the passphrase and shows the state.
import { createDropboxAuth } from './dropboxAuth.js';
import { createDropboxApi } from './dropboxApi.js';
import { createVault, unlockVault, open } from './vault.js';
import { createSyncEngine, PATHS } from './syncEngine.js';
import { fromBase64 } from '../services/backup.js';

const QUIET_MS = 2000, MAX_WAIT_MS = 10000, SAFETY_MS = 60000;

export function createSyncController({ repo, store, pictures, isBusy = () => false, device = 'Device', onChange = () => {}, onNotice = () => {} }) {
  const auth = createDropboxAuth({ repo });
  const api = createDropboxApi({ getToken: () => auth.getToken(), refresh: () => auth.refresh() });
  let key = null;
  let vaultRev = null;
  let engine = null;
  let phase = 'off';         // off | locked | on | stopped
  let status = { state: 'off' };
  let timer = 0, firstChange = 0, safety = 0, polling = false, stopped = false;

  const emit = () => onChange({ phase, ...status, pending: engine ? engine.pendingCount() : 0 });
  const lockedError = msg => Object.assign(new Error(msg), { kind: 'locked' });

  async function readVault() {
    const f = await api.download(PATHS.vault);
    if (!f) return null;
    return { file: JSON.parse(new TextDecoder().decode(f.bytes)), rev: f.rev };
  }

  // Before every cycle: still the same vault? (Another device may have
  // started over with a new passphrase.)
  async function getKey() {
    if (!key) throw lockedError('Type your sync passphrase');
    let rev = null;
    try { rev = (await api.rpc('files/get_metadata', { path: PATHS.vault })).rev; } catch (err) { if (err.kind !== 'notfound') throw err; }
    if (rev && rev !== vaultRev) {
      const v = await readVault();
      let ok = false;
      try { ok = !!v && (await open(key, fromBase64(v.file.check))) && true; } catch (_) { ok = false; }
      if (!ok) { key = null; await repo.setSetting('syncKey', null); phase = 'locked'; throw lockedError('The sync passphrase was changed on another device — type the new one'); }
      vaultRev = rev;
      repo.setSetting('syncVaultRev', rev);
    }
    if (!rev) throw lockedError('The Dropbox folder was emptied — set up sync again');
    return key;
  }

  function start() {
    phase = 'on';
    stopped = false;
    engine = createSyncEngine({
      api, getKey, store, pictures, repo, device, isBusy,
      onStatus: s => { status = s; if (s.state === 'locked') phase = 'locked'; emit(); },
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

  return {
    get phase() { return phase; },
    get status() { return { phase, ...status, pending: engine ? engine.pendingCount() : 0 }; },

    // On start: finish a sign-in we came back from; resume if already set up.
    // Returns the sign-in result ('connected' | 'denied' | 'failed' | null).
    async init() {
      const back = await auth.handleRedirect();
      if (await auth.isConnected()) {
        key = (await repo.getSetting('syncKey')) || null;
        vaultRev = (await repo.getSetting('syncVaultRev')) || null;
        if (key) start(); else { phase = 'locked'; status = { state: 'locked' }; emit(); }
      } else emit();
      return back;
    },

    connect: () => auth.connect(),

    // Does Dropbox already hold a vault (another device set up sync)?
    async hasVault() { return !!(await readVault()); },

    // First device: choose the passphrase.
    async createPassphrase(passphrase) {
      const { key: k, file } = await createVault(passphrase);
      let r;
      try { r = await api.upload(PATHS.vault, new TextEncoder().encode(JSON.stringify(file)), 'add'); } catch (err) {
        if (err.kind === 'conflict') return 'exists';
        throw err;
      }
      key = k;
      vaultRev = r.rev;
      await repo.setSetting('syncKey', k);
      repo.setSetting('syncVaultRev', r.rev);
      start();
      return 'ok';
    },

    // Another device: type the passphrase. false = wrong.
    async unlock(passphrase) {
      const v = await readVault();
      if (!v) return 'none';
      const k = await unlockVault(v.file, passphrase);
      if (!k) return false;
      key = k;
      vaultRev = v.rev;
      await repo.setSetting('syncKey', k);
      repo.setSetting('syncVaultRev', v.rev);
      start();
      return true;
    },

    // Forgot the passphrase: empties the SlimeGate folder and uploads this
    // device's boards under a new passphrase.
    async startOver(passphrase) {
      const { entries } = await api.listFolder('');
      for (const e of entries) await api.remove(e.path_lower || '/' + e.name);
      stop();
      const e2 = createSyncEngine({ api, getKey: async () => null, store, repo });
      await e2.reset();
      return this.createPassphrase(passphrase);
    },

    syncNow() { if (engine) return engine.syncNow(); },

    async disconnect() {
      stop();
      await auth.disconnect();
      key = null;
      await repo.setSetting('syncKey', null);
      repo.setSetting('sync', null);
      repo.setSetting('syncVaultRev', null);
      phase = 'off';
      status = { state: 'off' };
      emit();
    },

    // Another window took over: stop syncing here.
    pause() { stop(); phase = 'stopped'; status = { state: 'stopped' }; emit(); }
  };
}
