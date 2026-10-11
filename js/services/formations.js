// Formations (R34; on screen: "Bouncing"). Pure layout maths: given the
// blobs as they are now, where should each one go? Nothing here touches the
// store or the DOM, so every layout is unit-tested on its own.
//
// A node is { id, cx, cy, w, h } (centre and body size). Layouts return a
// Map id -> { cx, cy }. The royalty (if any) never moves and is not in the
// result. Adding a formation = adding one entry to FORMATIONS.

export const GAP = 28;    // space between neighbouring blobs
export const ROW_GAP = 36; // space between rows (Rows, Pyramid)
const CLEAR = 14;          // room a line needs to pass between two blobs

const DEG = Math.PI / 180;
// Ring fill order (owner): top-left, bottom-right, bottom-left, top-right,
// left, right, top, bottom. Screen angles (y points down).
export const RING_DIRS = [-135, 45, 135, -45, 180, 0, -90, 90].map(d => d * DEG);

const rad = n => Math.max(n.w, n.h) / 2;
const norm = a => { a %= 2 * Math.PI; return a < 0 ? a + 2 * Math.PI : a; };
const angDiff = (a, b) => { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, 2 * Math.PI - d); };
const dist2 = (a, b) => (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;

// Undirected neighbours from links [{ from, to }].
function neighbours(links) {
  const m = new Map();
  const add = (a, b) => { if (!m.has(a)) m.set(a, []); m.get(a).push(b); };
  for (const l of links || []) { add(l.from, l.to); add(l.to, l.from); }
  return m;
}

// Reading order: top to bottom in bands about one blob high, left to right.
export function readingOrder(nodes) {
  const band = Math.max(40, nodes.reduce((s, n) => s + n.h, 0) / Math.max(1, nodes.length));
  return nodes.slice().sort((a, b) => Math.round(a.cy / band) - Math.round(b.cy / band) || a.cx - b.cx || (a.id < b.id ? -1 : 1));
}

// ---- Ring ---------------------------------------------------------------------

// The order an outer ring's spots are filled in: nearest spot to top-left,
// then to its opposite, and so on (RING_DIRS), then the in-between
// directions, finer each pass.
function pizzaOrder(angles) {
  const left = angles.slice();
  const out = [];
  const refs = [];
  for (let p = 0; p < 6; p++) {
    const off = p === 0 ? 0 : (45 / 2 ** p) * DEG;
    for (let k = 0; k < (p === 0 ? 1 : 2 ** (p - 1)); k++) {
      const shift = p === 0 ? 0 : off * (2 * k + 1);
      for (const d of RING_DIRS) refs.push(d + shift);
    }
  }
  for (const r of refs) {
    if (!left.length) break;
    let best = 0;
    for (let i = 1; i < left.length; i++) if (angDiff(left[i], r) < angDiff(left[best], r) - 1e-9) best = i;
    out.push(left.splice(best, 1)[0]);
  }
  return out.concat(left);
}

// Spots on a ring that sit in the gaps between `blockers` (inner blobs as
// { ang, half }: the directions a straight line from the centre can't take)
// at least `step` radians apart. No blockers: evenly round the circle.
export function gapSlots(blockers, step) {
  const max = Math.floor((2 * Math.PI) / step + 1e-9);
  if (max < 1) return [];
  if (!blockers.length) return Array.from({ length: max }, (_, i) => RING_DIRS[0] + (i * 2 * Math.PI) / max);
  // Free arcs = the circle minus the blocked intervals.
  const iv = blockers.map(b => [norm(b.ang - b.half), b.half * 2]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, len] of iv) {
    if (len >= 2 * Math.PI) return [];
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], s + len);
    else merged.push([s, s + len]);
  }
  // Wrap: the last interval may run past 2π into the first.
  if (merged.length > 1 && merged[merged.length - 1][1] - 2 * Math.PI >= merged[0][0]) {
    const last = merged.pop();
    merged[0] = [last[0] - 2 * Math.PI, Math.max(merged[0][1], last[1] - 2 * Math.PI)];
  }
  const cand = [];
  for (let i = 0; i < merged.length; i++) {
    const s = merged[i][1];
    const e = i + 1 < merged.length ? merged[i + 1][0] : merged[0][0] + 2 * Math.PI;
    const L = e - s;
    if (L < 0) continue;
    const m = Math.floor(L / step + 1e-9) + 1;
    const first = s + (L - (m - 1) * step) / 2;
    for (let k = 0; k < m; k++) cand.push(norm(first + k * step));
  }
  // Keep spots at least `step` apart (also across neighbouring arcs).
  const kept = [];
  for (const a of pizzaOrder(cand)) if (kept.every(b => angDiff(a, b) >= step - 1e-9)) kept.push(a);
  return kept;
}

