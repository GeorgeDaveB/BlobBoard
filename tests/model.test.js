import { assert, assertEqual } from './runner.js';
import { newCanvas, newItem, badgeText, descendantsOf, ancestorsOf, childrenOf, sanitizeCanvas, applyItemPatch } from '../js/core/model.js';
import { PALETTE } from '../js/services/color.js';
import { migrateCanvas } from '../js/core/migrate.js';

function canvasWith(items, links = []) {
  const c = newCanvas('T');
  for (const it of items) c.items[it.id] = { ...newItem(c, it), ...it };
  for (const l of links) c.links[l.id] = { arrowFrom: false, arrowTo: false, createdAt: 1, updatedAt: 1, ...l };
  return c;
}

export const tests = {
  'newCanvas has the expected shape': () => {
    const c = newCanvas('Life');
    assertEqual(c.name, 'Life');
    assertEqual(c.schema, 1);
    assert(c.id.startsWith('c-'));
    assertEqual(c.settings.thumbnails, true);
    assertEqual(Object.keys(c.items).length, 0);
  },

  'newItem: rotates colours, stacks on top, appends order': () => {
    const c = newCanvas();
    const a = newItem(c, { title: 'a' });
    c.items[a.id] = a;
    const b = newItem(c, { title: 'b' });
    assertEqual(a.color, PALETTE[0].hex);
    assertEqual(b.color, PALETTE[1].hex);
    assert(b.z > a.z, 'z increases');
    assertEqual(b.order, a.order + 1);
    assertEqual(b.parentId, null);
  },

  'badgeText: exact 1-6 then 6+': () => {
    assertEqual([0, 1, 5, 6, 7, 30].map(badgeText), ['', '1', '5', '6', '6+', '6+']);
  },

  'tree helpers: children, descendants, ancestors': () => {
    const c = canvasWith([
      { id: 'a', parentId: null, order: 0 },
      { id: 'b', parentId: 'a', order: 1 },
      { id: 'c', parentId: 'a', order: 0 },
      { id: 'd', parentId: 'b', order: 0 }
    ]);
    assertEqual(childrenOf(c, 'a').map(i => i.id), ['c', 'b']);
    assertEqual(descendantsOf(c, 'a').sort(), ['b', 'c', 'd']);
    assertEqual(ancestorsOf(c, 'd'), ['b', 'a']);
  },

  'applyItemPatch: ignores unknown fields and bad colours, trims title': () => {
    const it = { title: 'x', notes: '', color: '#ffffff', done: false };
    assert(applyItemPatch(it, { title: 'y'.repeat(300), x: 99, color: 'red' }));
    assertEqual(it.title.length, 200);
    assertEqual(it.color, '#ffffff');
    assert(!('x' in it) || it.x !== 99);
    assert(!applyItemPatch(it, { done: false }), 'no change -> false');
  },

  'sanitize: missing parent is rescued to top level': () => {
    const c = canvasWith([{ id: 'a', parentId: 'ghost' }]);
    const { fixes } = sanitizeCanvas(c);
    assertEqual(c.items.a.parentId, null);
    assert(fixes.length > 0);
  },

  'sanitize: loops are broken': () => {
    const c = canvasWith([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }]);
    sanitizeCanvas(c);
    const tops = Object.values(c.items).filter(i => i.parentId === null).length;
    assertEqual(tops, 1, 'exactly one moved to top level');
    assertEqual(ancestorsOf(c, 'a').includes('a'), false);
  },

  'sanitize: bad fields are repaired': () => {
    const c = newCanvas();
    c.items.z1 = { title: 5, color: 'nope', x: 'a', tagIds: ['t', 't', 3], done: 'yes' };
    sanitizeCanvas(c);
    const it = c.items.z1;
    assertEqual(it.id, 'z1');
    assertEqual(it.title, '');
    assertEqual(it.color, PALETTE[0].hex);
    assertEqual(it.x, 0);
    assertEqual(it.tagIds, ['t']);
    assertEqual(it.done, false);
  },

  'sanitize: invalid links removed, duplicates keep newest': () => {
    const c = canvasWith(
      [{ id: 'a', parentId: null }, { id: 'b', parentId: null }, { id: 'k', parentId: 'a' }],
      [
        { id: 'l1', from: 'a', to: 'b', updatedAt: 1 },
        { id: 'l2', from: 'b', to: 'a', updatedAt: 5 },   // same pair, newer
        { id: 'l3', from: 'a', to: 'ghost' },             // missing end
        { id: 'l4', from: 'a', to: 'a' },                 // self
        { id: 'l5', from: 'b', to: 'k' }                  // different boards
      ]
    );
    sanitizeCanvas(c);
    assertEqual(Object.keys(c.links), ['l2']);
  },

  'migrate: rejects files from a newer app version': () => {
    let threw = false;
    try { migrateCanvas({ schema: 99 }); } catch (_) { threw = true; }
    assert(threw);
    assertEqual(migrateCanvas({ schema: 1, id: 'x' }).id, 'x');
  }
};
