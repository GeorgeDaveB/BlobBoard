// The item editor: bottom sheet on phones, side panel on PC.
// Changes apply live; one editor session = one undo step.
import { createColorPicker } from './colorPicker.js';
import { LIMITS } from '../core/model.js';

let sessionSeq = 0;
export const newSessionKey = () => 'edit:' + (++sessionSeq);

export function createEditSheet({ host, store, onRequestClose, onDelete, onOpen }) {
  const sheet = document.createElement('section');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Edit item');

  const head = document.createElement('div');
  head.className = 'sheet-head';
  const heading = document.createElement('h2');
  heading.className = 'sheet-title';
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn btn-primary';
  doneBtn.textContent = 'Done';
  head.append(heading, doneBtn);

  const body = document.createElement('div');
  body.className = 'sheet-body';

  const title = document.createElement('input');
  title.type = 'text';
  title.maxLength = LIMITS.title;
  title.placeholder = 'Title';
  title.enterKeyHint = 'next';
  const notes = document.createElement('textarea');
  notes.maxLength = LIMITS.notes;
  notes.rows = 3;
  notes.placeholder = 'Notes';
  const picker = createColorPicker({ onChange: hex => update({ color: hex }) });

  const doneRow = document.createElement('label');
  doneRow.className = 'toggle';
  const doneBox = document.createElement('input');
  doneBox.type = 'checkbox';
  const doneText = document.createElement('span');
  doneText.textContent = 'Done';
  doneRow.append(doneBox, doneText);

  const openInside = document.createElement('button');
  openInside.type = 'button';
  openInside.className = 'btn btn-wide';
  openInside.textContent = '⤢ Open inside';

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn-danger btn-wide';
  del.textContent = 'Delete item';

  body.append(field('Title', title), field('Notes', notes), field('Colour', picker.el), doneRow, openInside, del);
  sheet.append(head, body);
  host.append(sheet);

  let itemId = null;
  let key = null;
  let isNew = false;

  function field(label, control) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const l = document.createElement('div');
    l.className = 'field-label';
    l.textContent = label;
    wrap.append(l, control);
    return wrap;
  }

  function update(patch) {
    if (itemId) store.updateItem(itemId, patch, { coalesce: key });
  }

  function autosize() {
    notes.style.height = 'auto';
    notes.style.height = Math.min(notes.scrollHeight + 2, 260) + 'px';
  }

  function fill() {
    const it = store.item(itemId);
    if (!it) return;
    if (document.activeElement !== title) title.value = it.title;
    if (document.activeElement !== notes) notes.value = it.notes;
    doneBox.checked = it.done;
    picker.setValue(it.color);
    autosize();
  }

  title.addEventListener('input', () => update({ title: title.value }));
  title.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); notes.focus(); }
  });
  notes.addEventListener('input', () => { autosize(); update({ notes: notes.value }); });
  doneBox.addEventListener('change', () => update({ done: doneBox.checked }));
  for (const f of [title, notes]) {
    f.addEventListener('focus', () => setTimeout(() => f.scrollIntoView({ block: 'nearest' }), 300));
  }
  doneBtn.addEventListener('click', () => onRequestClose());
  del.addEventListener('click', () => onDelete(itemId));
  openInside.addEventListener('click', () => onOpen(itemId));

  return {
    el: sheet,
    get itemId() { return itemId; },
    get isOpen() { return itemId !== null; },

    open(id, opts = {}) {
      itemId = id;
      key = opts.key || newSessionKey();
      isNew = !!opts.isNew;
      heading.textContent = isNew ? 'New item' : 'Edit item';
      picker.collapse();
      fill();
      sheet.classList.add('open');
      if (isNew) title.focus({ preventScroll: true });
    },

    // Called when the sheet closes. A new item always stays, even untitled;
    // only Delete or Undo removes it.
    close() {
      if (itemId === null) return;
      if (document.activeElement && sheet.contains(document.activeElement)) document.activeElement.blur();
      sheet.classList.remove('open');
      itemId = null;
      key = null;
      isNew = false;
    },

    // Re-reads the item after undo/redo; returns false if it no longer exists.
    refresh() {
      if (itemId === null) return true;
      if (!store.item(itemId)) return false;
      fill();
      return true;
    }
  };
}
