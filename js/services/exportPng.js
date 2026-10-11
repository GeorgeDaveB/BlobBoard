// Export picture (R4, C11; phase 7): draws the board you're looking at onto
// an off-screen canvas from the data — background dots, lines + arrowheads +
// labels, blobs, cards with pictures, shapes, free text, titles, notes, tag
// chips, inside-item dots + badge, done ticks — the same way the screen does
// (groups shown closed). Drawing from the data is exact and works offline.
//
// scene = { view: { x, y, z }, width, height, items: [...], links: [...] }
// (board.exportScene builds it).
import { shapePath } from './shapes.js';
import { textColorFor } from './color.js';

const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';
const BG = '#f7f4ef', DOT = '#ddd6cb', INK = '#2b2a28';

export function drawScene(scene, scale = 2) {
  const W = Math.max(1, Math.round(scene.width * scale)), H = Math.max(1, Math.round(scene.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const { x: vx, y: vy, z } = scene.view;

  // Background + dot grid (screen space).
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  const step = 24 * z * scale;
  if (step >= 6) {
    g.fillStyle = DOT;
    const ox = ((vx * scale) % step + step) % step, oy = ((vy * scale) % step + step) % step;
    for (let x = ox; x < W; x += step) for (let y = oy; y < H; y += step) { g.beginPath(); g.arc(x, y, 1.1 * scale, 0, Math.PI * 2); g.fill(); }
  }

  // World space from here on.
  g.setTransform(scale * z, 0, 0, scale * z, scale * vx, scale * vy);
  for (const ln of scene.links) drawLine(g, ln);
  for (const it of scene.items) drawItem(g, it);
  for (const ln of scene.links) if (ln.label && ln.labelAt) drawLabel(g, ln);
  return canvas;
}

function drawLine(g, ln) {
  g.save();
  g.globalAlpha = ln.faded ? 0.2 : 0.92;
  let fill = ln.c0 || '#999';
  if (ln.c0 && ln.c1 && ln.c0 !== ln.c1 && (ln.x1 !== ln.x2 || ln.y1 !== ln.y2)) {
    fill = g.createLinearGradient(ln.x1, ln.y1, ln.x2, ln.y2);
    fill.addColorStop(0, ln.c0);
    fill.addColorStop(1, ln.c1);
  }
  g.fillStyle = fill;
  g.fill(new Path2D(ln.d));
  if (ln.arrows) g.fill(new Path2D(ln.arrows));
  g.restore();
}

function drawLabel(g, ln) {
  g.save();
  g.globalAlpha = ln.faded ? 0.2 : 1;
  g.font = '600 12px ' + FONT;
  const w = Math.min(220, g.measureText(ln.label).width) + 18, h = 22;
  const x = ln.labelAt.x - w / 2, y = ln.labelAt.y - h / 2;
  roundRect(g, x, y, w, h, h / 2, h / 2);
  let bg = ln.c0 || '#999';
  if (ln.c1 && ln.c1 !== ln.c0) { bg = g.createLinearGradient(x, 0, x + w, 0); bg.addColorStop(0, ln.c0); bg.addColorStop(1, ln.c1); }
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = '#fff';
  g.stroke();
  g.fillStyle = textColorFor(ln.c0 || '#999');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(clip(g, ln.label, 220), ln.labelAt.x, ln.labelAt.y + 0.5);
  g.restore();
}

// Rounded rectangle with elliptical corners (rx, ry) — rx = w/2, ry = h/2 is an ellipse.
function roundRect(g, x, y, w, h, rx, ry) {
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  g.beginPath();
  g.moveTo(x + rx, y);
  g.lineTo(x + w - rx, y);
  g.ellipse(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
  g.lineTo(x + w, y + h - ry);
  g.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2);
  g.lineTo(x + rx, y + h);
  g.ellipse(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI);
  g.lineTo(x, y + ry);
  g.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
  g.closePath();
}

function clip(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

// Word wrap into at most `lines` lines (last one ends with … if cut).
export function wrap(g, text, max, lines) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (g.measureText(next).width <= max || !line) line = next;
      else { out.push(line); line = word; }
      if (out.length >= lines) break;
    }
    if (out.length >= lines) break;
    out.push(line);
  }
  if (out.length > lines) out.length = lines;
  const joined = out.join(' ');
  const all = String(text || '').replace(/\s+/g, ' ').trim();
  if (out.length && joined.length < all.length) out[out.length - 1] = clip(g, out[out.length - 1] + '…', max);
  return out.map(l => clip(g, l, max));
}

