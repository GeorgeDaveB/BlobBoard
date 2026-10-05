// Saves and loads everything on this device. Canvas saves are batched
// (~300 ms) and flushed immediately when the app goes to the background.
import { openDb, DB_NAME } from './db.js';
import { migrateCanvas } from '../core/migrate.js';

const SAVE_DELAY = 300;

export async function openRepo({ dbName = DB_NAME } = {}) {
  const db = await openDb(dbName);
  const pendingCanvases = new Map();
  const pendingSettings = new Map();
  let timer = 0;
  let flushing = Promise.resolve();

  function schedule() {
    if (!timer) timer = setTimeout(() => repo.flush(), SAVE_DELAY);
  }

  const repo = {
    async loadCanvases() {
      const docs = await db.getAll('canvases');
      const out = [];
      for (const d of docs) {
        try {
          out.push(migrateCanvas(d));
        } catch (err) {
          console.error('Skipped canvas', d && d.id, err);
        }
      }
      return out;
    },

    saveCanvas(doc) {
      pendingCanvases.set(doc.id, doc);
      schedule();
    },

    async getSetting(key) {
      if (pendingSettings.has(key)) return pendingSettings.get(key);
      const row = await db.get('settings', key);
      return row ? row.value : undefined;
    },

    setSetting(key, value) {
      pendingSettings.set(key, value);
      schedule();
    },

    // Writes everything pending. Each canvas save also marks it "dirty" so
    // sync (phase 8) knows it needs uploading.
    flush() {
      clearTimeout(timer);
      timer = 0;
      const canvases = [...pendingCanvases.values()];
      const settings = [...pendingSettings.entries()];
      pendingCanvases.clear();
      pendingSettings.clear();
      flushing = flushing.then(async () => {
        if (canvases.length) {
          await db.putMany('canvases', canvases);
          await db.putMany('syncMeta', canvases.map(c => ({ id: c.id, dirty: true })));
        }
        if (settings.length) {
          await db.putMany('settings', settings.map(([key, value]) => ({ key, value })));
        }
      }).catch(err => console.error('Save failed', err));
      return flushing;
    },

    close() {
      return repo.flush().then(() => db.close());
    }
  };

  return repo;
}
