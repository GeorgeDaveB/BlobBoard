// Pictures (R7, phase 4): turns a picked file into a library picture.
// Reads the file, turns phone photos upright (EXIF), shrinks it to at most
// MAX_SIDE px on its longest side, saves it as WebP (keeps transparency),
// and fingerprints the ORIGINAL file (SHA-256) so the same picture added
// twice — or on both devices — gets the same id and is stored once.

export const MAX_SIDE = 640;
export const QUALITY = 0.82;
export const MAX_FILE_BYTES = 40 * 1024 * 1024; // refuse absurdly large files
// A card's picture keeps its own shape within these height/width limits.
export const ASPECT = { min: 0.6, max: 1.6 };

export function clampAspect(w, h) {
  if (!(w > 0) || !(h > 0)) return 1;
  return Math.min(ASPECT.max, Math.max(ASPECT.min, h / w));
}

// Size that fits within max x max, never enlarged.
export function fitSize(w, h, max = MAX_SIDE) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

export async function fingerprint(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return 'p-' + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Decodes the file upright. createImageBitmap applies the EXIF rotation;
// older browsers fall back to an <img> (which also does, in current ones).
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (_) { /* try the <img> route */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Returns { id, blob, w, h } or throws an Error with a message for people.
export async function processImage(file, { max = MAX_SIDE, quality = QUALITY, knownIds = null } = {}) {
  const name = (file && file.name) || 'picture';
  if (!file || !file.size) throw new Error(name + ': the file is empty');
  if (file.size > MAX_FILE_BYTES) throw new Error(name + ': the file is too large');
  if (file.type && !file.type.startsWith('image/')) throw new Error(name + ': not a picture');
  const id = await fingerprint(await file.arrayBuffer());
  if (knownIds && knownIds.has(id)) return { id, duplicate: true };
  let src;
  try {
    src = await decode(file);
  } catch (_) {
    throw new Error(name + ': this picture format can’t be read here (e.g. some HEIC photos) — try a JPG or PNG');
  }
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  if (!sw || !sh) throw new Error(name + ': the picture has no size');
  const { w, h } = fitSize(sw, sh, max);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  if (src.close) src.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob) throw new Error(name + ': the picture could not be saved');
  return { id, blob, w, h };
}