function drawChips(g, tags, cx, y, maxW) {
  if (!tags.length) return 0;
  g.font = '600 11px ' + FONT;
  const shown = tags.slice(0, 3).map(t => ({ text: clip(g, t.name, 96), color: t.color }));
  if (tags.length > 3) shown.push({ text: '+' + (tags.length - 3), color: '#e7e1d8' });
  const widths = shown.map(c => g.measureText(c.text).width + 16);
  let total = widths.reduce((s, w) => s + w, 0) + 4 * (shown.length - 1);
  let x = cx - Math.min(total, maxW) / 2;
  shown.forEach((c, i) => {
    roundRect(g, x, y, widths[i], 18, 9, 9);
    g.fillStyle = c.color;
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(255,255,255,.75)';
    g.stroke();
    g.fillStyle = textColorFor(c.color);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(c.text, x + widths[i] / 2, y + 9.5);
    x += widths[i] + 4;
  });
  return 22;
}

function drawItem(g, it) {
  g.save();
  g.globalAlpha = it.faded ? 0.2 : 1;
  if (it.kind === 'text') { drawText(g, it); g.restore(); return; }
  const { x, y, w, h } = it;
  const cx = x + w / 2;
  if (it.kind === 'shape') {
    g.save();
    g.translate(x, y);
    g.scale(w / 100, h / 100);
    g.shadowColor = 'rgba(40,30,20,.16)';
    g.shadowBlur = 6;
    g.shadowOffsetY = 2;
    g.fillStyle = it.color;
    g.fill(new Path2D(shapePath(it.shape)));
    g.restore();
    g.fillStyle = textColorFor(it.color);
    g.font = '650 15px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = wrap(g, it.title || 'Untitled', w * (it.shape === 'triangle' ? 0.55 : 0.75), 2);
    const top = y + h / 2 + (it.shape === 'triangle' ? h * 0.15 : 0) - (lines.length - 1) * 9;
    lines.forEach((l, i) => g.fillText(l, cx, top + i * 18));
    g.restore();
    return;
  }
  // Blob or card: the outline (rd 1 = ellipse … lower = rounded rectangle).
  const k = Math.max(0.2, it.rd == null ? 1 : it.rd);
  const outline = () => roundRect(g, x, y, w, h, (w / 2) * k, (h / 2) * k);
  if (it.done) g.globalAlpha *= 0.55;
  g.save();
  outline();
  g.shadowColor = 'rgba(40,30,20,.14)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 3;
  g.fillStyle = it.color;
  g.fill();
  g.restore();
  const ink = textColorFor(it.color);
  let cursor;
  if (it.card && it.img && it.img.naturalWidth) {
    // Picture across the top, title on a dark pill over its bottom edge.
    const ph = Math.min(h, w * it.aspect);
    g.save();
    outline();
    g.clip();
    const iw = it.img.naturalWidth, ih = it.img.naturalHeight;
    const s = Math.max(w / iw, ph / ih);
    g.drawImage(it.img, (iw - w / s) / 2, (ih - ph / s) / 2, w / s, ph / s, x, y, w, ph);
    g.restore();
    g.font = '650 14px ' + FONT;
    const t = clip(g, it.title || 'Untitled', w - 36);
    const tw = g.measureText(t).width + 20;
    roundRect(g, cx - tw / 2, y + ph - 34, tw, 26, 10, 10);
    g.fillStyle = 'rgba(20,16,12,.62)';
    g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, cx, y + ph - 20.5);
    cursor = y + ph + 8;
    cursor += drawChips(g, it.tags, cx, cursor, w - 20);
  } else {
    // Title, chips and up to 3 lines of notes, centred in the outline.
    g.font = '650 15px ' + FONT;
    const titleLines = wrap(g, it.title || 'Untitled', w * 0.78, 2);
    g.font = '13px ' + FONT;
    const noteLines = it.notes ? wrap(g, it.notes, w * 0.7, 3) : [];
    const chipH = it.tags.length ? 24 : 0;
    const blockH = titleLines.length * 19 + chipH + (noteLines.length ? 6 + noteLines.length * 17.5 : 0);
    cursor = y + h / 2 - blockH / 2;
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.font = (it.title ? '' : 'italic ') + '650 15px ' + FONT;
    if (!it.title) g.globalAlpha *= 0.55;
    titleLines.forEach(l => { g.fillText(l, cx, cursor); cursor += 19; });
    if (!it.title) g.globalAlpha /= 0.55;
    if (chipH) { drawChips(g, it.tags, cx, cursor + 3, w * 0.9); cursor += chipH; }
    if (noteLines.length) {
      cursor += 6;
      g.font = '13px ' + FONT;
      g.globalAlpha *= 0.85;
      g.fillStyle = ink;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      noteLines.forEach(l => { g.fillText(l, cx, cursor); cursor += 17.5; });
    }
  }
  if (it.card && it.notes && it.img) {
    g.font = '13px ' + FONT;
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    wrap(g, it.notes, w - 28, 3).forEach(l => { g.fillText(l, cx, cursor); cursor += 17.5; });
  }
  g.restore();
  g.save();
  g.globalAlpha = it.faded ? 0.2 : 1;
  if (it.done) {
    g.beginPath();
    g.arc(x + w * 0.14 + 12, y + h * 0.03 + 12, 12, 0, Math.PI * 2);
    g.fillStyle = INK;
    g.fill();
    g.fillStyle = '#fff';
    g.font = '700 14px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('✓', x + w * 0.14 + 12, y + h * 0.03 + 12.5);
  }
  // Collapsed group: up to 6 dots (2 rows x 3) + count badge, under it.
  if (it.kidCount) {
    const sx = cx - 31, sy = y + h + 8;
    it.kids.forEach((c, i) => {
      g.beginPath();
      g.ellipse(sx + (i % 3) * 18 + 7, sy + Math.floor(i / 3) * 18 + 7, 7, 7, 0, 0, Math.PI * 2);
      g.fillStyle = c;
      g.fill();
    });
    const text = it.kidCount <= 6 ? String(it.kidCount) : '6+';
    g.font = '700 12px ' + FONT;
    const bw = Math.max(22, g.measureText(text).width + 12);
    roundRect(g, sx + 58, sy - 4, bw, 22, 11, 11);
    g.fillStyle = INK;
    g.fill();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, sx + 58 + bw / 2, sy + 7.5);
  }
  g.restore();
}

