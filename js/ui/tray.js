// The expanded view of a group: its inside items as minis, in rows of 3
// (4 when there are 10 or more). Tapping a mini that is itself a group
// expands it the same way: its tray appears as a full-width row right under
// the row that mini sits in. Elements are reused by id so physics state and
// animation survive re-renders.
import { childrenOf } from '../core/model.js';
import { createItemEl, updateItemEl } from './itemView.js';

// trayEl: the .tray element to fill. parent: the expanded item. depth: its
// index in ui.expanded. ctx: { doc, ui, onEdit, onOpen, register }
export function renderTray(trayEl, parent, depth, ctx) {
  const st = trayEl._st || (trayEl._st = { minis: new Map(), nested: null });
  const kids = childrenOf(ctx.doc, parent.id);
  const cols = kids.length <= 9 ? 3 : 4;
  trayEl.style.setProperty('--cols', cols);

  const order = [];
  const seen = new Set();
  const openId = ctx.ui.expanded[depth + 1] || null;
  let openIndex = -1;

  kids.forEach((kid, i) => {
    seen.add(kid.id);
    let el = st.minis.get(kid.id);
    if (!el) {
      el = createItemEl(kid, { onEdit: ctx.onEdit, onOpen: ctx.onOpen, mini: true });
      st.minis.set(kid.id, el);
    }
    updateItemEl(el, kid, {
      selected: ctx.ui.selectedId === kid.id,
      kids: childrenOf(ctx.doc, kid.id),
      expanded: openId === kid.id
    });
    ctx.register(kid.id, el);
    order.push(el);
    if (openId === kid.id) openIndex = i;
  });

  // Nested tray for the expanded mini, placed after the last item of its row.
  if (openIndex >= 0) {
    if (!st.nested) {
      st.nested = document.createElement('div');
      st.nested.className = 'tray tray-nested';
    }
    renderTray(st.nested, kids[openIndex], depth + 1, ctx);
    const rowEnd = Math.min(kids.length - 1, Math.floor(openIndex / cols) * cols + cols - 1);
    order.splice(rowEnd + 1, 0, st.nested);
  } else if (st.nested) {
    disposeTray(st.nested);
    st.nested.remove();
    st.nested = null;
  }

  for (const [id, el] of st.minis) {
    if (seen.has(id)) continue;
    el._phys.dispose();
    el.remove();
    st.minis.delete(id);
  }

  // Put children in the wanted order (moves existing nodes, no rebuild).
  order.forEach((node, i) => {
    if (trayEl.children[i] !== node) trayEl.insertBefore(node, trayEl.children[i] || null);
  });
  while (trayEl.children.length > order.length) trayEl.lastChild.remove();
}

// Stops the physics of every mini in this tray (and nested trays).
export function disposeTray(trayEl) {
  const st = trayEl._st;
  if (!st) return;
  for (const el of st.minis.values()) el._phys.dispose();
  st.minis.clear();
  if (st.nested) disposeTray(st.nested);
  st.nested = null;
}
