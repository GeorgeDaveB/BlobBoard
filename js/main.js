// Start-up sequence (design §8.0). Phase 1: device storage only.
import { openRepo } from './persist/localRepo.js';
import { createStore } from './core/store.js';
import { newCanvas, sanitizeCanvas } from './core/model.js';
import { mountApp } from './ui/app.js';

async function boot() {
  const repo = await openRepo();
  let canvases = (await repo.loadCanvases()).map(c => sanitizeCanvas(c).doc);
  if (!canvases.length) {
    const first = newCanvas('My first canvas');
    canvases = [first];
    repo.saveCanvas(first);
  }
  const lastId = await repo.getSetting('lastCanvasId');
  const current = canvases.find(c => c.id === lastId) || canvases[0];
  repo.setSetting('lastCanvasId', current.id);

  const store = createStore({ repo });
  store.load(canvases, current.id);

  mountApp({ root: document.getElementById('app'), store, repo });

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
