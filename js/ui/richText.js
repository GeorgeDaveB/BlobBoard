// Rich text for descriptions (R32): bold, italic, underline, heading,
// bullet lists (with a bullet type) and numbered lists.
//
// Stored as a small, sanitized HTML subset in `item.notesHtml`; `item.notes`
// keeps the plain text (sizing, search, PNG export, older versions). Only
// these tags survive: b i u h3 ul ol li div br — no attributes except the
// bullet type on <ul data-b="…">. Everything else is unwrapped (its text
// kept), so pasted or synced content can never carry scripts, links or
// styles. Sanitized when saved AND every time it is shown.

export const BULLETS = [
  { id: 'dot', sym: '•' },
  { id: 'circle', sym: '◦' },
  { id: 'square', sym: '▪' },
  { id: 'dash', sym: '–' },
  { id: 'arrow', sym: '→' },
  { id: 'star', sym: '★' },
  { id: 'tick', sym: '✓' }
];
const BULLET_IDS = new Set(BULLETS.map(b => b.id));
export const MAX_HTML = 20000;

const KEEP = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', UL: 'ul', OL: 'ol', LI: 'li', BR: 'br', DIV: 'div', P: 'div', H1: 'h3', H2: 'h3', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3' };
const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK']);

// Safe HTML subset from any HTML string.
export function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '').slice(0, MAX_HTML * 2);
  const out = document.createElement('div');
  copy(tpl.content, out, false);
  // Tidy: no empty trailing breaks.
  let s = out.innerHTML.replace(/(<br>)+$/, '');
  if (s.length > MAX_HTML) s = s.slice(0, MAX_HTML);
  return s;
}

function copy(from, to, inList) {
  for (const n of [...from.childNodes]) {
    if (n.nodeType === 3) { to.append(document.createTextNode(n.nodeValue)); continue; }
    if (n.nodeType !== 1 || DROP.has(n.tagName)) continue;
    const tag = KEEP[n.tagName];
    // A list item outside a list becomes a plain line.
    const name = tag === 'li' && !inList ? 'div' : tag;
    if (!name) { copy(n, to, inList); continue; } // unwrap unknown tags
    // A heading can't hold lists or blocks: keep those, drop the heading.
    if (name === 'h3' && n.querySelector('ul, ol, div, p, li, h1, h2, h3, h4, h5, h6')) { copy(n, to, inList); continue; }
    const el = document.createElement(name);
    if (name === 'ul') {
      const b = n.getAttribute('data-b');
      if (BULLET_IDS.has(b) && b !== 'dot') el.setAttribute('data-b', b);
    }
    to.append(el);
    if (name !== 'br') copy(n, el, name === 'ul' || name === 'ol');
  }
}

// Plain text (with line breaks) -> HTML, for descriptions written before
// rich text existed.
export function plainToHtml(text) {
  const esc = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\n/g, '<br>');
}

// The HTML to show for an item (rich if present, else its plain notes).
// Cached: the board re-renders often and parsing HTML each time is costly.
const shown = new Map();
export function notesHtmlOf(item) {
  if (!item.notesHtml) return plainToHtml(item.notes);
  let html = shown.get(item.notesHtml);
  if (html === undefined) {
    html = sanitizeHtml(item.notesHtml);
    if (shown.size > 400) shown.clear();
    shown.set(item.notesHtml, html);
  }
  return html;
}

