// 8 base swatches + "Custom": a square to drag in (saturation/brightness),
// a hue bar, and a hex field. Works with finger or mouse.
import { PALETTE, hexToHsv, hsvToHex, normalizeHex, hsvToRgb, rgbToHex } from '../services/color.js';

export function createColorPicker({ onChange }) {
  const root = document.createElement('div');
  root.className = 'cp';

  const row = document.createElement('div');
  row.className = 'cp-swatches';
  const swatches = PALETTE.map(p => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cp-swatch';
    b.style.backgroundColor = p.hex;
    b.setAttribute('aria-label', p.name);
    b.dataset.hex = p.hex;
    b.addEventListener('click', () => { set(p.hex); onChange(p.hex); });
    row.append(b);
    return b;
  });
  const custom = document.createElement('button');
  custom.type = 'button';
  custom.className = 'cp-swatch cp-custom';
  custom.setAttribute('aria-label', 'Custom colour');
  custom.addEventListener('click', () => { panel.hidden = !panel.hidden; custom.setAttribute('aria-expanded', String(!panel.hidden)); });
  row.append(custom);

  const panel = document.createElement('div');
  panel.className = 'cp-panel';
  panel.hidden = true;
  const sv = document.createElement('div');
  sv.className = 'cp-sv';
  const svThumb = document.createElement('div');
  svThumb.className = 'cp-thumb';
  sv.append(svThumb);
  const hue = document.createElement('div');
  hue.className = 'cp-hue';
  const hueThumb = document.createElement('div');
  hueThumb.className = 'cp-thumb';
  hue.append(hueThumb);
  const hexRow = document.createElement('div');
  hexRow.className = 'cp-hexrow';
  const preview = document.createElement('span');
  preview.className = 'cp-preview';
  const hexInput = document.createElement('input');
  hexInput.className = 'cp-hex';
  hexInput.maxLength = 7;
  hexInput.spellcheck = false;
  hexInput.setAttribute('aria-label', 'Hex colour');
  hexRow.append(preview, hexInput);
  panel.append(sv, hue, hexRow);
  root.append(row, panel);

  let hsv = { h: 0, s: 0.5, v: 1 };
  let hex = PALETTE[0].hex;

  function paint() {
    sv.style.setProperty('--hue', rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 })));
    svThumb.style.left = hsv.s * 100 + '%';
    svThumb.style.top = (1 - hsv.v) * 100 + '%';
    hueThumb.style.left = (hsv.h / 360) * 100 + '%';
    preview.style.backgroundColor = hex;
    if (document.activeElement !== hexInput) hexInput.value = hex;
    const inPalette = swatches.some(b => b.dataset.hex === hex);
    for (const b of swatches) b.classList.toggle('on', b.dataset.hex === hex);
    custom.classList.toggle('on', !inPalette);
    custom.style.setProperty('--custom', inPalette ? 'transparent' : hex);
  }

  function set(value, keepHsv) {
    hex = normalizeHex(value) || hex;
    if (!keepHsv) hsv = hexToHsv(hex);
    paint();
  }

  function dragArea(el, fn) {
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId);
      const move = ev => {
        const r = el.getBoundingClientRect();
        fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
           Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
        hex = hsvToHex(hsv);
        paint();
        onChange(hex);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      move(e);
    });
  }
  dragArea(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y; });
  dragArea(hue, x => { hsv.h = Math.min(359.9, x * 360); });

  hexInput.addEventListener('input', () => {
    const v = normalizeHex(hexInput.value);
    if (v && v.length === 7 && hexInput.value.replace('#', '').length === 6) {
      set(v);
      onChange(v);
    }
  });
  hexInput.addEventListener('blur', paint);

  return {
    el: root,
    setValue(value) { set(value); },
    collapse() { panel.hidden = true; }
  };
}
