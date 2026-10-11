// Builds and updates one item (full size on a board, or "mini" inside a tray).
// Structure:
//   .item (position, moved by JS)
//     .item-jelly (physics transform)
//       .item-body (outline set by physics + CSS bob; clips its text)
//         card picture (phase 4: thumbnails on + a picture; the title then
//         sits on a pill over the picture's bottom edge),
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
import { badgeText, LIMITS } from '../core/model.js';
import { createRichEditor, notesHtmlOf } from './richText.js';
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
  notes.className = 'item-notes rich-text';
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
  descText.className = 'desc-text rich-text';
  // Styled editing in place (R32): created the first time it's needed.
  let rich = null;
  const descInput = document.createElement('div');
  descInput.className = 'desc-input';
  descInput.hidden = true;
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
  // Tag chips (R10): up to 3, then "+N". Not on minis.
  const tagRow = document.createElement('div');
  tagRow.className = 'item-tags';
  tagRow.hidden = true;
  body.append(title, tagRow, notes, desc, descShow);

  let editKey = null;
  descText.addEventListener('click', e => {
    e.stopPropagation();
    editKey = 'inline:' + (++inlineSeq);
    if (!rich) {
      rich = createRichEditor({
        compact: true,
        placeholder: 'Description',
        onInput: (html, text) => { if (onNotes) onNotes(el.dataset.id, { notesHtml: html, notes: text.slice(0, LIMITS.notes) }, editKey); }
      });
      descInput.append(rich.el);
      // Leaving the editor (focus moves outside it) shows the text again.
      descInput.addEventListener('focusout', ev => {
        if (ev.relatedTarget && descInput.contains(ev.relatedTarget)) return;
        setTimeout(() => {
          if (descInput.contains(document.activeElement)) return;
          showDescText(el);
          descInput.hidden = true;
          descText.hidden = false;
        }, 0);
      });
      descInput.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); rich.box.blur(); } });
    }
    rich.setHtml(el._notesHtml || '');
    descText.hidden = true;
    descInput.hidden = false;
    rich.focus();
  });
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
  // Card picture (created when first needed).
  const pic = document.createElement('div');
  pic.className = 'item-pic';
  pic.hidden = true;
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  pic.append(img);
  body.prepend(pic);
  el._parts = { body, title, tagRow, notes, kids, shapes, badge, desc, descText, descInput, descShow, pic, img };
  el._editingDesc = () => !descInput.hidden;
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

// The description box's text (shown when not editing).
function showDescText(el) {
  const t = el._parts.descText;
  const html = el._notesHtml || '';
  if (html) t.innerHTML = html; else t.textContent = 'Tap to add a description';
  t.classList.toggle('empty', !html);
}

function showDesc(el) {
  const p = el._parts;
  const open = el.classList.contains('container-open');
  p.desc.hidden = !open || !!el._descHidden;
  p.descShow.hidden = !open || !el._descHidden;
}

