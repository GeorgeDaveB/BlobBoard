// App shell: top bar, board, editor, keyboard shortcuts, and the back stack
// (Android back / Esc closes the top layer — editor, then the expanded tray —
// instead of leaving the app).
import { createBoard } from './board.js';
import { createEditSheet, newSessionKey } from './editSheet.js';
import { initDialogs, toast, choiceDialog } from './dialogs.js';
import { createFormationUI, MIN_SELECTED } from './formationPanel.js';
import { ringLayout } from '../services/formations.js';
import { createFilterMenu } from './tagPicker.js';
import { createCanvasMenu, copyOrMoveItems } from './canvasMenu.js';
import { SHAPES, SHAPE_IDS, shapePath } from '../services/shapes.js';
import { createSettingsSheet } from './settingsSheet.js';
import { createLineSheet } from './lineSheet.js';
import { setMotion } from './physics.js';
import { defaultMotion } from './motionPanel.js';
import { descendantsOf, childrenOf } from '../core/model.js';
import { spotInside } from '../services/layout.js';

const ICONS = {
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  fit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  pan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5v-6a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v5M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.6 15.4a1.6 1.6 0 0 1 2.4-2.1L8 14.5"/></svg>',
  select: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 2.6"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.2 7.4V19l-3.6-1.8v-4.8z"/></svg>',
  bouncing: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="4.2" r="1.9"/><circle cx="19.4" cy="15.6" r="1.9"/><circle cx="4.6" cy="15.6" r="1.9"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
};

const WIDE = '(min-width: 760px)';

