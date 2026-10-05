// Builds and updates one item on the board.
// Structure: .item (position, moved by JS) > .item-body (shape + CSS animation).
// Keeping them separate stops dragging and the animation fighting over `transform`.
import { textColorFor } from '../services/color.js';
import { seededRandom } from '../core/ids.js';

const MORPH_VARIANTS = 4;

export function createItemEl(item, { onEdit }) {
  const el = document.createElement('div');
  el.className = 'item';
  el.dataset.id = item.id;

  const body = document.createElement('div');
  body.className = 'item-body';
  const title = document.createElement('div');
  title.className = 'item-title';
  const notes = document.createElement('div');
  notes.className = 'item-notes';
  const done = document.createElement('span');
  done.className = 'item-done';
  done.textContent = '✓';
  done.setAttribute('aria-hidden', 'true');
  body.append(title, notes, done);

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'item-ctl item-edit';
  edit.setAttribute('aria-label', 'Edit item');
  edit.textContent = '✎';
  edit.addEventListener('click', e => {
    e.stopPropagation();
    onEdit(el.dataset.id);
  });

  el.append(body, edit);
  applyMotion(body, item.seed);
  el._parts = { body, title, notes };
  return el;
}

// Same seed -> same shape and timing on every device. Negative delays start
// each blob at a different point so they don't move in sync.
function applyMotion(body, seed) {
  const r = seededRandom(seed);
  body.classList.add('m' + Math.floor(r() * MORPH_VARIANTS));
  const md = 9 + r() * 5;
  const bd = 5 + r() * 2;
  body.style.setProperty('--md', md.toFixed(2) + 's');
  body.style.setProperty('--mdl', (-r() * md).toFixed(2) + 's');
  body.style.setProperty('--bd', bd.toFixed(2) + 's');
  body.style.setProperty('--bdl', (-r() * bd).toFixed(2) + 's');
}

export function updateItemEl(el, item, { selected }) {
  const sig = [item.title, item.notes, item.color, item.done].join('\u0001');
  if (el._sig !== sig) {
    const { body, title, notes } = el._parts;
    title.textContent = item.title || 'Untitled';
    title.classList.toggle('untitled', !item.title);
    notes.textContent = item.notes;
    notes.hidden = !item.notes;
    el.classList.toggle('has-notes', !!item.notes);
    el.classList.toggle('done', item.done);
    body.style.setProperty('--c', item.color);
    body.style.setProperty('--tc', textColorFor(item.color));
    el.setAttribute('aria-label', (item.title || 'Untitled') + (item.done ? ', done' : ''));
    el._sig = sig;
  }
  el.classList.toggle('selected', selected);
}

export function positionEl(el, x, y, extra = '') {
  el.style.transform = 'translate(' + x + 'px, ' + y + 'px) translateX(-50%)' + extra;
}
