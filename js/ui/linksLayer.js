// Lines between blobs (R21–R23), drawn as "gooey strings" in an SVG layer
// under the items. Each string's middle is a damped spring, so it lags,
// bends and wobbles when its blobs move, and it thins as it is pulled
// longer (services/strand.js has the shape). Updated from the physics
// frame loop; nothing is written to the DOM while nothing moves.
//
// Selected line: white edge, + / − near each end (add / remove that
// arrowhead) and × in the middle (delete). Drawing a new line shows a
// temporary string from the blob to the finger.
import { strandGeometry, restMid } from '../services/strand.js';
import { onFrame } from './physics.js';

const NS = 'http://www.w3.org/2000/svg';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const MID_SPRING = [0.10, 0.80]; // [stiffness, damping] of the string's middle

// geom(id) -> { cx, cy, a, b, rd } (the blob as drawn now) or null if it isn't
// on this board. color(id) -> its colour.
export function createLinksLayer({ world, before, store, geom, color, onToggleArrow, onDelete }) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'links-layer');
  svg.setAttribute('width', '1');
  svg.setAttribute('height', '1');
  svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS(NS, 'defs');
  svg.append(defs);
  world.insertBefore(svg, before);

  // Controls of the selected line (HTML, above the items).
  const ctls = document.createElement('div');
  ctls.className = 'link-ctls';
  ctls.hidden = true;
  const btnFrom = ctlButton('link-end', () => onToggleArrow(ctls.dataset.link, 'from'));
  const btnDel = ctlButton('link-del', () => onDelete(ctls.dataset.link));
  btnDel.textContent = '×';
  btnDel.setAttribute('aria-label', 'Delete line');
  const btnTo = ctlButton('link-end', () => onToggleArrow(ctls.dataset.link, 'to'));
  ctls.append(btnFrom, btnDel, btnTo);
  world.append(ctls);

  const views = new Map(); // linkId -> { g, goo, hit, grad, stops, mid, d, gradKey }
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
    return { g, goo, heads, hit, grad, stops: [s0, s1], mid: null, d: '', gradKey: '', colors: '' };
  }

  function dropView(id) {
    const v = views.get(id);
    if (!v) return;
    v.g.remove();
    v.grad.remove();
    views.delete(id);
  }

  // Which lines exist (both ends on this board) and their colours/selection.
  function render() {
    const doc = store.canvas();
    const seen = new Set();
    for (const ln of Object.values(doc ? doc.links : {})) {
      if (!geom(ln.from) || !geom(ln.to)) continue;
      seen.add(ln.id);
      const v = views.get(ln.id) || views.set(ln.id, makeView(ln.id)).get(ln.id);
      const colors = color(ln.from) + color(ln.to);
      if (v.colors !== colors) {
        v.stops[0].setAttribute('stop-color', color(ln.from));
        v.stops[1].setAttribute('stop-color', color(ln.to));
        v.colors = colors;
      }
      v.g.classList.toggle('selected', store.ui.selectedLinkId === ln.id);
      v.d = ''; // arrows may have changed: redraw next frame
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

  // Middle of the string: springs towards its resting place.
  function stepMid(state, A, B) {
    const rest = restMid(A, B);
    if (!state.mid || REDUCED.matches) {
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
      const s = strandGeometry(A, B, v.mid, { from: ln.arrowFrom, to: ln.arrowTo });
      const d = s ? s.d + '|' + s.arrows : '';
      if (d !== v.d) {
        v.goo.setAttribute('d', s ? s.d : '');
        v.heads.setAttribute('d', s ? s.arrows : '');
        v.hit.setAttribute('d', s ? s.spine : '');
        v.d = d;
      }
      if (s) {
        const gk = Math.round(A.cx) + ',' + Math.round(A.cy) + ',' + Math.round(B.cx) + ',' + Math.round(B.cy);
        if (gk !== v.gradKey) {
          v.grad.setAttribute('x1', s.a.x); v.grad.setAttribute('y1', s.a.y);
          v.grad.setAttribute('x2', s.b.x); v.grad.setAttribute('y2', s.b.y);
          v.gradKey = gk;
        }
        if (!ctls.hidden && ctls.dataset.link === id) placeCtls(s);
      } else if (!ctls.hidden && ctls.dataset.link === id) {
        ctls.style.visibility = 'hidden';
      }
    }
    if (temp) drawTemp();
  }

  function placeCtls(s) {
    ctls.style.visibility = '';
    const tEnd = Math.min(0.32, Math.max(0.14, 36 / Math.max(1, s.len)));
    place(btnFrom, s.at(tEnd));
    place(btnDel, s.at(0.5));
    place(btnTo, s.at(1 - tEnd));
  }

  // ---- drawing a new line ------------------------------------------------------
  // from: item id; then moveTemp with the pointer in board coordinates and
  // the target (id + ok) under it, if any.
  function startTemp(fromId) {
    endTemp();
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'link temp');
    const goo = document.createElementNS(NS, 'path');
    goo.setAttribute('class', 'link-goo');
    goo.setAttribute('fill', color(fromId));
    const heads = document.createElementNS(NS, 'path');
    heads.setAttribute('class', 'link-heads');
    heads.setAttribute('fill', color(fromId));
    const tip = document.createElementNS(NS, 'circle');
    tip.setAttribute('class', 'link-tip');
    tip.setAttribute('r', '7');
    tip.setAttribute('fill', color(fromId));
    g.append(goo, heads, tip);
    svg.append(g);
    temp = { fromId, g, goo, heads, tip, x: 0, y: 0, targetId: null, ok: false, mid: null };
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
    const s = strandGeometry(A, B, temp.mid, { to: !!T });
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
    dispose() { unsubscribe(); svg.remove(); ctls.remove(); }
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
