// Runs cloud sync for the app (phase 8; today the cloud is Dropbox):
// sign-in state and WHEN to sync —
//   · on start, and when the app comes back to the front or back online
//   · 2 s after you stop changing things (at most 10 s while you keep going)
//   · when the cloud says something changed (long-poll), else every 60 s
// Passwords are per canvas (owner 2026-10-26; Password ▸ in the canvas
// menu): a canvas this device can't open yet is listed in status.needs and
// unlocked with unlockCanvas(). The UI is ui/syncPanel.js.
import { createDropboxAuth } from './dropboxAuth.js';
import { createDropboxApi } from './dropboxApi.js';
import { createSyncEngine } from './syncEngine.js';
import { unlockWith } from '../services/canvasLock.js';

const QUIET_MS = 2000, MAX_WAIT_MS = 10000, SAFETY_MS = 60000;

// api: another cloud's storage with the same calls (tests use a fake one).
export function createSyncController({ repo, store, pictures, keys = null, isBusy = () => false, device = 'Device', onChange = () => {}, onNotice = () => {}, api: cloud = null }) {
  const auth = createDropboxAuth({ repo });
  const api = cloud || createDropboxApi({ getToken: () => auth.getToken(), refresh: () => auth.refresh() });
  let engine = null;
  let phase = 'off';         // off | on | stopped
  let status = { state: 'off' };
  let timer = 0, firstChange = 0, safety = 0, polling = false, stopped = false;

  const emit = () => onChange({ phase, ...status, pending: engine ? engine.pendingCount() : 0 });

  function start() {
    phase = 'on';
    stopped = false;
    engine = createSyncEngine({
      api, keys, store, pictures, repo, device, isBusy,
      onStatus: s => { status = s; emit(); },
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

    // On start: finish a sign-in we came back from; resume if connected.
    // Returns the sign-in result ('connected' | 'denied' | 'failed' | null).
    async init() {
      const back = await auth.handleRedirect();
      if (await auth.isConnected()) start(); else emit();
      return back;
    },

    connect: () => auth.connect(),

    // For tests and a sign-in that just finished: start syncing.
    begin() { if (phase !== 'on') start(); },

    // A canvas this device can't open yet: its password. true / false (wrong) / null (not in the cloud).
    async unlockCanvas(id, password) {
      if (!engine) return null;
      const r = await engine.remoteLock(id);
      if (!r) return null;
      const key = await unlockWith(r.lock, password);
      if (!key) return false;
      if (keys) keys.set(id, key);
      await engine.syncNow();
      return true;
    },

    // Empties the cloud folder and uploads this device's boards.
    async startOver() {
      const { entries } = await api.listFolder('');
      for (const e of entries) await api.remove(e.path_lower || '/' + e.name);
      stop();
      const e2 = createSyncEngine({ api, store, repo });
      await e2.reset();
      start();
    },

    syncNow() { if (engine) return engine.syncNow(); },

    async disconnect() {
      stop();
      await auth.disconnect();
      repo.setSetting('sync', null);
      phase = 'off';
      status = { state: 'off' };
      emit();
    },

    // Another window took over: stop syncing here.
    pause() { stop(); phase = 'stopped'; status = { state: 'stopped' }; emit(); }
  };
}
