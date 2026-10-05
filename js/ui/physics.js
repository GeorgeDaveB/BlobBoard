// Liquid physics for items, v2.
//
// Two things per item, driven from ONE shared animation loop:
//  1. Outline (border-radius on .item-body): the slow organic wobble, plus
//     per-side flattening — the front pushed flat by "air" while dragging, and
//     the side touching another blob flattened where they press together.
//  2. Body transform (on .item-jelly): air squeeze (front-to-back, not a
//     stretch), lift when held, splat on drop, press from contacts, a bouncy
//     grow/shrink when the size changes, and gliding when pushed aside.
//
// Idle items only update their outline ~30x a second and only when on screen;
// items with moving springs update every frame. If the loop gets slow it
// halves the idle rate by itself.

import { seededRandom } from '../core/ids.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

// ---- tuning (per-frame values assume ~60 fps) -----------------------------
export const TUNING = {
  airPerPx: 0.006,        // front-to-back squeeze per px/frame of drag speed
  maxAir: 0.12,
  frontFlatPerPx: 0.035,  // front flattening per px/frame of drag speed
  maxFrontFlat: 0.5,
  trailPx: 8,             // body lags this far behind the finger at max air
  lift: 1.06,             // scale while held
  swell: 1.12,            // scale of an armed drop target
  contactPress: 0.10,     // squeeze when pressed by another blob
  contactFlat: 0.55,      // flattening of the touching side
  morphFps: 30,
  slowMs: 5               // average loop time above this -> idle morph at 15 fps
};

// [stiffness, damping]: lower damping = more wobble
const SPRING = {
  air: [0.16, 0.80],
  lift: [0.14, 0.76],
  squash: [0.11, 0.80],
  press: [0.16, 0.76],
  flat: [0.16, 0.76],
  size: [0.085, 0.80],
  glide: [0.075, 0.80],
  grow: [0.075, 0.80],     // birth, expanding: soft, overshoots to ~1.2x
  growBack: [0.30, 0.50]   // birth, contracting back to size: snappy
};

const KEYS = ['ax', 'ay', 'px', 'py', 'lift', 'q', 'sx', 'sy', 'ox', 'oy', 'fr', 'fl', 'ft', 'fb', 'g'];
const REST = { ax: 0, ay: 0, px: 0, py: 0, lift: 1, q: 0, sx: 1, sy: 1, ox: 0, oy: 0, fr: 0, fl: 0, ft: 0, fb: 0, g: 1 };

// ---- shared loop ----------------------------------------------------------
const items = new Set();
const active = new Set();
let raf = 0;
let paused = false;
let lastMorph = 0;
let morphFps = TUNING.morphFps;
let avgMs = 0;

export function setPaused(value) { paused = value; }
export function stats() { return { items: items.size, active: active.size, avgMs, morphFps }; }

// One frame. Exported so tests (and a hidden browser pane) can step by hand.
export function tick(now = performance.now()) {
  const t0 = performance.now();
  const morphDue = !paused && now - lastMorph >= 1000 / morphFps;
  if (morphDue) lastMorph = now;
  for (const h of items) {
    const isActive = active.has(h);
    if (isActive && h._step()) active.delete(h);
    if (h.visible && (isActive || morphDue)) h._shape(now);
  }
  avgMs = avgMs * 0.95 + (performance.now() - t0) * 0.05;
  morphFps = avgMs > TUNING.slowMs ? 15 : TUNING.morphFps;
}

function loop(now) {
  tick(now);
  raf = items.size ? requestAnimationFrame(loop) : 0;
}

function ensureLoop() {
  if (!raf) raf = requestAnimationFrame(loop);
}

// Fast "12.3% " formatting (toFixed is slow when called thousands of times).
function pct(x) {
  return Math.round(x * 10) / 10 + '% ';
}

function spring(s, key, target, [k, damp]) {
  const vk = 'v' + key;
  s[vk] = (s[vk] + (target - s[key]) * k) * damp;
  s[key] += s[vk];
  return Math.abs(s[key] - target) < 0.0008 && Math.abs(s[vk]) < 0.0008;
}

