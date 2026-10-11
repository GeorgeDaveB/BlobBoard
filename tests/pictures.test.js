import { assert, assertEqual } from './runner.js';
import { processImage, clampAspect, fitSize, MAX_SIDE } from '../js/services/imageProcessor.js';
import { createPictureLibrary } from '../js/ui/pictures.js';
import { createStore } from '../js/core/store.js';
import { newCanvas } from '../js/core/model.js';
import { createItemEl, updateItemEl } from '../js/ui/itemView.js';
import { createPhysics, setMotion, MOTION } from '../js/ui/physics.js';

// A test picture: w x h PNG drawn on a canvas.
async function pngFile(w, h, name = 'test.png', color = '#36a') {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w / 2, h / 2);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new File([blob], name, { type: 'image/png' });
}

// In-memory stand-in for the device database's picture store.
function memRepo(initial = []) {
  const rows = new Map(initial.map(r => [r.id, r]));
  return {
    rows,
    loadImages: async () => [...rows.values()],
    putImage: async r => { rows.set(r.id, r); },
    deleteImage: async id => { rows.delete(id); }
  };
}

export const tests = {
  'sizes: longest side 640, never enlarged; card shape kept within 0.6–1.6': () => {
    assertEqual(fitSize(1600, 900), { w: 640, h: 360 });
    assertEqual(fitSize(300, 1200), { w: 160, h: 640 });
    assertEqual(fitSize(200, 100), { w: 200, h: 100 });
    assertEqual([clampAspect(100, 100), clampAspect(100, 30), clampAspect(100, 400)], [1, 0.6, 1.6]);
  },

  'process: shrinks to 640 px WebP, fingerprint of the file, same file = same id': async () => {
    const f = await pngFile(1600, 900);
    const a = await processImage(f);
    assertEqual([a.w, a.h], [MAX_SIDE, 360]);
    assert(/^p-[0-9a-f]{64}$/.test(a.id), 'sha-256 id');
    assertEqual(a.blob.type, 'image/webp');
    const b = await processImage(f);
    assertEqual(b.id, a.id, 'stable id');
    const dup = await processImage(f, { knownIds: new Set([a.id]) });
    assertEqual(dup, { id: a.id, duplicate: true }, 'known picture is not processed again');
  },

  'process: a file that is not a picture gets a clear message': async () => {
    let msg = '';
    try { await processImage(new File(['hello'], 'notes.txt', { type: 'text/plain' })); } catch (e) { msg = e.message; }
    assert(msg.includes('notes.txt') && msg.includes('not a picture'), msg);
    msg = '';
    try { await processImage(new File(['garbage bytes'], 'photo.heic', { type: 'image/heic' })); } catch (e) { msg = e.message; }
    assert(msg.includes('can’t be read'), msg);
  },

  'library: add (deduped), newest first, delete hides, restore, purge at start': async () => {
    const repo = memRepo();
    const lib = await createPictureLibrary(repo, []);
    const f1 = await pngFile(800, 400, 'a.png', '#a33');
    const f2 = await pngFile(300, 600, 'b.png', '#3a3');
    const r1 = await lib.add([f1]);
    const r2 = await lib.add([f2, f1]);
    assertEqual([r1.added.length, r2.added.length, r2.existing.length], [1, 1, 1]);
    assertEqual(lib.list().map(r => r.id), [r2.added[0], r1.added[0]], 'newest first');
    const p = lib.get(r2.added[0]);
    assert(p.url.startsWith('blob:') && Math.abs(p.aspect - 1.6) < 1e-9, 'url + clamped aspect');
    await lib.remove(r1.added[0]);
    assertEqual(lib.list().length, 1, 'hidden from the library');
    assert(lib.get(r1.added[0]), 'still shows where used (undo)');
    await lib.restore(r1.added[0]);
    assertEqual(lib.list().length, 2);
    await lib.remove(r1.added[0]);
    await lib.remove(r2.added[0]);
    // Next start: an unused hidden picture is gone; a used one comes back.
    const c = newCanvas('T');
    c.items.x = { id: 'x', thumbId: r2.added[0] };
    const again = await createPictureLibrary(repo, [c]);
    assertEqual(again.list().map(r => r.id), [r2.added[0]]);
    assertEqual(repo.rows.has(r1.added[0]), false, 'removed for good');
  },

  'store: clearPicture puts items back to their colour, undoable as one step': () => {
    let t = 1;
    const store = createStore({ repo: { saveCanvas() {} }, now: () => ++t });
    const c = newCanvas('T');
    store.load([c], c.id);
    const a = store.createItem({ thumbId: 'p-1' });
    const b = store.createItem({ thumbId: 'p-1' });
    const k = store.createItem({ thumbId: 'p-2' });
    assertEqual(store.pictureUses('p-1'), 2);
    assertEqual(store.clearPicture('p-1', { coalesce: 'pd' }), 2);
    assertEqual([store.item(a).thumbId, store.item(b).thumbId, store.item(k).thumbId], [null, null, 'p-2']);
    assertEqual(store.undoStep('pd'), true);
    assertEqual([store.item(a).thumbId, store.item(b).thumbId], ['p-1', 'p-1']);
  },

  'item view: picture + thumbnails on = card with the title on the picture; off = blob': () => {
    const item = { id: 'i1', title: 'Trip', notes: '', notesHtml: '', color: '#ff8a7a', done: false, seed: 5, thumbId: 'p-x' };
    const el = createItemEl(item, { onEdit() {} });
    const pic = { url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', aspect: 1.25 };
    updateItemEl(el, item, { picOf: id => (id === 'p-x' ? pic : null) });
    assert(el.classList.contains('card'), 'card');
    assertEqual(el._parts.title.parentElement, el._parts.pic, 'title sits on the picture');
    assertEqual(el._parts.pic.style.aspectRatio, '1 / 1.25');
    updateItemEl(el, item, { picOf: () => null });
    assert(!el.classList.contains('card') && el._parts.title.parentElement === el._parts.body, 'blob again');
    const mini = createItemEl(item, { onEdit() {}, mini: true });
    updateItemEl(mini, item, { picOf: () => pic });
    assert(mini.classList.contains('pic-blob') && !mini.classList.contains('card'), 'mini = round picture');
    el._phys.dispose();
    mini._phys.dispose();
  },

  'physics: a card keeps a still outline (no idle wobble)': () => {
    const before = { ...MOTION };
    setMotion({ ...before, wobble: true });
    const layer = document.createElement('div'), body = document.createElement('div');
    const h = createPhysics(layer, body, 7);
    h.setCard(true);
    h._shape(1000);
    const a = body.style.borderRadius;
    h._shape(9000);
    assertEqual(body.style.borderRadius, a, 'card: same outline over time');
    h.setCard(false);
    h._shape(1000);
    const b = body.style.borderRadius;
    h._shape(9000);
    assert(body.style.borderRadius !== b, 'blob still wobbles');
    h.dispose();
    setMotion(before);
  }
};
