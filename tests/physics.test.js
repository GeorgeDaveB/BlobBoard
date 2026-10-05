import { assert } from './runner.js';
import { createPhysics, tick, setPaused } from '../js/ui/physics.js';

function make() {
  const layer = document.createElement('div');
  const body = document.createElement('div');
  layer.style.cssText = 'position:absolute;left:-9999px;top:0';
  body.style.cssText = 'width:140px;height:100px';
  layer.append(body);
  document.body.append(layer);
  const h = createPhysics(layer, body, 12345);
  return { layer, body, h, done() { h.dispose(); layer.remove(); } };
}

function matrixOf(el) {
  const m = /matrix\(([^)]+)\)/.exec(el.style.transform);
  if (!m) return null;
  const [a, b, c, d] = m[1].split(',').map(Number);
  return { a, b, c, d };
}

// border-radius "TLx TRx BRx BLx / TLy TRy BRy BLy" -> numbers
function radii(body) {
  const [h, v] = body.style.borderRadius.split('/').map(s => s.trim().split(/\s+/).map(parseFloat));
  if (!v) return { TLx: h[0], TRx: h[1], BRx: h[2], BLx: h[3], TLy: h[0], TRy: h[1], BRy: h[2], BLy: h[3] };
  return { TLx: h[0], TRx: h[1], BRx: h[2], BLx: h[3], TLy: v[0], TRy: v[1], BRy: v[2], BLy: v[3] };
}

let clock = 100000;
const frames = n => { for (let i = 0; i < n; i++) tick((clock += 16.7)); };

function dragRight(t, steps = 12, px = 25) {
  t.h.pickUp();
  for (let i = 0; i < steps; i++) { t.h.pointer(i * px, 0, clock); frames(1); }
}

export const tests = {
  'air: moving right squeezes front-to-back (no long stretch)': () => {
    const t = make();
    dragRight(t);
    const m = matrixOf(t.layer);
    assert(m, 'has a transform');
    assert(m.a < m.d, 'narrower along the motion than across: ' + t.layer.style.transform);
    assert(m.d / m.a < 1.35, 'only a mild squeeze');
    t.done();
  },

  'air: the front (right side) is flattened, the back stays round': () => {
    const t = make();
    dragRight(t);
    const r = radii(t.body);
    const front = r.TRy + r.BRy;
    const back = r.TLy + r.BLy;
    assert(front < back * 0.8, 'right side flatter: front ' + front.toFixed(1) + ' vs back ' + back.toFixed(1));
    t.done();
  },

  'drop: wobbles, then settles completely': () => {
    const t = make();
    dragRight(t);
    t.h.drop();
    frames(3);
    assert(t.layer.style.transform !== '', 'still moving after drop');
    frames(500);
    assert(t.layer.style.transform === '', 'settled: ' + t.layer.style.transform);
    t.done();
  },

  'contact: the side facing the other blob flattens, without the item moving': () => {
    const t = make();
    frames(1);
    const before = radii(t.body);
    t.h.setContacts([{ ux: 0, uy: 1, s: 1 }]); // other blob is below
    frames(30);
    const r = radii(t.body);
    assert(r.BRx + r.BLx < (before.BRx + before.BLx) * 0.7, 'bottom flattened');
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(t.layer.style.transform);
    assert(m && Math.abs(+m[1]) < 1 && Math.abs(+m[2]) < 1, 'no real movement: ' + t.layer.style.transform);
    t.h.setContacts([]);
    frames(500);
    assert(t.layer.style.transform === '', 'released');
    t.done();
  },

  'glide: a pushed blob starts at its old spot and glides to the new one': () => {
    const t = make();
    t.h.glideFrom(-40, 0);
    const first = /translate\(([-\d.]+)px/.exec(t.layer.style.transform);
    assert(first && +first[1] < -35, 'starts at the old place');
    frames(500);
    assert(t.layer.style.transform === '', 'arrives');
    t.done();
  },

  'size change bounces: starts at old size and overshoots': () => {
    const t = make();
    t.h.resized({ w: 140, h: 100 }, { w: 220, h: 200 });
    let maxD = 0;
    for (let i = 0; i < 300; i++) { frames(1); const m = matrixOf(t.layer); if (m) maxD = Math.max(maxD, m.d); }
    assert(maxD > 1.03, 'overshoot ' + maxD.toFixed(3));
    assert(t.layer.style.transform === '', 'settles');
    t.done();
  },

  'performance: 100 on-screen blobs morph in under 3 ms per frame': () => {
    const many = [];
    for (let i = 0; i < 100; i++) many.push(make());
    setPaused(false);
    frames(5);
    const t0 = performance.now();
    const N = 30;
    for (let i = 0; i < N; i++) tick((clock += 34)); // 34 ms apart -> every frame morphs
    const per = (performance.now() - t0) / N;
    for (const t of many) t.done();
    assert(per < 3, per.toFixed(2) + ' ms per frame');
  }
};
