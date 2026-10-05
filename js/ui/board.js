// The canvas you see: pan/zoom, rendering items by id, dragging, auto-pan.
import { screenToWorld, worldToScreen, zoomAt, fitView, boundsOf, itemRect } from '../services/geometry.js';
import { findFreeSpot, NEW_ITEM_SIZE, ellipseOf, ellipseContact, resolveOverlaps } from '../services/layout.js';
import { createItemEl, updateItemEl, positionEl } from './itemView.js';
import { attachGestures } from './gestures.js';
import { setPaused } from './physics.js';

const EDGE = 48;        // auto-pan zone at the screen edge while dragging (px)
const EDGE_SPEED = 14;  // max auto-pan speed (px per frame)
const DOT = 24;         // background dot spacing at zoom 1

export function createBoard({ host, store, onEdit, onCreateAt, onTapEmpty, onViewChange }) {
  const boardEl = document.createElement('div');
  boardEl.className = 'board';
  const world = document.createElement('div');
  world.className = 'world';
  const itemsLayer = document.createElement('div');
  itemsLayer.className = 'items-layer';
  world.append(itemsLayer);
  const hint = document.createElement('div');
  hint.className = 'empty-hint';
  hint.textContent = 'Double-tap empty space or press + to add an item';
  boardEl.append(world, hint);
  host.append(boardEl);

  const els = new Map();
  const sizes = new Map();
  let view = { x: 0, y: 0, z: 1 };
  let drag = null;
  let rafPan = 0;
  let wheelTimer = 0;

  // Tracks item sizes (for placement/fit) and bounces an item when its size
  // changes, e.g. notes added. Runs after layout, before paint, so the bounce
  // starts from the old size without a flash.
  const ro = new ResizeObserver(entries => {
    for (const en of entries) {
      const el = en.target;
      const id = el.dataset.id;
      const next = { w: el.offsetWidth, h: el.offsetHeight };
      const prev = sizes.get(id);
      sizes.set(id, next);
      if (prev && (prev.w !== next.w || prev.h !== next.h)) el._phys.resized(prev, next);
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

  function render() {
    const sel = store.ui.selectedId;
    const seen = new Set();
    for (const item of boardItems()) {
      seen.add(item.id);
      let el = els.get(item.id);
      if (!el) {
        el = createItemEl(item, { onEdit });
        els.set(item.id, el);
        itemsLayer.append(el);
        ro.observe(el);
        io.observe(el);
      }
      updateItemEl(el, item, { selected: sel === item.id });
      if (!drag || drag.id !== item.id) {
        positionEl(el, item.x, item.y);
        el.style.zIndex = item.z;
      }
    }
    for (const [id, el] of els) {
      if (seen.has(id)) continue;
      ro.unobserve(el);
      io.unobserve(el);
      el._phys.dispose();
      el.remove();
      els.delete(id);
      sizes.delete(id);
    }
    hint.hidden = seen.size > 0;
  }

  // ---- dragging -----------------------------------------------------------
  function updateDrag() {
    const r = rect();
    const wp = screenToWorld(view, drag.px - r.left, drag.py - r.top);
    drag.x = Math.round(wp.x - drag.grabX);
    drag.y = Math.round(wp.y - drag.grabY);
    positionEl(drag.el, drag.x, drag.y);
    updateContacts();
  }

  // Blobs the dragged one overlaps get their facing edge pressed flat (they
  // don't move); the dragged blob is pressed back the same way.
  let touching = new Map();
  function updateContacts() {
    const me = ellipseOf({ id: drag.id, x: drag.x, y: drag.y }, sizeOf(drag.id));
    const now = new Map();
    const mine = [];
    for (const [id, el] of els) {
      if (id === drag.id) continue;
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

  function finishDrag() {
    cancelAnimationFrame(rafPan);
    const d = drag;
    clearContacts();
    d.el._phys.setContacts([]);
    d.el._phys.drop();
    d.el.classList.remove('dragging');
    boardEl.classList.remove('dragging-item');
    drag = null;
    return d;
  }

  // Drop: the dragged blob stays where it was let go; any blobs under it are
  // pushed aside by the minimum amount, and they push their neighbours too.
  // Everything is one undo step; pushed blobs glide to their new places.
  function dropAt(d) {
    const list = boardItems().map(it =>
      ellipseOf(it.id === d.id ? { id: it.id, x: d.x, y: d.y } : it, sizeOf(it.id)));
    const pushed = resolveOverlaps(list, d.id);
    const moves = [{ id: d.id, x: d.x, y: d.y }];
    const from = new Map();
    for (const [id, p] of pushed) {
      const it = store.item(id);
      from.set(id, { x: it.x, y: it.y });
      moves.push({ id, x: Math.round(p.cx), y: Math.round(p.cy - sizeOf(id).h / 2) });
    }
    store.moveItems(moves, { raise: d.id });
    render();
    for (const m of moves.slice(1)) {
      const o = from.get(m.id);
      const el = els.get(m.id);
      if (el) el._phys.glideFrom(o.x - m.x, o.y - m.y);
    }
  }

  attachGestures(boardEl, {
    tapItem: id => {
      const el = els.get(id);
      if (el) el._phys.poke(0.06);
      store.select(id);
    },
    contextItem: id => { store.select(id); onEdit(id); },
    holdStart: id => {
      const el = els.get(id);
      if (el) { el.classList.add('holding'); el._phys.poke(-0.08); }
      if (navigator.vibrate) navigator.vibrate(15);
    },
    holdEnd: (id, released) => {
      const el = els.get(id);
      if (el) el.classList.remove('holding');
      if (released) { store.select(id); onEdit(id); }
    },
    dragStart: (id, sx, sy) => {
      const item = store.item(id);
      const el = els.get(id);
      if (!item || !el) return;
      const r = rect();
      const wp = screenToWorld(view, sx - r.left, sy - r.top);
      drag = { id, el, grabX: wp.x - item.x, grabY: wp.y - item.y, px: sx, py: sy, x: item.x, y: item.y };
      el.classList.add('dragging');
      el.style.zIndex = 1000000;
      boardEl.classList.add('dragging-item');
      el._phys.pickUp();
      el._phys.pointer(sx, sy, performance.now());
      store.select(id);
      rafPan = requestAnimationFrame(autoPanTick);
    },
    dragMove: (id, cx, cy) => {
      if (!drag) return;
      drag.px = cx;
      drag.py = cy;
      drag.el._phys.pointer(cx, cy, performance.now());
      updateDrag();
    },
    dragEnd: () => {
      if (!drag) return;
      dropAt(finishDrag());
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
    tapEmpty: () => { store.select(null); if (onTapEmpty) onTapEmpty(); },
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

  const board = {
    el: boardEl,
    render,
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

    // Pans so the item is inside the visible area minus `insets` (e.g. a sheet).
    reveal(id, insets = {}) {
      const item = store.item(id);
      if (!item) return;
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
