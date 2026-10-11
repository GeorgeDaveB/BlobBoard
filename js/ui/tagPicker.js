// Tags (R10, R11; phase 5):
//  - createTagField(): the item editor's Tags field — chips (× removes), type
//    to search (no case, no accents: "υγεια" finds "Υγεία"), Enter adds the
//    highlighted tag or creates a new one; Backspace on an empty box removes
//    the last chip.
//  - createTagManager(): ⚙ → Tags — add, rename, recolour, delete (Undo).
//  - createFilterMenu(): the top-bar filter — pick tags, any / all, select
//    all matching, clear. Non-matching items fade (C6).
import { searchTags, findTagByName, cleanTagName, filterHits, LIMITS } from '../core/model.js';
import { PALETTE, textColorFor } from '../services/color.js';
import { toast, confirmDialog } from './dialogs.js';

function chip(tag, { onRemove, onClick, on } = {}) {
  const c = document.createElement(onClick ? 'button' : 'span');
  if (onClick) { c.type = 'button'; c.addEventListener('click', onClick); }
  c.className = 'tag-chip' + (on === false ? ' off' : '');
  c.style.setProperty('--tag', tag.color);
  c.style.setProperty('--tag-ink', textColorFor(tag.color));
  const t = document.createElement('span');
  t.textContent = tag.name;
  c.append(t);
  if (onClick) c.setAttribute('aria-pressed', String(!!on));
  if (onRemove) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tag-x';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Remove tag ' + tag.name);
    x.addEventListener('click', e => { e.stopPropagation(); onRemove(); });
    c.append(x);
  }
  return c;
}

// ---- editor field ------------------------------------------------------------------
export function createTagField({ store, onChange }) {
  const el = document.createElement('div');
  el.className = 'tag-field';
  const chips = document.createElement('div');
  chips.className = 'tag-chips';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-input';
  input.placeholder = 'Add a tag…';
  input.maxLength = LIMITS.tag;
  input.enterKeyHint = 'done';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  const list = document.createElement('div');
  list.className = 'tag-suggest';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  chips.append(input);
  el.append(chips, list);

  let ids = [];
  let options = []; // [{ tag } | { create: name }]
  let active = 0;

  function paintChips() {
    const nodes = ids.map(id => store.tag(id)).filter(Boolean).map(t => chip(t, { onRemove: () => setIds(ids.filter(x => x !== t.id)) }));
    // Swap the chips only: moving the input would drop the keyboard focus.
    for (const c of [...chips.children]) if (c !== input) c.remove();
    for (const n of nodes) chips.insertBefore(n, input);
  }
  function setIds(next) {
    ids = next;
    paintChips();
    onChange(ids.slice());
    if (document.activeElement === input) suggest();
  }
  function add(opt) {
    const id = opt.tag ? opt.tag.id : store.ensureTag(opt.create);
    if (!id || ids.includes(id)) return;
    input.value = '';
    setIds(ids.concat(id));
  }
  function suggest() {
    const q = input.value;
    const found = searchTags(store.tags(), q).filter(t => !ids.includes(t.id)).slice(0, 8);
    options = found.map(tag => ({ tag }));
    const clean = cleanTagName(q);
    if (clean && !findTagByName(store.tags(), clean)) options.push({ create: clean });
    active = 0;
    list.replaceChildren(...options.map((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tag-option' + (i === active ? ' on' : '');
      b.setAttribute('role', 'option');
      if (o.tag) {
        const dot = document.createElement('span');
        dot.className = 'tag-dot';
        dot.style.setProperty('--tag', o.tag.color);
        const n = document.createElement('span');
        n.textContent = o.tag.name;
        b.append(dot, n);
      } else {
        b.textContent = 'Create “' + o.create + '”';
        b.classList.add('create');
      }
      // pointerdown keeps the input focused.
      b.addEventListener('pointerdown', e => e.preventDefault());
      b.addEventListener('click', () => add(o));
      return b;
    }));
    if (!options.length && !store.tags().length) {
      const p = document.createElement('div');
      p.className = 'tag-hint';
      p.textContent = 'Type a name to create your first tag.';
      list.append(p);
    }
    list.hidden = !list.children.length;
    input.setAttribute('aria-expanded', String(!list.hidden));
  }
  function highlight(i) {
    if (!options.length) return;
    active = (i + options.length) % options.length;
    [...list.querySelectorAll('.tag-option')].forEach((b, k) => b.classList.toggle('on', k === active));
  }

  input.addEventListener('focus', suggest);
  input.addEventListener('input', suggest);
  input.addEventListener('blur', () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (options[active]) add(options[active]);
    } else if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
    else if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); list.hidden = true; }
    else if (e.key === 'Backspace' && !input.value && ids.length) setIds(ids.slice(0, -1));
  });
  // Escape with the list open only closes the list (not the editor).
  el.addEventListener('keydown', e => { if (e.key === 'Escape' && document.activeElement === input && !list.hidden) e.stopPropagation(); }, true);

  return {
    el,
    set(next) {
      const clean = (next || []).filter(id => store.tag(id));
      if (JSON.stringify(clean) === JSON.stringify(ids)) { paintChips(); return; }
      ids = clean;
      paintChips();
    }
  };
}

