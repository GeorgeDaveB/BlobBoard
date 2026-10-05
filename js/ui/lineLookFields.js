// Style + colour + thickness choices for lines, used twice: ⚙ (the canvas default) and
// the line editor (one line; adds a "Default" choice = follow the canvas).
import { createColorPicker } from './colorPicker.js';
import { isHex } from '../services/color.js';

const STYLES = [['goo', 'Gooey'], ['straight', 'Straight']];
const COLORS = [['gradient', 'Gradient'], ['start', 'Start blob'], ['end', 'End blob'], ['custom', 'Custom']];
const NAMES = { goo: 'Gooey', straight: 'Straight', gradient: 'Gradient', start: 'Start blob', end: 'End blob' };
const W_MIN = 0.3, W_MAX = 3, W_STEP = 0.1; // thickness slider (× normal width)
const fmtWidth = w => (Math.round(w * 10) / 10).toFixed(1) + '×';

// onChange(patch): patch = { style } | { color } | { width } (null = default).
export function createLineLookFields({ withDefault, onChange }) {
  const el = document.createElement('div');
  el.className = 'line-look';
  let customOpen = false; // "Custom" tapped, no colour picked yet

  const styleRow = chips('Line style', withDefault ? [['default', 'Default'], ...STYLES] : STYLES, v => {
    onChange({ style: v === 'default' ? null : v });
  });
  const colorRow = chips('Line colour', withDefault ? [['default', 'Default'], ...COLORS] : COLORS, v => {
    customOpen = v === 'custom';
    if (customOpen) {
      picker.el.hidden = false;
      mark(colorRow, 'custom');
      return;
    }
    picker.el.hidden = true;
    onChange({ color: v === 'default' ? null : v });
  });
  const picker = createColorPicker({ onChange: hex => onChange({ color: hex }) });
  picker.el.hidden = true;
  picker.el.classList.add('line-look-picker');
  // Thickness: a slider (0.3×–3× the normal width). In the line editor a
  // "Default" chip next to it means "follow the canvas"; dragging the
  // slider gives the line its own thickness.
  const widthWrap = document.createElement('div');
  widthWrap.className = 'field';
  const widthTop = document.createElement('div');
  widthTop.className = 'range-top';
  const widthLabel = document.createElement('div');
  widthLabel.className = 'field-label';
  widthLabel.textContent = 'Thickness';
  const widthValue = document.createElement('output');
  widthValue.className = 'range-value';
  widthTop.append(widthLabel, widthValue);
  const widthLine = document.createElement('div');
  widthLine.className = 'range-line';
  const widthSlider = document.createElement('input');
  widthSlider.type = 'range';
  widthSlider.min = String(W_MIN);
  widthSlider.max = String(W_MAX);
  widthSlider.step = String(W_STEP);
  widthSlider.setAttribute('aria-label', 'Line thickness');
  widthLine.append(widthSlider);
  let widthDefault = null;
  if (withDefault) {
    widthDefault = document.createElement('button');
    widthDefault.type = 'button';
    widthDefault.className = 'seg-btn';
    widthDefault.textContent = 'Default';
    widthDefault.addEventListener('click', () => onChange({ width: null }));
    widthLine.append(widthDefault);
  }
  widthWrap.append(widthTop, widthLine);
  widthSlider.addEventListener('input', () => {
    const w = Number(widthSlider.value);
    widthValue.textContent = fmtWidth(w);
    if (widthDefault) widthDefault.classList.remove('on');
    onChange({ width: w });
  });
  el.append(styleRow.wrap, colorRow.wrap, picker.el, widthWrap);

  function chips(label, options, pick) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const l = document.createElement('div');
    l.className = 'field-label';
    l.textContent = label;
    const row = document.createElement('div');
    row.className = 'seg';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', label);
    const buttons = options.map(([value, text]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn';
      b.dataset.value = value;
      b.textContent = text;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => pick(value));
      row.append(b);
      return b;
    });
    wrap.append(l, row);
    return { wrap, buttons };
  }

  function mark(row, value) {
    for (const b of row.buttons) {
      const on = b.dataset.value === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }

  return {
    el,
    // value: { style, color, width } (null = default); defaults: the canvas values,
    // shown on the Default chips.
    set(value, defaults) {
      mark(styleRow, value.style == null ? 'default' : value.style);
      // Thickness: the line's own value, or the default (shown, chip on).
      const w = value.width == null ? (defaults && defaults.width) || 1 : value.width;
      if (document.activeElement !== widthSlider) widthSlider.value = String(w);
      widthValue.textContent = fmtWidth(w) + (value.width == null && widthDefault ? ' (default)' : '');
      if (widthDefault) widthDefault.classList.toggle('on', value.width == null);
      const c = value.color;
      mark(colorRow, isHex(c) || customOpen ? 'custom' : c == null ? 'default' : c);
      if (isHex(c)) { picker.setValue(c); picker.el.hidden = false; }
      else picker.el.hidden = !customOpen;
      if (defaults) {
        const d = (row, v) => { const b = row.buttons.find(x => x.dataset.value === 'default'); if (b) b.textContent = 'Default (' + (isHex(v) ? 'custom' : NAMES[v] || v) + ')'; };
        d(styleRow, defaults.style);
        d(colorRow, defaults.color);
      }
    },
    // Fresh start (each time a sheet opens).
    reset() { customOpen = false; picker.collapse(); }
  };
}