// ---- one item -------------------------------------------------------------
export function createPhysics(layer, body, seed) {
  const r = seededRandom(seed || 1);
  // 4 slow oscillators: top/bottom horizontal radii, left/right vertical radii.
  const osc = [0, 1, 2, 3].map(() => ({ A: 6 + r() * 5, w: (Math.PI * 2) / (9000 + r() * 5000), p: r() * Math.PI * 2 }));

  const s = { pvx: 0, pvy: 0, last: null, dragging: false, swollen: false };
  for (const k of KEYS) { s[k] = REST[k]; s['v' + k] = 0; }
  let contacts = [];
  let lastRadius = '';
  let lastTransform = '';

  function wake() {
    if (REDUCED.matches) return;
    active.add(h);
    ensureLoop();
  }

  function targets() {
    const T = TUNING;
    const t = { ...REST };
    s.pvx *= 0.86;
    s.pvy *= 0.86;
    if (s.dragging) {
      t.ax = s.pvx * T.airPerPx;
      t.ay = s.pvy * T.airPerPx;
      const m = Math.hypot(t.ax, t.ay);
      if (m > T.maxAir) { t.ax *= T.maxAir / m; t.ay *= T.maxAir / m; }
      t.lift = T.lift;
      const speed = Math.hypot(s.pvx, s.pvy);
      if (speed > 0.05) {
        const f = Math.min(T.maxFrontFlat, speed * T.frontFlatPerPx);
        const ux = s.pvx / speed, uy = s.pvy / speed;
        t.fr = Math.max(0, ux) * f;
        t.fl = Math.max(0, -ux) * f;
        t.fb = Math.max(0, uy) * f;
        t.ft = Math.max(0, -uy) * f;
      }
    }
    if (s.swollen && !s.dragging) t.lift = T.swell;
    for (const c of contacts) {
      t.px += c.ux * c.s * T.contactPress;
      t.py += c.uy * c.s * T.contactPress;
      const f = c.s * T.contactFlat;
      t.fr = Math.max(t.fr, Math.max(0, c.ux) * f);
      t.fl = Math.max(t.fl, Math.max(0, -c.ux) * f);
      t.fb = Math.max(t.fb, Math.max(0, c.uy) * f);
      t.ft = Math.max(t.ft, Math.max(0, -c.uy) * f);
    }
    for (const k of ['fr', 'fl', 'fb', 'ft']) t[k] = Math.min(0.6, t[k]);
    return t;
  }

  function applyTransform(settled) {
    if (settled) {
      for (const k of KEYS) { s[k] = REST[k]; s['v' + k] = 0; }
      if (lastTransform) { layer.style.transform = ''; lastTransform = ''; }
      layer.style.opacity = '';
      return;
    }
    // Squeeze along the combined air+press direction: shorter along it,
    // a little wider across it (keeps the volume roughly the same).
    const cx = s.ax + s.px, cy = s.ay + s.py;
    const m = Math.hypot(cx, cy);
    let d11 = 1, d12 = 0, d22 = 1;
    if (m > 1e-4) {
      const ux = cx / m, uy = cy / m, p = 0.5 * m;
      d11 = 1 - m * ux * ux + p * uy * uy;
      d22 = 1 - m * uy * uy + p * ux * ux;
      d12 = -(m + p) * ux * uy;
    }
    const g = Math.max(0.01, s.g);
    const kx = g * s.lift * (1 + s.q) * s.sx;
    const ky = g * s.lift * (1 - s.q) * s.sy;
    layer.style.opacity = s.g < 0.7 ? String(Math.max(0, s.g / 0.7)) : '';
    const h0 = layer.offsetHeight;
    const trail = TUNING.trailPx / TUNING.maxAir;
    const tx = s.ox - s.ax * trail;
    const ty = s.oy - s.ay * trail - (h0 / 2) * (1 - s.sy); // size bounce anchored at the top
    const str = 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) matrix(' +
      (d11 * kx).toFixed(4) + ',' + (d12 * kx).toFixed(4) + ',' +
      (d12 * ky).toFixed(4) + ',' + (d22 * ky).toFixed(4) + ',0,0)';
    if (str !== lastTransform) { layer.style.transform = str; lastTransform = str; }
  }

  const h = {
    visible: true,

    _step() {
      const t = targets();
      let rest = true;
      for (const k of ['ax', 'ay']) rest = spring(s, k, t[k], SPRING.air) && rest;
      for (const k of ['px', 'py']) rest = spring(s, k, t[k], SPRING.press) && rest;
      for (const k of ['fr', 'fl', 'ft', 'fb']) rest = spring(s, k, t[k], SPRING.flat) && rest;
      rest = spring(s, 'lift', t.lift, SPRING.lift) && rest;
      rest = spring(s, 'q', 0, SPRING.squash) && rest;
      rest = spring(s, 'sx', 1, SPRING.size) && rest;
      rest = spring(s, 'sy', 1, SPRING.size) && rest;
      rest = spring(s, 'ox', 0, SPRING.glide) && rest;
      rest = spring(s, 'oy', 0, SPRING.glide) && rest;
      rest = spring(s, 'g', 1, s.vg >= 0 && s.g < 1.5 ? SPRING.grow : SPRING.growBack) && rest;
      const settled = rest && !s.dragging && !s.swollen && contacts.length === 0;
      applyTransform(settled);
      return settled;
    },

    // Outline = slow wobble, then each side flattened by its amount.
    _shape(now) {
      let tX = 0, bX = 0, lY = 0, rY = 0;
      if (!REDUCED.matches) {
        tX = osc[0].A * Math.sin(now * osc[0].w + osc[0].p);
        bX = osc[1].A * Math.sin(now * osc[1].w + osc[1].p);
        lY = osc[2].A * Math.sin(now * osc[2].w + osc[2].p);
        rY = osc[3].A * Math.sin(now * osc[3].w + osc[3].p);
      }
      const ft = 1 - s.ft, fb = 1 - s.fb, fl = 1 - s.fl, fr = 1 - s.fr;
      // horizontal radii TL TR BR BL / vertical radii TL TR BR BL
      const str =
        pct((50 + tX) * ft) + pct((50 - tX) * ft) + pct((50 - bX) * fb) + pct((50 + bX) * fb) + '/' +
        pct((50 + lY) * fl) + pct((50 + rY) * fr) + pct((50 - rY) * fr) + pct((50 - lY) * fl);
      if (str !== lastRadius) { body.style.borderRadius = str; lastRadius = str; }
    },

    pickUp() { s.dragging = true; s.last = null; s.vq -= 0.04; wake(); },

    pointer(x, y, t) {
      if (s.last) {
        const k = 16.7 / Math.max(4, t - s.last.t);
        s.pvx = s.pvx * 0.55 + (x - s.last.x) * k * 0.45;
        s.pvy = s.pvy * 0.55 + (y - s.last.y) * k * 0.45;
      }
      s.last = { x, y, t };
      wake();
    },

    drop() { s.dragging = false; s.vq += 0.09; wake(); },

    poke(amount = 0.06) { s.vq += amount; wake(); },

    // Armed drop target puffs up (and settles back when disarmed).
    swell(on) {
      if (s.swollen === !!on) return;
      s.swollen = !!on;
      wake();
    },

    // A new item comes into existence: from a dot, springing past full size.
    spawn() {
      if (REDUCED.matches) return;
      s.g = 0.05;
      s.vg = 0;
      s.vq = 0.04;
      applyTransform(false);
      wake();
    },

    // Old and new layout size: starts from the old size, springs to the new one.
    resized(prev, next) {
      if (REDUCED.matches || !prev.w || !prev.h || !next.w || !next.h) return;
      const c = x => Math.min(2, Math.max(0.5, x));
      s.sx *= c(prev.w / next.w);
      s.sy *= c(prev.h / next.h);
      applyTransform(false);
      wake();
    },

    // Item was moved by (−dx, −dy): show it at the old place and glide over,
    // with a little squish in the push direction.
    glideFrom(dx, dy) {
      if (REDUCED.matches) return;
      s.ox += dx;
      s.oy += dy;
      const m = Math.hypot(dx, dy) || 1;
      s.vpx -= (dx / m) * 0.03;
      s.vpy -= (dy / m) * 0.03;
      applyTransform(false);
      wake();
    },

    // contacts: [{ ux, uy, s }] — unit direction from this item towards the
    // blob touching it, and strength 0..1. Empty array = nothing touching.
    setContacts(list) {
      if (!list.length && !contacts.length) return;
      contacts = list;
      wake();
    },

    dispose() {
      items.delete(h);
      active.delete(h);
    }
  };

  items.add(h);
  h._shape(performance.now());
  ensureLoop();
  return h;
}
