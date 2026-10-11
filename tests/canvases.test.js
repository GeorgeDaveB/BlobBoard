import { assert, assertEqual } from './runner.js';
import { createStore } from '../js/core/store.js';
import { newCanvas, outermost, cloneItems, childrenOf } from '../js/core/model.js';

function setup() {
  let t = 1000;
  const deleted = [];
  const store = createStore({ repo: { saveCanvas() {}, deleteCanvas: id => deleted.push(id) }, now: () => ++t });
  const c = newCanvas('Life', 1);
  store.load([c], c.id, []);
  return { store, deleted, first: c.id };
}

export const tests = {
  'canvases: create, list (oldest first), switch resets screen state, own undo': () => {
    const { store, first } = setup();
    const a = store.createItem({ x: 0, y: 0 });
    store.select(a);
    const events = [];
    store.on(e => events.push(e.type));
    const work = store.createCanvas('  Work  ');
    assertEqual(store.canvasList().map(c => c.name), ['Life', 'Work']);
    assert(store.switchCanvas(work));
    assertEqual([store.ui.canvasId, store.ui.selectedId, store.canUndo()], [work, null, false]);
    assert(events.includes('canvas'));
    store.createItem({});
    store.switchCanvas(first);
    assertEqual([store.canUndo(), Object.keys(store.canvas().items).length], [true, 1], 'Life keeps its history');
  },

  'rename is undoable; empty names refused': () => {
    const { store, first } = setup();
    assertEqual(store.renameCanvas(first, '   '), false);
    assert(store.renameCanvas(first, 'Home'));
    assertEqual(store.canvas().name, 'Home');
    store.undo();
    assertEqual(store.canvas().name, 'Life');
  },

  'duplicate canvas: a full copy with new ids, lines re-pointed, settings copied': () => {
    const { store, first } = setup();
    store.setCanvasSetting('growth', 2);
    const p = store.createItem({ x: 10, y: 20, title: 'P' });
    const k = store.createItem({ parentId: p, title: 'K' });
    const q = store.createItem({ x: 300, y: 0, title: 'Q' });
    store.createLink(p, q);
    const copy = store.duplicateCanvas(first);
    const doc = store.canvas(copy);
    assertEqual(doc.name, 'Life (copy)');
    assertEqual(doc.settings.growth, 2);
    const items = Object.values(doc.items);
    assertEqual(items.map(i => i.title).sort(), ['K', 'P', 'Q']);
    assert(items.every(i => ![p, k, q].includes(i.id)), 'fresh ids');
    const P = items.find(i => i.title === 'P'), K = items.find(i => i.title === 'K'), Q = items.find(i => i.title === 'Q');
    assertEqual(K.parentId, P.id);
    const ln = Object.values(doc.links)[0];
    assertEqual([ln.from, ln.to], [P.id, Q.id]);
  },

  'delete: never the last canvas; switches away first; gone from the device': () => {
    const { store, first, deleted } = setup();
    assertEqual(store.deleteCanvas(first), false);
    const two = store.createCanvas('Two');
    store.switchCanvas(two);
    assert(store.deleteCanvas(two));
    assertEqual([store.ui.canvasId, store.canvasList().length, deleted], [first, 1, [two]]);
  },

  'duplicate items here: next to the originals, same level, with insides and inner lines': () => {
    const { store } = setup();
    const a = store.createItem({ x: 0, y: 0, title: 'A' });
    const b = store.createItem({ x: 300, y: 0, title: 'B' });
    const inner = store.createItem({ parentId: a, title: 'in' });
    const c = store.createItem({ x: 600, y: 0, title: 'C' });
    store.createLink(a, b);
    store.createLink(b, c);
    const made = store.copyItemsTo([a, b, inner], store.ui.canvasId, { coalesce: 'k' });
    assertEqual(made.length, 2, 'inner comes with its parent');
    const A2 = store.item(made[0]);
    assertEqual([A2.title, A2.x, A2.y, A2.parentId], ['A', 40, 40, null]);
    assertEqual(childrenOf(store.canvas(), made[0]).map(i => i.title), ['in']);
    const links = Object.values(store.canvas().links);
    assertEqual(links.length, 3, 'A–B copied, B–C not');
    store.undoStep('k');
    assertEqual(Object.keys(store.canvas().items).length, 4);
  },

  'move items to another canvas: top level there, gone here (lines to others too); undo both': () => {
    const { store, first } = setup();
    const other = store.createCanvas('Other');
    store.switchCanvas(other);
    store.createItem({ x: 0, y: 100 });
    store.switchCanvas(first);
    const p = store.createItem({ x: 0, y: 0, title: 'P' });
    const m = store.createItem({ parentId: p, title: 'M' });
    const q = store.createItem({ x: 300, y: 0, title: 'Q' });
    store.createLink(p, q);
    const made = store.copyItemsTo([m, q], other, { move: true, coalesce: 'mv' });
    assertEqual(made.length, 2);
    const there = store.canvas(other);
    assert(made.every(id => there.items[id] && there.items[id].parentId === null), 'top level there');
    assert(made.every(id => there.items[id].x >= 160), 'to the right of what is there');
    assertEqual([!!store.item(m), !!store.item(q), Object.keys(store.canvas().links).length], [false, false, 0]);
    store.undoStep('mv', other);
    store.undoStep('mv', first);
    assertEqual([!!store.item(m), !!store.item(q), Object.keys(store.canvas(other).items).length], [true, true, 1]);
  },

  'helpers: outermost drops items already inside a listed one; cloneItems keeps the tree': () => {
    const c = newCanvas('T');
    c.items.a = { id: 'a', parentId: null };
    c.items.b = { id: 'b', parentId: 'a' };
    c.items.d = { id: 'd', parentId: 'b' };
    c.links.l = { id: 'l', from: 'b', to: 'd' };
    assertEqual(outermost(c, ['d', 'a', 'b']), ['a']);
    const { items, links, idMap } = cloneItems(c, ['a']);
    assertEqual(items.length, 3);
    assertEqual(items.find(i => i.id === idMap.get('d')).parentId, idMap.get('b'));
    assertEqual([links[0].from, links[0].to], [idMap.get('b'), idMap.get('d')]);
  }
};
