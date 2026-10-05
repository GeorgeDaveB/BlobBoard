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

  'reparent: goes inside, loses its lines, lands at the end of the tray': () => {
    const { store } = setup();
    const g = store.createItem({ title: 'group' });
    const k1 = store.createItem({ parentId: g });
    const a = store.createItem({ title: 'a' });
    const b = store.createItem({ title: 'b' });
    const doc = store.canvas();
    doc.links.l1 = { id: 'l1', from: a, to: b, arrowFrom: false, arrowTo: false, createdAt: 1, updatedAt: 1 };
    assert(store.reparentItem(a, g, 50, 60));
    const it = store.item(a);
    assertEqual([it.parentId, it.x, it.y], [g, 50, 60]);
    assert(it.order > store.item(k1).order, 'end of tray');
    assertEqual(Object.keys(store.canvas().links).length, 0, 'line removed (R23)');
  },

  'reparent: refuses loops, and undo restores in one step with pushes': () => {
    const { store } = setup();
    const g = store.createItem({ x: 0, y: 0 });
    const kid = store.createItem({ parentId: g });
    assertEqual(store.reparentItem(g, kid, 0, 0), false, 'not into its own child');
    assertEqual(store.reparentItem(g, g, 0, 0), false);
    const other = store.createItem({ x: 10, y: 10 });
    store.reparentItem(kid, null, 5, 5, { pushes: [{ id: other, x: 300, y: 10 }] });
    assertEqual([store.item(kid).parentId, store.item(other).x], [null, 300]);
    store.undo();
    assertEqual([store.item(kid).parentId, store.item(other).x], [g, 10]);
  },

  'expand: one per level, nested inside, tap again collapses, any item can expand': () => {
    const { store } = setup();
    const a = store.createItem({});
    const b = store.createItem({});
    const a1 = store.createItem({ parentId: a });
    store.createItem({ parentId: a1 });
    store.createItem({ parentId: b });
    const lonely = store.createItem({});
    store.toggleExpand(a);
    assertEqual(store.ui.expanded, [a]);
    store.toggleExpand(a1);
    assertEqual(store.ui.expanded, [a, a1], 'nested');
    store.toggleExpand(b);
    assertEqual(store.ui.expanded, [b], 'other top-level item replaces (C2)');
    store.toggleExpand(b);
    assertEqual(store.ui.expanded, [], 'tap again collapses');
    store.toggleExpand(lonely);
    assertEqual(store.ui.expanded, [lonely], 'items with nothing inside expand too (full notes + add tile)');
  },

  'expanded path is repaired when an expanded item is deleted or moved': () => {
    const { store } = setup();
    const a = store.createItem({});
    const a1 = store.createItem({ parentId: a });
    store.toggleExpand(a);
    store.toggleExpand(a1);
    store.reparentItem(a1, null, 0, 0);
    assertEqual(store.ui.expanded, [a], 'moved out -> no longer under a');
    store.deleteItem(a);
    assertEqual(store.ui.expanded, []);
  },

  'reorder: moves an item among its siblings, one undo step': () => {
    const { store } = setup();
    const g = store.createItem({});
    const k = ['a', 'b', 'c', 'd'].map(t => store.createItem({ parentId: g, title: t }));
    const titles = () => Object.values(store.canvas().items).filter(i => i.parentId === g).sort((x, y) => x.order - y.order).map(i => i.title).join('');
    assert(store.reorderItem(k[3], 0));
    assertEqual(titles(), 'dabc');
    assert(store.reorderItem(k[0], 3));
    assertEqual(titles(), 'dbca');
    assertEqual(store.reorderItem(k[0], 3), false, 'same place = no change');
    store.undo();
    assertEqual(titles(), 'dabc');
  },

  'expandTo opens the item and everything above it': () => {
    const { store } = setup();
    const a = store.createItem({});
    const b = store.createItem({ parentId: a });
    const c = store.createItem({ parentId: b });
    store.expandTo(c);
    assertEqual(store.ui.expanded, [a, b, c]);
    store.expandTo(a);
    assertEqual(store.ui.expanded, [a]);
  },

  'canvas setting insideView is saved and undoable': () => {
    const { store } = setup();
    assertEqual(store.canvas().settings.insideView, 'tray');
    store.setCanvasSetting('insideView', 'container');
    assertEqual(store.canvas().settings.insideView, 'container');
    store.undo();
    assertEqual(store.canvas().settings.insideView, 'tray');
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