// Free text: headings bold and larger, list items with bullets, wrapped at its width.
function drawText(g, it) {
  const blocks = textBlocks(it.notesHtml, it.notes);
  let y = it.y + 4;
  g.fillStyle = it.color || INK;
  g.textAlign = 'left';
  g.textBaseline = 'top';
  const max = Math.max(20, it.w - 12);
  for (const b of blocks) {
    const size = b.heading ? 19.5 : 15;
    g.font = (b.bold || b.heading ? '700 ' : '') + (b.italic ? 'italic ' : '') + size + 'px ' + FONT;
    const indent = b.bullet ? 18 : 0;
    const lines = wrap(g, b.text, max - indent, 50);
    lines.forEach((l, i) => {
      if (i === 0 && b.bullet) g.fillText(b.bullet, it.x + 6, y);
      g.fillText(l, it.x + 6 + indent, y);
      y += size * 1.4;
    });
    if (!lines.length) y += size * 1.4;
  }
}

// HTML (sanitized subset) -> [{ text, heading, bullet, bold, italic }].
export function textBlocks(html, plain) {
  if (!html) return String(plain || '').split('\n').map(text => ({ text }));
  const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
  const out = [];
  const walk = (node, ctx) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.textContent.trim()) push(n.textContent, ctx); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') { out.push({ text: '' }); continue; }
      if (tag === 'h3') { out.push({ text: n.textContent, heading: true }); continue; }
      if (tag === 'ul' || tag === 'ol') {
        [...n.children].forEach((li, i) => out.push({ text: li.textContent, bullet: tag === 'ol' ? (i + 1) + '.' : '•' }));
        continue;
      }
      if (tag === 'b' || tag === 'i' || tag === 'u') { walk(n, { ...ctx, bold: ctx.bold || tag === 'b', italic: ctx.italic || tag === 'i', inline: true }); continue; }
      walk(n, { ...ctx, block: true });
      if (tag === 'div') out.push({ text: '', sep: true });
    }
  };
  const push = (text, ctx) => {
    const last = out[out.length - 1];
    if (last && !last.sep && !last.heading && !last.bullet && ctx.inline !== undefined && last.open) last.text += text;
    else out.push({ text, bold: !!ctx.bold, italic: !!ctx.italic, open: true });
  };
  walk(doc.body.firstChild, {});
  return out.filter(b => !b.sep).map(({ open, sep, ...b }) => b);
}
