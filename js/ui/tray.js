// The grid of an expanded item's inside items (minis), followed by a "+"
// tile that adds a new item inside. Used two ways (canvas setting
// insideView):
//   'tray'      — the grid floats below the item (.tray-root). An expanded
//                 mini's grid appears as a full-width row under its row.
//   'container' — the grid sits inside the item's own body (.tray-inline),
//                 and an expanded mini becomes a container itself, spanning
//                 a full row of its parent's grid.
// Rows of 3 (4 from 10 items up), equal cells. Elements are reused by id so
// physics state survives re-renders; new minis pop in one after another.
import { childrenOf } from '../core/model.js';
import { createItemEl, updateItemEl } from './itemView.js';

// ctx: { doc, ui, container (bool), onEdit, onNotes, onAdd, register }
export function renderTray(trayEl, parent, depth, ctx) {
  const st = trayEl._st || (trayEl._st = { minis: new Map(), nested: null, add: null });
  const kids = childrenOf(ctx.doc, parent.id);
  const cols = Math.min(kids.length + 1, kids.length <= 9 ? 3 : 4);
  trayEl.style.setProperty('--cols', cols);
  if (!st.add) {
    st.add = document.createElement('button');
    st.add.type = 'button';
    st.add.className = 'tray-add';
    st.add.textContent = '+';
    st.add.addEventListener('click', e => { e.stopPropagation(); ctx.onAdd(st.add.dataset.parent); });
  }
  st.add.dataset.parent = parent.id;
  st.add.setAttribute('aria-label', 'Add an item inside ' + (parent.title || 'Untitled'));

  const order = [];
  const seen = new Set();
  const openId = ctx.ui.expanded[depth + 1] || null;
  let openIndex = -1;
  let fresh = 0;

  kids.forEach((kid, i) => {
    seen.add(kid.id);
    let el = st.minis.get(kid.id);
    if (!el) {
      el = createItemEl(kid, { onEdit: ctx.onEdit, onNotes: ctx.onNotes, mini: true });
      st.minis.set(kid.id, el);
      el.style.setProperty('--i', fresh++);
      el.classList.add('pop');
      el.addEventListener('animationend', function done(e) {
        if (e.target !== el) return;
        el.classList.remove('pop');
        el.removeEventListener('animationend', done);
      });
    }
    const isOpen = openId === kid.id;
    updateItemEl(el, kid, {
      selected: ctx.ui.selectedId === kid.id,
      kids: childrenOf(ctx.doc, kid.id),
      expanded: isOpen,
      container: ctx.container
    });
    ctx.register(kid.id, el);
    // Container view: an open mini holds its own grid inside its body.
    if (ctx.container && isOpen) syncInline(el, kid, depth + 1, ctx);
    else removeInline(el);
    order.push(el);
    if (isOpen) openIndex = i;
  });

  order.push(st.add);
  const cells = kids.length + 1;

  // Tray view: the open mini's grid is a full-width row after its row.
  if (!ctx.container && openIndex >= 0) {
    if (!st.nested) {
      st.nested = document.createElement('div');
      st.nested.className = 'tray tray-nested';
    }
    renderTray(st.nested, kids[openIndex], depth + 1, ctx);
    const rowEnd = Math.min(cells - 1, Math.floor(openIndex / cols) * cols + cols - 1);
    order.splice(rowEnd + 1, 0, st.nested);
  } else if (st.nested) {
    disposeTray(st.nested);
    st.nested.remove();
    st.nested = null;
  }

  for (const [id, el] of st.minis) {
    if (seen.has(id)) continue;
    disposeMini(el);
    el.remove();
    st.minis.delete(id);
  }

  // Put children in the wanted order (moves existing nodes, no rebuild).
  order.forEach((node, i) => {
    if (trayEl.children[i] !== node) trayEl.insertBefore(node, trayEl.children[i] || null);
  });
  while (trayEl.children.length > order.length) trayEl.lastChild.remove();
}

// Container view: the grid inside `el`'s body.
export function syncInline(el, item, depth, ctx) {
  if (!el._inline) {
    el._inline = document.createElement('div');
    el._inline.className = 'tray tray-inline';
    el._parts.body.append(el._inline);
  }
  renderTray(el._inline, item, depth, ctx);
}

export function removeInline(el) {
  if (!el._inline) return;
  disposeTray(el._inline);
  el._inline.remove();
  el._inline = null;
}

function disposeMini(el) {
  removeInline(el);
  el._phys.dispose();
}

// Stops the physics of every mini in this grid (and anything nested).
export function disposeTray(trayEl) {
  const st = trayEl._st;
  if (!st) return;
  for (const el of st.minis.values()) disposeMini(el);
  st.minis.clear();
  if (st.nested) disposeTray(st.nested);
  st.nested = null;
}
