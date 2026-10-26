// The data rules. Pure functions only: no screen, no storage.
import { uuid } from './ids.js';
import { PALETTE, isHex } from '../services/color.js';
import { isShape, clampSize, SHAPES } from '../services/shapes.js';

export const SCHEMA = 1;
export const LIMITS = { name: 100, title: 200, notes: 5000, notesHtml: 20000, label: 80, tag: 40, tagsPerItem: 30 };

export function newCanvas(name, now = Date.now()) {
  return {
    schema: SCHEMA,
    id: 'c-' + uuid(),
    name: (name || 'My first canvas').slice(0, LIMITS.name),
    settings: { thumbnails: true, insideView: 'tray', growth: 1, lineStyle: 'goo', lineColor: 'gradient', lineWidth: 1 },
    createdAt: now,
    updatedAt: now,
    items: {},
    links: {}
  };
}

// notesHtml: the description with styling (sanitized subset, ui/richText.js);
// notes: the same as plain text.
// R37/R38: kind 'shape' adds shape + w/h (resizable); kind 'text' is free
// text on the canvas (notesHtml/notes = its content, color = text colour).
const EDITABLE = ['title', 'notes', 'notesHtml', 'color', 'done', 'thumbId', 'tagIds', 'shape', 'w', 'h'];
export const KINDS = ['blob', 'shape', 'text'];
export const TEXT_INK = '#2b2a28';
export const TEXT_MAX_W = 320;

export function newItem(canvas, fields = {}, now = Date.now()) {
  const kind = KINDS.includes(fields.kind) ? fields.kind : 'blob';
  const parentId = kind === 'blob' ? fields.parentId || null : null; // shapes / text never go inside
  const siblings = childrenOf(canvas, parentId);
  const item = {
    id: 'i-' + uuid(),
    kind,
    parentId,
    title: '',
    notes: '',
    notesHtml: '',
    color: nextColor(canvas),
    thumbId: null,
    tagIds: [],
    done: false,
    x: 0,
    y: 0,
    z: maxZ(canvas) + 1,
    order: siblings.length ? siblings[siblings.length - 1].order + 1 : 0,
    seed: Math.floor(Math.random() * 2147483647),
    createdAt: now,
    updatedAt: now
  };
  for (const k of EDITABLE) if (k in fields) item[k] = fields[k];
  if (kind === 'shape') {
    item.shape = isShape(item.shape) ? item.shape : 'circle';
    const def = SHAPES[item.shape].size;
    item.w = clampSize(item.w || def.w);
    item.h = clampSize(item.h || def.h);
  }
  if (kind === 'text' && !('color' in fields)) item.color = TEXT_INK;
  if ('x' in fields) item.x = fields.x;
  if ('y' in fields) item.y = fields.y;
  return item;
}

// Applies only known editable fields; returns true if anything changed.
export function applyItemPatch(item, patch) {
  let changed = false;
  for (const k of EDITABLE) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'title') v = String(v).slice(0, LIMITS.title);
    if (k === 'notes') v = String(v).slice(0, LIMITS.notes);
    if (k === 'notesHtml') v = String(v).slice(0, LIMITS.notesHtml);
    if (k === 'shape' && !isShape(v)) continue;
    if ((k === 'w' || k === 'h') && !(typeof v === 'number' && isFinite(v))) continue;
    if (k === 'w' || k === 'h') v = clampSize(v);
    if (k === 'tagIds') v = Array.isArray(v) ? [...new Set(v.filter(t => typeof t === 'string' && t))].slice(0, LIMITS.tagsPerItem) : [];
    if (k === 'color' && !isHex(v)) continue;
    if (k === 'done') v = !!v;
    if (JSON.stringify(item[k]) !== JSON.stringify(v)) {
      item[k] = v;
      changed = true;
    }
  }
  return changed;
}

export function nextColor(canvas) {
  return PALETTE[Object.keys(canvas.items).length % PALETTE.length].hex;
}

export function maxZ(canvas) {
  let z = 0;
  for (const it of Object.values(canvas.items)) if (it.z > z) z = it.z;
  return z;
}