// ctx: { selected, kids (inside items, in tray order), expanded,
//        container (expanded in container view), growth,
//        picOf(thumbId) -> { url, aspect } | null (null when the canvas's
//        thumbnails are off or the picture isn't on this device),
//        tagsOf(tagIds) -> live tags [{ name, color }], faded (filter, C6) }
export function updateItemEl(el, item, ctx) {
  const p = el._parts;
  const picOf = ctx.picOf || (() => null);
  el._notes = item.notes;
  el._notesHtml = item.notes || item.notesHtml ? notesHtmlOf(item) : '';
  const container = !!(ctx.expanded && ctx.container);
  if (el.classList.contains('container-open') !== container) {
    el.classList.toggle('container-open', container);
    el._descHidden = false; // shown again every time it opens
  }
  if (!el._editingDesc()) showDescText(el);
  showDesc(el);
  const sig = [item.title, item.notes, item.notesHtml, item.color, item.done].join('\u0001');
  if (el._sig !== sig) {
    p.title.textContent = item.title || 'Untitled';
    p.title.classList.toggle('untitled', !item.title);
    p.notes.innerHTML = el._notesHtml; // sanitized (richText.js)
    p.notes.hidden = !item.notes;
    el.classList.toggle('has-notes', !!item.notes);
    el.classList.toggle('done', item.done);
    p.body.style.setProperty('--c', item.color);
    el.style.setProperty('--lc', item.color); // connect dot
    p.body.style.setProperty('--tc', textColorFor(item.color));
    el.setAttribute('aria-label', (item.title || 'Untitled') + (item.done ? ', done' : ''));
    el._sig = sig;
  }

  // Phase 4 (R8): with a picture and thumbnails on, a board item is a card
  // (picture on top, title on a pill over it, notes underneath); a mini
  // shows the picture as a round crop instead of its colour. An open
  // container stays a container.
  const pic = picOf(item.thumbId);
  const mini = el.classList.contains('mini');
  const card = !!pic && !mini && !container;
  const picBlob = !!pic && mini && !container;
  // Opened into a container (editing in place): the picture stays as a
  // faded background and the card's corners stay (owner, 2026-10-11).
  const picOpen = !!pic && container;
  if (el._picUrl !== (pic && pic.url) || el._card !== card || el._picBlob !== picBlob || el._picOpen !== picOpen) {
    el.classList.toggle('card', card);
    el.classList.toggle('pic-blob', picBlob);
    el.classList.toggle('pic-open', picOpen);
    p.pic.hidden = !card;
    if (card) {
      if (p.img.src !== pic.url) p.img.src = pic.url;
      p.pic.style.aspectRatio = '1 / ' + pic.aspect.toFixed(3);
      if (p.title.parentElement !== p.pic) p.pic.append(p.title);
    } else if (p.title.parentElement !== p.body) {
      p.pic.after(p.title);
    }
    if (picBlob || picOpen) p.body.style.setProperty('--pic', 'url("' + pic.url + '")');
    else p.body.style.removeProperty('--pic');
    el._picUrl = pic && pic.url;
    el._card = card;
    el._picBlob = picBlob;
    el._picOpen = picOpen;
  }
  el._phys.setCard(card);

  // Tag chips (R10).
  const tagList = mini || !ctx.tagsOf ? [] : ctx.tagsOf(item.tagIds || []);
  const tagSig = JSON.stringify(tagList.map(t => [t.name, t.color]));
  if (el._tagSig !== tagSig) {
    p.tagRow.hidden = !tagList.length;
    p.tagRow.replaceChildren(...tagList.slice(0, MAX_CHIPS).map(t => {
      const c = document.createElement('span');
      c.className = 'tag-chip';
      c.textContent = t.name;
      c.style.setProperty('--tag', t.color);
      c.style.setProperty('--tag-ink', textColorFor(t.color));
      return c;
    }));
    if (tagList.length > MAX_CHIPS) {
      const more = document.createElement('span');
      more.className = 'tag-chip more';
      more.textContent = '+' + (tagList.length - MAX_CHIPS);
      p.tagRow.append(more);
    }
    el.classList.toggle('has-tags', tagList.length > 0);
    el._tagSig = tagSig;
  }
  el.classList.toggle('faded', !!ctx.faded);

  // Collapsed group: up to 6 mini shapes in the inside items' colours (or
  // their pictures) + badge.
  const kids = ctx.kids || [];
  const showKids = kids.length > 0 && !ctx.expanded;
  const kidPics = showKids ? kids.slice(0, 6).map(k => picOf(k.thumbId)) : [];
  const kidSig = showKids ? kids.length + ':' + kids.slice(0, 6).map((k, i) => k.color + (kidPics[i] ? kidPics[i].url : '')).join(',') : '';
  if (el._kidSig !== kidSig) {
    p.kids.hidden = !showKids;
    if (showKids) {
      p.shapes.replaceChildren(...kids.slice(0, 6).map((k, i) => {
        const s = document.createElement('span');
        s.className = 'kid-shape';
        s.style.setProperty('--c', k.color);
        if (kidPics[i]) { s.classList.add('has-pic'); s.style.setProperty('--pic', 'url("' + kidPics[i].url + '")'); }
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
  el._phys.setRoundness(card || picOpen ? 0.2 : container ? 0.16 : item.notes ? (ctx.expanded ? 0.42 : 0.72) : 1);
}

export const MAX_GROW = 5;
export const MAX_CHIPS = 3;

export function growFactor(insideCount, perItem = 1) {
  const k = isFinite(perItem) ? Math.max(0, perItem) : 1;
  return Math.min(MAX_GROW, Math.sqrt(1 + k * Math.max(0, insideCount)));
}

export function positionEl(el, x, y, extra = '') {
  el.style.transform = 'translate(' + x + 'px, ' + y + 'px) translateX(-50%)' + extra;
}
