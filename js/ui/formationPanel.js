// "Bouncing" (R34): the formation menu, the royalty pick banner and the Rows
// panel with a live preview. The maths is in services/formations.js; this
// file only runs the steps:
//   menu → (selected minis? "Move already grouped items?") → royalty pick
//   (Ring, Pyramid) or Rows panel → minis leave their groups + blobs glide
//   into place + others pushed aside + (Ring "+ lines") — one undo step.
import { FORMATIONS, formationById } from '../services/formations.js';
import { ancestorsOf } from '../core/model.js';
import { toast, choiceDialog } from './dialogs.js';

export const MIN_SELECTED = 3;
let seq = 0;

export function createFormationUI({ root, store, board, openLayer, closeLayer }) {
  // ---- menu -------------------------------------------------------------------
  const menu = document.createElement('div');
  menu.className = 'formation-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const HINTS = {
    ring: 'Around a blob you pick',
    rows: 'In rows you choose',
    pyramid: 'Below a blob you pick, following lines'
  };
  // What Bouncing is, in one line (owner request).
  const about = document.createElement('p');
  about.className = 'formation-about';
  about.textContent = 'Bouncing moves the selected blobs into a shape. Others make room; undo puts them back.';
  menu.append(about);
  for (const f of FORMATIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'formation-item';
    b.setAttribute('role', 'menuitem');
    const l = document.createElement('span');
    l.textContent = f.label;
    const s = document.createElement('small');
    s.textContent = HINTS[f.id] || '';
    b.append(l, s);
    b.addEventListener('click', () => { closeMenu(); start(f.id); });
    menu.append(b);
  }
  root.append(menu);

  function openMenu(anchor) {
    if (!menu.hidden) { closeMenu(); return; }
    const r = anchor.getBoundingClientRect();
    menu.hidden = false;
    const w = menu.offsetWidth;
    menu.style.top = Math.round(r.bottom + 6) + 'px';
    menu.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }
  function closeMenu() {
    menu.hidden = true;
    document.removeEventListener('pointerdown', outside, true);
  }
  function outside(e) {
    if (!menu.contains(e.target) && !e.target.closest('.bouncing-btn')) closeMenu();
  }

  // ---- banner (royalty pick / Rows controls) ------------------------------------
  const bar = document.createElement('div');
  bar.className = 'formation-bar';
  bar.hidden = true;
  root.append(bar);
  let layer = 0;
  let onCancel = null;

  function showBar(nodes, cancel) {
    bar.replaceChildren(...nodes);
    bar.hidden = false;
    onCancel = cancel;
    root.classList.add('forming');
    layer = openLayer(() => {
      layer = 0;
      hideBar();
      const c = onCancel;
      onCancel = null;
      if (c) c();
    });
  }
  function hideBar() {
    bar.hidden = true;
    bar.replaceChildren();
    root.classList.remove('forming');
  }
  // Finished (not cancelled): close without running the cancel step.
  function done() {
    onCancel = null;
    if (layer) closeLayer(layer);
  }
  const cancelAll = () => { if (layer) closeLayer(layer); };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, cls, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // ---- running a formation ---------------------------------------------------------
  // Topmost board blob above `id` (where a mini is seen to start from).
  function topOf(doc, id) {
    const chain = [id, ...ancestorsOf(doc, id)];
    return doc.items[chain[chain.length - 1]];
  }

  // One run = one undo step under `key`. ctx: { f, members, minis, royaltyId }.
  function run(ctx, opts, key, from) {
    const doc = store.canvas();
    const minis = ctx.minis.filter(id => doc.items[id] && doc.items[id].parentId !== null);
    if (minis.length) {
      store.reparentItems(minis.map(id => { const t = topOf(doc, id); return { id, x: t.x, y: t.y }; }), null, { coalesce: key });
    }
    const royalty = ctx.royaltyId ? board.nodeOf(ctx.royaltyId) : null;
    const nodes = ctx.members.filter(id => id !== ctx.royaltyId).map(board.nodeOf).filter(Boolean);
    const links = Object.values(store.canvas().links).map(l => ({ from: l.from, to: l.to }));
    const targets = ctx.f.layout({ royalty, nodes, links, opts });
    const add = ctx.f.lines && opts.lines ? [...targets.keys()].map(id => ({ from: ctx.royaltyId, to: id })) : [];
    const moved = board.arrange(targets, { fixed: royalty ? [royalty.id] : [], coalesce: key, links: add, from });
    return moved || minis.length > 0;
  }

  function finished(ctx, changed) {
    if (changed) toast(ctx.f.label + ' formed', { actionLabel: 'Undo', onAction: () => store.undo() });
    else toast('Already in that formation');
  }

  async function start(fid) {
    const f = formationById(fid);
    const sel = store.selectedItems();
    if (!f || sel.length < MIN_SELECTED) { toast('Select multiple items first'); return; }
    cancelAll();
    const doc = store.canvas();
    const inside = sel.filter(id => doc.items[id] && doc.items[id].parentId !== null);
    let minis = [];
    if (inside.length) {
      const n = inside.length;
      const answer = await choiceDialog({
        title: 'Move already grouped items?',
        message: n + (n === 1 ? ' selected blob is' : ' selected blobs are') + ' inside another blob.',
        choices: [
          { label: 'Move them', value: 'move', kind: 'primary', note: 'They leave their group and join the formation' },
          { label: 'Leave them out', value: 'leave', note: 'Only the blobs on the canvas take part' }
        ]
      });
      if (!answer) return;
      if (answer === 'move') minis = inside;
    }
    const members = sel.filter(id => store.item(id) && (store.item(id).parentId === null || minis.includes(id)));
    const ctx = { f, members, minis, royaltyId: null };
    if (f.royalty) pickRoyalty(ctx);
    else rowsPanel(ctx);
  }

  // Ring / Pyramid: "Tap the royalty" (any blob on the canvas), then run.
  function pickRoyalty(ctx) {
    const opts = { lines: false };
    const nodes = [el('span', 'formation-title', ctx.f.label), el('span', 'formation-hint', 'Tap the royalty')];
    if (ctx.f.lines) {
      const chip = button('+ lines', 'seg-btn', () => {
        opts.lines = !opts.lines;
        chip.classList.toggle('on', opts.lines);
        chip.setAttribute('aria-pressed', String(opts.lines));
      });
      chip.title = 'Also draw a line from the royalty to each blob';
      chip.setAttribute('aria-pressed', 'false');
      nodes.push(chip);
    }
    nodes.push(button('Cancel', 'btn', cancelAll));
    showBar(nodes, () => board.cancelPick());
    board.pickBlob().then(id => {
      if (!id) return;
      done();
      ctx.royaltyId = id;
      const count = ctx.members.filter(m => m !== id).length;
      if (count < ctx.f.minMembers) { toast('Select at least ' + ctx.f.minMembers + ' blob' + (ctx.f.minMembers === 1 ? '' : 's') + ' besides the royalty'); return; }
      finished(ctx, run(ctx, opts, 'formation:' + (++seq)));
    });
  }

  // Rows: number of rows + alignment, previewed live; Apply keeps it,
  // Cancel undoes it.
  function rowsPanel(ctx) {
    const n = ctx.members.length;
    if (n < ctx.f.minMembers) { toast('Select at least ' + ctx.f.minMembers + ' blobs'); return; }
    const opts = { rows: Math.max(1, Math.min(n, Math.round(Math.sqrt(n)))), align: 'centre' };
    let key = null;
    let changed = false;
    const count = el('span', 'formation-count');
    const minus = button('−', 'icon-btn formation-step', () => setRows(opts.rows - 1));
    const plus = button('+', 'icon-btn formation-step', () => setRows(opts.rows + 1));
    minus.setAttribute('aria-label', 'Fewer rows');
    plus.setAttribute('aria-label', 'More rows');
    const align = el('div', 'seg formation-align');
    const alignBtns = ['left', 'centre', 'right'].map(a => {
      const b = button(a === 'centre' ? 'Centre' : a[0].toUpperCase() + a.slice(1), 'seg-btn', () => { opts.align = a; paint(); preview(); });
      b.dataset.align = a;
      align.append(b);
      return b;
    });
    const apply = button('Apply', 'btn btn-primary', () => {
      done();
      finished(ctx, changed);
    });
    const cancel = button('Cancel', 'btn', cancelAll);
    const stepper = el('div', 'formation-stepper');
    stepper.append(minus, count, plus);
    showBar([el('span', 'formation-title', 'Rows'), stepper, align, apply, cancel], () => {
      const from = board.positions();
      if (key && store.undoStep(key)) board.glideFrom(from);
    });

    function setRows(r) {
      r = Math.max(1, Math.min(n, r));
      if (r === opts.rows) return;
      opts.rows = r;
      paint();
      preview();
    }
    function paint() {
      count.textContent = opts.rows + (opts.rows === 1 ? ' row' : ' rows');
      minus.disabled = opts.rows <= 1;
      plus.disabled = opts.rows >= n;
      for (const b of alignBtns) b.classList.toggle('on', b.dataset.align === opts.align);
    }
    // Replaces the previous preview (undone first, so the layout always
    // starts from where the blobs were).
    function preview() {
      const from = board.positions();
      if (key) store.undoStep(key);
      key = 'formation:' + (++seq);
      changed = run(ctx, opts, key, from);
    }
    paint();
    preview();
  }

  return {
    openMenu,
    closeMenu,
    start,
    cancel: cancelAll,
    get busy() { return !bar.hidden; }
  };
}