export function childrenOf(canvas, parentId) {
  return Object.values(canvas.items)
    .filter(it => it.parentId === parentId)
    .sort((a, b) => a.order - b.order);
}

export function descendantsOf(canvas, id) {
  const out = [];
  const queue = [id];
  const seen = new Set([id]);
  while (queue.length) {
    const cur = queue.shift();
    for (const it of Object.values(canvas.items)) {
      if (it.parentId === cur && !seen.has(it.id)) {
        seen.add(it.id);
        out.push(it.id);
        queue.push(it.id);
      }
    }
  }
  return out;
}

// Parent first, up to the top level. Stops on a loop instead of hanging.
export function ancestorsOf(canvas, id) {
  const out = [];
  const seen = new Set([id]);
  let cur = canvas.items[id];
  while (cur && cur.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    out.push(cur.parentId);
    cur = canvas.items[cur.parentId];
  }
  return out;
}

// Can `id` be put inside `targetId` (null = top level)? Not into itself or
// anything inside it.
export function canMoveInto(canvas, id, targetId) {
  if (!canvas.items[id]) return false;
  if (targetId === null) return true;
  if (!canvas.items[targetId] || targetId === id) return false;
  // Shapes and text never go inside anything, and nothing goes inside them.
  if (kindOf(canvas.items[id]) !== 'blob' || kindOf(canvas.items[targetId]) !== 'blob') return false;
  return !ancestorsOf(canvas, targetId).includes(id);
}

// ---- links (lines between two items) ---------------------------------------

// Line look. style: 'goo' (gooey string) | 'straight'. color: 'gradient'
// (start blob's colour fading to the end blob's) | 'start' | 'end' | '#hex'.
// On a line, null = follow the canvas default (settings.lineStyle/lineColor).
export const LINE_STYLES = ['goo', 'straight'];
export const LINE_COLORS = ['gradient', 'start', 'end'];
const okStyle = v => LINE_STYLES.includes(v);
const okColor = v => LINE_COLORS.includes(v) || isHex(v);
// Thickness: a multiplier of the normal width (0.6 thin … 2.4 extra thick).
export const LINE_WIDTH = { min: 0.3, max: 3 };
const okWidth = v => typeof v === 'number' && isFinite(v) && v >= LINE_WIDTH.min && v <= LINE_WIDTH.max;

// A new line from `from` to `to`, with an arrowhead at the `to` end; look
// follows the canvas default; no label.
export function newLink(from, to, now = Date.now()) {
  return { id: 'l-' + uuid(), from, to, arrowFrom: false, arrowTo: true, style: null, color: null, width: null, label: '', createdAt: now, updatedAt: now };
}

// Applies known line fields (style, color, width, label); returns true if changed.
export function applyLinkPatch(link, patch) {
  let changed = false;
  const set = (k, v) => { if (link[k] !== v) { link[k] = v; changed = true; } };
  if ('style' in patch && (patch.style === null || okStyle(patch.style))) set('style', patch.style);
  if ('color' in patch && (patch.color === null || okColor(patch.color))) set('color', patch.color);
  if ('width' in patch && (patch.width === null || okWidth(patch.width))) set('width', patch.width);
  if ('label' in patch) set('label', String(patch.label).slice(0, LIMITS.label));
  return changed;
}

// What a line actually looks like: { style, width, c0, c1 } (colour at the
// start and end; equal for a single colour). A line's own choice wins over
// the canvas default.
export function lineLook(link, settings, fromColor, toColor) {
  const style = okStyle(link.style) ? link.style : okStyle(settings.lineStyle) ? settings.lineStyle : 'goo';
  const width = okWidth(link.width) ? link.width : okWidth(settings.lineWidth) ? settings.lineWidth : 1;
  const color = okColor(link.color) ? link.color : okColor(settings.lineColor) ? settings.lineColor : 'gradient';
  if (color === 'start') return { style, width, c0: fromColor, c1: fromColor };
  if (color === 'end') return { style, width, c0: toColor, c1: toColor };
  if (color === 'gradient') return { style, width, c0: fromColor, c1: toColor };
  return { style, width, c0: color, c1: color };
}

