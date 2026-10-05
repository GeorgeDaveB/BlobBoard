import { assert, assertEqual } from './runner.js';
import { createStore } from '../js/core/store.js';
import { newCanvas } from '../js/core/model.js';
import { ellipseTouchesRect, resolveOverlaps, support } from '../js/services/layout.js';

function setup() {
  let t = 1000;
  const store = createStore({ repo: { saveCanvas() {} }, now: () => ++t });
  const c = newCanvas('T');
  store.load([c], c.id);
  const ids = ['a', 'b', 'c', 'd'].map((n, i) => store.createItem({ title: n, x: i * 200, y: 0 }));
  return { store, ids };
}

const circle = (id, cx, cy, r = 50) => ({ id, cx, cy, a: r, b: r });

export const tests = {
  'select many: two or more = multi-selection; one = normal; none = cleared': () => {
    const { store, ids } = setup();
    store.selectMany(ids.slice(0, 3));
    assertEqual(store.ui.selectedIds, ids.slice(0, 3));
    assertEqual(store.ui.selectedId, null);
    store.selectMany([ids[1]]);
    assertEqual([store.ui.selectedIds.length, store.ui.selectedId], [0, ids[1]]);
    store.selectMany([]);
    assertEqual([store.ui.selectedIds.length, store.ui.selectedId], [0, null]);
  },

  'select many: only top-level items; inside items are left out': () => {
    const { store, ids } = setup();
    const inner = store.createItem({ parentId: ids[0] });
    store.selectMany([ids[1], ids[2], inner]);
    assertEqual(store.ui.selectedIds, [ids[1], ids[2]]);
  },

  'toggle (Ctrl/Shift+click): adds to and removes from the selection': () => {
    const { store, ids } = setup();
    store.select(ids[0]);
    store.toggleSelected(ids[1]);
    assertEqual(store.ui.selectedIds, [ids[0], ids[1]]);
    store.toggleSelected(ids[2]);
    store.toggleSelected(ids[0]);
    assertEqual(store.ui.selectedIds, [ids[1], ids[2]]);
    store.toggleSelected(ids[1]);
    assertEqual([store.ui.selectedIds.length, store.ui.selectedId], [0, ids[2]], 'one left = normal selection');
  },

  'selecting one item, a line, or nothing clears the multi-selection': () => {
    const { store, ids } = setup();
    store.selectMany(ids);
    store.select(ids[0]);
    assertEqual(store.ui.selectedIds.length, 0);
    store.selectMany(ids);
    const l = store.createLink(ids[0], ids[1]);
    store.selectLink(l);
    assertEqual([store.ui.selectedIds.length, store.ui.selectedLinkId], [0, l]);
  },

  'delete many: one undo step; deleted ones leave the selection': () => {
    const { store, ids } = setup();
    store.createItem({ parentId: ids[0], title: 'inside' });
    store.createLink(ids[0], ids[3]);
    store.selectMany(ids.slice(0, 3));
    store.deleteItems(ids.slice(0, 3));
    const doc = store.canvas();
    assertEqual(Object.keys(doc.items), [ids[3]], 'items, their insides gone');
    assertEqual(Object.keys(doc.links).length, 0, 'their lines gone');
    assertEqual([store.ui.selectedIds.length, store.ui.selectedId], [0, null]);
    store.undo();
    assertEqual(Object.keys(store.canvas().items).length, 5, 'one undo brings all back');
  },

  'reparent many: all go inside in order, lose their lines, one undo step': () => {
    const { store, ids } = setup();
    store.createLink(ids[0], ids[1]);
    const ok = store.reparentItems([{ id: ids[0], x: 0, y: 0 }, { id: ids[1], x: 0, y: 0 }, { id: ids[3], x: 0, y: 0 }], ids[2]);
    assert(ok);
    const doc = store.canvas();
    const kids = Object.values(doc.items).filter(i => i.parentId === ids[2]).sort((a, b) => a.order - b.order).map(i => i.id);
    assertEqual(kids, [ids[0], ids[1], ids[3]]);
    assertEqual(Object.keys(doc.links).length, 0);
    store.undo();
    assertEqual(Object.values(store.canvas().items).filter(i => i.parentId).length, 0);
  },

  'reparent many: at a grid slot, and loops are skipped': () => {
    const { store, ids } = setup();
    store.reparentItem(ids[3], ids[2], 0, 0);
    store.reparentItems([{ id: ids[0], x: 0, y: 0 }, { id: ids[1], x: 0, y: 0 }], ids[2], { index: 0 });
    const kids = Object.values(store.canvas().items).filter(i => i.parentId === ids[2]).sort((a, b) => a.order - b.order).map(i => i.id);
    assertEqual(kids, [ids[0], ids[1], ids[3]], 'inserted before the existing one');
    assertEqual(store.reparentItems([{ id: ids[2], x: 0, y: 0 }], ids[0]), false, 'a group cannot go inside its own item');
  },

  'box hit: a blob is selected if the box touches its outline': () => {
    const e = circle('x', 100, 100, 50);
    assert(ellipseTouchesRect(e, { x: 0, y: 0, w: 300, h: 300 }), 'inside');
    assert(ellipseTouchesRect(e, { x: 140, y: 90, w: 50, h: 20 }), 'touching the right edge');
    assert(!ellipseTouchesRect(e, { x: 0, y: 0, w: 60, h: 60 }), 'corner box misses the round outline');
    assert(!ellipseTouchesRect(e, { x: 200, y: 0, w: 50, h: 50 }), 'far away');
  },

  'displacement: several dropped blobs all stay put, others pushed': () => {
    const list = [circle('d1', 0, 0), circle('d2', 110, 0), circle('x', 55, 60), circle('far', 0, 600)];
    const out = resolveOverlaps(list, new Set(['d1', 'd2']), 10);
    assert(!out.has('d1') && !out.has('d2'), 'dropped blobs fixed');
    assert(out.has('x') && !out.has('far'));
    const x = { ...list[2], ...out.get('x') };
    for (const d of [list[0], list[1]]) {
      const dist = Math.hypot(x.cx - d.cx, x.cy - d.cy);
      const ux = (x.cx - d.cx) / dist, uy = (x.cy - d.cy) / dist;
      assert(dist >= support(d, ux, uy) + support(x, ux, uy) + 9, 'x clears ' + d.id);
    }
  }
};