// ---- tag manager (⚙ → Tags) ----------------------------------------------------------
export function createTagManager({ store }) {
  const el = document.createElement('div');
  el.className = 'tag-manager';
  const addRow = document.createElement('form');
  addRow.className = 'tag-add';
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.placeholder = 'New tag';
  addInput.maxLength = LIMITS.tag;
  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className = 'btn';
  addBtn.textContent = 'Add';
  addRow.append(addInput, addBtn);
  addRow.addEventListener('submit', e => {
    e.preventDefault();
    const name = cleanTagName(addInput.value);
    if (!name) return;
    if (findTagByName(store.tags(), name)) { toast('That tag already exists'); return; }
    store.ensureTag(name);
    addInput.value = '';
  });
  const hint = document.createElement('small');
  hint.className = 'range-hint';
  hint.textContent = 'Tags are shared by all canvases. Add them to an item in its editor (✎ → Tags).';
  const rows = document.createElement('div');
  rows.className = 'tag-rows';
  el.append(addRow, hint, rows);
  let openColor = null;
  let seq = 0;

  function refresh() {
    const list = store.tags();
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'pic-empty';
      p.textContent = 'No tags yet.';
      rows.replaceChildren(p);
      return;
    }
    rows.replaceChildren(...list.map(t => {
      const row = document.createElement('div');
      row.className = 'tag-row';
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'tag-swatch';
      sw.style.setProperty('--tag', t.color);
      sw.setAttribute('aria-label', 'Colour of ' + t.name);
      sw.addEventListener('click', () => { openColor = openColor === t.id ? null : t.id; refresh(); });
      const name = document.createElement('input');
      name.type = 'text';
      name.value = t.name;
      name.maxLength = LIMITS.tag;
      name.setAttribute('aria-label', 'Tag name');
      const commitName = () => {
        if (name.value === t.name) return;
        const why = store.updateTag(t.id, { name: name.value });
        if (why === 'exists') { toast('Another tag already has that name'); name.value = t.name; }
        else if (why === 'empty') name.value = t.name;
      };
      name.addEventListener('change', commitName);
      name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
      const uses = document.createElement('small');
      const n = store.tagUses(t.id);
      uses.textContent = n + (n === 1 ? ' item' : ' items');
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn tag-del';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Delete tag ' + t.name);
      del.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Delete “' + t.name + '”?',
          message: n ? 'Used by ' + n + ' item' + (n === 1 ? '' : 's') + '; it is taken off them. You can undo this.' : 'No item uses it.',
          okLabel: 'Delete',
          danger: true
        });
        if (!ok) return;
        const key = 'tag-delete:' + (++seq);
        store.deleteTag(t.id, { coalesce: key });
        toast('Tag deleted', { actionLabel: 'Undo', onAction: () => { store.restoreTag(t.id); store.undoStep(key); } });
      });
      row.append(sw, name, uses, del);
      if (openColor !== t.id) return row;
      const wrap = document.createElement('div');
      wrap.className = 'tag-row-wrap';
      const pal = document.createElement('div');
      pal.className = 'tag-palette';
      for (const p of PALETTE) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tag-swatch' + (p.hex === t.color ? ' on' : '');
        b.style.setProperty('--tag', p.hex);
        b.setAttribute('aria-label', p.name);
        b.addEventListener('click', () => { openColor = null; store.updateTag(t.id, { color: p.hex }); refresh(); });
        pal.append(b);
      }
      wrap.append(row, pal);
      return wrap;
    }));
  }
  // Keep in step with tag changes (but don't rebuild under the cursor).
  store.on(change => {
    if (!el.isConnected || el.closest('[hidden]')) return;
    if (change.type === 'tags' || change.type === 'data') {
      if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      refresh();
    }
  });
  return { el, refresh };
}

