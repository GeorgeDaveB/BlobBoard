import { assert } from './runner.js';
import { createJelly, tickAll } from '../js/ui/jelly.js';

// Reads the 2x2 part of the layer's matrix(...) transform.
function matrixOf(el) {
  const m = /matrix\(([^)]+)\)/.exec(el.style.transform);
  if (!m) return null;
  const [a, b, c, d] = m[1].split(',').map(Number);
  return { a, b, c, d };
}

function layer() {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;width:140px;height:100px';
  document.body.append(el);
  return el;
}

const frames = n => { for (let i = 0; i < n; i++) tickAll(); };

export const tests = {
  'dragging fast to the right stretches horizontally': () => {
    const el = layer();
    const j = createJelly(el);
    j.pickUp();
    let t = 0;
    for (let i = 0; i < 10; i++) { j.pointer(i * 30, 0, (t += 16.7)); tickAll(); }
    const m = matrixOf(el);
    assert(m && m.a > m.d * 1.15, 'wider than tall while moving: ' + el.style.transform);
    el.remove();
  },

  'after dropping it wobbles, then settles back to normal': () => {
    const el = layer();
    const j = createJelly(el);
    j.pickUp();
    let t = 0;
    for (let i = 0; i < 10; i++) { j.pointer(i * 30, 0, (t += 16.7)); tickAll(); }
    j.drop();
    frames(4);
    assert(el.style.transform !== '', 'still moving right after drop');
    frames(400);
    assert(el.style.transform === '', 'settled: ' + el.style.transform);
    el.remove();
  },

  'growing for notes starts at the old size and overshoots': () => {
    const el = layer();
    const j = createJelly(el);
    j.resized({ w: 140, h: 100 }, { w: 220, h: 200 });
    const first = matrixOf(el);
    assert(first && first.d < 0.6, 'starts near the old height');
    let maxD = 0;
    for (let i = 0; i < 200; i++) { tickAll(); const m = matrixOf(el); if (m) maxD = Math.max(maxD, m.d); }
    assert(maxD > 1.03, 'overshoots past full size (bounce): ' + maxD.toFixed(3));
    assert(el.style.transform === '', 'settles');
    el.remove();
  }
};
