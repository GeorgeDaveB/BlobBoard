import { assert, assertEqual } from './runner.js';
import { createStore, UNDO_LIMIT } from '../js/core/store.js';
import { newCanvas } from '../js/core/model.js';
import { openRepo } from '../js/persist/localRepo.js';

function setup() {
  const saved = [];
  const repo = { saveCanvas: d => saved.push(d.id) };
  let t = 1000;
  const store = createStore({ repo, now: () => ++t });
  const c = newCanvas('T');
  store.load([c], c.id);
  return { store, saved, c };
}

const count = s => Object.keys(s.canvas().items).length;

export const tests = {
  'create, then undo removes it, redo brings it back': () => {
    const { store } = setup();
    const id = store.createItem({ title: 'a', x: 1, y: 2 });
    assertEqual(store.item(id).title, 'a');
    assert(store.undo());
    assertEqual(count(store), 0);
    assert(store.redo());
    assertEqual(store.item(id).title, 'a');
  },

  'an editor session (same key) is one undo step': () => {
    const { store } = setup();
    const id = store.createItem({}, { coalesce: 'k1' });
    store.updateItem(id, { title: 'H' }, { coalesce: 'k1' });
    store.updateItem(id, { title: 'He' }, { coalesce: 'k1' });
    store.updateItem(id, { notes: 'n' }, { coalesce: 'k1' });
    store.undo();
    assertEqual(count(store), 0, 'one undo removes create + all edits');
    assertEqual(store.canUndo(), false);
  },

  'a new untitled item stays after its editor session; undo removes it': () => {
    const { store } = setup();
    const id = store.createItem({}, { coalesce: 'k2' });
    assertEqual(store.item(id).title, '');
    assertEqual(count(store), 1);
    store.undo();
    assertEqual(count(store), 0);
  },

  'no-op changes record nothing': () => {
    const { store, saved } = setup();
    const id = store.createItem({ x: 5, y: 5 });
    const n = saved.length;
    assertEqual(store.moveItem(id, 5, 5), false);
    assertEqual(store.updateItem(id, { title: '' }), false);
    assertEqual(saved.length, n);
  },

  'moveItem brings the item to the front': () => {
    const { store } = setup();
    const a = store.createItem({});
    const b = store.createItem({});
    store.moveItem(a, 10, 10);
    assert(store.item(a).z > store.item(b).z);
  },

  'moveItems: a drop plus pushed blobs is one undo step': () => {
    const { store } = setup();
    const a = store.createItem({ x: 0, y: 0 });
    const b = store.createItem({ x: 50, y: 0 });
    store.moveItems([{ id: a, x: 10, y: 10 }, { id: b, x: 200, y: 0 }], { raise: a });
    assertEqual([store.item(a).x, store.item(b).x], [10, 200]);
    assert(store.item(a).z > store.item(b).z, 'dropped item on top');
    store.undo();
    assertEqual([store.item(a).x, store.item(b).x], [0, 50]);
  },

  'delete removes everything inside and touching lines; undo restores': () => {
    const { store } = setup();
    const a = store.createItem({ title: 'group' });
    const doc = store.canvas();
    const kid = store.createItem({ title: 'kid', parentId: a });
    const other = store.createItem({ title: 'other' });
    doc.links.l1 = { id: 'l1', from: a, to: other, arrowFrom: false, arrowTo: true, createdAt: 1, updatedAt: 1 };
    store.select(kid);
    store.deleteItem(a);
    assertEqual(count(store), 1);
    assertEqual(Object.keys(store.canvas().links).length, 0);
    assertEqual(store.ui.selectedId, null);
    store.undo();
    assertEqual(count(store), 3);
    assertEqual(Object.keys(store.canvas().links), ['l1']);
  },

  'undo history is capped': () => {
    const { store } = setup();
    for (let i = 0; i < UNDO_LIMIT + 10; i++) store.createItem({});
    let n = 0;
    while (store.undo()) n++;
    assertEqual(n, UNDO_LIMIT);
  },

  'every change is handed to the repo for saving': () => {
    const { store, saved, c } = setup();
    store.createItem({});
    store.undo();
    assertEqual(saved, [c.id, c.id]);
  },

  'device database: save, flush, reload': async () => {
    const dbName = 'blobboard-test-' + Date.now();
    const repo = await openRepo({ dbName });
    const c = newCanvas('Persist me');
    repo.saveCanvas(c);
    repo.setSetting('view:x', { x: 1, y: 2, z: 1.5 });
    await repo.close();
    const again = await openRepo({ dbName });
    const docs = await again.loadCanvases();
    assertEqual(docs.map(d => d.name), ['Persist me']);
    assertEqual(await again.getSetting('view:x'), { x: 1, y: 2, z: 1.5 });
    await again.close();
    await new Promise(r => { const q = indexedDB.deleteDatabase(dbName); q.onsuccess = q.onerror = q.onblocked = r; });
  }
};
