// App shell: top bar, board, editor, keyboard shortcuts, and the back stack
// (Android back / Esc closes the top layer — editor, then the expanded tray —
// instead of leaving the app).
import { createBoard } from './board.js';
import { createEditSheet, newSessionKey } from './editSheet.js';
import { initDialogs, toast, confirmDialog } from './dialogs.js';
import { createSettingsSheet } from './settingsSheet.js';
import { createLineSheet } from './lineSheet.js';
import { descendantsOf, childrenOf } from '../core/model.js';
import { spotInside } from '../services/layout.js';

const ICONS = {
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
};

const WIDE = '(min-width: 760px)';

export function mountApp({ root, store, repo }) {
  // ---- layout -------------------------------------------------------------
  const top = document.createElement('header');
  top.className = 'topbar';
  const name = document.createElement('div');
  name.className = 'canvas-name';
  const tools = document.createElement('div');
  tools.className = 'tools';
  const btnUndo = iconButton('undo', 'Undo (Ctrl+Z)');
  const btnRedo = iconButton('redo', 'Redo (Ctrl+Y)');
  const btnOut = iconButton('zoomOut', 'Zoom out');
  const btnIn = iconButton('zoomIn', 'Zoom in');
  const btnFit = iconButton('fit', 'Fit everything on screen');
  const btnGear = iconButton('gear', 'Settings');
  tools.append(btnUndo, btnRedo, sep(), btnOut, btnIn, btnFit, sep(), btnGear);
  top.append(name, tools);

  const main = document.createElement('main');
  main.className = 'main';
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'fab';
  fab.setAttribute('aria-label', 'New item');
  fab.textContent = '+';
  root.append(top, main, fab);
  initDialogs(root);

  // ---- back stack -----------------------------------------------------------
  // Each open layer (editor, expanded tray) pushes one history entry
  // tagged with its id. Closing from the UI just closes it and leaves its
  // entry behind; when the user presses back we close every layer above the
  // entry we land on, and skip over entries of layers that are already closed.
  // (No history.back() from code, so there are no timing races.)
  const layers = [];
  let layerSeq = 0;

  function openLayer(close) {
    const id = ++layerSeq;
    layers.push({ id, close });
    history.pushState({ bb: id }, '', location.hash);
    return id;
  }
  function closeLayer(id) {
    const i = layers.findIndex(l => l.id === id);
    if (i < 0) return;
    const [l] = layers.splice(i, 1);
    l.close();
  }
  function closeTopLayer() {
    if (layers.length) closeLayer(layers[layers.length - 1].id);
  }
  window.addEventListener('popstate', e => {
    const target = (e.state && e.state.bb) || 0;
    while (layers.length && layers[layers.length - 1].id > target) layers.pop().close();
    if (target > 0 && !layers.some(l => l.id === target)) history.back(); // stale entry
  });

  // ---- board + editor -----------------------------------------------------
  let viewTimer = 0;
  const board = createBoard({
    host: main,
    store,
    onEdit: id => openEditor(id, { expand: true }),
    onNotes: (id, text, key) => store.updateItem(id, { notes: text }, { coalesce: key }),
    onAddInside: id => createInside(id),
    onCreateAt: (x, y) => createAt(x, y),
    onTapEmpty: () => { if (editor.isOpen) closeLayer(editorLayer); },
    onDeleteLink: id => deleteLinkWithUndo(id),
    onEditLink: id => openLineEditor(id),
    onViewChange: v => {
      clearTimeout(viewTimer);
      viewTimer = setTimeout(() => repo.setSetting(viewKey(), v), 400);
    }
  });

  const editor = createEditSheet({
    host: root,
    store,
    onRequestClose: () => closeLayer(editorLayer),
    onDelete: id => deleteWithUndo(id)
  });

  function viewKey() {
    return 'view:' + store.ui.canvasId + ':root';
  }

  async function showView() {
    const v = await repo.getSetting(viewKey());
    if (v) board.setView(v);
    else requestAnimationFrame(() => board.fit());
  }

  // ---- line editor (label, style, colour) ---------------------------------------
  const lineSheet = createLineSheet({
    host: root,
    store,
    onRequestClose: () => closeLayer(lineLayer),
    onDelete: id => { closeLayer(lineLayer); deleteLinkWithUndo(id); }
  });
  let lineLayer = 0;
  function openLineEditor(id) {
    if (!store.link(id)) return;
    if (editor.isOpen) closeLayer(editorLayer);
    if (settings.isOpen) closeLayer(settingsLayer);
    store.selectLink(id);
    if (lineSheet.isOpen && lineSheet.linkId === id) return;
    lineSheet.close();
    lineSheet.open(id);
    root.classList.add('editing');
    if (!lineLayer) {
      lineLayer = openLayer(() => {
        lineLayer = 0;
        lineSheet.close();
        root.classList.remove('editing');
      });
    }
  }

  const settings = createSettingsSheet({ host: root, store, onRequestClose: () => closeLayer(settingsLayer) });
  let settingsLayer = 0;
  // Side panels (settings, item editor, line editor) replace each other.
  function openSettings() {
    if (settings.isOpen) return;
    if (editor.isOpen) closeLayer(editorLayer);
    if (lineSheet.isOpen) closeLayer(lineLayer);
    settings.open();
    settingsLayer = openLayer(() => { settingsLayer = 0; settings.close(); });
  }

  // ---- editor -------------------------------------------------------------
  // opts.expand: opened on purpose (✎, long-press, right-click, Enter). In
  // container view that also opens the blob into its container.
  let editorLayer = 0;
  function openEditor(id, opts = {}) {
    if (!store.item(id)) return;
    if (lineSheet.isOpen) closeLayer(lineLayer);
    if (settings.isOpen) closeLayer(settingsLayer);
    if (opts.expand && store.canvas().settings.insideView === 'container') store.expandTo(id);
    if (editor.isOpen && editor.itemId === id) return;
    if (editor.isOpen) editor.close();
    editor.open(id, opts);
    root.classList.add('editing');
    if (!editorLayer) {
      editorLayer = openLayer(() => {
        editorLayer = 0;
        editor.close();
        root.classList.remove('editing');
      });
    }
    requestAnimationFrame(() => {
      const wide = matchMedia(WIDE).matches;
      const r = editor.el.getBoundingClientRect();
      board.reveal(id, wide ? { right: r.width } : { bottom: r.height });
    });
  }

  // ---- tray (expanded group) is a layer too ----------------------------------
  let trayLayer = 0;
  function syncTrayLayer() {
    const open = store.ui.expanded.length > 0;
    if (open && !trayLayer) {
      trayLayer = openLayer(() => { trayLayer = 0; store.setExpanded([]); });
    } else if (!open && trayLayer) {
      const id = trayLayer;
      trayLayer = 0;
      closeLayer(id);
    }
  }

  // ---- items ----------------------------------------------------------------
  function createAt(x, y) {
    const spot = board.freeSpot(x, y);
    const key = newSessionKey();
    const id = store.createItem({ x: spot.x, y: spot.y }, { coalesce: key });
    board.spawn(id);
    store.select(id);
    openEditor(id, { key, isNew: true });
  }

  // "+" tile in an expanded item's tray: a new item inside it.
  function createInside(parentId) {
    const parent = store.item(parentId);
    if (!parent) return;
    const p = spotInside(childrenOf(store.canvas(), parentId));
    const key = newSessionKey();
    const id = store.createItem({ parentId, x: p.x, y: p.y }, { coalesce: key });
    board.spawn(id);
    store.select(id);
    openEditor(id, { key, isNew: true });
  }

  async function deleteWithUndo(id) {
    const item = store.item(id);
    if (!item) return;
    const inside = descendantsOf(store.canvas(), id).length;
    if (inside > 0) {
      const ok = await confirmDialog({
        title: 'Delete item?',
        message: 'Delete “' + (item.title || 'Untitled') + '” and its ' + inside + ' inside item' + (inside === 1 ? '' : 's') + '?',
        okLabel: 'Delete',
        danger: true
      });
      if (!ok) return;
    }
    if (editor.isOpen && editor.itemId === id) closeLayer(editorLayer);
    store.deleteItem(id);
    toast('Deleted “' + (item.title || 'Untitled') + '”', { actionLabel: 'Undo', onAction: () => store.undo() });
  }

  function deleteLinkWithUndo(id) {
    if (!store.deleteLink(id)) return;
    toast('Line deleted', { actionLabel: 'Undo', onAction: () => store.undo() });
  }

  // ---- reacting to changes ------------------------------------------------
  function refreshChrome() {
    const doc = store.canvas();
    if (!doc) return;
    name.textContent = doc.name;
    btnUndo.disabled = !store.canUndo();
    btnRedo.disabled = !store.canRedo();
  }

  let shownExpanded = '';
  store.on(change => {
    board.render(change);
    const exp = store.ui.expanded.join('/');
    if (exp && exp !== shownExpanded) requestAnimationFrame(() => board.revealTray());
    shownExpanded = exp;
    refreshChrome();
    syncTrayLayer();
    if (change.type === 'data' && editor.isOpen && !editor.refresh()) closeLayer(editorLayer);
    if (lineSheet.isOpen && !lineSheet.refresh()) closeLayer(lineLayer);
    // Selecting something else (or nothing) while editing a line closes it.
    if (change.type === 'ui' && lineSheet.isOpen && store.ui.selectedLinkId !== lineSheet.linkId) closeLayer(lineLayer);
    // Tapping another item while editing switches the editor to it.
    if (change.type === 'ui' && editor.isOpen && store.ui.selectedId && store.ui.selectedId !== editor.itemId) {
      openEditor(store.ui.selectedId);
    }
  });

  btnUndo.addEventListener('click', () => store.undo());
  btnRedo.addEventListener('click', () => store.redo());
  btnIn.addEventListener('click', () => board.zoomBy(1.25));
  btnOut.addEventListener('click', () => board.zoomBy(0.8));
  btnFit.addEventListener('click', () => board.fit());
  btnGear.addEventListener('click', openSettings);
  fab.addEventListener('click', () => { const s = board.centerSpot(); createAt(s.x, s.y); });

  // ---- keyboard -----------------------------------------------------------
  document.addEventListener('keydown', e => {
    const typing = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
    if (e.key === 'Escape') {
      if (layers.length) closeTopLayer();
      else { store.select(null); store.selectLink(null); }
      return;
    }
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); store.redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && store.ui.selectedId) { e.preventDefault(); deleteWithUndo(store.ui.selectedId); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && store.ui.selectedLinkId) { e.preventDefault(); deleteLinkWithUndo(store.ui.selectedLinkId); }
    else if (e.key === 'Enter' && store.ui.selectedId) { e.preventDefault(); openEditor(store.ui.selectedId, { expand: true }); }
  });

  // ---- start --------------------------------------------------------------
  board.render();
  refreshChrome();
  showView();

  return { board, editor };
}

function iconButton(icon, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = ICONS[icon];
  return b;
}

function sep() {
  const s = document.createElement('span');
  s.className = 'tool-sep';
  return s;
}
