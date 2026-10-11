import { rectsOverlap } from './geometry.js';

// ---- blobs as ellipses ----------------------------------------------------
// e = { id, cx, cy, a, b }: centre and half-width / half-height.

export function ellipseOf(item, size) {
  return { id: item.id, cx: item.x, cy: item.y + size.h / 2, a: size.w / 2, b: size.h / 2 };
}

// Distance from the centre to the outline in direction (ux, uy).
export function support(e, ux, uy) {
  return (e.a * e.b) / Math.sqrt((e.b * ux) ** 2 + (e.a * uy) ** 2);
}

// How hard B is pressing on A. Returns null, or { ux, uy, s }: unit direction
// from A towards B, and strength 0..1 (starts `margin` px before touching).
export function ellipseContact(A, B, margin = 6) {
  let dx = B.cx - A.cx, dy = B.cy - A.cy;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-6) { dx = 0; dy = -1; dist = 1e-6; }
  const ux = dx / dist, uy = dy / dist;
  const reach = support(A, ux, uy) + support(B, -ux, -uy) + margin;
  const overlap = reach - dist;
  if (overlap <= 0) return null;
  const scale = Math.min(support(A, ux, uy), support(B, -ux, -uy));
  return { ux, uy, s: Math.min(1, overlap / Math.max(1, scale)) };
}

// After dropping `fixed` (one id, or several when many blobs are moved
// together — R24), pushes overlapping blobs out of the way by the smallest
// amount along the line between centres; anything they then hit is pushed
// too (chain reaction). Dropped blobs never move. Blobs that weren't
// involved stay put. Returns Map id -> { cx, cy } of moved blobs.
export function resolveOverlaps(list, fixed, gap = 10, maxPushes = 400) {
  const byId = new Map(list.map(e => [e.id, { ...e }]));
  const fixedIds = new Set(typeof fixed === 'string' ? [fixed] : fixed);
  const queue = [...fixedIds].filter(id => byId.has(id));
  if (!queue.length) return new Map();
  const moved = new Set();
  let pushes = 0;
  while (queue.length && pushes < maxPushes) {
    const A = byId.get(queue.shift());
    for (const B of byId.values()) {
      if (B.id === A.id || fixedIds.has(B.id)) continue;
      let dx = B.cx - A.cx, dy = B.cy - A.cy;
      let dist = Math.hypot(dx, dy);
      if (dist < 1e-6) { dx = 0; dy = 1; dist = 1e-6; }
      const ux = dx / dist, uy = dy / dist;
      const need = support(A, ux, uy) + support(B, ux, uy) + gap;
      if (dist >= need - 0.5) continue;
      const push = need - dist;
      B.cx += ux * push;
      B.cy += uy * push;
      moved.add(B.id);
      pushes++;
      if (!queue.includes(B.id)) queue.push(B.id);
    }
  }
  const out = new Map();
  for (const id of moved) out.set(id, { cx: byId.get(id).cx, cy: byId.get(id).cy });
  return out;
}

// R34: after a formation lands (`fixed` = its blobs, packed tightly), blobs
// caught in it first slide straight out, away from the formation's centre,
// until clear; then the usual chain push runs from the formation and the
// blobs that slid out. (A plain centre-to-centre push can trap a blob
// between two placed blobs in a column.) Returns Map id -> { cx, cy }.
export function clearFormation(list, fixed, gap = 10) {
  const byId = new Map(list.map(e => [e.id, { ...e }]));
  const fixedIds = new Set(fixed);
  const F = [...fixedIds].map(id => byId.get(id)).filter(Boolean);
  const moved = new Set();
  if (!F.length) return new Map();
  const fx = F.reduce((s, e) => s + e.cx, 0) / F.length, fy = F.reduce((s, e) => s + e.cy, 0) / F.length;
  const hits = B => F.some(A => {
    let dx = B.cx - A.cx, dy = B.cy - A.cy;
    const d = Math.hypot(dx, dy) || 1e-6;
    return d < support(A, dx / d, dy / d) + support(B, dx / d, dy / d) + gap - 0.5;
  });
  for (let round = 0; round < 4; round++) {
    const out = [];
    for (const B of byId.values()) {
      if (fixedIds.has(B.id) || !hits(B)) continue;
      let dx = B.cx - fx, dy = B.cy - fy;
      let d = Math.hypot(dx, dy);
      if (d < 1e-6) { dx = 0; dy = 1; d = 1; }
      for (let k = 0; k < 600 && hits(B); k++) { B.cx += (dx / d) * 8; B.cy += (dy / d) * 8; }
      moved.add(B.id);
      out.push(B.id);
    }
    const pushed = resolveOverlaps([...byId.values()], [...fixedIds, ...out], gap);
    for (const [id, p] of pushed) { const b = byId.get(id); b.cx = p.cx; b.cy = p.cy; moved.add(id); }
    if (![...byId.values()].some(B => !fixedIds.has(B.id) && hits(B))) break;
  }
  const res = new Map();
  for (const id of moved) res.set(id, { cx: byId.get(id).cx, cy: byId.get(id).cy });
  return res;
}

// Does ellipse e touch rectangle r ({ x, y, w, h }, same coordinates)? Used
// by the selection box: a blob is selected if the box touches its outline.
export function ellipseTouchesRect(e, r) {
  const nx = Math.max(r.x, Math.min(e.cx, r.x + r.w));
  const ny = Math.max(r.y, Math.min(e.cy, r.y + r.h));
  const dx = (nx - e.cx) / e.a, dy = (ny - e.cy) / e.b;
  return dx * dx + dy * dy <= 1;
}

export const NEW_ITEM_SIZE = { w: 140, h: 100 };

// Where an item dropped into a group lands on that group's inside board:
// to the right of the last item there (or the origin if it's empty).
export function spotInside(children) {
  if (!children.length) return { x: 0, y: 0 };
  const rects = children.map(c => ({ x: c.x - NEW_ITEM_SIZE.w / 2, y: c.y, w: NEW_ITEM_SIZE.w, h: NEW_ITEM_SIZE.h }));
  const last = children[children.length - 1];
  return findFreeSpot(rects, last.x + NEW_ITEM_SIZE.w + 30, last.y);
}

// Finds the nearest spot to (cx, top) where a w x h item doesn't overlap any of
// `rects`. Position is returned as { x: centre, y: top } like items store it.
export function findFreeSpot(rects, cx, top, w = NEW_ITEM_SIZE.w, h = NEW_ITEM_SIZE.h, gap = 16) {
  const fits = (x, y) => {
    const r = { x: x - w / 2, y, w, h };
    return !rects.some(o => rectsOverlap(r, o, gap));
  };
  if (fits(cx, top)) return { x: cx, y: top };
  const step = 40;
  for (let ring = 1; ring <= 40; ring++) {
    const samples = ring * 8;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * ring * step);
      const y = Math.round(top + Math.sin(a) * ring * step);
      if (fits(x, y)) return { x, y };
    }
  }
  return { x: cx, y: top };
}
