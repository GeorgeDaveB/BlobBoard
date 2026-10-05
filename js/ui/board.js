// The canvas you see: pan/zoom, rendering top-level items by id (with the
// tray of an expanded item), dragging, grouping drops, auto-pan.
import { screenToWorld, worldToScreen, zoomAt, fitView, boundsOf, itemRect } from '../services/geometry.js';
import { findFreeSpot, spotInside, NEW_ITEM_SIZE, ellipseOf, ellipseContact, resolveOverlaps } from '../services/layout.js';
import { childrenOf, descendantsOf } from '../core/model.js';
import { createItemEl, updateItemEl, positionEl } from './itemView.js';
import { renderTray, disposeTray } from './tray.js';
import { attachGestures } from './gestures.js';
import { setPaused } from './physics.js';

const EDGE = 48;        // auto-pan zone at the screen edge while dragging (px)
const EDGE_SPEED = 14;  // max auto-pan speed (px per frame)
const DOT = 24;         // background dot spacing at zoom 1
const ARM_MS = 500;     // hold over a blob this long to drop *into* it

export function createBoard({ host, store, onEdit, onAddInside, onCreateAt, onTapEmpty, onViewChange }) {
  const boardEl = document.createElement('div');
  boardEl.className = 'board';
  const world = document.createElement('div');
  world.className = 'world';
  const itemsLayer = document.createElement('div');
  itemsLayer.className = 'items-layer';
  world.append(itemsLayer);
  const hint = document.createElement('div');
  hint.className = 'empty-hint';
  boardEl.append(world, hint);
  host.append(boardEl);

  const els = new Map();     // items on this board
  const allEls = new Map();  // + minis in trays (rebuilt every render)
  const sizes = new Map();   // body sizes of items on this board
  let view = { x: 0, y: 0, z: 1 };
  let drag = null;
  let rafPan = 0;
  let wheelTimer = 0;

  // Body sizes (for placement, fit, contacts). A size change bounces the
  // blob. Runs after layout, before paint, so the bounce has no flash.
  const ro = new ResizeObserver(entries => {
    for (const en of entries) {
      const itemEl = en.target.closest('.item');
      if (!itemEl || itemEl.classList.contains('mini')) continue;
      const id = itemEl.dataset.id;
      const next = { w: en.target.offsetWidth, h: en.target.offsetHeight };
      const prev = sizes.get(id);
      sizes.set(id, next);
      if (prev && (prev.w !== next.w || prev.h !== next.h)) itemEl._phys.resized(prev, next);
    }
  });
  // Pause animation for items off screen (battery).
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      en.target.classList.toggle('offscreen', !en.isIntersecting);
      en.target._phys.visible = en.isIntersecting;
    }
  }, { root: boardEl, rootMargin: '120px' });

  function setMoving(on) {
    boardEl.classList.toggle('moving', on);
    setPaused(on);
  }

  const rect = () => boardEl.getBoundingClientRect();
  const sizeOf = id => sizes.get(id) || NEW_ITEM_SIZE;

  function applyView() {
    world.style.transform = 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.z + ')';
    world.style.setProperty('--z', view.z);
    boardEl.style.backgroundSize = DOT * view.z + 'px ' + DOT * view.z + 'px';
    boardEl.style.backgroundPosition = view.x + 'px ' + view.y + 'px';
    if (onViewChange) onViewChange(view);
  }

  function boardItems() {
    const doc = store.canvas();
    return doc ? Object.values(doc.items).filter(it => it.parentId === null) : [];
  }

  // ---- rendering ------------------------------------------------------------
  function render() {
    const doc = store.canvas();
    const ui = store.ui;
    const seen = new Set();
    allEls.clear();
    const trayCtx = { doc, ui, onEdit, onAdd: onAddInside, register: (id, el) => allEls.set(id, el) };

    for (const item of boardItems()) {
      seen.add(item.id);
      let el = els.get(item.id);
      if (!el) {
        el = createItemEl(item, { onEdit });
        els.set(item.id, el);
        itemsLayer.append(el);
        ro.observe(el._parts.body);
        io.observe(el);
      }
      const expanded = ui.expanded[0] === item.id;
      updateItemEl(el, item, { selected: ui.selectedId === item.id, kids: childrenOf(doc, item.id), expanded });
      allEls.set(item.id, el);
      if (!drag || drag.id !== item.id || drag.ghost) {
        positionEl(el, item.x, item.y);
        el.style.zIndex = expanded ? 900000 : item.z;
      }
      // Tray (expanded item)
      if (expanded) {
        if (!el._tray) {
          el._tray = document.createElement('div');
          el._tray.className = 'tray tray-root';
          el.append(el._tray);
        }
        renderTray(el._tray, item, 0, trayCtx);
      } else if (el._tray) {
        disposeTray(el._tray);
        el._tray.remove();
        el._tray = null;
      }
    }
    for (const [id, el] of els) {
      if (seen.has(id)) continue;
      ro.unobserve(el._parts.body);
      io.unobserve(el);
      if (el._tray) disposeTray(el._tray);
      el._phys.dispose();
      el.remove();
      els.delete(id);
      sizes.delete(id);
    }
    hint.hidden = seen.size > 0;
    hint.textContent = 'Double-tap empty space or press + to add an item';
  }

  // ---- dragging -----------------------------------------------------------
  // drag = { id, el (what moves: the board item, or a ghost for a mini),
  //          ghost, miniEl, size, grabX, grabY, px, py, x, y,
  //          banned (ids it can't be dropped into), hoverId, armedId }
  function updateDrag() {
    const r = rect();
    const wp = screenToWorld(view, drag.px - r.left, drag.py - r.top);
    drag.x = Math.round(wp.x - drag.grabX);
    drag.y = Math.round(wp.y - drag.grabY);
    positionEl(drag.el, drag.x, drag.y);
    updateContacts();
    updateTarget();
  }

  // Blobs the dragged one overlaps get their facing edge pressed flat (they
  // don't move); the dragged blob is pressed back the same way.
  let touching = new Map();
  function updateContacts() {
    const me = ellipseOf({ id: drag.id, x: drag.x, y: drag.y }, drag.size);
    const now = new Map();
    const mine = [];
    for (const [id, el] of els) {
      if (id === drag.id || id === drag.armedId) continue; // armed target swells instead
      const it = store.item(id);
      if (!it) continue;
      const c = ellipseContact(ellipseOf(it, sizeOf(id)), me);
      if (!c) continue;
      now.set(id, el);
      el._phys.setContacts([c]);
      mine.push({ ux: -c.ux, uy: -c.uy, s: c.s });
    }
    for (const [id, el] of touching) if (!now.has(id)) el._phys.setContacts([]);
    touching = now;
    drag.el._phys.setContacts(mine);
  }

  function clearContacts() {
    for (const el of touching.values()) el._phys.setContacts([]);
    touching = new Map();
  }

  // What is under the finger: a blob (board or mini), a tray's background,
  // or empty board.
  function hitTest(x, y) {
    for (const e of document.elementsFromPoint(x, y)) {
      const it = e.closest('.item');
      const tr = e.closest('.tray');
      if (tr && (!it || !tr.contains(it))) return { kind: 'tray' };
      if (it) {
        if (it === drag.el || it.classList.contains('ghosted')) continue;
        return { kind: 'item', id: it.dataset.id, el: it };
      }
      if (e === boardEl) return { kind: 'empty' };
    }
    return { kind: 'outside' };
  }

  function disarm() {
    clearTimeout(drag.armTimer);
    if (drag.armedId) {
      const el = allEls.get(drag.armedId);
      if (el) { el.classList.remove('drop-target'); el._phys.swell(false); }
    }
    drag.armedId = null;
  }

  function updateTarget() {
    const hit = hitTest(drag.px, drag.py);
    drag.hit = hit;
    const target = hit.kind === 'item' && !drag.banned.has(hit.id) ? hit.id : null;
    if (target === drag.hoverId) return;
    disarm();
    drag.hoverId = target;
    if (!target) return;
    drag.armTimer = setTimeout(() => {
      if (!drag || drag.hoverId !== target) return;
      const el = allEls.get(target);
      if (!el) return;
      drag.armedId = target;
      el.classList.add('drop-target');
      el._phys.setContacts([]);
      el._phys.swell(true, swellToShow(el));
      if (navigator.vibrate) navigator.vibrate(20);
    }, ARM_MS);
  }

  // How much an armed target must puff up so its edge shows all around the
  // blob being held (title and notes included), so you can see which one
  // you're about to drop into.
  function swellToShow(targetEl) {
    const t = targetEl._parts.body.getBoundingClientRect();
    const h = drag.el._parts.body.getBoundingClientRect();
    const margin = 26;
    const s = Math.max(1.12, (h.width + margin) / Math.max(1, t.width), (h.height + margin) / Math.max(1, t.height));
    return isFinite(s) ? Math.min(3, s) : 1.12;
  }

  function autoPanTick() {
    if (!drag) return;
    const r = rect();
    const speed = d => (d < EDGE ? EDGE_SPEED * (1 - Math.max(0, d) / EDGE) : 0);
    const vx = speed(drag.px - r.left) - speed(r.right - drag.px);
    const vy = speed(drag.py - r.top) - speed(r.bottom - drag.py);
    if (vx || vy) {
      view.x += vx;
      view.y += vy;
      applyView();
      updateDrag();
    }
    rafPan = requestAnimationFrame(autoPanTick);
  }

  function startDrag(id, sx, sy) {
    const doc = store.canvas();
    const item = store.item(id);
    if (!item) return;
    const r = rect();
    const wp = screenToWorld(view, sx - r.left, sy - r.top);
    const banned = new Set([id, ...descendantsOf(doc, id)]);
    if (item.parentId) banned.add(item.parentId);
    const base = { id, px: sx, py: sy, banned, hoverId: null, armedId: null, armTimer: 0 };

    if (els.has(id)) {
      // A blob on this board: move it directly. An expanded group closes first.
      if (store.ui.expanded[0] === id) store.setExpanded([]);
      const el = els.get(id);
      drag = { ...base, el, ghost: false, size: sizeOf(id), grabX: wp.x - item.x, grabY: wp.y - item.y, x: item.x, y: item.y };
      el.style.zIndex = 1000000;
    } else {
      // A mini inside a tray: lift a full-size copy ("ghost") out of the tray.
      const miniEl = allEls.get(id);
      if (!miniEl) return;
      const ghost = createItemEl(item, { onEdit });
      updateItemEl(ghost, item, { kids: childrenOf(doc, id) });
      ghost.classList.add('ghost');
      ghost.style.zIndex = 1000000;
      itemsLayer.append(ghost);
      const size = { w: ghost._parts.body.offsetWidth, h: ghost._parts.body.offsetHeight };
      miniEl.classList.add('ghosted');
      drag = { ...base, el: ghost, ghost: true, miniEl, size, grabX: 0, grabY: size.h / 2, x: wp.x, y: wp.y - size.h / 2 };
      positionEl(ghost, drag.x, drag.y);
      ghost._phys.spawn();
    }
    drag.el.classList.add('dragging');
    boardEl.classList.add('dragging-item');
    drag.el._phys.pickUp();
    drag.el._phys.pointer(sx, sy, performance.now());
    store.select(id);
    rafPan = requestAnimationFrame(autoPanTick);
  }

  function finishDrag() {
    cancelAnimationFrame(rafPan);
    const d = drag;
    const armedId = d.armedId;
    disarm();
    d.armedId = armedId; // drop() still needs to know what was armed
    clearContacts();
    d.el._phys.setContacts([]);
    d.el._phys.drop();
    d.el.classList.remove('dragging');
    boardEl.classList.remove('dragging-item');
    if (d.ghost) {
      d.el._phys.dispose();
      d.el.remove();
      d.miniEl.classList.remove('ghosted');
    }
    drag = null;
    return d;
  }

  // Blobs on this board pushed aside by an item landing at (x, y): the
  // minimum distance, with a chain reaction. Returns [{ id, x, y }].
  function pushesFor(id, x, y, size) {
    const list = boardItems().filter(it => it.id !== id).map(it => ellipseOf(it, sizeOf(it.id)));
    list.push(ellipseOf({ id, x, y }, size));
    const out = [];
    for (const [pid, p] of resolveOverlaps(list, id)) {
      out.push({ id: pid, x: Math.round(p.cx), y: Math.round(p.cy - sizeOf(pid).h / 2) });
    }
    return out;
  }

  function glide(pushes, from) {
    for (const m of pushes) {
      const o = from.get(m.id);
      const el = els.get(m.id);
      if (o && el) el._phys.glideFrom(o.x - m.x, o.y - m.y);
    }
  }

  function drop(d) {
    const doc = store.canvas();
    const item = store.item(d.id);
    const hit = d.hit || { kind: 'outside' };

    // 1. Held over a blob long enough: put it inside.
    if (d.armedId && hit.kind === 'item' && hit.id === d.armedId) {
      const p = spotInside(childrenOf(doc, d.armedId));
      store.reparentItem(d.id, d.armedId, p.x, p.y);
      store.select(null);
      render();
      return;
    }
    // 2. On the board (empty space, or over a top-level blob without
    //    holding): land there and push others aside.
    const overMini = hit.kind === 'item' && hit.el && hit.el.classList.contains('mini');
    if (hit.kind === 'empty' || (hit.kind === 'item' && !overMini)) {
      const pushes = pushesFor(d.id, d.x, d.y, d.size);
      const from = new Map(pushes.map(m => [m.id, { x: store.item(m.id).x, y: store.item(m.id).y }]));
      if (item.parentId === null) {
        store.moveItems([{ id: d.id, x: d.x, y: d.y }, ...pushes], { raise: d.id });
      } else {
        store.reparentItem(d.id, null, d.x, d.y, { pushes }); // out of its group
      }
      render();
      glide(pushes, from);
      return;
    }
    // 3. Anywhere else (a tray, outside the board): snap back.
    render();
  }

  // ---- gestures ---------------------------------------------------------------
  const elFor = id => allEls.get(id);

  attachGestures(boardEl, {
    // Tap selects; tapping the selected item again (or a quick double
    // click) expands it fully, and once more collapses it.
    tapItem: id => {
      const el = elFor(id);
      if (el) el._phys.poke(0.06);
      if (store.ui.selectedId === id) store.toggleExpand(id);
      else store.select(id);
    },
    contextItem: id => { store.select(id); onEdit(id); },
    holdStart: id => {
      const el = elFor(id);
      if (el) { el.classList.add('holding'); el._phys.poke(-0.08); }
      if (navigator.vibrate) navigator.vibrate(15);
    },
    holdEnd: (id, released) => {
      const el = elFor(id);
      if (el) el.classList.remove('holding');
      if (released) { store.select(id); onEdit(id); }
    },
    dragStart: (id, sx, sy) => startDrag(id, sx, sy),
    dragMove: (id, cx, cy) => {
      if (!drag) return;
      drag.px = cx;
      drag.py = cy;
      drag.el._phys.pointer(cx, cy, performance.now());
      updateDrag();
    },
    dragEnd: () => {
      if (!drag) return;
      drop(finishDrag());
    },
    dragCancel: () => {
      if (!drag) return;
      finishDrag();
      render();
    },
    panStart: () => setMoving(true),
    pan: (dx, dy) => { view.x += dx; view.y += dy; applyView(); },
    panEnd: () => setMoving(false),
    pinchStart: () => setMoving(true),
    pinch: (factor, mx, my, dx, dy) => {
      const r = rect();
      view = zoomAt(view, mx - r.left, my - r.top, factor);
      view.x += dx;
      view.y += dy;
      applyView();
    },
    pinchEnd: () => setMoving(false),
    tapEmpty: () => {
      store.select(null);
      store.setExpanded([]);
      if (onTapEmpty) onTapEmpty();
    },
    doubleTapEmpty: (cx, cy) => {
      const r = rect();
      const wp = screenToWorld(view, cx - r.left, cy - r.top);
      onCreateAt(wp.x, wp.y - NEW_ITEM_SIZE.h / 2);
    }
  });

  // Mouse wheel / two-finger scroll pans; Ctrl+wheel and touchpad pinch zoom.
  boardEl.addEventListener('wheel', e => {
    e.preventDefault();
    const r = rect();
    const unit = e.deltaMode === 1 ? 16 : 1;
    if (e.ctrlKey) {
      view = zoomAt(view, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * unit * 0.01));
    } else if (e.shiftKey && !e.deltaX) {
      view.x -= e.deltaY * unit;
    } else {
      view.x -= e.deltaX * unit;
      view.y -= e.deltaY * unit;
    }
    applyView();
    setMoving(true);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => setMoving(false), 150);
  }, { passive: false });

  // Birth animation for an item the user just created: grows from a dot.
  function spawn(id) {
    const el = allEls.get(id) || els.get(id);
    if (el) el._phys.spawn();
  }

  const board = {
    el: boardEl,
    render,
    spawn,
    getView: () => ({ ...view }),
    setView(v) { view = { ...v }; applyView(); },

    zoomBy(factor) {
      const r = rect();
      view = zoomAt(view, r.width / 2, r.height / 2, factor);
      applyView();
    },

    fit() {
      const r = rect();
      const rects = boardItems().map(it => itemRect(it, sizeOf(it.id)));
      view = fitView(boundsOf(rects), r.width, r.height);
      applyView();
    },

    // Centre of the visible area in board coordinates (top edge for a new item).
    centerSpot() {
      const r = rect();
      const wp = screenToWorld(view, r.width / 2, r.height / 2);
      return { x: wp.x, y: wp.y - NEW_ITEM_SIZE.h / 2 };
    },

    freeSpot(x, y) {
      const rects = boardItems().map(it => itemRect(it, sizeOf(it.id)));
      return findFreeSpot(rects, Math.round(x), Math.round(y));
    },

    // After a tray opens: scroll just enough to show it, keeping its group
    // on screen.
    revealTray() {
      const el = els.get(store.ui.expanded[0]);
      if (!el || !el._tray) return;
      const r = rect();
      const t = el._tray.getBoundingClientRect();
      const top = el._parts.body.getBoundingClientRect().top;
      const over = t.bottom - (r.bottom - 16);
      if (over > 0) {
        view.y -= Math.min(over, Math.max(0, top - r.top - 16));
        applyView();
      }
    },

    // Pans so the item is inside the visible area minus `insets` (e.g. a sheet).
    reveal(id, insets = {}) {
      const item = store.item(id);
      if (!item || !els.has(id)) return;
      const r = rect();
      const s = sizeOf(id);
      const tl = worldToScreen(view, item.x - s.w / 2, item.y);
      const br = worldToScreen(view, item.x + s.w / 2, item.y + s.h);
      const area = { l: 16, t: 16, r: r.width - (insets.right || 0) - 16, b: r.height - (insets.bottom || 0) - 16 };
      if (tl.x >= area.l && br.x <= area.r && tl.y >= area.t && br.y <= area.b) return;
      const cx = (tl.x + br.x) / 2;
      const cy = (tl.y + br.y) / 2;
      view.x += (area.l + area.r) / 2 - cx;
      view.y += (area.t + area.b) / 2 - cy;
      applyView();
    }
  };

  applyView();
  return board;
}
