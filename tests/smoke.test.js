import { assert, assertEqual } from './runner.js';

// Phase 0: proves the browser has the features the design relies on.
export const tests = {
  'secure context (needed for service worker, crypto)': () => {
    assert(window.isSecureContext, 'serve over https or http://localhost');
  },
  'crypto.randomUUID available': () => {
    assertEqual(typeof crypto.randomUUID(), 'string');
  },
  'IndexedDB available': () => {
    assert('indexedDB' in window);
  },
  'SHA-256 via crypto.subtle': async () => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('blob'));
    assertEqual(buf.byteLength, 32);
  },
  'Pointer Events available': () => {
    assert('PointerEvent' in window);
  },
  'canvas can encode WebP': async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.8));
    assertEqual(blob && blob.type, 'image/webp');
  },
  'accent-insensitive Greek matching works': () => {
    const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    assertEqual(norm('Υγεία'), norm('υγεια'));
  }
};
