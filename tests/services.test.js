import { assert, assertEqual } from './runner.js';
import { PALETTE, normalizeHex, hexToHsv, hsvToHex, textColorFor, contrast, DARK_TEXT, LIGHT_TEXT } from '../js/services/color.js';
import { screenToWorld, worldToScreen, zoomAt, fitView, boundsOf, rectsOverlap, MAX_ZOOM } from '../js/services/geometry.js';
import { findFreeSpot } from '../js/services/layout.js';

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
  }
};