// Gives each node the free spot closest to its own direction (least travel).
function assign(nodes, angles, centre) {
  const pairs = [];
  nodes.forEach((n, i) => {
    const own = Math.atan2(n.cy - centre.cy, n.cx - centre.cx);
    angles.forEach((a, j) => pairs.push({ i, j, d: angDiff(own, a) }));
  });
  pairs.sort((p, q) => p.d - q.d || p.j - q.j || p.i - q.i);
  const usedN = new Set(), usedA = new Set();
  const out = new Map();
  for (const p of pairs) {
    if (usedN.has(p.i) || usedA.has(p.j)) continue;
    usedN.add(p.i);
    usedA.add(p.j);
    out.set(nodes[p.i].id, angles[p.j]);
  }
  return out;
}

// Ring around the royalty. Inner ring: 8 spokes in RING_DIRS order. Outer
// rings hold as many as fit and sit in the gaps between the inner blobs,
// so a straight line from the royalty passes between them. Blobs already
// linked to the royalty go innermost, then the nearest.
export function ringLayout(royalty, nodes, links = []) {
  const out = new Map();
  const members = nodes.filter(n => n.id !== royalty.id);
  if (!members.length) return out;
  const linked = new Set(neighbours(links).get(royalty.id) || []);
  const byNear = (a, b) => dist2(a, royalty) - dist2(b, royalty) || (a.id < b.id ? -1 : 1);
  const left = [...members.filter(n => linked.has(n.id)).sort(byNear), ...members.filter(n => !linked.has(n.id)).sort(byNear)];
  const rRoy = rad(royalty);
  const rings = []; // [{ R, placed: [{ n, ang }] }]

  while (left.length && rings.length < 60) {
    const rk = Math.max(...left.map(rad));
    let R, angles;
    if (!rings.length) {
      const compact = Math.max(rRoy + GAP + rk, (rk + GAP / 2) / Math.sin(Math.PI / 8));
      R = compact;
      if (left.length > 8) {
        // More rings to come: open the inner ring until the next ring fits
        // two blobs per gap (lines pass between the inner blobs).
        const rNext = Math.max(...left.slice(8).map(rad));
        for (let t = 0; t < 200; t++) {
          const half = Math.asin(Math.min(1, (rk + CLEAR) / R));
          const R2 = R + rk + GAP + rNext;
          const step2 = 2 * Math.asin(Math.min(1, (rNext + GAP / 2) / R2));
          if (Math.PI / 4 - 2 * half >= step2) break;
          R += 8;
        }
      }
      angles = RING_DIRS.slice(0, Math.min(8, left.length));
    } else {
      const prev = rings[rings.length - 1];
      const rPrev = Math.max(...prev.placed.map(p => rad(p.n)));
      R = prev.R + rPrev + GAP + rk;
      const step = 2 * Math.asin(Math.min(1, (rk + GAP / 2) / R));
      const block = list => list.flatMap(r => r.placed.map(p => ({ ang: p.ang, half: Math.asin(Math.min(1, (rad(p.n) + CLEAR) / r.R)) })));
      // Clear of every inner ring if possible, else of the one just inside,
      // else just evenly round.
      let slots = gapSlots(block(rings), step);
      if (!slots.length) slots = gapSlots(block([prev]), step);
      if (!slots.length) slots = gapSlots([], step);
      angles = pizzaOrder(slots).slice(0, left.length);
    }
    const take = left.splice(0, angles.length);
    const got = assign(take, angles, royalty);
    const ring = { R, placed: [] };
    for (const n of take) {
      const ang = got.get(n.id);
      ring.placed.push({ n, ang });
      out.set(n.id, { cx: royalty.cx + R * Math.cos(ang), cy: royalty.cy + R * Math.sin(ang) });
    }
    rings.push(ring);
  }
  return out;
}

