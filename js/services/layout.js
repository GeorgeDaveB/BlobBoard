import { rectsOverlap } from './geometry.js';

export const NEW_ITEM_SIZE = { w: 140, h: 100 };

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