// The line joining a and b (either direction), or null.
export function linkBetween(canvas, a, b) {
  for (const ln of Object.values(canvas.links)) {
    if ((ln.from === a && ln.to === b) || (ln.from === b && ln.to === a)) return ln;
  }
  return null;
}

// Why a and b can't be connected: 'missing' | 'self' | 'level' (not on the
// same board) | 'exists' — or '' if they can.
export function linkProblem(canvas, a, b) {
  const A = canvas.items[a], B = canvas.items[b];
  if (!A || !B) return 'missing';
  if (a === b) return 'self';
  if (kindOf(A) === 'text' || kindOf(B) === 'text') return 'text'; // free text has no lines (R38)
  if (A.parentId !== B.parentId) return 'level';
  if (linkBetween(canvas, a, b)) return 'exists';
  return '';
}

export function countInside(canvas, id) {
  return childrenOf(canvas, id).length;
}

export function badgeText(n) {
  if (n <= 0) return '';
  return n <= 6 ? String(n) : '6+';
}

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);

// Repairs anything broken (design §6.6). Mutates and returns { doc, fixes }.
export function sanitizeCanvas(doc) {
  const fixes = [];
  const now = Date.now();
  if (!doc || typeof doc !== 'object') throw new Error('not a canvas');
  doc.schema = SCHEMA;
  if (typeof doc.id !== 'string' || !doc.id) { doc.id = 'c-' + uuid(); fixes.push('canvas id'); }
  doc.name = str(doc.name, LIMITS.name) || 'Untitled canvas';
  if (!doc.settings || typeof doc.settings !== 'object') doc.settings = {};
  doc.settings.thumbnails = doc.settings.thumbnails !== false;
  // How an expanded item shows what's inside: a tray below it, or inside the blob itself.
  doc.settings.insideView = doc.settings.insideView === 'container' ? 'container' : 'tray';
  // R30 growth: how many blobs' worth of area each inside item adds (0–3).
  const gr = Number(doc.settings.growth);
  doc.settings.growth = isFinite(gr) && doc.settings.growth !== null && doc.settings.growth !== '' ? Math.max(0, Math.min(3, gr)) : 1;
  // Default look of lines on this canvas.
  if (!okStyle(doc.settings.lineStyle)) doc.settings.lineStyle = 'goo';
  if (!okColor(doc.settings.lineColor)) doc.settings.lineColor = 'gradient';
  if (!okWidth(doc.settings.lineWidth)) doc.settings.lineWidth = 1;
  doc.createdAt = num(doc.createdAt, now);
  doc.updatedAt = num(doc.updatedAt, now);
  // Canvas password lock (salt + check value only; services/canvasLock.js).
  if (doc.lock !== undefined && !validLock(doc.lock)) { delete doc.lock; fixes.push('lock'); }
  if (!doc.items || typeof doc.items !== 'object') doc.items = {};
  if (!doc.links || typeof doc.links !== 'object') doc.links = {};

  // Item fields
  for (const [key, it] of Object.entries(doc.items)) {
    if (!it || typeof it !== 'object') { delete doc.items[key]; fixes.push('bad item ' + key); continue; }
    it.id = key;
    it.kind = KINDS.includes(it.kind) ? it.kind : 'blob';
    it.parentId = typeof it.parentId === 'string' && it.parentId && it.kind === 'blob' ? it.parentId : null;
    if (it.kind === 'shape') {
      it.shape = isShape(it.shape) ? it.shape : 'circle';
      it.w = clampSize(num(it.w, SHAPES[it.shape].size.w));
      it.h = clampSize(num(it.h, SHAPES[it.shape].size.h));
    }
    it.title = str(it.title, LIMITS.title);
    it.notes = str(it.notes, LIMITS.notes);
    it.notesHtml = str(it.notesHtml, LIMITS.notesHtml);
    if (!isHex(it.color)) { it.color = PALETTE[0].hex; fixes.push('colour ' + key); }
    it.thumbId = typeof it.thumbId === 'string' && it.thumbId ? it.thumbId : null;
    it.tagIds = Array.isArray(it.tagIds) ? [...new Set(it.tagIds.filter(t => typeof t === 'string'))] : [];
    it.done = it.done === true;
    it.x = num(it.x, 0);
    it.y = num(it.y, 0);
    it.z = num(it.z, 0);
    it.order = num(it.order, 0);
    it.seed = Math.floor(num(it.seed, 1)) >>> 0;
    it.createdAt = num(it.createdAt, now);
    it.updatedAt = num(it.updatedAt, now);
  }

  // Missing parent -> rescue to top level
  for (const it of Object.values(doc.items)) {
    if (it.parentId && (!doc.items[it.parentId] || it.parentId === it.id || doc.items[it.parentId].kind !== 'blob')) {
      it.parentId = null;
      fixes.push('rescued ' + it.id);
    }
  }

  // Loops -> break by moving the item that closes the loop to the top level
  for (const it of Object.values(doc.items)) {
    const seen = new Set([it.id]);
    let cur = it;
    while (cur.parentId) {
      if (seen.has(cur.parentId)) {
        cur.parentId = null;
        fixes.push('loop ' + cur.id);
        break;
      }
      seen.add(cur.parentId);
      cur = doc.items[cur.parentId];
    }
  }

  // Links: both ends exist, not the same item, same board, one per pair (newest wins)
  const byPair = new Map();
  for (const [key, ln] of Object.entries(doc.links)) {
    const a = ln && doc.items[ln.from];
    const b = ln && doc.items[ln.to];
    if (!a || !b || a === b || a.parentId !== b.parentId) {
      delete doc.links[key];
      fixes.push('link ' + key);
      continue;
    }
    ln.id = key;
    ln.arrowFrom = ln.arrowFrom === true;
    ln.arrowTo = ln.arrowTo === true;
    ln.style = okStyle(ln.style) ? ln.style : null;
    ln.color = okColor(ln.color) ? ln.color : null;
    ln.width = okWidth(ln.width) ? ln.width : null;
    ln.label = str(ln.label, LIMITS.label);
    ln.createdAt = num(ln.createdAt, now);
    ln.updatedAt = num(ln.updatedAt, now);
    const pair = [ln.from, ln.to].sort().join('|');
    const prev = byPair.get(pair);
    if (prev) {
      const loser = prev.updatedAt >= ln.updatedAt ? ln : prev;
      delete doc.links[loser.id];
      fixes.push('duplicate link ' + loser.id);
      byPair.set(pair, loser === ln ? prev : ln);
    } else {
      byPair.set(pair, ln);
    }
  }

  return { doc, fixes };
}

