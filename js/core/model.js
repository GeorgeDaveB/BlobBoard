// The data rules. Pure functions only: no screen, no storage.
import { uuid } from './ids.js';
import { PALETTE, isHex } from '../services/color.js';

export const SCHEMA = 1;
export const LIMITS = { name: 100, title: 200, notes: 5000, notesHtml: 20000, label: 80 };

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
const EDITABLE = ['title', 'notes', 'notesHtml', 'color', 'done', 'thumbId', 'tagIds'];

export function newItem(canvas, fields = {}, now = Date.now()) {
  const parentId = fields.parentId || null;
  const siblings = childrenOf(canvas, parentId);
  const item = {
    id: 'i-' + uuid(),
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
  if (!doc.items || typeof doc.items !== 'object') doc.items = {};
  if (!doc.links || typeof doc.links !== 'object') doc.links = {};

  // Item fields
  for (const [key, it] of Object.entries(doc.items)) {
    if (!it || typeof it !== 'object') { delete doc.items[key]; fixes.push('bad item ' + key); continue; }
    it.id = key;
    it.parentId = typeof it.parentId === 'string' && it.parentId ? it.parentId : null;
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
    if (it.parentId && (!doc.items[it.parentId] || it.parentId === it.id)) {
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
