// The single source of truth in memory. Only these actions change data, so
// every change is saved, (later) synced and undoable the same way.
import { newItem, applyItemPatch, descendantsOf, maxZ } from './model.js';
import { createEmitter } from './events.js';

export const UNDO_LIMIT = 50;

export function createStore({ repo, now = () => Date.now() }) {
  const canvases = new Map();
  const history = new Map(); // canvasId -> { undo: [], redo: [] }
  const events = createEmitter();
  const ui = { canvasId: null, selectedId: null };

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
    events.emit({ type: 'data', canvasId });
    return true;
  }

  function replaceDoc(canvasId, json) {
    const doc = JSON.parse(json);
    canvases.set(canvasId, doc);
    if (ui.selectedId && !doc.items[ui.selectedId]) ui.selectedId = null;
    repo.saveCanvas(doc);
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
      ui.selectedId = null;
    },

    canvas(id = ui.canvasId) { return canvases.get(id) || null; },
    item(id) {
      const doc = canvases.get(ui.canvasId);
      return (doc && doc.items[id]) || null;
    },

    select(id) {
      const next = id || null;
      if (ui.selectedId === next) return;
      ui.selectedId = next;
      events.emit({ type: 'ui' });
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
      return commit(opts.coalesce, (doc, t) => {
        const item = doc.items[id];
        if (!item || (item.x === x && item.y === y)) return false;
        item.x = x;
        item.y = y;
        const top = maxZ(doc);
        if (item.z < top) item.z = top + 1;
        item.updatedAt = t;
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
    },

    // Throws away the session `key` entirely (no redo), e.g. a new item that
    // was closed while still empty. Only works if it is the latest step.
    cancelSession(key, canvasId = ui.canvasId) {
      const h = hist(canvasId);
      const top = h.undo[h.undo.length - 1];
      if (!key || !top || top.key !== key) return false;
      h.undo.pop();
      replaceDoc(canvasId, top.json);
      return true;
    }
  };

  return store;
}
