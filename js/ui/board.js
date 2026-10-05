// The canvas you see: pan/zoom, rendering items by id, dragging, auto-pan.
import { screenToWorld, worldToScreen, zoomAt, fitView, boundsOf, itemRect } from '../services/geometry.js';
import { findFreeSpot, NEW_ITEM_SIZE } from '../services/layout.js';
import { createItemEl, updateItemEl, positionEl } from './itemView.js';
import { attachGestures } from './gestures.js';

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

  const ro = new ResizeObserver(entries => {
    for (const en of entries) {
      const el = en.target;
      sizes.set(el.dataset.id, { w: el.offsetWidth, h: el.offsetHeight });
    }
  });
  // Pause animation for items off screen (battery).
  const io = new IntersectionObserver(entries => {
    for (const en of entries) en.target.classList.toggle('offscreen', !en.isIntersecting);
  }, { root: boardEl, rootMargin: '120px' });

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
    positionEl(drag.el, drag.x, drag.y, ' rotate(2deg) scale(1.04)');
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
    d.el.classList.remove('dragging');
    boardEl.classList.remove('dragging-item');
    drag = null;
    return d;
  }

  attachGestures(boardEl, {
    tapItem: id => store.select(id),
    contextItem: id => { store.select(id); onEdit(id); },
    holdStart: id => {
      const el = els.get(id);
      if (el) el.classList.add('holding');
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
      store.select(id);
      rafPan = requestAnimationFrame(autoPanTick);
    },
    dragMove: (id, cx, cy) => {
      if (!drag) return;
      drag.px = cx;
      drag.py = cy;
      updateDrag();
    },
    dragEnd: () => {
      if (!drag) return;
      const d = finishDrag();
      store.moveItem(d.id, d.x, d.y);
      render();
    },
    dragCancel: () => {
      if (!drag) return;
      finishDrag();
      render();
    },
    panStart: () => boardEl.classList.add('moving'),
    pan: (dx, dy) => { view.x += dx; view.y += dy; applyView(); },
    panEnd: () => boardEl.classList.remove('moving'),
    pinchStart: () => boardEl.classList.add('moving'),
    pinch: (factor, mx, my, dx, dy) => {
      const r = rect();
      view = zoomAt(view, mx - r.left, my - r.top, factor);
      view.x += dx;
      view.y += dy;
      applyView();
    },
    pinchEnd: () => boardEl.classList.remove('moving'),
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
    boardEl.classList.add('moving');
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => boardEl.classList.remove('moving'), 150);
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
