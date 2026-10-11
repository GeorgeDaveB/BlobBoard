import { assert, assertEqual } from './runner.js';
import { createStore } from '../js/core/store.js';
import { newCanvas, foldText, searchTags, findTagByName, sanitizeTag, filterMatches, filterHits, applyItemPatch, LIMITS } from '../js/core/model.js';
import { PALETTE } from '../js/services/color.js';
import { createItemEl, updateItemEl, MAX_CHIPS } from '../js/ui/itemView.js';

function setup() {
  let t = 1000;
  const saved = [];
  const store = createStore({ repo: { saveCanvas() {}, saveTag: tag => saved.push({ ...tag }) }, now: () => ++t });
  const c = newCanvas('T');
  store.load([c], c.id, []);
  return { store, saved };
}

export const tests = {
  'names match without case or accents, Greek included': () => {
    assertEqual(foldText('Υγεία'), foldText('υγεια'));
    assertEqual(foldText('  Café '), 'cafe');
    assertEqual(foldText('ΤΑΞΙΔΙΑ'), foldText('ταξίδια'));
    const tags = [{ id: 'a', name: 'Health' }, { id: 'b', name: 'Υγεία' }, { id: 'c', name: 'Healthy food' }, { id: 'd', name: 'My health', deleted: true }];
    assertEqual(findTagByName(tags, 'υγεια').id, 'b');
    assertEqual(searchTags(tags, 'heal').map(t => t.id), ['a', 'c'], 'starts-with first, deleted left out');
    assertEqual(searchTags(tags, 'food').map(t => t.id), ['c']);
  },

  'store: ensureTag creates once (any case/accents), colours rotate, saved': () => {
    const { store, saved } = setup();
    const a = store.ensureTag('  Health  ');
    assertEqual(store.ensureTag('HEALTH'), a, 'same tag');
    const b = store.ensureTag('Υγεία');
    assertEqual(store.ensureTag('υγεια'), b);
    assertEqual([store.tag(a).color, store.tag(b).color], [PALETTE[0].hex, PALETTE[1].hex]);
    assertEqual(store.tags().map(t => t.name), ['Health', 'Υγεία']);
    assertEqual(store.ensureTag('   '), null);
    assertEqual(saved.length, 2);
  },

  'store: rename refuses an existing name; recolour': () => {
    const { store } = setup();
    const a = store.ensureTag('Work');
    store.ensureTag('Home');
    assertEqual(store.updateTag(a, { name: 'home' }), 'exists');
    assertEqual(store.updateTag(a, { name: ' ' }), 'empty');
    assertEqual(store.updateTag(a, { name: 'Office', color: PALETTE[5].hex }), '');
    assertEqual([store.tag(a).name, store.tag(a).color], ['Office', PALETTE[5].hex]);
  },

  'store: delete takes the tag off items (undoable) and hides it; restore brings it back': () => {
    const { store } = setup();
    const t1 = store.ensureTag('A'), t2 = store.ensureTag('B');
    const i1 = store.createItem({ tagIds: [t1, t2] });
    const i2 = store.createItem({ tagIds: [t1] });
    assertEqual(store.tagUses(t1), 2);
    store.setFilter({ tagIds: [t1] });
    assertEqual(store.deleteTag(t1, { coalesce: 'td' }), 2);
    assertEqual([store.item(i1).tagIds, store.item(i2).tagIds, store.tag(t1)], [[t2], [], null]);
    assertEqual(store.ui.filter.tagIds, [], 'filter forgets a deleted tag');
    store.restoreTag(t1);
    store.undoStep('td');
    assertEqual([store.item(i1).tagIds, !!store.tag(t1)], [[t1, t2], true]);
  },

  'item tagIds are cleaned: strings only, no repeats, capped': () => {
    const it = { tagIds: [] };
    applyItemPatch(it, { tagIds: ['a', 'a', 3, '', 'b'] });
    assertEqual(it.tagIds, ['a', 'b']);
    applyItemPatch(it, { tagIds: Array.from({ length: 50 }, (_, i) => 't' + i) });
    assertEqual(it.tagIds.length, LIMITS.tagsPerItem);
    assertEqual(sanitizeTag({ id: 't-1', name: '  x  ', color: 'red' }).color, PALETTE[0].hex);
    assertEqual(sanitizeTag({ name: 'no id' }), null);
  },

  'filter: any / all; a group stays bright if anything inside matches': () => {
    const { store } = setup();
    const a = store.ensureTag('A'), b = store.ensureTag('B');
    const top = store.createItem({});
    const mid = store.createItem({ parentId: top });
    const leaf = store.createItem({ parentId: mid, tagIds: [a, b] });
    const other = store.createItem({ tagIds: [a] });
    const plain = store.createItem({});
    const doc = store.canvas();
    assertEqual(filterMatches(doc, { tagIds: [] }), null, 'no filter');
    const any = filterMatches(doc, { tagIds: [a] });
    assert(any.has(leaf) && any.has(mid) && any.has(top) && any.has(other) && !any.has(plain), 'any + ancestors');
    const all = filterMatches(doc, { tagIds: [a, b], all: true });
    assert(all.has(leaf) && all.has(top) && !all.has(other), 'all');
    assertEqual(filterHits(doc, { tagIds: [a] }).sort(), [leaf, other].sort(), 'hits = the items themselves');
  },

  'setFilter keeps only live tags; no change = no event': () => {
    const { store } = setup();
    const a = store.ensureTag('A');
    let n = 0;
    store.on(() => n++);
    store.setFilter({ tagIds: [a, 'gone'], all: true });
    assertEqual(store.ui.filter, { tagIds: [a], all: true });
    store.setFilter({ tagIds: [a], all: true });
    assertEqual(n, 1);
  },

  'item view: up to 3 chips then +N; none on minis; faded': () => {
    const tags = [1, 2, 3, 4, 5].map(i => ({ id: 't' + i, name: 'Tag ' + i, color: PALETTE[i].hex }));
    const item = { id: 'i', title: 'X', notes: '', notesHtml: '', color: '#ff8a7a', done: false, seed: 3, tagIds: tags.map(t => t.id) };
    const ctx = { tagsOf: ids => ids.map(id => tags.find(t => t.id === id)), faded: true };
    const el = createItemEl(item, { onEdit() {} });
    updateItemEl(el, item, ctx);
    const chips = [...el._parts.tagRow.children].map(c => c.textContent);
    assertEqual(chips, ['Tag 1', 'Tag 2', 'Tag 3', '+2']);
    assertEqual(MAX_CHIPS, 3);
    assert(el.classList.contains('faded'), 'faded');
    const mini = createItemEl(item, { onEdit() {}, mini: true });
    updateItemEl(mini, item, ctx);
    assert(mini._parts.tagRow.hidden, 'no chips on minis');
    el._phys.dispose();
    mini._phys.dispose();
  }
};