// Plain text of an HTML description: one line per block / list item, with
// bullet symbols, for sizing and search.
export function htmlToPlain(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = sanitizeHtml(html);
  const lines = [];
  let cur = '';
  // Block ends add a line only if it has text; a <br> always ends a line
  // (so an intentionally empty line stays).
  const flush = (force) => { if (cur.trim() || (force && lines.length)) lines.push(cur.replace(/\s+$/, '')); cur = ''; };
  (function walk(node, list) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { cur += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (t === 'BR') { flush(true); continue; }
      if (t === 'UL' || t === 'OL') {
        flush();
        let i = 0;
        for (const li of n.children) {
          const sym = t === 'OL' ? (++i) + '.' : (BULLETS.find(b => b.id === (n.getAttribute('data-b') || 'dot')) || BULLETS[0]).sym;
          cur += sym + ' ';
          walk(li, true);
          flush();
        }
        continue;
      }
      if (t === 'DIV' || t === 'H3' || t === 'LI') { flush(); walk(n, list); flush(); continue; }
      walk(n, list);
    }
  })(tpl.content, false);
  flush();
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---- editor --------------------------------------------------------------------
// A toolbar + a contenteditable box. onInput(html, text) after every change.
// compact: smaller toolbar (inside a blob).
export function createRichEditor({ placeholder = '', compact = false, onInput }) {
  const el = document.createElement('div');
  el.className = 'rich' + (compact ? ' rich-compact' : '');
  const bar = document.createElement('div');
  bar.className = 'rich-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Text style');
  const box = document.createElement('div');
  box.className = 'rich-box rich-text';
  box.contentEditable = 'true';
  box.dataset.placeholder = placeholder;
  box.setAttribute('role', 'textbox');
  box.setAttribute('aria-multiline', 'true');
  box.setAttribute('aria-label', placeholder || 'Description');
  el.append(bar, box);

  const btn = (label, html, run) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rich-btn';
    b.innerHTML = html;
    b.title = label;
    b.setAttribute('aria-label', label);
    // Keep the text selection: don't let the button take focus.
    b.addEventListener('pointerdown', e => e.preventDefault());
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); box.focus(); run(); changed(); });
    bar.append(b);
    return b;
  };
  // <b>/<i>/<u> tags rather than inline styles.
  const exec = (cmd, val) => { document.execCommand('styleWithCSS', false, false); return document.execCommand(cmd, false, val); };
  btn('Bold', '<b>B</b>', () => exec('bold'));
  btn('Italic', '<i>I</i>', () => exec('italic'));
  btn('Underline', '<u>U</u>', () => exec('underline'));
  btn('Heading', 'H', () => exec('formatBlock', blockOf('H3') ? '<div>' : '<h3>'));
  // A heading can't be a list item: it turns into normal text first.
  const list = cmd => { if (blockOf('H3')) exec('formatBlock', '<div>'); exec(cmd); };
  btn('Bullet list', '•≡', () => list('insertUnorderedList'));
  btn('Numbered list', '1.', () => list('insertOrderedList'));
  const typeBtn = btn('Bullet type', '•▾', () => cycleBullet());

  // The nearest element with this tag around the cursor, inside the box.
  function blockOf(tag) {
    const sel = getSelection();
    let n = sel && sel.anchorNode;
    while (n && n !== box) {
      if (n.nodeType === 1 && n.tagName === tag) return n;
      n = n.parentNode;
    }
    return null;
  }

  // Bullet type: the list under the cursor gets the next bullet; if the
  // cursor isn't in a bullet list, it becomes one first.
  function cycleBullet() {
    let ul = blockOf('UL');
    if (!ul) { list('insertUnorderedList'); ul = blockOf('UL'); }
    if (!ul) return;
    const cur = ul.getAttribute('data-b') || 'dot';
    const next = BULLETS[(BULLETS.findIndex(b => b.id === cur) + 1) % BULLETS.length];
    if (next.id === 'dot') ul.removeAttribute('data-b'); else ul.setAttribute('data-b', next.id);
    showType();
  }

  function showType() {
    const ul = blockOf('UL');
    const id = (ul && ul.getAttribute('data-b')) || 'dot';
    typeBtn.firstChild.textContent = (BULLETS.find(b => b.id === id) || BULLETS[0]).sym + '▾';
  }

  function changed() {
    const html = sanitizeHtml(box.innerHTML);
    box.classList.toggle('empty', !box.textContent.trim() && !box.querySelector('li'));
    if (onInput) onInput(html, htmlToPlain(html));
  }

  box.addEventListener('input', changed);
  box.addEventListener('keyup', showType);
  box.addEventListener('mouseup', showType);
  // Paste as plain text (no foreign styles, links or pictures).
  box.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    exec('insertText', text);
  });
  // Ctrl+B / I / U work natively; keep Escape for the caller.

  return {
    el,
    box,
    setHtml(html) {
      box.innerHTML = sanitizeHtml(html);
      box.classList.toggle('empty', !box.textContent.trim() && !box.querySelector('li'));
    },
    focus() {
      box.focus();
      // Cursor at the end.
      const r = document.createRange();
      r.selectNodeContents(box);
      r.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    },
    get isFocused() { return document.activeElement === box; }
  };
}
