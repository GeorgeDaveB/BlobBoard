// Canvases (R3, R20; phase 6): the switcher behind the canvas name (top bar
// on PC, footer on phones) — your canvases, then New / Rename / Duplicate /
// Delete for the current one — and "Duplicate / move to canvas…" for items.
// extra: [{ label, run }] more actions shown at the bottom (phase 7: save,
// open, export picture).
import { toast, confirmDialog, promptDialog, choiceDialog } from './dialogs.js';
import { LIMITS } from '../core/model.js';

export function createCanvasMenu({ root, store, extra = () => [] }) {
  const menu = document.createElement('div');
  menu.className = 'canvas-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  root.append(menu);
  let anchor = null;

  const button = (label, fn, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'canvas-act ' + cls;
    b.textContent = label;
    b.addEventListener('click', () => { close(); fn(); });
    return b;
  };

  function paint() {
    const cur = store.ui.canvasId;
    const list = document.createElement('div');
    list.className = 'canvas-list';
    for (const c of store.canvasList()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'canvas-row' + (c.id === cur ? ' on' : '');
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(c.id === cur));
      const n = document.createElement('span');
      n.textContent = c.name;
      const k = document.createElement('small');
      k.textContent = c.count + (c.count === 1 ? ' item' : ' items');
      b.append(n, k);
      b.addEventListener('click', () => { close(); store.switchCanvas(c.id); });
      list.append(b);
    }
    const acts = document.createElement('div');
    acts.className = 'canvas-acts';
    acts.append(
      button('New canvas', newCanvas),
      button('Rename', rename),
      button('Duplicate', duplicate),
      button('Delete', remove, 'danger')
    );
    const more = extra();
    const moreBox = document.createElement('div');
    moreBox.className = 'canvas-acts';
    for (const m of more) moreBox.append(button(m.label, m.run));
    menu.replaceChildren(list, acts, ...(more.length ? [moreBox] : []));
  }

  async function newCanvas() {
    const name = await promptDialog({ title: 'New canvas', value: '', okLabel: 'Create', input: { placeholder: 'Name', maxLength: LIMITS.name }, check: v => (v.trim() ? '' : 'Give it a name') });
    if (name == null) return;
    store.switchCanvas(store.createCanvas(name));
  }
  async function rename() {
    const doc = store.canvas();
    const name = await promptDialog({ title: 'Rename canvas', value: doc.name, okLabel: 'Rename', input: { maxLength: LIMITS.name }, check: v => (v.trim() ? '' : 'Give it a name') });
    if (name == null) return;
    if (store.renameCanvas(doc.id, name)) toast('Renamed', { actionLabel: 'Undo', onAction: () => store.undo() });
  }
  function duplicate() {
    const id = store.duplicateCanvas(store.ui.canvasId);
    if (id) { store.switchCanvas(id); toast('Duplicated — you are on the copy'); }
  }
  async function remove() {
    const doc = store.canvas();
    if (store.canvasList().length <= 1) { toast('This is your only canvas'); return; }
    const n = Object.keys(doc.items).length;
    const ok = await confirmDialog({
      title: 'Delete “' + doc.name + '”?',
      message: 'The canvas and its ' + n + ' item' + (n === 1 ? '' : 's') + ' are deleted from this device. This can’t be undone.',
      okLabel: 'Delete',
      danger: true
    });
    if (ok) { store.deleteCanvas(doc.id); toast('Canvas deleted'); }
  }

  function place() {
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth, h = menu.offsetHeight;
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    menu.style.top = Math.round(below ? r.bottom + 6 : Math.max(8, r.top - 6 - h)) + 'px';
    menu.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left))) + 'px';
  }
  function open(btn) {
    if (!menu.hidden) { close(); return; }
    anchor = btn;
    paint();
    menu.hidden = false;
    place();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }
  function close() {
    menu.hidden = true;
    document.removeEventListener('pointerdown', outside, true);
  }
  function outside(e) { if (!menu.contains(e.target) && !(anchor && anchor.contains(e.target))) close(); }
  return { open, close };
}

// R20: "Duplicate / move to canvas…" for these item ids. onDone(targetId,
// newIds, { move, key }) lets the caller tidy up (push aside, toast).
let seq = 0;
export async function copyOrMoveItems(store, ids, onDone) {
  const n = ids.length;
  const what = n === 1 ? 'this item' : n + ' items';
  const action = await choiceDialog({
    title: 'Duplicate or move ' + what + '?',
    choices: [
      { label: 'Duplicate to…', value: 'copy', note: 'Everything inside and the lines between them come along' },
      { label: 'Move to…', value: 'move', note: 'To another canvas; lines to items left behind go' }
    ]
  });
  if (!action) return;
  const move = action === 'move';
  const cur = store.ui.canvasId;
  const targets = store.canvasList().filter(c => !(move && c.id === cur));
  if (!targets.length) { toast('Make another canvas first (tap the canvas name → New canvas)'); return; }
  const target = await choiceDialog({
    title: (move ? 'Move ' : 'Duplicate ') + what + ' to',
    choices: targets.map(c => ({ label: c.name + (c.id === cur ? ' (this canvas)' : ''), value: c.id, kind: c.id === cur ? 'primary' : undefined }))
  });
  if (!target) return;
  const key = 'copyto:' + (++seq);
  const made = store.copyItemsTo(ids, target, { move, coalesce: key });
  if (!made.length) return;
  onDone(target, made, { move, key });
}
