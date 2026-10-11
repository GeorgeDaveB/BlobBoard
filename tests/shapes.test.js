import { assert, assertEqual } from './runner.js';
import { createStore } from '../js/core/store.js';
import { newCanvas, newItem, applyItemPatch, canMoveInto, linkProblem, sanitizeCanvas, kindOf, TEXT_INK } from '../js/core/model.js';
import { SHAPES, SHAPE_IDS, polyEdgeDistance, shapePath, clampSize, SHAPE_SIZE } from '../js/services/shapes.js';
import { edgeDistance } from '../js/services/strand.js';
import { createItemEl, updateItemEl } from '../js/ui/itemView.js';

function setup() {
  let t = 1000;
  const store = createStore({ repo: { saveCanvas() {} }, now: () => ++t });
  const c = newCanvas('T');
  store.load([c], c.id, []);
  return store;
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

export const tests = {
  'shapes: circle, square, triangle, diamond, hexagon, trapezoid (no star)': () => {
    assertEqual(SHAPE_IDS, ['circle', 'square', 'triangle', 'diamond', 'hexagon', 'trapezoid']);
    for (const id of SHAPE_IDS) assert(/^M[\d. ]/.test(shapePath(id)) && shapePath(id).endsWith('Z'), id + ' path');
    assertEqual([clampSize(5), clampSize(5000), clampSize(123.4)], [SHAPE_SIZE.min, SHAPE_SIZE.max, 123]);
  },

  'lines stop on the real outline of polygon shapes': () => {
    const d = SHAPES.diamond.poly;
    assert(near(polyEdgeDistance(d, 50, 50, 1, 0), 50), 'diamond tip to the right');
    assert(near(polyEdgeDistance(d, 50, 50, Math.SQRT1_2, Math.SQRT1_2), 50 / Math.SQRT2), 'diamond side at 45°');
    const tri = SHAPES.triangle.poly;
    assert(near(polyEdgeDistance(tri, 60, 40, 0, 1), 40), 'triangle base below');
    assert(near(polyEdgeDistance(tri, 60, 40, 0, -1), 40), 'triangle tip above');
    const s = { cx: 0, cy: 0, a: 50, b: 50, rd: 1, poly: d };
    assert(near(edgeDistance(s, 1, 0), 50), 'strand uses the polygon');
    assert(near(edgeDistance({ ...s, poly: null }, Math.SQRT1_2, Math.SQRT1_2), 50, 1e-6), 'circle unchanged');
  },

  'model: a shape gets its type and default size; text gets ink colour; neither nests': () => {
    const c = newCanvas('T');
    const sh = newItem(c, { kind: 'shape', shape: 'hexagon', parentId: 'x' });
    assertEqual([sh.kind, sh.shape, sh.w, sh.h, sh.parentId], ['shape', 'hexagon', SHAPES.hexagon.size.w, SHAPES.hexagon.size.h, null]);
    const bad = newItem(c, { kind: 'shape', shape: 'star' });
    assertEqual(bad.shape, 'circle', 'unknown shape -> circle');
    const tx = newItem(c, { kind: 'text' });
    assertEqual([tx.kind, tx.color], ['text', TEXT_INK]);
    assertEqual(kindOf({}), 'blob', 'old items are blobs');
    applyItemPatch(sh, { shape: 'star', w: 10, h: 'x' });
    assertEqual([sh.shape, sh.w, sh.h], ['hexagon', SHAPE_SIZE.min, SHAPES.hexagon.size.h]);
  },

  'rules: shapes/text never go inside or hold items; text has no lines; shapes do': () => {
    const store = setup();
    const blob = store.createItem({ x: 0, y: 0 });
    const blob2 = store.createItem({ x: 300, y: 0 });
    const shape = store.createItem({ kind: 'shape', shape: 'square', x: 600, y: 0 });
    const text = store.createItem({ kind: 'text', x: 900, y: 0 });
    const doc = store.canvas();
    assertEqual([canMoveInto(doc, shape, blob), canMoveInto(doc, text, blob), canMoveInto(doc, blob, shape), canMoveInto(doc, blob2, blob)], [false, false, false, true]);
    assertEqual(store.reparentItem(shape, blob, 0, 0), false, 'store refuses');
    assertEqual([linkProblem(doc, blob, shape), linkProblem(doc, blob, text)], ['', 'text']);
  },

  'sanitize: unknown kind = blob; shapes/text and children of shapes go to the top level': () => {
    const c = newCanvas('T');
    c.items.s = { id: 's', kind: 'shape', shape: 'nope', parentId: 'b', w: 'x' };
    c.items.b = { id: 'b', kind: 'weird' };
    c.items.k = { id: 'k', parentId: 's' };
    sanitizeCanvas(c);
    assertEqual([c.items.s.parentId, c.items.s.shape, c.items.s.w, c.items.b.kind, c.items.k.parentId], [null, 'circle', SHAPES.circle.size.w, 'blob', null]);
  },

  'view: a shape is drawn at its size with resize handles; text shows formatted content': () => {
    const sh = { id: 's1', kind: 'shape', shape: 'diamond', w: 180, h: 90, title: 'Goal', notes: '', notesHtml: '', color: '#8ec5ff', seed: 2 };
    const el = createItemEl(sh, { onEdit() {} });
    updateItemEl(el, sh, { selected: true });
    assertEqual([el._parts.body.style.width, el._parts.body.style.height], ['180px', '90px']);
    assertEqual(el._parts.shapePath.getAttribute('d'), shapePath('diamond'));
    assertEqual(el.querySelectorAll('.shape-handle').length, 3);
    assert(el.classList.contains('kind-shape') && el.classList.contains('shape-diamond'));
    const tx = { id: 't1', kind: 'text', title: '', notes: 'Hello', notesHtml: '<b>Hello</b>', color: TEXT_INK, seed: 3 };
    const te = createItemEl(tx, { onEdit() {} });
    updateItemEl(te, tx, {});
    assertEqual(te._parts.text.innerHTML, '<b>Hello</b>');
    assert(typeof te._startTextEdit === 'function', 'editable in place');
    el._phys.dispose();
    te._phys.dispose();
  }
};