// ---- tags (R10, R11; phase 5) -------------------------------------------------
// Shared by every canvas: { id, name, color, createdAt, updatedAt, deleted? }.
// Items point at them with tagIds.

// For matching names: no case, no accents ("υγεια" finds "Υγεία").
export function foldText(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ').trim();
}

export function cleanTagName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.tag);
}

// A new tag; colour = the next palette colour after the existing tags.
export function newTag(name, existing = [], now = Date.now()) {
  const n = existing.filter(t => !t.deleted).length;
  return { id: 't-' + uuid(), name: cleanTagName(name), color: PALETTE[n % PALETTE.length].hex, createdAt: now, updatedAt: now };
}

// The live tag with this name (ignoring case and accents), or null.
export function findTagByName(tags, name) {
  const f = foldText(cleanTagName(name));
  if (!f) return null;
  return tags.find(t => !t.deleted && foldText(t.name) === f) || null;
}

// Tags whose name contains `query` (ignoring case/accents); names starting
// with it first.
export function searchTags(tags, query) {
  const q = foldText(query);
  const live = tags.filter(t => !t.deleted);
  if (!q) return live.slice().sort((a, b) => a.name.localeCompare(b.name));
  return live
    .map(t => ({ t, i: foldText(t.name).indexOf(q) }))
    .filter(x => x.i >= 0)
    .sort((a, b) => (a.i === 0 ? 0 : 1) - (b.i === 0 ? 0 : 1) || a.t.name.localeCompare(b.t.name))
    .map(x => x.t);
}

