// Lines between blobs (R21–R23, R31), drawn in an SVG layer under the
// items. Two styles (services/strand.js has the shapes):
//  - gooey string: its middle is a damped spring, so it lags, bends and
//    wobbles when its blobs move, and it thins as it is pulled longer;
//  - straight: a thin arrow from edge to edge, no physics.
// Colour: gradient between the blobs, the start or end blob's colour, or a
// custom colour (canvas default, overridable per line — model.lineLook).
// An optional text label sits exactly at the middle in a pill with a white
// border, filled with the line's colours.
// Updated from the physics frame loop; nothing is written to the DOM while
// nothing moves.
//
// Selected line: white edge, + / − near each end (add / remove that
// arrowhead), ✎ (line editor) and × (delete) beside the middle. Drawing a
// new line shows a temporary line from the blob to the finger.
import { strandGeometry, restMid } from '../services/strand.js';
import { lineLook } from '../core/model.js';
import { textColorFor } from '../services/color.js';
import { onFrame } from './physics.js';

const NS = 'http://www.w3.org/2000/svg';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const MID_SPRING = [0.10, 0.80]; // [stiffness, damping] of the string's middle

// geom(id) -> { cx, cy, a, b, rd } (the blob as drawn now) or null if it isn't
// on this board. color(id) -> its colour.
export function createLinksLayer({ world, before, store, geom, color, onToggleArrow, onDelete, onEdit }) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'links-layer');
  svg.setAttribute('width', '1');
  svg.setAttribute('height', '1');
  svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS(NS, 'defs');
  svg.append(defs);
  world.insertBefore(svg, before);

  // Labels (HTML): above the blobs (a blob's invisible corners must not
  // hide or block them), below open trays and a dragged blob.
  const labels = document.createElement('div');
  labels.className = 'link-labels';
  world.append(labels);

  // Controls of the selected line (HTML, above the items).
  const ctls = document.createElement('div');
  ctls.className = 'link-ctls';
  ctls.hidden = true;
  const btnFrom = ctlButton('link-end', () => onToggleArrow(ctls.dataset.link, 'from'));
  const btnEdit = ctlButton('link-edit', () => onEdit(ctls.dataset.link));
  btnEdit.textContent = '✎';
  btnEdit.setAttribute('aria-label', 'Edit line: text, style, colour');
  const btnDel = ctlButton('link-del', () => onDelete(ctls.dataset.link));
  btnDel.textContent = '×';
  btnDel.setAttribute('aria-label', 'Delete line');
  const btnTo = ctlButton('link-end', () => onToggleArrow(ctls.dataset.link, 'to'));
  ctls.append(btnFrom, btnEdit, btnDel, btnTo);
  world.append(ctls);

  const views = new Map(); // linkId -> view (see makeView)
  let temp = null;          // the line being drawn

  function makeView(id) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'link');
    const grad = document.createElementNS(NS, 'linearGradient');
    grad.id = 'lg-' + id;
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    const s0 = document.createElementNS(NS, 'stop');
    s0.setAttribute('offset', '0');
    const s1 = document.createElementNS(NS, 'stop');
    s1.setAttribute('offset', '1');
    grad.append(s0, s1);
    defs.append(grad);
    const goo = document.createElementNS(NS, 'path');
    goo.setAttribute('class', 'link-goo');
    goo.setAttribute('fill', 'url(#lg-' + id + ')');
    const heads = document.createElementNS(NS, 'path');
    heads.setAttribute('class', 'link-heads');
    heads.setAttribute('fill', 'url(#lg-' + id + ')');
    const hit = document.createElementNS(NS, 'path');
    hit.setAttribute('class', 'link-hit');
    hit.dataset.link = id;
    g.append(goo, heads, hit);
    svg.append(g);
    const label = document.createElement('div');
    label.className = 'link-label';
    label.dataset.link = id;
    label.hidden = true;
    labels.append(label);
    return { g, goo, heads, hit, grad, stops: [s0, s1], label, mid: null, d: '', gradKey: '', colorKey: '', style: 'goo', c0: '', c1: '', text: '', labelKey: '', labelW: 0 };
  }

  function dropView(id) {
    const v = views.get(id);
    if (!v) return;
    v.g.remove();
    v.grad.remove();
    v.label.remove();
    views.delete(id);
  }

  // Which lines exist (both ends on this board), their look, label and
  // selection.
  function render() {
    const doc = store.canvas();
    const seen = new Set();
    for (const ln of Object.values(doc ? doc.links : {})) {
      if (!geom(ln.from) || !geom(ln.to)) continue;
      seen.add(ln.id);
      const v = views.get(ln.id) || views.set(ln.id, makeView(ln.id)).get(ln.id);
      const look = lineLook(ln, doc.settings, color(ln.from), color(ln.to));
      if (v.style !== look.style) { v.style = look.style; v.mid = null; }
      v.width = look.width;
      v.g.classList.toggle('straight', look.style === 'straight');
      const colorKey = look.c0 + look.c1;
      if (v.colorKey !== colorKey) {
        v.stops[0].setAttribute('stop-color', look.c0);
        v.stops[1].setAttribute('stop-color', look.c1);
        v.c0 = look.c0;
        v.c1 = look.c1;
        v.colorKey = colorKey;
        v.labelKey = '';
      }
      const text = ln.label || '';
      if (v.text !== text) {
        v.text = text;
        v.label.textContent = text;
        v.label.hidden = !text;
        v.labelW = 0;
        v.labelKey = '';
      }
      const selected = store.ui.selectedLinkId === ln.id;
      v.g.classList.toggle('selected', selected);
      v.label.classList.toggle('selected', selected);
      v.d = ''; // arrows or style may have changed: redraw next frame
    }
    for (const id of [...views.keys()]) if (!seen.has(id)) dropView(id);
    const sel = store.ui.selectedLinkId && views.has(store.ui.selectedLinkId) ? store.link(store.ui.selectedLinkId) : null;
    ctls.hidden = !sel;
    if (sel) {
      ctls.dataset.link = sel.id;
      setEnd(btnFrom, sel.arrowFrom);
      setEnd(btnTo, sel.arrowTo);
    }
    frame();
  }

  function setEnd(btn, hasArrow) {
    btn.textContent = hasArrow ? '−' : '+';
    btn.setAttribute('aria-label', hasArrow ? 'Remove arrowhead at this end' : 'Add arrowhead at this end');
  }

  // Middle of a gooey string: springs towards its resting place.
  function stepMid(state, A, B) {
    const rest = restMid(A, B, state.style);
    if (!state.mid || REDUCED.matches || state.style === 'straight') {
      state.mid = { x: rest.x, y: rest.y, vx: 0, vy: 0 };
      return;
    }
    const m = state.mid;
    const [k, damp] = MID_SPRING;
    m.vx = (m.vx + (rest.x - m.x) * k) * damp;
    m.vy = (m.vy + (rest.y - m.y) * k) * damp;
    m.x += m.vx;
    m.y += m.vy;
    if (!isFinite(m.x) || !isFinite(m.y)) state.mid = { x: rest.x, y: rest.y, vx: 0, vy: 0 };
  }

  function frame() {
    const doc = store.canvas();
    if (!doc) return;
    for (const [id, v] of views) {
      const ln = doc.links[id];
      const A = ln && geom(ln.from), B = ln && geom(ln.to);
      if (!A || !B) continue;
      stepMid(v, A, B);
      const s = strandGeometry(A, B, v.mid, { from: ln.arrowFrom, to: ln.arrowTo }, v.style, v.width);
      const d = s ? s.d + '|' + s.arrows : '';
      if (d !== v.d) {
        v.goo.setAttribute('d', s ? s.d : '');
        v.heads.setAttribute('d', s ? s.arrows : '');
        v.hit.setAttribute('d', s ? s.spine : '');
        v.d = d;
      }
      if (s) {
        const gk = Math.round(s.a.x) + ',' + Math.round(s.a.y) + ',' + Math.round(s.b.x) + ',' + Math.round(s.b.y);
        if (gk !== v.gradKey) {
          v.grad.setAttribute('x1', s.a.x); v.grad.setAttribute('y1', s.a.y);
          v.grad.setAttribute('x2', s.b.x); v.grad.setAttribute('y2', s.b.y);
          v.gradKey = gk;
        }
        if (v.text) placeLabel(v, s);
        if (!ctls.hidden && ctls.dataset.link === id) placeCtls(v, s);
      } else {
        if (v.text) v.label.style.visibility = 'hidden';
        if (!ctls.hidden && ctls.dataset.link === id) ctls.style.visibility = 'hidden';
      }
    }
    if (temp) drawTemp();
  }

  // Label: centred exactly on the middle of the line, filled with the line's
  // colours (left to right as drawn).
  function placeLabel(v, s) {
    const p = s.at(0.5);
    const leftFirst = s.a.x <= s.b.x;
    const [l, r] = leftFirst ? [v.c0, v.c1] : [v.c1, v.c0];
    const bg = l === r ? l : 'linear-gradient(90deg, ' + l + ', ' + r + ')';
    const key = Math.round(p.x) + ',' + Math.round(p.y) + ',' + bg;
    if (key === v.labelKey) return;
    if (v.bg !== bg) {
      v.label.style.background = bg;
      v.label.style.color = textColorFor(mix(v.c0, v.c1));
      v.bg = bg;
    }
    v.label.style.visibility = '';
    v.label.style.transform = 'translate(' + Math.round(p.x) + 'px, ' + Math.round(p.y) + 'px) translate(-50%, -50%)';
    v.labelKey = key;
  }

  function placeCtls(v, s) {
    ctls.style.visibility = '';
    const L = Math.max(1, s.len);
    const tEnd = Math.min(0.3, Math.max(0.12, 36 / L));
    if (v.text && !v.labelW) v.labelW = v.label.offsetWidth;
    const half = (v.text ? v.labelW / 2 : 0) + 22; // ✎ and × sit either side of the label
    const tm = Math.min(0.5 - tEnd - 0.04, half / L);
    place(btnFrom, s.at(tEnd));
    place(btnEdit, s.at(0.5 - Math.max(0.02, tm)));
    place(btnDel, s.at(0.5 + Math.max(0.02, tm)));
    place(btnTo, s.at(1 - tEnd));
  }

  // ---- drawing a new line ------------------------------------------------------
  // from: item id; then moveTemp with the pointer in board coordinates and
  // the target (id + ok) under it, if any.
  function startTemp(fromId) {
    endTemp();
    const doc = store.canvas();
    const look = lineLook({}, doc.settings, color(fromId), color(fromId));
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'link temp');
    const goo = document.createElementNS(NS, 'path');
    goo.setAttribute('class', 'link-goo');
    goo.setAttribute('fill', look.c0);
    const heads = document.createElementNS(NS, 'path');
    heads.setAttribute('class', 'link-heads');
    heads.setAttribute('fill', look.c0);
    const tip = document.createElementNS(NS, 'circle');
    tip.setAttribute('class', 'link-tip');
    tip.setAttribute('r', look.style === 'straight' ? '4' : '7');
    tip.setAttribute('fill', look.c0);
    g.append(goo, heads, tip);
    svg.append(g);
    temp = { fromId, g, goo, heads, tip, x: 0, y: 0, targetId: null, ok: false, mid: null, style: look.style, width: look.width };
  }

  function moveTemp(x, y, targetId, ok) {
    if (!temp) return;
    temp.x = x;
    temp.y = y;
    temp.targetId = targetId;
    temp.ok = ok;
    temp.g.classList.toggle('bad', !!targetId && !ok);
    temp.g.classList.toggle('snapped', !!targetId && ok);
  }

  function drawTemp() {
    const A = geom(temp.fromId);
    if (!A) return;
    const T = temp.targetId && temp.ok ? geom(temp.targetId) : null;
    const B = T || { cx: temp.x, cy: temp.y, a: 0, b: 0 };
    stepMid(temp, A, B);
    const s = strandGeometry(A, B, temp.mid, { to: !!T }, temp.style, temp.width);
    temp.goo.setAttribute('d', s ? s.d : '');
    temp.heads.setAttribute('d', s ? s.arrows : '');
    temp.tip.setAttribute('cx', temp.x);
    temp.tip.setAttribute('cy', temp.y);
    temp.tip.style.display = T ? 'none' : '';
  }

  function endTemp() {
    if (!temp) return;
    temp.g.remove();
    temp = null;
  }

  const unsubscribe = onFrame(frame);

  return {
    render,
    startTemp,
    moveTemp,
    endTemp,
    // For tests: the drawn path of a line ('' if hidden).
    pathOf: id => (views.get(id) ? views.get(id).d : null),
    dispose() { unsubscribe(); svg.remove(); labels.remove(); ctls.remove(); }
  };
}

function ctlButton(cls, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link-ctl ' + cls;
  b.dataset.noGesture = '';
  b.addEventListener('click', e => { e.stopPropagation(); fn(); });
  return b;
}

function place(el, p) {
  el.style.left = Math.round(p.x) + 'px';
  el.style.top = Math.round(p.y) + 'px';
}

// Average of two #rrggbb colours (for the label's text colour).
function mix(a, b) {
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a;
  const n = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = i => Math.round((n(a, i) + n(b, i)) / 2).toString(16).padStart(2, '0');
  return '#' + c(0) + c(1) + c(2);
}
