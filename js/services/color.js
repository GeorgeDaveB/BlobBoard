// Colours: the 8 base colours, conversions, and automatic readable text colour.

export const PALETTE = [
  { name: 'Coral', hex: '#ff8a7a' },
  { name: 'Tangerine', hex: '#ffb066' },
  { name: 'Sunflower', hex: '#ffd966' },
  { name: 'Mint', hex: '#9be3b5' },
  { name: 'Teal', hex: '#5cc6be' },
  { name: 'Sky', hex: '#8ec5ff' },
  { name: 'Lavender', hex: '#b9a7f5' },
  { name: 'Rose', hex: '#f7a1c4' }
];

export const DARK_TEXT = '#1f1d1a';
export const LIGHT_TEXT = '#ffffff';

export function isHex(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

// Accepts "#abc", "abc", "#aabbcc", "aabbcc"; returns "#aabbcc" or null.
export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  let v = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : null;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const h = x => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

// h: 0-360, s and v: 0-1
export function hsvToRgb({ h, s, v }) {
  const f = n => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255 };
}

export function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hexToHsv(hex) { return rgbToHsv(hexToRgb(hex)); }
export function hsvToHex(hsv) { return rgbToHex(hsvToRgb(hsv)); }

// WCAG relative luminance.
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(hexA, hexB) {
  const a = luminance(hexA);
  const b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Picks whichever of dark/white text reads better on the given background.
export function textColorFor(bgHex) {
  return contrast(bgHex, DARK_TEXT) >= contrast(bgHex, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
}
