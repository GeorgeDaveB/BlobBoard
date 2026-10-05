// Liquid "jelly" physics for one item: stretch along the drag direction,
// trail behind the finger, swell when picked up, splat + wobble when dropped,
// and spring-bounce when the item changes size (e.g. notes added/removed).
//
// Works on a dedicated layer (.item-jelly) between the positioned .item and
// the CSS-animated .item-body, so it never fights the drag or the morph.
// All motion is damped springs, run in one shared animation loop that only
// ticks while something is moving.

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

const STRETCH_PER_PX = 0.014; // stretch per px/frame of pointer speed
const MAX_STRETCH = 0.42;
const TRAIL_PX = 26;          // how far the body lags behind at full stretch
const LIFT = 1.07;            // scale while held

// [stiffness, damping] — lower damping = more wobble
const SPRING_STRETCH = [0.16, 0.80];
const SPRING_LIFT = [0.14, 0.76];
const SPRING_SQUASH = [0.11, 0.80];
const SPRING_SIZE = [0.085, 0.80]; // bouncy grow/shrink

const active = new Set();
let raf = 0;

// One frame for every moving jelly; returns how many are still moving.
// Exported so tests can step frames by hand.
export function tickAll() {
  for (const j of active) if (j.step()) active.delete(j);
  return active.size;
}

function loop() {
  raf = tickAll() ? requestAnimationFrame(loop) : 0;
}

function wake(j) {
  active.add(j);
  if (!raf) raf = requestAnimationFrame(loop);
}

function spring(s, key, target, [k, damp]) {
  const vk = 'v' + key;
  s[vk] = (s[vk] + (target - s[key]) * k) * damp;
  s[key] += s[vk];
  return Math.abs(s[key] - target) < 0.0008 && Math.abs(s[vk]) < 0.0008;
}

export function createJelly(layer) {
  const s = {
    dx: 0, vdx: 0, dy: 0, vdy: 0,   // stretch vector
    lift: 1, vlift: 0,
    q: 0, vq: 0,                    // squash: + = wide/flat, - = tall/thin
    sx: 1, vsx: 0, sy: 1, vsy: 0,   // size bounce (scale from old size to 1)
    pvx: 0, pvy: 0,                 // smoothed pointer velocity (px/frame)
    last: null,
    dragging: false
  };

  const j = {
    step() {
      s.pvx *= 0.86;
      s.pvy *= 0.86;
      let tx = 0, ty = 0;
      if (s.dragging) {
        tx = s.pvx * STRETCH_PER_PX;
        ty = s.pvy * STRETCH_PER_PX;
        const m = Math.hypot(tx, ty);
        if (m > MAX_STRETCH) { tx *= MAX_STRETCH / m; ty *= MAX_STRETCH / m; }
      }
      let rest = spring(s, 'dx', tx, SPRING_STRETCH);
      rest = spring(s, 'dy', ty, SPRING_STRETCH) && rest;
      rest = spring(s, 'lift', s.dragging ? LIFT : 1, SPRING_LIFT) && rest;
      rest = spring(s, 'q', 0, SPRING_SQUASH) && rest;
      rest = spring(s, 'sx', 1, SPRING_SIZE) && rest;
      rest = spring(s, 'sy', 1, SPRING_SIZE) && rest;
      const settled = rest && !s.dragging;
      apply(settled);
      return settled;
    }
  };

  function apply(settled) {
    if (settled) {
      Object.assign(s, { dx: 0, dy: 0, lift: 1, q: 0, sx: 1, sy: 1, vdx: 0, vdy: 0, vlift: 0, vq: 0, vsx: 0, vsy: 0 });
      layer.style.transform = '';
      return;
    }
    // Stretch by (1+m) along the motion, thin by (1-0.45m) across it.
    const m = Math.hypot(s.dx, s.dy);
    let d11 = 1, d12 = 0, d22 = 1;
    if (m > 1e-4) {
      const ux = s.dx / m, uy = s.dy / m, p = 0.45 * m;
      d11 = 1 + m * ux * ux - p * uy * uy;
      d22 = 1 + m * uy * uy - p * ux * ux;
      d12 = (m + p) * ux * uy;
    }
    const kx = s.lift * (1 + s.q) * s.sx;
    const ky = s.lift * (1 - s.q) * s.sy;
    // Size bounce is anchored at the top edge (items grow downward).
    const h = layer.offsetHeight;
    const ty = -(h / 2) * (1 - s.sy) - s.dy * TRAIL_PX;
    const tx = -s.dx * TRAIL_PX;
    layer.style.transform =
      'translate(' + tx.toFixed(2) + 'px, ' + ty.toFixed(2) + 'px) matrix(' +
      (d11 * kx).toFixed(4) + ',' + (d12 * kx).toFixed(4) + ',' +
      (d12 * ky).toFixed(4) + ',' + (d22 * ky).toFixed(4) + ',0,0)';
  }

  return {
    pickUp() {
      if (REDUCED.matches) return;
      s.dragging = true;
      s.last = null;
      s.vq -= 0.04;
      wake(j);
    },
    pointer(x, y, t) {
      if (REDUCED.matches) return;
      if (s.last) {
        const k = 16.7 / Math.max(4, t - s.last.t);
        s.pvx = s.pvx * 0.55 + (x - s.last.x) * k * 0.45;
        s.pvy = s.pvy * 0.55 + (y - s.last.y) * k * 0.45;
      }
      s.last = { x, y, t };
      wake(j);
    },
    drop() {
      s.dragging = false;
      if (REDUCED.matches) return;
      s.vq += 0.09;
      wake(j);
    },
    poke(amount = 0.06) {
      if (REDUCED.matches) return;
      s.vq += amount;
      wake(j);
    },
    // Called with the old and new layout size; starts from the old size and
    // springs (with overshoot) to the new one.
    resized(prev, next) {
      if (REDUCED.matches || !prev.w || !prev.h || !next.w || !next.h) return;
      const clampR = r => Math.min(2, Math.max(0.5, r));
      s.sx *= clampR(prev.w / next.w);
      s.sy *= clampR(prev.h / next.h);
      apply(false);
      wake(j);
    }
  };
}
