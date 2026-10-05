import { assert, assertEqual } from './runner.js';
import { PALETTE, normalizeHex, hexToHsv, hsvToHex, textColorFor, contrast, DARK_TEXT, LIGHT_TEXT } from '../js/services/color.js';
import { screenToWorld, worldToScreen, zoomAt, fitView, boundsOf, rectsOverlap, MAX_ZOOM } from '../js/services/geometry.js';
import { growFactor, MAX_GROW } from '../js/ui/itemView.js';
import { findFreeSpot, ellipseContact, resolveOverlaps, support, spotInside } from '../js/services/layout.js';

const circle = (id, cx, cy, r = 50) => ({ id, cx, cy, a: r, b: r });
const overlapping = (A, B, gap) => {
  const d = Math.hypot(B.cx - A.cx, B.cy - A.cy) || 1e-6;
  const ux = (B.cx - A.cx) / d, uy = (B.cy - A.cy) / d;
  return d < support(A, ux, uy) + support(B, ux, uy) + gap - 1;
};

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

export const tests = {
  'color: normalizeHex accepts short and long forms': () => {
    assertEqual(normalizeHex('ABC'), '#aabbcc');
    assertEqual(normalizeHex('#12aBcD'), '#12abcd');
    assertEqual(normalizeHex('xyz'), null);
  },

  'color: hex -> hsv -> hex round trip': () => {
    for (const hex of ['#ff8a7a', '#000000', '#ffffff', '#3542aa', '#5cc6be']) {
      assertEqual(hsvToHex(hexToHsv(hex)), hex, hex);
    }
  },

  'color: automatic text colour is readable': () => {
    assertEqual(textColorFor('#ffffff'), DARK_TEXT);
    assertEqual(textColorFor('#000000'), LIGHT_TEXT);
    assertEqual(textColorFor('#3542aa'), LIGHT_TEXT);
    for (const p of PALETTE) {
      assert(contrast(p.hex, textColorFor(p.hex)) >= 4.5, p.name + ' contrast');
    }
  },

  'geometry: screen and world conversions are inverse': () => {
    const v = { x: 120, y: -40, z: 1.7 };
    const w = screenToWorld(v, 300, 200);
    const s = worldToScreen(v, w.x, w.y);
    assert(near(s.x, 300) && near(s.y, 200));
  },

  'geometry: zoomAt keeps the point under the finger fixed': () => {
    const v = { x: 10, y: 20, z: 1 };
    const before = screenToWorld(v, 200, 150);
    const v2 = zoomAt(v, 200, 150, 1.5);
    const after = screenToWorld(v2, 200, 150);
    assert(near(before.x, after.x) && near(before.y, after.y));
    assertEqual(zoomAt(v, 0, 0, 100).z, MAX_ZOOM);
  },

  'geometry: fitView centres the bounds': () => {
    const b = boundsOf([{ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 200, w: 100, h: 100 }]);
    assertEqual(b, { x: 0, y: 0, w: 400, h: 300 });
    const v = fitView(b, 800, 600);
    const centre = screenToWorld(v, 400, 300);
    assert(near(centre.x, 200) && near(centre.y, 150));
  },

  'layout: findFreeSpot keeps a free spot and avoids overlaps': () => {
    assertEqual(findFreeSpot([], 50, 50), { x: 50, y: 50 });
    const taken = [{ x: -20, y: 0, w: 140, h: 100 }];
    const spot = findFreeSpot(taken, 50, 0, 140, 100);
    const r = { x: spot.x - 70, y: spot.y, w: 140, h: 100 };
    assert(!rectsOverlap(r, taken[0], 16), 'no overlap');
  },

  'spotInside: origin when empty, beside the last item otherwise': () => {
    assertEqual(spotInside([]), { x: 0, y: 0 });
    const p = spotInside([{ x: 0, y: 0 }, { x: 200, y: 0 }]);
    assert(p.x > 200, 'to the right of the last one');
  },

  'growth: each inside item adds one blob of area (sqrt), capped at 5x': () => {
    assertEqual(growFactor(0), 1);
    assert(near(growFactor(1), Math.SQRT2), '1 inside -> ~1.41x');
    assert(near(growFactor(3), 2), '3 inside -> 2x');
    assertEqual(MAX_GROW, 5);
    assertEqual(growFactor(24), MAX_GROW);
    assertEqual(growFactor(500), MAX_GROW, 'capped');
  },

  'growth: the per-item slider scales it (0 = never grows)': () => {
    assertEqual(growFactor(10, 0), 1);
    assert(near(growFactor(1, 3), 2), '1 inside at 3 blobs each -> 2x');
    assert(near(growFactor(4, 0.5), Math.sqrt(3)));
    assertEqual(growFactor(2, NaN), growFactor(2), 'bad value -> default');
  },

  'contact: none when apart, direction + strength when overlapping': () => {
    assertEqual(ellipseContact(circle('a', 0, 0), circle('b', 300, 0)), null);
    const c = ellipseContact(circle('a', 0, 0), circle('b', 80, 0));
    assert(c && near(c.ux, 1) && near(c.uy, 0), 'points from A to B');
    assert(c.s > 0 && c.s <= 1);
    const deeper = ellipseContact(circle('a', 0, 0), circle('b', 40, 0));
    assert(deeper.s > c.s, 'more overlap = stronger');
  },

  'displacement: nothing moves when nothing overlaps': () => {
    const out = resolveOverlaps([circle('d', 0, 0), circle('x', 400, 0)], 'd');
    assertEqual(out.size, 0);
  },

  'displacement: overlapped blob moves the minimum, dropped blob stays': () => {
    const list = [circle('d', 0, 0), circle('x', 60, 0)];
    const out = resolveOverlaps(list, 'd', 10);
    assert(!out.has('d'), 'dropped blob never moves');
    const p = out.get('x');
    assert(p && near(p.cx, 110, 0.6) && near(p.cy, 0, 0.6), 'pushed right just enough: ' + JSON.stringify(p));
  },

  'displacement: chain reaction moves the neighbour too; far blobs untouched': () => {
    const list = [circle('d', 0, 0), circle('x', 60, 0), circle('y', 150, 0), circle('far', 0, 500)];
    const out = resolveOverlaps(list, 'd', 10);
    assert(out.has('x') && out.has('y'), 'x and its neighbour y moved');
    assert(!out.has('far'), 'unrelated blob stays');
    const final = list.map(e => (out.has(e.id) ? { ...e, ...out.get(e.id) } : e));
    for (let i = 0; i < final.length; i++) {
      for (let j = i + 1; j < final.length; j++) {
        assert(!overlapping(final[i], final[j], 10), final[i].id + '/' + final[j].id + ' still overlap');
      }
    }
  },

  'displacement: dropping exactly on top still separates': () => {
    const out = resolveOverlaps([circle('d', 0, 0), circle('x', 0, 0)], 'd', 10);
    assert(out.has('x') && Math.hypot(out.get('x').cx, out.get('x').cy) >= 109);
  },

  'displacement: 300 blobs resolve quickly': () => {
    const list = [];
    for (let i = 0; i < 300; i++) list.push(circle('b' + i, (i % 20) * 115, Math.floor(i / 20) * 115));
    list.push(circle('d', 575, 575));
    const t0 = performance.now();
    resolveOverlaps(list, 'd', 10);
    const ms = performance.now() - t0;
    assert(ms < 50, ms.toFixed(1) + ' ms');
  }
};
