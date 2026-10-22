// 3-way merge (phase 8, DESIGN §11.3, C5): the last version both devices
// agreed on (base) vs. this device (mine) vs. the other device (theirs).
// Pure functions — no storage, no network.
//
//  - changed on one side only            -> that change is kept
//  - both changed DIFFERENT fields        -> both kept
//  - both changed the SAME field          -> the newer edit (item updatedAt) wins;
//                                            the losing side is reported (backup)
//  - both changed an item's tags          -> combined (adds + removes from both)
//  - deleted on one side, untouched other -> deleted
//  - deleted on one side, EDITED other    -> kept (an edit is never silently lost)
//  - group deleted / loops / lines across boards -> repaired by sanitizeCanvas
import { sanitizeCanvas } from '../core/model.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Set merge for id lists: what either side added stays, what either side
// removed goes.
export function mergeSet(base = [], mine = [], theirs = []) {
  const b = new Set(base), m = new Set(mine), t = new Set(theirs);
  const out = [];
  for (const id of [...mine, ...theirs]) {
    if (out.includes(id)) continue;
    const removed = b.has(id) && (!m.has(id) || !t.has(id));
    if (!removed) out.push(id);
  }
  return out;
}

// Merges one record (item / link / tag / settings). Returns { value,
// conflicts: [field], loser: 'mine' | 'theirs' | null }.
export function mergeRecord(base, mine, theirs, { sets = [], skip = ['updatedAt'] } = {}) {
  const out = {};
  const conflicts = [];
  const mineNewer = (mine.updatedAt || 0) >= (theirs.updatedAt || 0);
  let loser = null;
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(mine), ...Object.keys(theirs)]);
  for (const k of keys) {
    if (skip.includes(k)) continue;
    const b = base ? base[k] : undefined, m = mine[k], t = theirs[k];
    let v;
    if (same(m, t)) v = m;
    else if (base && same(m, b)) v = t;
    else if (base && same(t, b)) v = m;
    else if (!base && m === undefined) v = t; // a field only one side has
    else if (!base && t === undefined) v = m;
    else if (sets.includes(k)) v = mergeSet(b || [], m || [], t || []);
    else {
      v = mineNewer ? m : t;
      conflicts.push(k);
      loser = mineNewer ? 'theirs' : 'mine';
    }
    if (v !== undefined) out[k] = clone(v);
  }
  out.updatedAt = Math.max(mine.updatedAt || 0, theirs.updatedAt || 0);
  return { value: out, conflicts, loser };
}

// Merges a map of records { id: record } (items, links).
function mergeMap(base = {}, mine = {}, theirs = {}, opts) {
  const out = {};
  const conflicts = [];
  const losers = new Set();
  const ids = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)]);
  for (const id of ids) {
    const b = base[id], m = mine[id], t = theirs[id];
    if (m && t) {
      const r = mergeRecord(b || null, m, t, opts);
      out[id] = r.value;
      if (r.conflicts.length) { conflicts.push({ id, fields: r.conflicts }); losers.add(r.loser); }
    } else if (m && !t) {
      // Theirs deleted it (b exists) — keep only if mine edited it; or mine added it.
      if (!b || !same(m, b)) out[id] = clone(m);
    } else if (t && !m) {
      if (!b || !same(t, b)) out[id] = clone(t);
    }
  }
  return { value: out, conflicts, losers };
}

// Whole canvas. base may be null (no agreed version yet: e.g. both devices
// had the canvas before the first sync). Returns { doc, conflicts,
// losers: Set('mine' | 'theirs') }.
export function mergeCanvas(base, mine, theirs) {
  const b = base || null;
  const items = mergeMap(b ? b.items : {}, mine.items, theirs.items, { sets: ['tagIds'] });
  const links = mergeMap(b ? b.links : {}, mine.links, theirs.links, {});
  const settings = mergeRecord(b ? b.settings : null, mine.settings || {}, theirs.settings || {}, { skip: [] });
  const head = mergeRecord(
    b ? { name: b.name } : null,
    { name: mine.name, updatedAt: mine.updatedAt },
    { name: theirs.name, updatedAt: theirs.updatedAt }
  );
  const doc = {
    ...clone(mine),
    name: head.value.name,
    settings: settings.value,
    items: items.value,
    links: links.value,
    createdAt: Math.min(mine.createdAt || Infinity, theirs.createdAt || Infinity),
    updatedAt: Math.max(mine.updatedAt || 0, theirs.updatedAt || 0)
  };
  if (!isFinite(doc.createdAt)) doc.createdAt = Date.now();
  sanitizeCanvas(doc);
  const conflicts = [...items.conflicts, ...links.conflicts.map(c => ({ ...c, link: true }))];
  if (settings.conflicts.length) conflicts.push({ settings: settings.conflicts });
  if (head.conflicts.length) conflicts.push({ name: true });
  const losers = new Set([...items.losers, ...links.losers]);
  if (settings.loser) losers.add(settings.loser);
  if (head.loser) losers.add(head.loser);
  return { doc, conflicts, losers };
}

// The shared tag list ([tag]); deleted tags keep a `deleted` flag.
export function mergeTags(base, mine, theirs) {
  const toMap = list => Object.fromEntries((list || []).map(t => [t.id, t]));
  const r = mergeMap(toMap(base), toMap(mine), toMap(theirs), {});
  return { tags: Object.values(r.value), conflicts: r.conflicts };
}
