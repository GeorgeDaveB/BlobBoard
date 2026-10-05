// Builds and updates one item (full size on a board, or "mini" inside a tray).
// Structure:
//   .item (position, moved by JS)
//     .item-jelly (physics transform)
//       .item-body (outline set by physics + CSS bob; clips its text)
//         title, notes preview, and in container view: description box
//         (tap to edit in place, − to hide) + the inline grid (tray.js)
//       .item-done (✓ when done)
//       .item-kids (collapsed group: up to 6 mini shapes + count badge)
//     ✎ control
//     .tray (expanded item, top-level items only; see tray.js)
// Each layer owns its own `transform`, so dragging, physics and the bob never
// fight each other.
import { textColorFor } from '../services/color.js';
import { seededRandom } from '../core/ids.js';
import { badgeText } from '../core/model.js';
import { createPhysics } from './physics.js';

let inlineSeq = 0;

export function createItemEl(item, { onEdit, onNotes, mini = false }) {
  const el = document.createElement('div');
  el.className = mini ? 'item mini' : 'item';
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
  // Description box (container view only). Board gestures ignore it so you
  // can tap into the text without dragging the blob.
  const desc = document.createElement('div');
  desc.className = 'item-desc';
  desc.dataset.noGesture = '';
  const descText = document.createElement('div');
  descText.className = 'desc-text';
  const descInput = document.createElement('textarea');
  descInput.className = 'desc-input';
  descInput.hidden = true;
  descInput.rows = 2;
  descInput.setAttribute('aria-label', 'Description');
  const descHide = document.createElement('button');
  descHide.type = 'button';
  descHide.className = 'desc-hide';
  descHide.textContent = '−';
  descHide.setAttribute('aria-label', 'Hide description');
  desc.append(descText, descInput, descHide);
  const descShow = document.createElement('button');
  descShow.type = 'button';
  descShow.className = 'desc-show';
  descShow.dataset.noGesture = '';
  descShow.textContent = '▸ Description';
  body.append(title, notes, desc, descShow);

  let editKey = null;
  const autosize = () => { descInput.style.height = 'auto'; descInput.style.height = descInput.scrollHeight + 2 + 'px'; };
  descText.addEventListener('click', e => {
    e.stopPropagation();
    editKey = 'inline:' + (++inlineSeq);
    descInput.value = el._notes || '';
    descText.hidden = true;
    descInput.hidden = false;
    autosize();
    descInput.focus();
  });
  descInput.addEventListener('input', () => { autosize(); if (onNotes) onNotes(el.dataset.id, descInput.value, editKey); });
  descInput.addEventListener('blur', () => {
    descText.textContent = descInput.value || 'Tap to add a description';
    descText.classList.toggle('empty', !descInput.value);
    descInput.hidden = true;
    descText.hidden = false;
  });
  descInput.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); descInput.blur(); } });
  descHide.addEventListener('click', e => { e.stopPropagation(); el._descHidden = true; showDesc(el); });
  descShow.addEventListener('click', e => { e.stopPropagation(); el._descHidden = false; showDesc(el); });

  const kids = document.createElement('div');
  kids.className = 'item-kids';
  kids.hidden = true;
  const shapes = document.createElement('div');
  shapes.className = 'kid-shapes';
  const badge = document.createElement('span');
  badge.className = 'kid-badge';
  kids.append(shapes, badge);

  const jellyLayer = document.createElement('div');
  jellyLayer.className = 'item-jelly';
  jellyLayer.append(body, done, kids);

  const edit = control('item-edit', 'Edit item', '✎', () => onEdit(el.dataset.id));

  // Connect handle (thin arrow icon): drag it onto another blob to draw a
  // line (gestures.js).
  const link = control('item-link', 'Drag to another item to connect them', '', () => {});
  link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 18.5 18 6"/><path d="M10.5 6H18v7.5"/></svg>';

  el.append(jellyLayer, link, edit);
  applyBob(body, item.seed);
  el._parts = { body, title, notes, kids, shapes, badge, desc, descText, descInput, descShow };
  el._phys = createPhysics(jellyLayer, body, item.seed);
  return el;
}

function control(cls, label, text, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item-ctl ' + cls;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.textContent = text;
  b.addEventListener('click', e => { e.stopPropagation(); fn(); });
  return b;
}