export function mountApp({ root, store, repo, pictures = null }) {
  // ---- layout -------------------------------------------------------------
  const top = document.createElement('header');
  top.className = 'topbar';
  // The canvas name opens the canvas menu (phase 6).
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'canvas-name';
  name.title = 'Canvases';
  const tools = document.createElement('div');
  tools.className = 'tools';
  const btnUndo = iconButton('undo', 'Undo (Ctrl+Z)');
  const btnRedo = iconButton('redo', 'Redo (Ctrl+Y)');
  const btnOut = iconButton('zoomOut', 'Zoom out');
  const btnIn = iconButton('zoomIn', 'Zoom in');
  const btnFit = iconButton('fit', 'Fit everything on screen');
  const btnGear = iconButton('gear', 'Settings');
  // C13: Pan / Select mode (only changes what dragging empty space does).
  const btnMode = iconButton('pan', 'Pan mode (H) — tap for Select mode (V)');
  btnMode.classList.add('mode-btn');
  // R34: formations. Greyed out until 3+ blobs are selected (still
  // pressable, to say why).
  const btnBounce = iconButton('bouncing', 'Bouncing');
  btnBounce.classList.add('bouncing-btn');
  const bounceText = document.createElement('span');
  bounceText.className = 'bouncing-text';
  bounceText.textContent = 'Bouncing';
  btnBounce.append(bounceText);
  // R11: tag filter (badge = how many tags are picked).
  const btnFilter = iconButton('filter', 'Filter by tags');
  btnFilter.classList.add('filter-btn');
  const filterBadge = document.createElement('span');
  filterBadge.className = 'filter-badge';
  filterBadge.hidden = true;
  btnFilter.append(filterBadge);
  tools.append(btnMode, btnBounce, btnFilter, sep(), btnUndo, btnRedo, sep(), btnOut, btnIn, btnFit, sep(), btnGear);
  top.append(name, tools);

  const main = document.createElement('main');
  main.className = 'main';
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'fab';
  fab.setAttribute('aria-label', 'New item');
  fab.textContent = '+';
  // Phones: the canvas name sits in a footer at the bottom (owner); the top
  // bar keeps the tools.
  const foot = document.createElement('footer');
  foot.className = 'footbar';
  const footName = document.createElement('button');
  footName.type = 'button';
  footName.title = 'Canvases';
  footName.className = 'foot-name';
  foot.append(footName);
  root.append(top, main, foot, fab);
  initDialogs(root);

  // "N selected · Delete · ✕" bar while several items are selected (R24).
  const selBar = document.createElement('div');
  selBar.className = 'select-bar';
  selBar.hidden = true;
  const selCount = document.createElement('span');
  selCount.className = 'select-count';
  const selDelete = document.createElement('button');
  selDelete.type = 'button';
  selDelete.className = 'btn btn-danger';
  selDelete.textContent = 'Delete';
  const selRelease = document.createElement('button');
  selRelease.type = 'button';
  selRelease.className = 'btn';
  selRelease.textContent = 'Release child(s)';
  selRelease.hidden = true;
  const selCanvas = document.createElement('button');
  selCanvas.type = 'button';
  selCanvas.className = 'btn';
  selCanvas.textContent = 'To canvas…';
  selCanvas.title = 'Duplicate or move the selected items to a canvas';
  const selClear = document.createElement('button');
  selClear.type = 'button';
  selClear.className = 'icon-btn';
  selClear.setAttribute('aria-label', 'Clear selection');
  selClear.textContent = '✕';
  selBar.append(selCount, selRelease, selCanvas, selDelete, selClear);
  root.append(selBar);

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
    pictures,
    onEdit: id => openEditor(id, { expand: true }),
    onNotes: (id, patch, key) => store.updateItem(id, patch, { coalesce: key }),
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
    pictures,
    onRequestClose: () => closeLayer(editorLayer),
    onDelete: id => deleteWithUndo(id),
    onRelease: id => releaseWithUndo([id]),
    onCopyMove: id => copyOrMoveItems(store, [id], copied)
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

  // ---- motion switches (R33): this device only ----------------------------------
  let motion = defaultMotion();
  function applyMotion(m) {
    motion = m;
    setMotion(m);
    root.classList.toggle('m-no-bob', !m.bob);
    root.classList.toggle('m-no-ui', !m.ui);
  }
  applyMotion(motion);
  repo.getSetting('motion').then(m => { if (m && typeof m === 'object') applyMotion({ ...defaultMotion(), ...m }); }).catch(() => {});

  const settings = createSettingsSheet({
    host: root,
    store,
    pictures,
    onRequestClose: () => closeLayer(settingsLayer),
    motion: {
      get: () => motion,
      set: m => { applyMotion(m); repo.setSetting('motion', m); }
    }
  });
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
  // fields: { kind: 'shape', shape } (R37) or { kind: 'text' } (R38); a
  // new text is typed straight on the canvas.
  function createAt(x, y, fields = {}) {
    const spot = board.freeSpot(x, y);
    const key = newSessionKey();
    const id = store.createItem({ ...fields, x: spot.x, y: spot.y }, { coalesce: key });
    board.spawn(id);
    store.select(id);
    if (fields.kind === 'text') board.startTextEdit(id, key);
    else openEditor(id, { key, isNew: true });
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

  // ---- deleting, Dissolve, Release (R35) -------------------------------------------
  let opSeq = 0;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  // Rings released blobs round their old parent (or the spot where it
  // stood), others pushed aside; joins the step `key`.
  function ringAround(centre, ids, key) {
    const nodes = ids.map(board.nodeOf).filter(Boolean);
    if (!centre || !nodes.length) return;
    board.arrange(ringLayout(centre, nodes), { fixed: store.item(centre.id) ? [centre.id] : [], coalesce: key });
  }

  // "Release child(s)": the direct minis of each blob come out, placed in a
  // ring round it. One undo step.
  function releaseWithUndo(ids) {
    const doc = store.canvas();
    const n = ids.reduce((s, id) => s + (doc.items[id] ? childrenOf(doc, id).length : 0), 0);
    if (!n) return;
    // An open tray of a blob being emptied closes first (it would cover the ring).
    const at = store.ui.expanded.findIndex(id => ids.includes(id));
    if (at >= 0) store.setExpanded(store.ui.expanded.slice(0, at));
    const key = 'release:' + (++opSeq);
    const groups = store.releaseChildren(ids, { coalesce: key });
    for (const g of groups) ringAround(board.nodeOf(g.parentId), g.ids, key);
    toast('Released ' + plural(n, 'blob', 'blobs'), { actionLabel: 'Undo', onAction: () => store.undo() });
  }

  // Deleting one or more blobs. If any has minis: Dissolve parent (only the
  // blob goes; its minis are ringed round the spot where it stood) or
  // Dissolve family (everything inside goes too). One undo step.
  async function deleteFlow(ids) {
    const doc = store.canvas();
    const live = [...new Set(ids)].filter(id => doc.items[id]);
    if (!live.length) return;
    const one = live.length === 1;
    const label = one ? '“' + (doc.items[live[0]].title || 'Untitled') + '”' : plural(live.length, 'item', 'items');
    const gone = new Set(live);
    const kids = live.reduce((s, id) => s + childrenOf(doc, id).filter(k => !gone.has(k.id)).length, 0);
    let mode = 'family';
    if (kids > 0) {
      const all = new Set();
      for (const id of live) for (const d of descendantsOf(doc, id)) if (!gone.has(d)) all.add(d);
      mode = await choiceDialog({
        title: 'Delete ' + label + '?',
        choices: [
          { label: 'Dissolve parent', value: 'parent', note: (one ? 'Delete only this blob; its ' : 'Delete only these blobs; their ') + plural(kids, 'mini stays', 'minis stay') + ' on the canvas' },
          { label: 'Dissolve family', value: 'family', kind: 'danger', note: (one ? 'Delete this blob and everything inside it' : 'Delete these blobs and everything inside them') + ' (' + all.size + ')' }
        ]
      });
      if (!mode) return;
    }
    if (editor.isOpen && live.some(id => id === editor.itemId || descendantsOf(doc, id).includes(editor.itemId))) closeLayer(editorLayer);
    if (mode === 'parent') {
      const spots = new Map(live.map(id => [id, board.nodeOf(id)]).filter(([, n]) => n));
      const key = 'dissolve:' + (++opSeq);
      const groups = store.dissolveItems(live, { coalesce: key });
      for (const g of groups) {
        const s = spots.get(g.spotId);
        if (s) ringAround({ ...s, id: '__spot' }, g.ids, key);
      }
    } else if (one) {
      store.deleteItem(live[0]);
    } else {
      store.deleteItems(live);
    }
    toast('Deleted ' + label, { actionLabel: 'Undo', onAction: () => store.undo() });
  }
  const deleteManyWithUndo = ids => deleteFlow(ids);
  const deleteWithUndo = id => deleteFlow([id]);

  // ---- Pan / Select mode (C13), remembered on this device ----------------------
  function setMode(select) {
    board.setSelectMode(select);
    btnMode.innerHTML = ICONS[select ? 'select' : 'pan'];
    btnMode.classList.toggle('on', select);
    btnMode.setAttribute('aria-pressed', String(select));
    const label = select ? 'Select mode (V): drag empty space to select — tap for Pan mode (H)' : 'Pan mode (H): drag empty space to move — tap for Select mode (V)';
    btnMode.title = label;
    btnMode.setAttribute('aria-label', label);
    repo.setSetting('mode', select ? 'select' : 'pan');
  }
  btnMode.addEventListener('click', () => setMode(!board.selectMode));
  repo.getSetting('mode').then(m => setMode(m === 'select')).catch(() => setMode(false));

  function deleteLinkWithUndo(id) {
    if (!store.deleteLink(id)) return;
    toast('Line deleted', { actionLabel: 'Undo', onAction: () => store.undo() });
  }

  // ---- reacting to changes ------------------------------------------------
  function refreshChrome() {
    const doc = store.canvas();
    if (!doc) return;
    name.textContent = doc.name;
    footName.textContent = doc.name;
    btnUndo.disabled = !store.canUndo();
    btnRedo.disabled = !store.canRedo();
    const n = store.ui.selectedIds.length;
    selBar.hidden = n < 2;
    if (n >= 2) selCount.textContent = n + ' selected';
    selRelease.hidden = !store.ui.selectedIds.some(id => doc.items[id] && childrenOf(doc, id).length > 0);
    const nf = store.ui.filter.tagIds.length;
    btnFilter.classList.toggle('on', nf > 0);
    filterBadge.hidden = !nf;
    filterBadge.textContent = String(nf);
    btnFilter.title = nf ? 'Filter: ' + nf + ' tag' + (nf === 1 ? '' : 's') + ' picked' : 'Filter by tags';
    const ready = store.selectedItems().length >= MIN_SELECTED;
    btnBounce.classList.toggle('is-off', !ready);
    btnBounce.setAttribute('aria-disabled', String(!ready));
    btnBounce.title = ready ? 'Bouncing: arrange the selected blobs' : 'Bouncing — select multiple items first';
  }

  let shownExpanded = '';
  store.on(change => {
    board.render(change);
    const exp = store.ui.expanded.join('/');
    if (exp && exp !== shownExpanded) requestAnimationFrame(() => board.revealTray());
    shownExpanded = exp;
    refreshChrome();
    syncTrayLayer();
    if ((change.type === 'data' || change.type === 'tags') && editor.isOpen && !editor.refresh()) closeLayer(editorLayer);
    if (change.type === 'ui' || change.type === 'tags') saveFilter();
    if (change.type === 'canvas') onCanvasSwitched();
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
  selDelete.addEventListener('click', () => deleteManyWithUndo(store.ui.selectedIds));
  selClear.addEventListener('click', () => store.select(null));
  selRelease.addEventListener('click', () => releaseWithUndo(store.ui.selectedIds));
  btnBounce.addEventListener('click', () => {
    if (store.selectedItems().length < MIN_SELECTED) { formations.closeMenu(); toast('Select multiple items first'); return; }
    formations.openMenu(btnBounce);
  });
  // + : Blob / Text / one of the shapes (R37, R38).
  const addMenu = document.createElement('div');
  addMenu.className = 'add-menu';
  addMenu.hidden = true;
  const addBtn = (label, fields, svg) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'add-item';
    b.title = label;
    b.setAttribute('aria-label', 'New ' + label.toLowerCase());
    b.innerHTML = svg;
    const s = document.createElement('span');
    s.textContent = label;
    b.append(s);
    b.addEventListener('click', () => { closeAdd(); const p = board.centerSpot(); createAt(p.x, p.y, fields); });
    return b;
  };
  const kinds = document.createElement('div');
  kinds.className = 'add-row';
  kinds.append(
    addBtn('Blob', {}, '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M12 3c5 0 9 3.5 9 8.5S17 21 12 21 3 16.5 3 11.5 7 3 12 3Z"/></svg>'),
    addBtn('Text', { kind: 'text' }, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>')
  );
  const shapesRow = document.createElement('div');
  shapesRow.className = 'add-row';
  for (const id of SHAPE_IDS) shapesRow.append(addBtn(SHAPES[id].label, { kind: 'shape', shape: id }, '<svg viewBox="-6 -6 112 112" aria-hidden="true"><path class="fill" d="' + shapePath(id) + '"/></svg>'));
  const shapesLabel = document.createElement('div');
  shapesLabel.className = 'add-label';
  shapesLabel.textContent = 'Shapes';
  addMenu.append(kinds, shapesLabel, shapesRow);
  root.append(addMenu);
  function closeAdd() { addMenu.hidden = true; fab.classList.remove('open'); document.removeEventListener('pointerdown', outsideAdd, true); }
  function outsideAdd(e) { if (!addMenu.contains(e.target) && !fab.contains(e.target)) closeAdd(); }
  fab.addEventListener('click', () => {
    if (!addMenu.hidden) { closeAdd(); return; }
    addMenu.hidden = false;
    fab.classList.add('open');
    setTimeout(() => document.addEventListener('pointerdown', outsideAdd, true));
  });

  // ---- keyboard -----------------------------------------------------------
  document.addEventListener('keydown', e => {
    const typing = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
    if (e.key === 'Escape') {
      formations.closeMenu();
      filterMenu.close();
      closeAdd();
      if (layers.length) closeTopLayer();
      else { store.select(null); store.selectLink(null); }
      return;
    }
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); store.redo(); }
    else if (!mod && k === 'h') setMode(false);
    else if (!mod && k === 'v') setMode(true);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && store.ui.selectedIds.length > 1) { e.preventDefault(); deleteManyWithUndo(store.ui.selectedIds); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && store.ui.selectedId) { e.preventDefault(); deleteWithUndo(store.ui.selectedId); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && store.ui.selectedLinkId) { e.preventDefault(); deleteLinkWithUndo(store.ui.selectedLinkId); }
    else if (e.key === 'Enter' && store.ui.selectedId) { e.preventDefault(); openEditor(store.ui.selectedId, { expand: true }); }
  });

  // A picture added or deleted: redraw cards and the open editor.
  if (pictures) pictures.on(() => { board.render(); if (editor.isOpen) editor.refresh(); });

  // ---- canvases (phase 6) -----------------------------------------------------------
  const canvasMenu = createCanvasMenu({ root, store, extra: () => (canvasExtras ? canvasExtras() : []) });
  let canvasExtras = null; // phase 7 adds save / open / export picture
  name.addEventListener('click', () => canvasMenu.open(name));
  footName.addEventListener('click', () => canvasMenu.open(footName));
  selCanvas.addEventListener('click', () => copyOrMoveItems(store, store.ui.selectedIds, copied));

  // After "Duplicate / move to canvas…" (R20, C12).
  function copied(target, made, { move, key }) {
    const here = target === store.ui.canvasId;
    const tName = (store.canvasList().find(c => c.id === target) || {}).name || 'canvas';
    if (here) {
      // Next to the originals: others make room (same undo step).
      const targets = new Map(made.map(id => board.nodeOf(id)).filter(Boolean).map(n => [n.id, { cx: n.cx, cy: n.cy }]));
      board.arrange(targets, { coalesce: key });
      store.selectMany(made);
      toast('Duplicated', { actionLabel: 'Undo', onAction: () => store.undoStep(key) });
      return;
    }
    if (move) {
      const from = store.ui.canvasId;
      toast('Moved to “' + tName + '”', { actionLabel: 'Undo', onAction: () => { store.undoStep(key, target); store.undoStep(key, from); } });
    } else {
      toast('Copied to “' + tName + '”', { actionLabel: 'Go there', onAction: () => store.switchCanvas(target) });
    }
  }

  // Switching canvas: panels close, its own view and filter come back.
  function onCanvasSwitched() {
    while (layers.length) closeTopLayer();
    formations.cancel();
    repo.setSetting('lastCanvasId', store.ui.canvasId);
    savedFilter = '';
    showView();
    repo.getSetting('filter:' + store.ui.canvasId).then(f => { if (f && Array.isArray(f.tagIds)) store.setFilter(f); }).catch(() => {});
  }

  // ---- tag filter (R11): remembered per canvas on this device ------------------
  const filterMenu = createFilterMenu({ root, store });
  btnFilter.addEventListener('click', () => filterMenu.open(btnFilter));
  let savedFilter = '';
  function saveFilter() {
    const f = JSON.stringify(store.ui.filter);
    if (f === savedFilter) return;
    savedFilter = f;
    repo.setSetting('filter:' + store.ui.canvasId, store.ui.filter);
  }
  repo.getSetting('filter:' + store.ui.canvasId).then(f => { if (f && Array.isArray(f.tagIds)) store.setFilter(f); }).catch(() => {});

  // ---- Bouncing (R34) ----------------------------------------------------------
  const formations = createFormationUI({ root, store, board, openLayer, closeLayer });

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
