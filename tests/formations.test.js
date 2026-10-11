import { assert, assertEqual } from './runner.js';
import { createStore } from '../js/core/store.js';
import { newCanvas, childrenOf } from '../js/core/model.js';
import { clearFormation, support } from '../js/services/layout.js';
import { ringLayout, rowsLayout, rowCounts, linkedOrder, pyramidLayout, gapSlots, RING_DIRS, FORMATIONS, GAP } from '../js/services/formations.js';

const node = (id, cx, cy, w = 140, h = 100) => ({ id, cx, cy, w, h });
const R = { id: 'R', cx: 0, cy: 0, w: 140, h: 100 };
const many = (n, spread = 900) => Array.from({ length: n }, (_, i) => node('n' + i, Math.cos(i * 2.4) * spread, Math.sin(i * 2.4) * spread));
const deg = (p, c = R) => Math.round(Math.atan2(p.cy - c.cy, p.cx - c.cx) * 180 / Math.PI);
// No two placed blobs (as circles of their bigger half-size) overlap.
function noOverlap(map, nodes, extra = []) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const pts = [...map].map(([id, p]) => ({ ...p, r: Math.max(byId.get(id).w, byId.get(id).h) / 2 })).concat(extra);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].cx - pts[j].cx, pts[i].cy - pts[j].cy);
      if (d < pts[i].r + pts[j].r - 0.5) return false;
    }
  }
  return true;
}

// Rows / Pyramid pack rectangles: no two bodies (or the royalty) overlap.
function noRectOverlap(map, nodes, extra = []) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const rs = [...map].map(([id, p]) => ({ cx: p.cx, cy: p.cy, w: byId.get(id).w, h: byId.get(id).h })).concat(extra);
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 - 0.5 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 - 0.5) return false;
    }
  }
  return true;
}

function setup() {
  let t = 1000;
  const store = createStore({ repo: { saveCanvas() {} }, now: () => ++t });
  const c = newCanvas('T');
  store.load([c], c.id);
  return store;
}