// ---- Rows ---------------------------------------------------------------------

// How many blobs go in each row: extras to the first rows (11 in 3 = 4,4,3).
export function rowCounts(n, rows) {
  rows = Math.max(1, Math.min(n, Math.round(rows) || 1));
  const base = Math.floor(n / rows), extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

// Linked blobs next to each other: walks each linked group from its first
// blob in reading order; unlinked blobs keep reading order.
export function linkedOrder(nodes, links = []) {
  const ids = new Set(nodes.map(n => n.id));
  const nb = neighbours((links || []).filter(l => ids.has(l.from) && ids.has(l.to)));
  const read = readingOrder(nodes);
  const rank = new Map(read.map((n, i) => [n.id, i]));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const seen = new Set();
  const out = [];
  for (const start of read) {
    if (seen.has(start.id)) continue;
    const stack = [start.id];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(byId.get(id));
      const next = (nb.get(id) || []).filter(x => !seen.has(x)).sort((a, b) => rank.get(b) - rank.get(a));
      stack.push(...next);
    }
  }
  return out;
}

// Places rows of nodes (top to bottom) as a block: each row is as tall as
// its tallest blob; rows aligned 'left' | 'centre' | 'right' within the
// widest row. Returns Map + the block's size.
function placeRows(rowsOfNodes, align, left, top) {
  const out = new Map();
  const widths = rowsOfNodes.map(r => r.reduce((s, n) => s + n.w, 0) + GAP * Math.max(0, r.length - 1));
  const W = Math.max(0, ...widths);
  let y = top;
  rowsOfNodes.forEach((r, i) => {
    const h = Math.max(0, ...r.map(n => n.h));
    let x = left + (align === 'left' ? 0 : align === 'right' ? W - widths[i] : (W - widths[i]) / 2);
    for (const n of r) {
      out.set(n.id, { cx: x + n.w / 2, cy: y + h / 2 });
      x += n.w + GAP;
    }
    y += h + ROW_GAP;
  });
  return { out, W, H: y - top - ROW_GAP };
}

// Rows: centred on where the selection is now.
export function rowsLayout(nodes, links = [], { rows = 2, align = 'centre' } = {}) {
  if (!nodes.length) return new Map();
  const order = linkedOrder(nodes, links);
  const counts = rowCounts(order.length, rows);
  const rowsOf = [];
  let i = 0;
  for (const c of counts) { rowsOf.push(order.slice(i, i + c)); i += c; }
  const minX = Math.min(...nodes.map(n => n.cx - n.w / 2)), maxX = Math.max(...nodes.map(n => n.cx + n.w / 2));
  const minY = Math.min(...nodes.map(n => n.cy - n.h / 2)), maxY = Math.max(...nodes.map(n => n.cy + n.h / 2));
  const probe = placeRows(rowsOf, align, 0, 0);
  const left = (minX + maxX) / 2 - probe.W / 2, top = (minY + maxY) / 2 - probe.H / 2;
  return placeRows(rowsOf, align, left, top).out;
}

// ---- Pyramid ------------------------------------------------------------------