// ---- filter menu (top bar) ------------------------------------------------------------
export function createFilterMenu({ root, store }) {
  const menu = document.createElement('div');
  menu.className = 'filter-menu';
  menu.hidden = true;
  root.append(menu);
  let anchor = null;

  function paint() {
    const f = store.ui.filter;
    const tags = store.tags();
    const head = document.createElement('div');
    head.className = 'filter-head';
    const h = document.createElement('strong');
    h.textContent = 'Filter by tags';
    head.append(h);
    if (!tags.length) {
      const p = document.createElement('p');
      p.className = 'formation-about';
      p.textContent = 'No tags yet. Add tags to items in their editor (✎ → Tags).';
      menu.replaceChildren(head, p);
      return;
    }
    const about = document.createElement('p');
    about.className = 'formation-about';
    about.textContent = 'Items without the picked tags fade.';
    const chips = document.createElement('div');
    chips.className = 'filter-chips';
    for (const t of tags) {
      const on = f.tagIds.includes(t.id);
      chips.append(chip(t, { on, onClick: () => store.setFilter({ ...f, tagIds: on ? f.tagIds.filter(x => x !== t.id) : f.tagIds.concat(t.id) }) }));
    }
    const allRow = document.createElement('label');
    allRow.className = 'toggle-row';
    const txt = document.createElement('span');
    const s1 = document.createElement('strong');
    s1.textContent = 'Match all picked tags';
    const s2 = document.createElement('small');
    s2.textContent = f.all ? 'Only items with every picked tag stay bright.' : 'Items with any picked tag stay bright.';
    txt.append(s1, s2);
    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.className = 'switch';
    sw.checked = f.all;
    sw.addEventListener('change', () => store.setFilter({ ...f, all: sw.checked }));
    allRow.append(txt, sw);
    const actions = document.createElement('div');
    actions.className = 'filter-actions';
    const sel = document.createElement('button');
    sel.type = 'button';
    sel.className = 'btn';
    sel.textContent = 'Select all matching';
    sel.disabled = !f.tagIds.length;
    sel.addEventListener('click', () => {
      const hits = filterHits(store.canvas(), f);
      store.selectMany(hits);
      const got = store.selectedItems().length;
      const hidden = hits.length - got;
      toast(got ? got + ' selected' + (hidden > 0 ? ' (' + hidden + ' inside closed groups left out)' : '') : 'No matching items you can see');
      close();
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn';
    clear.textContent = 'Clear';
    clear.disabled = !f.tagIds.length;
    clear.addEventListener('click', () => store.setFilter({ tagIds: [], all: f.all }));
    actions.append(sel, clear);
    menu.replaceChildren(head, about, chips, allRow, actions);
  }

  function place() {
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.top = Math.round(r.bottom + 6) + 'px';
    menu.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))) + 'px';
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
  function outside(e) {
    if (!menu.contains(e.target) && !(anchor && anchor.contains(e.target))) close();
  }
  store.on(change => { if (!menu.hidden && (change.type === 'ui' || change.type === 'tags')) { paint(); place(); } });
  return { open, close, get isOpen() { return !menu.hidden; } };
}
