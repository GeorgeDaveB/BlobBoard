// The single source of truth in memory. Only these actions change data, so
// every change is saved, (later) synced and undoable the same way.
import { newItem, newLink, linkProblem, applyItemPatch, applyLinkPatch, descendantsOf, ancestorsOf, childrenOf, canMoveInto, maxZ } from './model.js';
import { createEmitter } from './events.js';

export const UNDO_LIMIT = 50;

export function createStore({ repo, now = () => Date.now() }) {
  const canvases = new Map();
  const history = new Map(); // canvasId -> { undo: [], redo: [] }
  const events = createEmitter();
  // Screen state (not saved): which items are expanded (a path from the top
  // level down: one per level, C2) and what is selected (an item or a line,
  // never both).
  const ui = { canvasId: null, expanded: [], selectedId: null, selectedLinkId: null };

  function hist(canvasId) {
    let h = history.get(canvasId);
    if (!h) history.set(canvasId, (h = { undo: [], redo: [] }));
    return h;
  }

  // Runs `mutate(doc, time)`. If it returns false nothing changed and nothing
  // is recorded. Consecutive commits with the same `key` share one undo step
  // (e.g. one editor session, not one step per keystroke).
  function commit(key, mutate, canvasId = ui.canvasId) {
    const doc = canvases.get(canvasId);
    if (!doc) throw new Error('No canvas ' + canvasId);
    const before = JSON.stringify(doc);
    const t = now();
    if (mutate(doc, t) === false) return false;
    const h = hist(canvasId);
    const top = h.undo[h.undo.length - 1];
    if (!(key && top && top.key === key)) {
      h.undo.push({ json: before, key: key || null });
      if (h.undo.length > UNDO_LIMIT) h.undo.shift();
    }
    h.redo.length = 0;
    doc.updatedAt = t;
    repo.saveCanvas(doc);
    fixUi();
    events.emit({ type: 'data', canvasId });
    return true;
  }

  // Keeps screen state valid after data changes (deletes, undo, sync):
  // the expanded path is still a parent->child chain, selection exists.
  function fixUi() {
    const doc = canvases.get(ui.canvasId);
    if (!doc) return;
    const path = [];
    let parent = null;
    for (const id of ui.expanded) {
      const it = doc.items[id];
      if (!it || it.parentId !== parent) break;
      path.push(id);
      parent = id;
    }
    ui.expanded = path;
    if (ui.selectedId && !doc.items[ui.selectedId]) ui.selectedId = null;
    if (ui.selectedLinkId && !doc.links[ui.selectedLinkId]) ui.selectedLinkId = null;
  }

  function replaceDoc(canvasId, json) {
    const doc = JSON.parse(json);
    canvases.set(canvasId, doc);
    repo.saveCanvas(doc);
    fixUi();
    events.emit({ type: 'data', canvasId, history: true });
  }

  const store = {
    ui,
    on: events.on,

    load(docs, currentId) {
      canvases.clear();
      history.clear();
      for (const d of docs) canvases.set(d.id, d);
      ui.canvasId = canvases.has(currentId) ? currentId : (docs[0] && docs[0].id) || null;
      ui.expanded = [];
      ui.selectedId = null;
      ui.selectedLinkId = null;
    },

    canvas(id = ui.canvasId) { return canvases.get(id) || null; },
    item(id) {
      const doc = canvases.get(ui.canvasId);
      return (doc && doc.items[id]) || null;
    },

    link(id) {
      const doc = canvases.get(ui.canvasId);
      return (doc && doc.links[id]) || null;
    },

    select(id) {
      const next = id || null;
      if (ui.selectedId === next && !ui.selectedLinkId) return;
      ui.selectedId = next;
      ui.selectedLinkId = null;
      events.emit({ type: 'ui' });
    },

    selectLink(id) {
      const next = id || null;
      if (ui.selectedLinkId === next && !ui.selectedId) return;
      ui.selectedLinkId = next;
      ui.selectedId = null;
      events.emit({ type: 'ui' });
    },

    setExpanded(path) {
      if (JSON.stringify(path) === JSON.stringify(ui.expanded)) return;
      ui.expanded = path.slice();
      fixUi();
      events.emit({ type: 'ui' });
    },

    // Opens the view of `id` (and everything above it), e.g. when it is
    // being edited in container view. Keeps sibling levels as they are.
    expandTo(id) {
      const doc = canvases.get(ui.canvasId);
      if (!doc || !doc.items[id]) return;
      const chain = [...ancestorsOf(doc, id).reverse(), id];
      store.setExpanded(chain);
    },

    // Per-canvas settings (insideView: 'tray' | 'container', growth: 0–3).
    // opts.coalesce: one undo step for e.g. one slider drag.
    setCanvasSetting(key, value, opts = {}) {
      return commit(opts.coalesce, doc => {
        if (doc.settings[key] === value) return false;
        doc.settings[key] = value;
      });
    },

    // Moves `id` to position `index` among its siblings (tray / container order).
    reorderItem(id, index) {
      return commit(null, (doc, t) => {
        const item = doc.items[id];
        if (!item) return false;
        const sibs = childrenOf(doc, item.parentId).filter(s => s.id !== id);
        const at = Math.max(0, Math.min(sibs.length, index));
        const before = childrenOf(doc, item.parentId).map(s => s.id).join();
        sibs.splice(at, 0, item);
        if (sibs.map(s => s.id).join() === before) return false;
        sibs.forEach((s, i) => { if (s.order !== i) { s.order = i; s.updatedAt = t; } });
      });
    },

    // Expand an item fully (whole notes + its inside items + an add tile),
    // collapsing any other at the same level (C2) — or collapse it if open.
    toggleExpand(id) {
      const doc = canvases.get(ui.canvasId);
      const it = doc && doc.items[id];
      if (!it) return;
      let depth;
      if (it.parentId === null) depth = 0;
      else {
        const at = ui.expanded.indexOf(it.parentId);
        if (at < 0) return;
        depth = at + 1;
      }
      if (ui.expanded[depth] === id) store.setExpanded(ui.expanded.slice(0, depth));
      else store.setExpanded(ui.expanded.slice(0, depth).concat(id));
    },

    createItem(fields, opts = {}) {
      let id = null;
      commit(opts.coalesce, (doc, t) => {
        const item = newItem(doc, fields, t);
        doc.items[item.id] = item;
        id = item.id;
      });
      return id;
    },

    updateItem(id, patch, opts = {}) {
      return commit(opts.coalesce, (doc, t) => {
        const item = doc.items[id];
        if (!item || !applyItemPatch(item, patch)) return false;
        item.updatedAt = t;
      });
    },

    moveItem(id, x, y, opts = {}) {
      return store.moveItems([{ id, x, y }], { ...opts, raise: id });
    },

    // Several moves as ONE undo step (a drop plus the blobs it pushed aside).
    // `raise` brings that item to the front.
    moveItems(moves, opts = {}) {
      return commit(opts.coalesce, (doc, t) => {
        let changed = false;
        for (const m of moves) {
          const item = doc.items[m.id];
          if (!item || (item.x === m.x && item.y === m.y)) continue;
          item.x = m.x;
          item.y = m.y;
          item.updatedAt = t;
          changed = true;
        }
        if (!changed) return false;
        const raised = opts.raise && doc.items[opts.raise];
        if (raised) {
          const top = maxZ(doc);
          if (raised.z < top) raised.z = top + 1;
        }
      });
    },

    // Puts `id` inside `parentId` (null = top level of the canvas) at (x, y) on
    // that board. Its lines are removed (R23); it goes to the end of the
    // tray. `pushes` (blobs moved aside on the target board) are part of the
    // same undo step. Refuses loops.
    reparentItem(id, parentId, x, y, opts = {}) {
      return commit(opts.coalesce, (doc, t) => {
        const item = doc.items[id];
        const target = parentId || null;
        if (!item || !canMoveInto(doc, id, target)) return false;
        if (item.parentId === target) return false;
        for (const [lid, ln] of Object.entries(doc.links)) {
          if (ln.from === id || ln.to === id) delete doc.links[lid];
        }
        const siblings = childrenOf(doc, target).filter(s => s.id !== id);
        item.parentId = target;
        if (opts.index != null) {
          // Dropped at a specific slot of the group's grid.
          siblings.splice(Math.max(0, Math.min(siblings.length, opts.index)), 0, item);
          siblings.forEach((s, i) => { if (s.order !== i) { s.order = i; s.updatedAt = t; } });
        } else {
          item.order = siblings.length ? siblings[siblings.length - 1].order + 1 : 0;
        }
        item.x = Math.round(x);
        item.y = Math.round(y);
        item.z = maxZ(doc) + 1;
        item.updatedAt = t;
        for (const m of opts.pushes || []) {
          const p = doc.items[m.id];
          if (p && p.parentId === target) { p.x = m.x; p.y = m.y; p.updatedAt = t; }
        }
      });
    },

    // Deletes the item, everything inside it, and every line touching them.
    deleteItem(id, opts = {}) {
      return commit(opts.coalesce, doc => {
        if (!doc.items[id]) return false;
        const gone = new Set([id, ...descendantsOf(doc, id)]);
        for (const g of gone) delete doc.items[g];
        for (const [lid, ln] of Object.entries(doc.links)) {
          if (gone.has(ln.from) || gone.has(ln.to)) delete doc.links[lid];
        }
        if (gone.has(ui.selectedId)) ui.selectedId = null;
      });
    },

    // A line from `from` to `to` (same board, one per pair), arrowhead at
    // `to`. Returns the new id, or null if not allowed (see linkProblem).
    createLink(from, to, opts = {}) {
      let id = null;
      commit(opts.coalesce, (doc, t) => {
        if (linkProblem(doc, from, to)) return false;
        const ln = newLink(from, to, t);
        doc.links[ln.id] = ln;
        id = ln.id;
      });
      return id;
    },

    // Adds or removes the arrowhead at one end ('from' | 'to').
    toggleArrow(linkId, end) {
      return commit(null, (doc, t) => {
        const ln = doc.links[linkId];
        if (!ln || (end !== 'from' && end !== 'to')) return false;
        const k = end === 'from' ? 'arrowFrom' : 'arrowTo';
        ln[k] = !ln[k];
        ln.updatedAt = t;
      });
    },

    // Style / colour / label of one line. opts.coalesce: one undo step per
    // editor session.
    updateLink(linkId, patch, opts = {}) {
      return commit(opts.coalesce, (doc, t) => {
        const ln = doc.links[linkId];
        if (!ln || !applyLinkPatch(ln, patch)) return false;
        ln.updatedAt = t;
      });
    },

    deleteLink(linkId) {
      return commit(null, doc => {
        if (!doc.links[linkId]) return false;
        delete doc.links[linkId];
      });
    },

    canUndo(canvasId = ui.canvasId) { return hist(canvasId).undo.length > 0; },
    canRedo(canvasId = ui.canvasId) { return hist(canvasId).redo.length > 0; },

    undo(canvasId = ui.canvasId) {
      const h = hist(canvasId);
      const entry = h.undo.pop();
      if (!entry) return false;
      h.redo.push({ json: JSON.stringify(canvases.get(canvasId)), key: null });
      replaceDoc(canvasId, entry.json);
      return true;
    },

    redo(canvasId = ui.canvasId) {
      const h = hist(canvasId);
      const entry = h.redo.pop();
      if (!entry) return false;
      h.undo.push({ json: JSON.stringify(canvases.get(canvasId)), key: null });
      replaceDoc(canvasId, entry.json);
      return true;
    }
  };

  return store;
}
