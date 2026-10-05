// Coordinates. A view is { x, y, z }: the board origin sits at screen (x, y)
// and everything is scaled by z. Rects are { x, y, w, h } with x/y = top-left.

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.5;

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function screenToWorld(view, sx, sy) {
  return { x: (sx - view.x) / view.z, y: (sy - view.y) / view.z };
}

export function worldToScreen(view, wx, wy) {
  return { x: wx * view.z + view.x, y: wy * view.z + view.y };
}

// Zoom by `factor` keeping the screen point (sx, sy) fixed under the finger.
export function zoomAt(view, sx, sy, factor, min = MIN_ZOOM, max = MAX_ZOOM) {
  const z = clamp(view.z * factor, min, max);
  const k = z / view.z;
  return { x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k, z };
}

export function boundsOf(rects) {
  if (!rects.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// View that shows `bounds` centred in a viewport of vw x vh.
export function fitView(bounds, vw, vh, pad = 48, maxZ = 1.25) {
  if (!bounds) return { x: vw / 2, y: vh / 3, z: 1 };
  const z = clamp(Math.min((vw - pad * 2) / Math.max(1, bounds.w), (vh - pad * 2) / Math.max(1, bounds.h)), MIN_ZOOM, maxZ);
  return {
    x: vw / 2 - (bounds.x + bounds.w / 2) * z,
    y: vh / 2 - (bounds.y + bounds.h / 2) * z,
    z
  };
}

export function rectsOverlap(a, b, gap = 0) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap &&
         a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

// Items are stored by horizontal centre + top edge; this turns one into a rect.
export function itemRect(item, size) {
  return { x: item.x - size.w / 2, y: item.y, w: size.w, h: size.h };
}
