// The line editor (opened with ✎ on a selected line, or by tapping a
// selected line again): label, style, colour, thickness, delete. Bottom sheet on
// phones, side panel on PC, like the item editor. Changes apply live; one
// opening = one undo step.
import { createLineLookFields } from './lineLookFields.js';
import { LIMITS } from '../core/model.js';

let seq = 0;

export function createLineSheet({ host, store, onRequestClose, onDelete }) {
  const sheet = document.createElement('section');
  sheet.className = 'sheet line-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Edit line');

  const head = document.createElement('div');
  head.className = 'sheet-head';
  const heading = document.createElement('h2');
  heading.className = 'sheet-title';
  heading.textContent = 'Edit line';
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn btn-primary';
  doneBtn.textContent = 'Done';
  head.append(heading, doneBtn);

  const body = document.createElement('div');
  body.className = 'sheet-body';

  const labelWrap = document.createElement('div');
  labelWrap.className = 'field';
  const labelTitle = document.createElement('div');
  labelTitle.className = 'field-label';
  labelTitle.textContent = 'Text on the line';
  const label = document.createElement('input');
  label.type = 'text';
  label.maxLength = LIMITS.label;
  label.placeholder = 'e.g. leads to, blocks, needs';
  label.enterKeyHint = 'done';
  labelWrap.append(labelTitle, label);

  const look = createLineLookFields({ withDefault: true, onChange: patch => update(patch) });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn-danger btn-wide';
  del.textContent = 'Delete line';

  body.append(labelWrap, look.el, del);
  sheet.append(head, body);
  host.append(sheet);

  let linkId = null;
  let key = null;

  function update(patch) {
    if (linkId) store.updateLink(linkId, patch, { coalesce: key });
  }

  function fill() {
    const ln = store.link(linkId);
    if (!ln) return;
    if (document.activeElement !== label) label.value = ln.label || '';
    const s = store.canvas().settings;
    look.set({ style: ln.style, color: ln.color, width: ln.width }, { style: s.lineStyle, color: s.lineColor, width: s.lineWidth });
  }

  label.addEventListener('input', () => update({ label: label.value }));
  label.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); label.blur(); } });
  doneBtn.addEventListener('click', () => onRequestClose());
  del.addEventListener('click', () => onDelete(linkId));

  return {
    el: sheet,
    get linkId() { return linkId; },
    get isOpen() { return linkId !== null; },
    open(id) {
      linkId = id;
      key = 'line:' + (++seq);
      look.reset();
      fill();
      sheet.classList.add('open');
    },
    close() {
      if (linkId === null) return;
      if (document.activeElement && sheet.contains(document.activeElement)) document.activeElement.blur();
      sheet.classList.remove('open');
      linkId = null;
      key = null;
    },
    // After any change (undo/redo, delete): false if the line is gone.
    refresh() {
      if (linkId === null) return true;
      if (!store.link(linkId)) return false;
      fill();
      return true;
    }
  };
}
