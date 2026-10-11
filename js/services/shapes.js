// Simple shapes (R37): circle, rounded square, triangle, diamond, hexagon,
// trapezoid. Pure data: the outline as a polygon in a -1..1 box (null =
// ellipse / rounded rectangle via roundness), the drawing path in a 0..100
// box (stretched to the shape's own width and height), and the default size.
export const SHAPES = {
  circle: { label: 'Circle', poly: null, rd: 1, size: { w: 120, h: 120 } },
  square: { label: 'Square', poly: null, rd: 0.12, size: { w: 130, h: 110 } },
  triangle: { label: 'Triangle', poly: [[0, -1], [1, 1], [-1, 1]], size: { w: 150, h: 130 } },
  diamond: { label: 'Diamond', poly: [[0, -1], [1, 0], [0, 1], [-1, 0]], size: { w: 150, h: 130 } },
  hexagon: { label: 'Hexagon', poly: [[-0.5, -1], [0.5, -1], [1, 0], [0.5, 1], [-0.5, 1], [-1, 0]], size: { w: 150, h: 125 } },
  trapezoid: { label: 'Trapezoid', poly: [[-0.6, -1], [0.6, -1], [1, 1], [-1, 1]], size: { w: 160, h: 110 } }
};
export const SHAPE_IDS = Object.keys(SHAPES);
export const SHAPE_SIZE = { min: 40, max: 900 };

export const isShape = v => SHAPE_IDS.includes(v);
export const clampSize = v => Math.round(Math.max(SHAPE_SIZE.min, Math.min(SHAPE_SIZE.max, Number(v) || 0)));

// SVG path in a 0..100 box.
export function shapePath(id) {
  const s = SHAPES[id] || SHAPES.circle;
  if (id === 'square') return 'M12 0H88A12 12 0 0 1 100 12V88A12 12 0 0 1 88 100H12A12 12 0 0 1 0 88V12A12 12 0 0 1 12 0Z';
  if (!s.poly) return 'M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z';
  return 'M' + s.poly.map(([x, y]) => (50 + x * 50).toFixed(1) + ' ' + (50 + y * 50).toFixed(1)).join('L') + 'Z';
}

// Distance from the centre to a polygon outline in direction (ux, uy); the
// polygon's -1..1 box is stretched to half-width a, half-height b.
export function polyEdgeDistance(poly, a, b, ux, uy) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const px = x1 * a, py = y1 * b, qx = x2 * a - px, qy = y2 * b - py;
    // Solve t*u = p + s*q for t >= 0, 0 <= s <= 1.
    const den = ux * qy - uy * qx;
    if (Math.abs(den) < 1e-12) continue;
    const t = (px * qy - py * qx) / den;
    const s = (px * uy - py * ux) / den;
    if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = t;
  }
  return isFinite(best) ? best : 0;
}
