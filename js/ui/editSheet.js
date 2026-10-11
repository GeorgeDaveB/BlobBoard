// The item editor: bottom sheet on phones, side panel on PC.
// Changes apply live; one editor session = one undo step.
import { createColorPicker } from './colorPicker.js';
import { LIMITS, childrenOf } from '../core/model.js';
import { createRichEditor, notesHtmlOf } from './richText.js';
import { openPicturePicker } from './imageLibrary.js';
import { createTagField } from './tagPicker.js';

let sessionSeq = 0;
export const newSessionKey = () => 'edit:' + (++sessionSeq);

export function createEditSheet({ host, store, pictures, onRequestClose, onDelete, onRelease }) {
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
  // Description with styling (R32): toolbar + formatted text.
  const rich = createRichEditor({
    placeholder: 'Notes',
    onInput: (html, text) => update({ notesHtml: html, notes: text.slice(0, LIMITS.notes) })
  });
  const notes = rich.box;
  const picker = createColorPicker({ onChange: hex => update({ color: hex }) });

  // Tags (R10): chips + type to find or create.
  const tagField = createTagField({ store, onChange: tagIds => update({ tagIds }) });

  // Picture (phase 4): preview + Choose… (opens the library) + Remove.
  const picRow = document.createElement('div');
  picRow.className = 'pic-row';
  const picPrev = document.createElement('div');
  picPrev.className = 'pic-prev';
  const picImg = document.createElement('img');
  picImg.alt = '';
  picPrev.append(picImg);
  const picChoose = document.createElement('button');
  picChoose.type = 'button';
  picChoose.className = 'btn';
  const picRemove = document.createElement('button');
  picRemove.type = 'button';
  picRemove.className = 'btn-text';
  picRemove.textContent = 'Remove';
  const picNote = document.createElement('small');
  picNote.className = 'pic-note';
  picNote.textContent = 'Pictures are switched off for this canvas (⚙ → Canvas).';
  const picBtns = document.createElement('div');
  picBtns.className = 'pic-row-btns';
  picBtns.append(picChoose, picRemove);
  picRow.append(picPrev, picBtns);
  const picField = document.createElement('div');
  picField.className = 'pic-field';
  picField.append(picRow, picNote);
  picChoose.addEventListener('click', async () => {
    if (!pictures || !itemId) return;
    const id = itemId;
    const res = await openPicturePicker({ pictures, current: store.item(id) && store.item(id).thumbId });
    if (!res || itemId !== id) return;
    update({ thumbId: res.remove ? null : res.id });
  });
  picRemove.addEventListener('click', () => update({ thumbId: null }));

  const doneRow = document.createElement('label');
  doneRow.className = 'toggle';
  const doneBox = document.createElement('input');
  doneBox.type = 'checkbox';
  const doneText = document.createElement('span');
  doneText.textContent = 'Done';
  doneRow.append(doneBox, doneText);

  // R35: only for a blob that has minis.
  const release = document.createElement('button');
  release.type = 'button';
  release.className = 'btn btn-wide';
  release.textContent = 'Release child(s)';
  release.title = 'Take the blobs inside out and place them around it';
  release.hidden = true;

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn-danger btn-wide';
  del.textContent = 'Delete item';

  body.append(field('Title', title), field('Tags', tagField.el), field('Notes', rich.el), field('Colour', picker.el), field('Picture', picField), doneRow, release, del);
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
    // The rich box grows with its content (CSS max-height + scroll).
  }

  function fill() {
    const it = store.item(itemId);
    if (!it) return;
    if (document.activeElement !== title) title.value = it.title;
    if (!rich.isFocused) rich.setHtml(notesHtmlOf(it));
    doneBox.checked = it.done;
    tagField.set(it.tagIds || []);
    picker.setValue(it.color);
    release.hidden = !onRelease || childrenOf(store.canvas(), itemId).length === 0;
    const pic = it.thumbId && pictures ? pictures.get(it.thumbId) : null;
    picPrev.hidden = !pic;
    if (pic && picImg.src !== pic.url) picImg.src = pic.url;
    picChoose.textContent = pic ? 'Change…' : 'Choose…';
    picRemove.hidden = !it.thumbId;
    picNote.hidden = !it.thumbId || store.canvas().settings.thumbnails !== false;
    autosize();
  }

  title.addEventListener('input', () => update({ title: title.value }));
  title.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); rich.focus(); }
  });

  doneBox.addEventListener('change', () => update({ done: doneBox.checked }));
  for (const f of [title, notes]) {
    f.addEventListener('focus', () => setTimeout(() => f.scrollIntoView({ block: 'nearest' }), 300));
  }
  doneBtn.addEventListener('click', () => onRequestClose());
  del.addEventListener('click', () => onDelete(itemId));
  release.addEventListener('click', () => { if (onRelease) onRelease(itemId); });

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
