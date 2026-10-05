import { assert, assertEqual } from './runner.js';
import { createStore } from '../js/core/store.js';
import { newCanvas, linkProblem, linkBetween, sanitizeCanvas } from '../js/core/model.js';
import { edgeDistance, edgeToward, strandGeometry, restMid, midWidth, STRAND } from '../js/services/strand.js';

function setup() {
  let t = 1000;
  const store = createStore({ repo: { saveCanvas() {} }, now: () => ++t });
  const c = newCanvas('T');
  store.load([c], c.id);
  const a = store.createItem({ title: 'a', x: 0, y: 0 });
  const b = store.createItem({ title: 'b', x: 300, y: 0 });
  return { store, a, b };
}

const near = (x, y, eps = 1e-6) => Math.abs(x - y) < eps;
const blob = (cx, cy, a = 60, b = 45, rd = 1) => ({ cx, cy, a, b, rd });

export const tests = {
  'link: new line has an arrowhead at the end it was drawn to': () => {
    const { store, a, b } = setup();
    const id = store.createLink(a, b);
    const ln = store.link(id);
    assert(ln && ln.from === a && ln.to === b);
    assertEqual([ln.arrowFrom, ln.arrowTo], [false, true]);
  },

  'link: refused for self, other boards and an existing pair (either way)': () => {
    const { store, a, b } = setup();
    assertEqual(store.createLink(a, a), null, 'self');
    store.createLink(a, b);
    assertEqual(store.createLink(b, a), null, 'reverse duplicate');
    const inner = store.createItem({ parentId: a });
    assertEqual(store.createLink(b, inner), null, 'different board');
    const doc = store.canvas();
    assertEqual(linkProblem(doc, b, inner), 'level');
    assertEqual(linkProblem(doc, b, a), 'exists');
    assertEqual(linkProblem(doc, a, 'nope'), 'missing');
    assertEqual(Object.keys(doc.links).length, 1);
  },

  'link: toggle arrows, delete, each one undo step': () => {
    const { store, a, b } = setup();
    const id = store.createLink(a, b);
    store.toggleArrow(id, 'from');
    store.toggleArrow(id, 'to');
    assertEqual([store.link(id).arrowFrom, store.link(id).arrowTo], [true, false]);
    store.undo();
    assertEqual(store.link(id).arrowTo, true, 'undo one toggle');
    store.deleteLink(id);
    assertEqual(store.link(id), null);
    store.undo();
    assert(store.link(id), 'undo brings the line back');
    assertEqual(store.toggleArrow(id, 'middle'), false, 'bad end ignored');
  },

  'link: selecting a line deselects the item and vice versa; deleted line is deselected': () => {
    const { store, a, b } = setup();
    const id = store.createLink(a, b);
    store.select(a);
    store.selectLink(id);
    assertEqual([store.ui.selectedId, store.ui.selectedLinkId], [null, id]);
    store.select(b);
    assertEqual([store.ui.selectedId, store.ui.selectedLinkId], [b, null]);
    store.selectLink(id);
    store.deleteLink(id);
    assertEqual(store.ui.selectedLinkId, null);
  },

  'link: removed when an end goes into a group or is deleted (R23)': () => {
    const { store, a, b } = setup();
    const c = store.createItem({ x: 600, y: 0 });
    store.createLink(a, b);
    store.createLink(b, c);
    store.reparentItem(a, c, 0, 0);
    assertEqual(linkBetween(store.canvas(), a, b), null);
    assert(linkBetween(store.canvas(), b, c));
    store.deleteItem(c);
    assertEqual(Object.keys(store.canvas().links).length, 0);
  },

  'link: sanitize keeps arrows as booleans': () => {
    const { store, a, b } = setup();
    const doc = JSON.parse(JSON.stringify(store.canvas()));
    doc.links.x = { from: a, to: b, arrowFrom: 'yes', arrowTo: 1 };
    sanitizeCanvas(doc);
    assertEqual([doc.links.x.arrowFrom, doc.links.x.arrowTo], [false, false]);
  },

  'strand: edge of a blob is the ellipse; a container is squarer': () => {
    const e = blob(0, 0, 60, 40);
    assert(near(edgeDistance(e, 1, 0), 60) && near(edgeDistance(e, 0, 1), 40));
    const d = Math.SQRT1_2;
    const box = blob(0, 0, 60, 40, 0.16);
    assert(edgeDistance(box, d, d) > edgeDistance(e, d, d) + 5, 'corner reaches further on a rectangle');
    const p = edgeToward(e, 100, 0);
    assert(near(p.x, 60) && near(p.y, 0));
  },

  'strand: thins as it is pulled longer, never below the minimum': () => {
    assert(midWidth(100) > midWidth(300), 'longer = thinner');
    assertEqual(midWidth(100000), STRAND.minMidWidth);
    assertEqual(midWidth(10), STRAND.midWidth);
  },

  'strand: runs edge to edge, hangs a little, arrowheads only where asked': () => {
    const A = blob(0, 0), B = blob(400, 0);
    const mid = restMid(A, B);
    assert(mid.y > 0, 'sags downward');
    const s = strandGeometry(A, B, mid, { to: true });
    const onEdge = (p, c) => near(((p.x - c.cx) / c.a) ** 2 + ((p.y - c.cy) / c.b) ** 2, 1, 1e-6);
    assert(s && onEdge(s.a, A) && onEdge(s.b, B), 'ends on the outlines');
    assert(s.a.x > 50 && s.b.x < 350 && s.a.y > 0, 'facing each other, slightly down');
    assertEqual((s.arrows.match(/Z/g) || []).length, 1, 'one arrowhead');
    const none = strandGeometry(A, B, mid, {});
    assertEqual(none.arrows, '');
    assertEqual((strandGeometry(A, B, mid, { from: true, to: true }).arrows.match(/Z/g) || []).length, 2);
    assert(!/NaN/.test(s.d + s.spine), 'no NaN');
  },

  'strand: nothing drawn when the blobs overlap': () => {
    const s = strandGeometry(blob(0, 0), blob(50, 0), restMid(blob(0, 0), blob(50, 0)));
    assertEqual(s, null);
  },

  'strand: to a point (drawing a new line) ends at the point': () => {
    const s = strandGeometry(blob(0, 0), { cx: 300, cy: 50, a: 0, b: 0 }, { x: 150, y: 25 });
    assert(s && near(s.b.x, 300) && near(s.b.y, 50));
  }
};