export const isTagColor = v => isHex(v);

export function sanitizeTag(t) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id) return null;
  const now = Date.now();
  return {
    id: t.id,
    name: cleanTagName(t.name) || 'Tag',
    color: isHex(t.color) ? t.color : PALETTE[0].hex,
    createdAt: num(t.createdAt, now),
    updatedAt: num(t.updatedAt, now),
    ...(t.deleted ? { deleted: true } : {})
  };
}

// R11 / C6: which items stay bright under the filter { tagIds, all }.
// An item matches if it has any (or, with `all`, every) picked tag; every
// group above a matching item stays bright too. Returns a Set of ids, or
// null when no filter is active.
export function filterMatches(canvas, filter) {
  const want = filter && Array.isArray(filter.tagIds) ? filter.tagIds : [];
  if (!want.length) return null;
  const bright = new Set();
  for (const it of Object.values(canvas.items)) {
    const has = new Set(it.tagIds || []);
    const ok = filter.all ? want.every(t => has.has(t)) : want.some(t => has.has(t));
    if (!ok) continue;
    bright.add(it.id);
    for (const a of ancestorsOf(canvas, it.id)) bright.add(a);
  }
  return bright;
}

// Items that match the filter themselves (not just because something inside does).
export function filterHits(canvas, filter) {
  const want = filter && Array.isArray(filter.tagIds) ? filter.tagIds : [];
  if (!want.length) return [];
  return Object.values(canvas.items).filter(it => {
    const has = new Set(it.tagIds || []);
    return filter.all ? want.every(t => has.has(t)) : want.some(t => has.has(t));
  }).map(it => it.id);
}

// 'blob' | 'shape' | 'text' (items saved before R37 have no kind = blob).
export function kindOf(item) {
  return item && KINDS.includes(item.kind) ? item.kind : 'blob';
}

// ---- copying items (phase 6: duplicate canvas, duplicate/move to canvas) ----
// Copies `rootIds` and everything inside them out of `src` with new ids,
// plus the lines between copied items. Returns { items, links, idMap }; the
// copies keep their fields (positions, parents inside the copy); roots keep
// their own parentId (the caller re-homes them).
export function cloneItems(src, rootIds, now = Date.now()) {
  const ids = [];
  for (const r of rootIds) if (src.items[r]) ids.push(r, ...descendantsOf(src, r));
  const idMap = new Map();
  for (const id of ids) if (!idMap.has(id)) idMap.set(id, 'i-' + uuid());
  const items = [];
  for (const [oldId, newId] of idMap) {
    const it = JSON.parse(JSON.stringify(src.items[oldId]));
    it.id = newId;
    if (it.parentId && idMap.has(it.parentId)) it.parentId = idMap.get(it.parentId);
    it.createdAt = now;
    it.updatedAt = now;
    items.push(it);
  }
  const links = [];
  for (const ln of Object.values(src.links)) {
    if (!idMap.has(ln.from) || !idMap.has(ln.to)) continue;
    links.push({ ...JSON.parse(JSON.stringify(ln)), id: 'l-' + uuid(), from: idMap.get(ln.from), to: idMap.get(ln.to), createdAt: now, updatedAt: now });
  }
  return { items, links, idMap };
}

// Only the outermost of `ids` (drops any whose ancestor is also listed).
export function outermost(canvas, ids) {
  const set = new Set(ids);
  return ids.filter(id => canvas.items[id] && !ancestorsOf(canvas, id).some(a => set.has(a)));
}

// A canvas password lock as stored on the canvas: { v, kdf: { name, hash,
// iterations, salt }, check } — never the password.
export function validLock(l) {
  return !!(l && typeof l === 'object' && l.kdf && l.kdf.name === 'PBKDF2' && typeof l.kdf.salt === 'string' && typeof l.check === 'string' && l.kdf.iterations >= 10000 && l.kdf.iterations <= 10000000);
}
