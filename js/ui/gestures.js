// One state machine for every finger and mouse on the board (design §8.5).
//
//  idle ─down on item─► pressing ─moved─► drag ─up─► dragEnd
//                         │ 500 ms still ─► holding ─moved─► drag
//                         │                    └─up─► holdEnd(release) = edit
//                         └─up quickly─► tapItem
//  idle ─down on empty─► emptyPress ─moved─► pan ;  up quickly ─► tap / double-tap
//  idle ─down on ● dot─► link ─move─► linkMove ─up─► linkEnd (cancelled: linkCancel)
//  idle ─down on a line─► linePress ─moved─► pan ;  up quickly ─► tapLine
//  second finger at any point ─► pinch (an item drag / new line is cancelled first)

const MOVE_PX = 6;
const HOLD_MS = 500;
const DOUBLE_MS = 320;
const DOUBLE_PX = 24;

export function attachGestures(surface, h) {
  const pts = new Map();
  let mode = 'idle';
  let start = null;
  let last = null;
  let itemId = null;
  let timer = 0;
  let pinch = null;
  let lastTap = null;
  let lastType = 'mouse';
  let lineId = null;

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clearHold = () => { clearTimeout(timer); timer = 0; };
  const pair = () => {
    const [a, b] = [...pts.values()];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.max(1, dist(a, b)) };
  };

  surface.addEventListener('pointerdown', e => {
    lastType = e.pointerType;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const dot = e.target.closest('.item-link');
    if (!dot && e.target.closest('.item-ctl, [data-no-gesture]')) return;
    // A tray's background belongs to no item: ignore it (minis inside are fine).
    const trayEl = e.target.closest('.tray');
    const hitItem = e.target.closest('.item');
    if (trayEl && (!hitItem || !trayEl.contains(hitItem))) return;
    try { surface.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pts.size === 2) {
      clearHold();
      if (mode === 'drag') h.dragCancel(itemId);
      if (mode === 'holding') h.holdEnd(itemId, false);
      if (mode === 'pan') h.panEnd();
      if (mode === 'link') h.linkCancel();
      mode = 'pinch';
      pinch = pair();
      h.pinchStart();
      return;
    }
    if (pts.size > 2) return;

    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    last = { x: e.clientX, y: e.clientY };
    const itemEl = e.target.closest('.item');
    const hitLine = e.target.closest('.link-hit, .link-label');
    if (dot && itemEl) {
      itemId = itemEl.dataset.id;
      mode = 'link';
      h.linkStart(itemId, e.clientX, e.clientY);
    } else if (hitLine) {
      itemId = null;
      lineId = hitLine.dataset.link;
      mode = 'linePress';
    } else if (itemEl) {
      itemId = itemEl.dataset.id;
      mode = 'pressing';
      timer = setTimeout(() => {
        if (mode === 'pressing') {
          mode = 'holding';
          h.holdStart(itemId);
        }
      }, HOLD_MS);
    } else {
      itemId = null;
      mode = 'emptyPress';
    }
  });

  surface.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const p = { x: e.clientX, y: e.clientY };
    pts.set(e.pointerId, p);

    if (mode === 'pinch') {
      if (pts.size < 2) return;
      const now = pair();
      h.pinch(now.d / pinch.d, now.mid.x, now.mid.y, now.mid.x - pinch.mid.x, now.mid.y - pinch.mid.y);
      pinch = now;
      return;
    }
    if (!start || e.pointerId !== start.id) return;

    const moved = dist(start, p) > MOVE_PX;
    if ((mode === 'pressing' || mode === 'holding') && moved) {
      clearHold();
      if (mode === 'holding') h.holdEnd(itemId, false);
      mode = 'drag';
      h.dragStart(itemId, start.x, start.y);
    }
    if (mode === 'drag') {
      h.dragMove(itemId, p.x, p.y);
      return;
    }
    if (mode === 'link') {
      h.linkMove(p.x, p.y);
      return;
    }
    if ((mode === 'emptyPress' || mode === 'linePress') && moved) {
      mode = 'pan';
      h.panStart();
    }
    if (mode === 'pan') h.pan(p.x - last.x, p.y - last.y);
    last = p;
  });

  function end(e, cancelled) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);

    if (mode === 'pinch') {
      if (pts.size < 2) {
        h.pinchEnd();
        mode = pts.size ? 'ignore' : 'idle';
      }
      return;
    }
    if (mode === 'ignore') {
      if (!pts.size) mode = 'idle';
      return;
    }
    if (!start || e.pointerId !== start.id) return;
    clearHold();

    if (mode === 'pressing' && !cancelled) h.tapItem(itemId);
    else if (mode === 'holding') h.holdEnd(itemId, !cancelled);
    else if (mode === 'drag') cancelled ? h.dragCancel(itemId) : h.dragEnd(itemId, e.clientX, e.clientY);
    else if (mode === 'pan') h.panEnd();
    else if (mode === 'link') cancelled ? h.linkCancel() : h.linkEnd(e.clientX, e.clientY);
    else if (mode === 'linePress' && !cancelled) h.tapLine(lineId);
    else if (mode === 'emptyPress' && !cancelled) {
      const p = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      if (lastTap && p.t - lastTap.t < DOUBLE_MS && dist(p, lastTap) < DOUBLE_PX) {
        lastTap = null;
        h.doubleTapEmpty(p.x, p.y);
      } else {
        lastTap = p;
        h.tapEmpty();
      }
    }
    mode = 'idle';
    start = null;
    itemId = null;
    lineId = null;
  }

  surface.addEventListener('pointerup', e => end(e, false));
  surface.addEventListener('pointercancel', e => end(e, true));

  // Right-click edits on PC. On touch the browser's long-press menu is
  // blocked; our own hold timer handles long-press instead.
  surface.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (lastType !== 'mouse') return;
    const it = e.target.closest('.item');
    if (it) h.contextItem(it.dataset.id);
  });
}
