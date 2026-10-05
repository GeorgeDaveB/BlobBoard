// Geometry of a "gooey string" line between two blobs (R21). Pure math, no
// DOM, so the board and (later) the PNG export draw it the same way.
//
// A shape is { cx, cy, a, b, rd }: centre, half-width, half-height and
// roundness (1 = blob/ellipse, lower = rounded rectangle, e.g. an open
// container). The string is a quadratic curve from edge to edge through a
// control point C that lags behind when blobs move (the caller springs it).
// It is thick where it leaves a blob and thin in the middle, and the longer
// it is, the thinner it gets, like a strand of slime being pulled apart.

export const STRAND = {
  endWidth: 16,       // max width where it leaves a blob
  midWidth: 8,        // max width in the middle (short strands)
  minMidWidth: 2.4,   // thinnest it gets when pulled far apart
  thinAt: 140,        // middle width starts dropping past this length
  inset: 8,           // ends tuck this far under the blob's edge
  arrowLen: 16,
  arrowHalf: 10,
  sag: 0.07,          // hangs down by this fraction of its length…
  maxSag: 22,         // …up to this many px
  samples: 16
};

// Distance from the centre to the outline in direction (ux, uy). A
// superellipse: exponent 2 = ellipse, higher = squarer (rounded rectangle).
export function edgeDistance(s, ux, uy) {
  const p = 2 + (1 - Math.max(0, Math.min(1, s.rd == null ? 1 : s.rd))) * 6;
  const v = Math.pow(Math.abs(ux) / s.a, p) + Math.pow(Math.abs(uy) / s.b, p);
  return v > 0 ? Math.pow(v, -1 / p) : 0;
}

// Point on A's outline facing (tx, ty).
export function edgeToward(s, tx, ty) {
  let dx = tx - s.cx, dy = ty - s.cy;
  const d = Math.hypot(dx, dy) || 1e-6;
  dx /= d; dy /= d;
  const r = edgeDistance(s, dx, dy);
  return { x: s.cx + dx * r, y: s.cy + dy * r, ux: dx, uy: dy };
}

// Where the middle of the string wants to rest: halfway, hanging a little.
export function restMid(A, B) {
  const len = Math.hypot(B.cx - A.cx, B.cy - A.cy);
  return { x: (A.cx + B.cx) / 2, y: (A.cy + B.cy) / 2 + Math.min(STRAND.maxSag, len * STRAND.sag) };
}

const quad = (p0, c, p1, t) => {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
};
const quadTangent = (p0, c, p1, t) => ({
  x: 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x),
  y: 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y)
});

// Middle width for a string of this length (thinner when longer).
export function midWidth(len) {
  const S = STRAND;
  return Math.max(S.minMidWidth, Math.min(S.midWidth, S.midWidth * S.thinAt / Math.max(1, len)));
}

// A, B: shapes (B may be a point { cx, cy, a: 0, b: 0 } while drawing a new
// line). mid: the (sprung) middle point. Returns null when the blobs overlap
// too much to show a string, else:
//   d      — filled outline of the string
//   arrows — filled arrowheads ('' if none; a separate shape so the overlap
//            with the string doesn't cancel out)
//   spine  — centre curve 'M … Q …' (for the wide invisible tap target)
//   at(t)  — point on the centre curve, t = 0 at A's edge … 1 at B's edge
//   len    — edge-to-edge length
export function strandGeometry(A, B, mid, arrows = {}) {
  const S = STRAND;
  // Control point so the curve passes through `mid` halfway.
  const c = { x: 2 * mid.x - (A.cx + B.cx) / 2, y: 2 * mid.y - (A.cy + B.cy) / 2 };
  const ea = A.a > 0 ? edgeToward(A, c.x, c.y) : { x: A.cx, y: A.cy };
  const eb = B.a > 0 ? edgeToward(B, c.x, c.y) : { x: B.cx, y: B.cy };
  const len = Math.hypot(eb.x - ea.x, eb.y - ea.y);
  // Edges crossing (blobs overlapping): nothing sensible to draw.
  const facing = (eb.x - ea.x) * (B.cx - A.cx) + (eb.y - ea.y) * (B.cy - A.cy);
  if (len < 6 || facing <= 0) return null;

  const wEnd = Math.min(S.endWidth, Math.max(6, len * 0.25));
  const wMid = Math.min(midWidth(len), wEnd);
  const unit = (v) => { const m = Math.hypot(v.x, v.y) || 1; return { x: v.x / m, y: v.y / m }; };
  const dirA = unit({ x: ea.x - c.x, y: ea.y - c.y }); // pointing into A
  const dirB = unit({ x: eb.x - c.x, y: eb.y - c.y }); // pointing into B
  const arrowLen = Math.min(S.arrowLen, len * 0.35);
  const arrowHalf = Math.max(S.arrowHalf, wEnd * 0.6);

  // String ends: tucked under the blob, or at the back of an arrowhead.
  const endAt = (e, dir, arrow, isBlob) => arrow
    ? { x: e.x - dir.x * (arrowLen - 2), y: e.y - dir.y * (arrowLen - 2) }
    : isBlob ? { x: e.x + dir.x * S.inset, y: e.y + dir.y * S.inset } : { x: e.x, y: e.y };
  const sa = endAt(ea, dirA, arrows.from, A.a > 0);
  const sb = endAt(eb, dirB, arrows.to, B.a > 0);

  const left = [], right = [];
  for (let i = 0; i <= S.samples; i++) {
    const t = i / S.samples;
    const p = quad(sa, c, sb, t);
    const tg = unit(quadTangent(sa, c, sb, t));
    const k = Math.abs(2 * t - 1);
    const w = (wMid + (wEnd - wMid) * k * k * k) / 2;
    left.push(p.x + -tg.y * w, p.y + tg.x * w);
    right.push(p.x - -tg.y * w, p.y - tg.x * w);
  }
  const f = n => Math.round(n * 10) / 10;
  let d = 'M' + f(left[0]) + ' ' + f(left[1]);
  for (let i = 2; i < left.length; i += 2) d += 'L' + f(left[i]) + ' ' + f(left[i + 1]);
  for (let i = right.length - 2; i >= 0; i -= 2) d += 'L' + f(right[i]) + ' ' + f(right[i + 1]);
  d += 'Z';
  const arrow = (e, dir) => {
    const bx = e.x - dir.x * arrowLen, by = e.y - dir.y * arrowLen;
    const nx = -dir.y * arrowHalf, ny = dir.x * arrowHalf;
    return 'M' + f(e.x) + ' ' + f(e.y) + 'L' + f(bx + nx) + ' ' + f(by + ny) + 'L' + f(bx - nx) + ' ' + f(by - ny) + 'Z';
  };
  const heads = (arrows.from ? arrow(ea, dirA) : '') + (arrows.to ? arrow(eb, dirB) : '');

  return {
    d,
    arrows: heads,
    spine: 'M' + f(ea.x) + ' ' + f(ea.y) + 'Q' + f(c.x) + ' ' + f(c.y) + ' ' + f(eb.x) + ' ' + f(eb.y),
    at: t => quad(ea, c, eb, t),
    a: ea,
    b: eb,
    len,
    wMid
  };
}
