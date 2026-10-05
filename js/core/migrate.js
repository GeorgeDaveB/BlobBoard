// Upgrades saved canvases from older formats. Add one step per schema bump:
//   if (v === 1) { ...change doc to v2 shape...; v = 2; }
import { SCHEMA } from './model.js';

export function migrateCanvas(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('not a canvas');
  const v = typeof doc.schema === 'number' ? doc.schema : 1;
  if (v > SCHEMA) {
    throw new Error('This canvas was saved by a newer version of BlobBoard. Reload to update the app.');
  }
  doc.schema = SCHEMA;
  return doc;
}