export const tests = {
  'registry: Ring, Rows, Pyramid; Ring alone offers "+ lines"': () => {
    assertEqual(FORMATIONS.map(f => f.id), ['ring', 'rows', 'pyramid']);
    assertEqual(FORMATIONS.filter(f => f.lines).map(f => f.id), ['ring']);
    assertEqual(FORMATIONS.filter(f => f.royalty).map(f => f.id), ['ring', 'pyramid']);
  },

  'ring: inner ring fills top-left, bottom-right, bottom-left, top-right, left, right, top, bottom': () => {
    // Every blob starts right of the royalty, so direction does not decide:
    // the fill order does (n0 nearest = first).
    for (let k = 1; k <= 8; k++) {
      const nodes = Array.from({ length: k }, (_, i) => node('n' + i, 400 + i * 10, 0));
      const out = ringLayout(R, nodes);
      const got = [...out.values()].map(p => deg(p)).sort((a, b) => a - b);
      const want = RING_DIRS.slice(0, k).map(a => Math.round(a * 180 / Math.PI)).sort((a, b) => a - b);
      assertEqual(got, want, k + ' blobs');
    }
  },

  'ring: each blob takes the free spot nearest its own direction': () => {
    const nodes = [node('left', -500, 0), node('right', 500, 0), node('up', 0, -500), node('down', 0, 500), node('a', -400, -400), node('b', 400, 400), node('c', -400, 400), node('d', 400, -400)];
    const out = ringLayout(R, nodes);
    assertEqual([deg(out.get('left')), deg(out.get('right')), deg(out.get('up')), deg(out.get('down'))], [180, 0, -90, 90]);
  },

  'ring: royalty does not move; linked blobs go innermost': () => {
    const nodes = many(12);
    const links = [{ from: 'R', to: 'n11' }, { from: 'n10', to: 'R' }];
    const out = ringLayout(R, [R, ...nodes], links);
    assert(!out.has('R'), 'royalty not moved');
    const r = id => Math.hypot(out.get(id).cx, out.get(id).cy);
    const inner = Math.min(...[...out.values()].map(p => Math.hypot(p.cx, p.cy)));
    assert(Math.abs(r('n11') - inner) < 1 && Math.abs(r('n10') - inner) < 1, 'linked blobs on the inner ring');
  },

  'ring: outer rings hold more, never overlap, and lines from the royalty pass between inner blobs': () => {
    const nodes = many(40);
    const out = ringLayout(R, nodes);
    assertEqual(out.size, 40);
    assert(noOverlap(out, nodes, [{ cx: 0, cy: 0, r: 70 }]), 'no overlaps (royalty included)');
    const radii = [...new Set([...out.values()].map(p => Math.round(Math.hypot(p.cx, p.cy))))].sort((a, b) => a - b);
    const perRing = radii.map(rr => [...out.values()].filter(p => Math.round(Math.hypot(p.cx, p.cy)) === rr).length);
    assertEqual(perRing[0], 8, 'inner ring = 8');
    assert(perRing[1] > 8, 'second ring holds more than 8 (' + perRing[1] + ')');
    // A straight line from the royalty to a second-ring blob misses every
    // inner-ring blob.
    const inner = [...out.values()].filter(p => Math.round(Math.hypot(p.cx, p.cy)) === radii[0]);
    const second = [...out.values()].filter(p => Math.round(Math.hypot(p.cx, p.cy)) === radii[1]);
    for (const s of second) {
      const L = Math.hypot(s.cx, s.cy), ux = s.cx / L, uy = s.cy / L;
      for (const b of inner) {
        const along = b.cx * ux + b.cy * uy;
        const off = Math.abs(b.cx * uy - b.cy * ux);
        assert(along < 0 || off > 70, 'line clears inner blob');
      }
    }
  },

  'ring: big blobs get more room': () => {
    const small = ringLayout(R, many(8));
    const bigNodes = many(8).map(n => ({ ...n, w: 300, h: 260 }));
    const big = ringLayout(R, bigNodes);
    const r0 = p => Math.hypot(p.cx, p.cy);
    assert(r0(big.get('n0')) > r0(small.get('n0')) + 100);
    assert(noOverlap(big, bigNodes, [{ cx: 0, cy: 0, r: 70 }]));
  },

  'gap spots: sit outside blocked directions, spaced apart': () => {
    const blockers = [0, 90, 180, 270].map(d => ({ ang: d * Math.PI / 180, half: 20 * Math.PI / 180 }));
    const slots = gapSlots(blockers, 15 * Math.PI / 180);
    assert(slots.length >= 8, 'two or more per gap: ' + slots.length);
    for (const s of slots) {
      for (const b of blockers) {
        const d = Math.abs(((s - b.ang + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        assert(d >= b.half - 1e-6, 'outside blocked arc');
      }
    }
  },

  'rows: counts put the extras in the first rows': () => {
    assertEqual(rowCounts(9, 3), [3, 3, 3]);
    assertEqual(rowCounts(11, 3), [4, 4, 3]);
    assertEqual(rowCounts(5, 9), [1, 1, 1, 1, 1], 'never more rows than blobs');
    assertEqual(rowCounts(4, 0), [4]);
  },

  'rows: 11 blobs in 3 rows, centred on the selection, aligned as asked': () => {
    const nodes = Array.from({ length: 11 }, (_, i) => node('n' + i, i * 37, (i % 3) * 211));
    for (const align of ['left', 'centre', 'right']) {
      const out = rowsLayout(nodes, [], { rows: 3, align });
      const ys = [...new Set([...out.values()].map(p => Math.round(p.cy)))].sort((a, b) => a - b);
      assertEqual(ys.length, 3, align + ': 3 rows');
      const inRow = ys.map(y => [...out.values()].filter(p => Math.round(p.cy) === y));
      assertEqual(inRow.map(r => r.length), [4, 4, 3]);
      const lefts = inRow.map(r => Math.min(...r.map(p => p.cx))), rights = inRow.map(r => Math.max(...r.map(p => p.cx)));
      if (align === 'left') assert(Math.abs(lefts[2] - lefts[0]) < 1, 'left edges line up');
      if (align === 'right') assert(Math.abs(rights[2] - rights[0]) < 1, 'right edges line up');
      if (align === 'centre') assert(Math.abs((lefts[2] + rights[2]) - (lefts[0] + rights[0])) < 1, 'centred');
      assert(noRectOverlap(out, nodes), 'no overlaps');
    }
    const out = rowsLayout(nodes, [], { rows: 3 });
    const xs = [...out.values()].map(p => p.cx), ys = [...out.values()].map(p => p.cy);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const ox = (Math.min(...nodes.map(n => n.cx)) + Math.max(...nodes.map(n => n.cx))) / 2;
    const oy = (Math.min(...nodes.map(n => n.cy)) + Math.max(...nodes.map(n => n.cy))) / 2;
    assert(Math.abs(cx - ox) < 1 && Math.abs(cy - oy) < 1, 'centred on where the selection was');
  },

  'rows: linked blobs end up next to each other; the rest in reading order': () => {
    const nodes = [node('a', 0, 0), node('b', 300, 0), node('c', 600, 0), node('d', 0, 300), node('e', 300, 300)];
    assertEqual(linkedOrder(nodes, []).map(n => n.id), ['a', 'b', 'c', 'd', 'e']);
    assertEqual(linkedOrder(nodes, [{ from: 'e', to: 'a' }]).map(n => n.id), ['a', 'e', 'b', 'c', 'd']);
  },

  'pyramid: a tree by lines below the royalty; unlinked blobs fill rows of 2, 3, 4…': () => {
    const nodes = [node('a', 100, 300), node('b', -100, 300), node('c', 0, 600), node('x', 900, 0), node('y', 950, 0), node('z', 1000, 0)];
    const links = [{ from: 'R', to: 'a' }, { from: 'b', to: 'R' }, { from: 'a', to: 'c' }];
    const out = pyramidLayout(R, [R, ...nodes], links);
    assert(!out.has('R'), 'royalty not moved');
    const row = id => Math.round(out.get(id).cy);
    assert(row('a') === row('b') && row('a') > R.cy, 'linked to the royalty: row 1');
    assert(row('c') > row('a'), 'linked to a: below it');
    const rows = [...new Set([...out.values()].map(p => Math.round(p.cy)))].sort((a, b) => a - b);
    const counts = rows.map(y => [...out.values()].filter(p => Math.round(p.cy) === y).length);
    assertEqual(counts, [2, 3, 1], 'row 1 full (2), row 2 filled to 3, rest below');
    assert(noRectOverlap(out, nodes, [R]), 'no overlaps');
    // Under its parent: c sits on a's side of the row.
    assert(Math.sign(out.get('c').cx - out.get('b').cx) === Math.sign(out.get('a').cx - out.get('b').cx));
  },

  'store: applyFormation moves blobs and adds lines (skipping existing pairs) as one step': () => {
    const store = setup();
    const [r, a, b] = ['r', 'a', 'b'].map((n, i) => store.createItem({ title: n, x: i * 300, y: 0 }));
    store.createLink(r, a);
    const lines = Object.keys(store.canvas().links).length;
    store.applyFormation([{ id: a, x: 10, y: 20 }, { id: b, x: 30.4, y: 40.6 }], [{ from: r, to: a }, { from: r, to: b }], { coalesce: 'f1' });
    assertEqual([store.item(a).x, store.item(b).x, store.item(b).y], [10, 30, 41]);
    assertEqual(Object.keys(store.canvas().links).length, lines + 1, 'only the missing line');
    store.undo();
    assertEqual([store.item(a).x, Object.keys(store.canvas().links).length], [300, lines]);
  },

  'store: undoStep only undoes its own step': () => {
    const store = setup();
    const a = store.createItem({ x: 0, y: 0 });
    store.moveItem(a, 5, 5);
    assertEqual(store.undoStep('nope'), false);
    assertEqual(store.item(a).x, 5);
    store.applyFormation([{ id: a, x: 50, y: 50 }], [], { coalesce: 'k' });
    assertEqual(store.undoStep('k'), true);
    assertEqual(store.item(a).x, 5);
  },

  'store: release child(s) — direct minis to the parent’s level, grandchildren stay inside': () => {
    const store = setup();
    const p = store.createItem({ x: 100, y: 200 });
    const k1 = store.createItem({ parentId: p });
    const k2 = store.createItem({ parentId: p });
    const g = store.createItem({ parentId: k2 });
    const groups = store.releaseChildren([p], { coalesce: 'rel' });
    assertEqual(groups, [{ parentId: p, ids: [k1, k2] }]);
    assertEqual([store.item(k1).parentId, store.item(k2).parentId, store.item(g).parentId], [null, null, k2]);
    assertEqual([store.item(k1).x, store.item(k1).y], [100, 200], 'start at the parent’s spot');
    assert(store.item(p), 'parent kept');
    store.undo();
    assertEqual(childrenOf(store.canvas(), p).map(i => i.id), [k1, k2]);
  },

  'store: release inside a group goes right after the parent in its grid': () => {
    const store = setup();
    const top = store.createItem({ x: 0, y: 0 });
    const [s1, p, s2] = [0, 1, 2].map(() => store.createItem({ parentId: top }));
    const k = store.createItem({ parentId: p });
    assertEqual(store.releaseChildren([p]), [], 'nothing landed on the board');
    assertEqual(childrenOf(store.canvas(), top).map(i => i.id), [s1, p, k, s2]);
  },

  'store: dissolve parent keeps the minis (at its spot); dissolve family = deleteItems': () => {
    const store = setup();
    const p = store.createItem({ x: 70, y: 80 });
    const other = store.createItem({ x: 500, y: 0 });
    store.createLink(p, other);
    const k1 = store.createItem({ parentId: p });
    const k2 = store.createItem({ parentId: p });
    const g = store.createItem({ parentId: k1 });
    const groups = store.dissolveItems([p], { coalesce: 'd' });
    assertEqual(groups, [{ spotId: p, ids: [k1, k2] }]);
    assert(!store.item(p), 'parent gone');
    assertEqual(Object.keys(store.canvas().links).length, 0, 'its lines gone');
    assertEqual([store.item(k1).parentId, store.item(k1).x, store.item(k1).y, store.item(g).parentId], [null, 70, 80, k1]);
    store.undo();
    assertEqual([!!store.item(p), store.item(k1).parentId, Object.keys(store.canvas().links).length], [true, p, 1]);
  },

  'store: dissolving nested parents moves minis to the nearest surviving level': () => {
    const store = setup();
    const top = store.createItem({ x: 0, y: 0 });
    const mid = store.createItem({ parentId: top });
    const leaf = store.createItem({ parentId: mid });
    assertEqual(store.dissolveItems([mid]), []);
    assertEqual(store.item(leaf).parentId, top, 'up one level, into the group');
    const store2 = setup();
    const t2 = store2.createItem({ x: 9, y: 9 });
    const m2 = store2.createItem({ parentId: t2 });
    const l2 = store2.createItem({ parentId: m2 });
    assertEqual(store2.dissolveItems([t2, m2]), [{ spotId: t2, ids: [l2] }]);
    assertEqual(store2.item(l2).parentId, null);
  },

  'selection: minis of an open group can join; closing the group drops them': () => {
    const store = setup();
    const a = store.createItem({ x: 0, y: 0 });
    const b = store.createItem({ x: 300, y: 0 });
    const m = store.createItem({ parentId: a });
    store.selectMany([b, m]);
    assertEqual(store.ui.selectedIds, [], 'closed group: mini left out');
    store.setExpanded([a]);
    store.select(b);
    store.toggleSelected(m);
    assertEqual(store.ui.selectedIds, [b, m]);
    store.setExpanded([]);
    assertEqual([store.ui.selectedIds.length, store.ui.selectedId], [0, b]);
  },

  'clear-out: a blob trapped between placed blobs in a column gets out, nothing overlaps': () => {
    const e = (id, cx, cy) => ({ id, cx, cy, a: 55, b: 48 });
    const placed = [e('p1', 0, 0), e('p2', 0, 132), e('p3', 0, 264), e('p4', 138, 0), e('p5', 138, 132)];
    const list = [...placed, e('x', 0, 60), e('y', 300, 60)];
    const moved = clearFormation(list, placed.map(p => p.id));
    assert(moved.has('x'), 'trapped blob moved');
    const all = list.map(b => (moved.has(b.id) ? { ...b, ...moved.get(b.id) } : b));
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const A = all[i], B = all[j];
        const d = Math.hypot(B.cx - A.cx, B.cy - A.cy), ux = (B.cx - A.cx) / d, uy = (B.cy - A.cy) / d;
        assert(d >= support(A, ux, uy) + support(B, ux, uy) - 0.5, A.id + ' overlaps ' + B.id);
      }
    }
    for (const p of placed) assert(!moved.has(p.id), 'placed blobs stay');
  },

  'gap constant is shared': () => assert(GAP > 0)
};