// Bob timing from the seed (same on every device); a negative delay starts
// each blob at a different point so they don't move in sync.
function applyBob(body, seed) {
  const r = seededRandom((seed ^ 0x5bd1e995) >>> 0);
  const bd = 5 + r() * 2;
  body.style.setProperty('--bd', bd.toFixed(2) + 's');
  body.style.setProperty('--bdl', (-r() * bd).toFixed(2) + 's');
}

function showDesc(el) {
  const p = el._parts;
  const open = el.classList.contains('container-open');
  p.desc.hidden = !open || !!el._descHidden;
  p.descShow.hidden = !open || !el._descHidden;
}

// ctx: { selected, kids (inside items, in tray order), expanded,
//        container (expanded in container view) }
export function updateItemEl(el, item, ctx) {
  const p = el._parts;
  el._notes = item.notes;
  const container = !!(ctx.expanded && ctx.container);
  if (el.classList.contains('container-open') !== container) {
    el.classList.toggle('container-open', container);
    el._descHidden = false; // shown again every time it opens
  }
  if (document.activeElement !== p.descInput) {
    p.descText.textContent = item.notes || 'Tap to add a description';
    p.descText.classList.toggle('empty', !item.notes);
  }
  showDesc(el);
  const sig = [item.title, item.notes, item.color, item.done].join('\u0001');
  if (el._sig !== sig) {
    p.title.textContent = item.title || 'Untitled';
    p.title.classList.toggle('untitled', !item.title);
    p.notes.textContent = item.notes;
    p.notes.hidden = !item.notes;
    el.classList.toggle('has-notes', !!item.notes);
    el.classList.toggle('done', item.done);
    p.body.style.setProperty('--c', item.color);
    el.style.setProperty('--lc', item.color); // connect dot
    p.body.style.setProperty('--tc', textColorFor(item.color));
    el.setAttribute('aria-label', (item.title || 'Untitled') + (item.done ? ', done' : ''));
    el._sig = sig;
  }

  // Collapsed group: up to 6 mini shapes in the inside items' colours + badge.
  const kids = ctx.kids || [];
  const showKids = kids.length > 0 && !ctx.expanded;
  const kidSig = showKids ? kids.length + ':' + kids.slice(0, 6).map(k => k.color).join(',') : '';
  if (el._kidSig !== kidSig) {
    p.kids.hidden = !showKids;
    if (showKids) {
      p.shapes.replaceChildren(...kids.slice(0, 6).map((k, i) => {
        const s = document.createElement('span');
        s.className = 'kid-shape';
        s.style.setProperty('--c', k.color);
        s.style.setProperty('--d', (-i * 0.7).toFixed(1) + 's');
        return s;
      }));
      p.badge.textContent = badgeText(kids.length);
      p.badge.setAttribute('aria-label', kids.length + ' inside');
    }
    el._kidSig = kidSig;
  }

  // R30: a closed blob on the board grows as if its inside items had merged
  // into it: each adds `growth` default blobs of area (canvas setting, 0–3),
  // so size x sqrt(1 + growth x n), max 5x. Minis keep their grid cell size;
  // open blobs size to their content.
  const grow = el.classList.contains('mini') || ctx.expanded ? 1 : growFactor(kids.length, ctx.growth);
  p.body.style.setProperty('--grow', grow);

  el.classList.toggle('group', kids.length > 0);
  el.classList.toggle('expanded', !!ctx.expanded);
  el.classList.toggle('selected', !!ctx.selected);
  // Text needs a squarer outline to stay inside: a bit with notes, a lot
  // when fully expanded (whole description shown). Morphs with a spring.
  el._phys.setRoundness(container ? 0.16 : item.notes ? (ctx.expanded ? 0.42 : 0.72) : 1);
}

export const MAX_GROW = 5;

export function growFactor(insideCount, perItem = 1) {
  const k = isFinite(perItem) ? Math.max(0, perItem) : 1;
  return Math.min(MAX_GROW, Math.sqrt(1 + k * Math.max(0, insideCount)));
}

export function positionEl(el, x, y, extra = '') {
  el.style.transform = 'translate(' + x + 'px, ' + y + 'px) translateX(-50%)' + extra;
}