// Royalty on top; a tree by lines: blobs linked to the royalty in the row
// below it, blobs linked to those below them, and so on. Unlinked blobs fill
// the remaining places in pyramid order (row n holds n + 1), left to right.
export function pyramidLayout(royalty, nodes, links = []) {
  const members = nodes.filter(n => n.id !== royalty.id);
  if (!members.length) return new Map();
  const ids = new Set(members.map(n => n.id));
  const nb = neighbours(links);
  const byId = new Map(members.map(n => [n.id, n]));
  const read = readingOrder(members);
  const rank = new Map(read.map((n, i) => [n.id, i]));
  const parent = new Map();
  const rows = [];
  let frontier = [royalty.id];
  const seen = new Set([royalty.id]);
  while (frontier.length) {
    const next = [];
    for (const p of frontier) {
      const kids = (nb.get(p) || []).filter(x => ids.has(x) && !seen.has(x)).sort((a, b) => rank.get(a) - rank.get(b));
      for (const k of kids) { seen.add(k); parent.set(k, p); next.push(k); }
    }
    if (next.length) rows.push(next);
    frontier = next;
  }
  // Fill with the unlinked blobs, nearest to the royalty first.
  const rest = members.filter(n => !seen.has(n.id)).sort((a, b) => dist2(a, royalty) - dist2(b, royalty) || (a.id < b.id ? -1 : 1)).map(n => n.id);
  for (let L = 0; rest.length; L++) {
    if (!rows[L]) rows[L] = [];
    while (rows[L].length < L + 2 && rest.length) rows[L].push(rest.shift());
  }
  // Under their parents: order each row by the parent's place in the row above.
  const out = new Map();
  let top = royalty.cy + royalty.h / 2 + ROW_GAP;
  const xOf = new Map([[royalty.id, royalty.cx]]);
  for (const row of rows) {
    // Linked blobs take the spot nearest under their parent (in parent
    // order, so lines don't cross); the unlinked fill the rest left to right.
    const linkedPart = row.filter(id => parent.has(id)).sort((a, b) => xOf.get(parent.get(a)) - xOf.get(parent.get(b)) || rank.get(a) - rank.get(b));
    const fill = row.filter(id => !parent.has(id));
    const avg = row.reduce((s, id) => s + byId.get(id).w, 0) / row.length + GAP;
    const slotX = i => royalty.cx + (i - (row.length - 1) / 2) * avg;
    const slots = new Array(row.length).fill(null);
    let from = 0;
    linkedPart.forEach((id, k) => {
      const want = xOf.get(parent.get(id));
      const last = row.length - (linkedPart.length - k); // leave room for the rest
      let best = from;
      for (let i = from; i <= last; i++) if (Math.abs(slotX(i) - want) < Math.abs(slotX(best) - want)) best = i;
      slots[best] = id;
      from = best + 1;
    });
    for (const id of fill) slots[slots.indexOf(null)] = id;
    const ordered = slots.map(id => byId.get(id));
    const w = ordered.reduce((s, n) => s + n.w, 0) + GAP * (ordered.length - 1);
    const h = Math.max(...ordered.map(n => n.h));
    let x = royalty.cx - w / 2;
    for (const n of ordered) {
      const p = { cx: x + n.w / 2, cy: top + h / 2 };
      out.set(n.id, p);
      xOf.set(n.id, p.cx);
      x += n.w + GAP;
    }
    top += h + ROW_GAP;
  }
  return out;
}

// ---- registry -------------------------------------------------------------------
// royalty: needs a royalty picked first. lines: offers "+ lines" (royalty to
// each blob). minMembers: blobs needed besides the royalty.
export const FORMATIONS = [
  { id: 'ring', label: 'Ring', royalty: true, lines: true, minMembers: 1, layout: ({ royalty, nodes, links }) => ringLayout(royalty, nodes, links) },
  { id: 'rows', label: 'Rows', royalty: false, lines: false, minMembers: 2, layout: ({ nodes, links, opts }) => rowsLayout(nodes, links, opts) },
  { id: 'pyramid', label: 'Pyramid', royalty: true, lines: false, minMembers: 1, layout: ({ royalty, nodes, links }) => pyramidLayout(royalty, nodes, links) }
];

export const formationById = id => FORMATIONS.find(f => f.id === id) || null;
