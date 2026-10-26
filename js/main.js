// Start-up sequence (design §8.0). Phase 1: device storage only.
import { openRepo } from './persist/localRepo.js';
import { createStore } from './core/store.js';
import { newCanvas, sanitizeCanvas, sanitizeTag } from './core/model.js';
import { mountApp } from './ui/app.js';
import { createPictureLibrary } from './ui/pictures.js';
import { acquireWindowLock, showLostLock } from './ui/windowLock.js';
import { createKeyStore } from './persist/canvasKeys.js';

async function boot() {
  // Phase 8: one window at a time (the other stops and says so).
  let app = null;
  let repoRef = null;
  await acquireWindowLock({ onLost: () => { if (repoRef) repoRef.flush(); if (app && app.sync) app.sync.pause(); showLostLock(); } });
  const repo = await openRepo();
  repoRef = repo;
  let canvases = (await repo.loadCanvases()).map(c => sanitizeCanvas(c).doc);
  if (!canvases.length) {
    const first = newCanvas('My first canvas');
    canvases = [first];
    repo.saveCanvas(first);
  }
  const lastId = await repo.getSetting('lastCanvasId');
  const current = canvases.find(c => c.id === lastId) || canvases[0];
  repo.setSetting('lastCanvasId', current.id);

  // Tags (phase 5): repaired; deleted ones that nothing uses any more are
  // removed for good (a delete undone before closing is kept).
  const used = new Set();
  for (const c of canvases) for (const it of Object.values(c.items)) for (const t of it.tagIds) used.add(t);
  const tags = [];
  for (const raw of await repo.loadTags().catch(() => [])) {
    const t = sanitizeTag(raw);
    if (!t) continue;
    if (t.deleted && !used.has(t.id)) { repo.deleteTag(t.id); continue; }
    if (t.deleted) { delete t.deleted; repo.saveTag(t); }
    tags.push(t);
  }

  const store = createStore({ repo });
  store.load(canvases, current.id, tags);
  // Picture library (phase 4); a broken one never stops the app.
  const pictures = await createPictureLibrary(repo, canvases).catch(err => { console.error('Pictures unavailable', err); return null; });

  // Canvas passwords: the keys this device has unlocked (owner 2026-10-26).
  const keys = await createKeyStore(repo);

  app = mountApp({ root: document.getElementById('app'), store, repo, pictures, keys });

  // Save right away when the app is hidden or closed (phones kill background apps).
  document.addEventListener('visibilitychange', () => { if (document.hidden) repo.flush(); });
  window.addEventListener('pagehide', () => repo.flush());

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

boot().catch(err => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = 'BlobBoard could not start: ' + (err && err.message ? err.message : err);
  document.body.append(box);
});
