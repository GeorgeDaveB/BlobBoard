// Style + colour choices for lines, used twice: ⚙ (the canvas default) and
// the line editor (one line; adds a "Default" choice = follow the canvas).
import { createColorPicker } from './colorPicker.js';
import { isHex } from '../services/color.js';

const STYLES = [['goo', 'Gooey'], ['straight', 'Straight']];
const COLORS = [['gradient', 'Gradient'], ['start', 'Start blob'], ['end', 'End blob'], ['custom', 'Custom']];
const NAMES = { goo: 'Gooey', straight: 'Straight', gradient: 'Gradient', start: 'Start blob', end: 'End blob' };

// onChange(patch): patch = { style } or { color } (null = default).
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
  el.append(styleRow.wrap, colorRow.wrap, picker.el);

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
    // value: { style, color } (null = default); defaults: the canvas values,
    // shown on the Default chips.
    set(value, defaults) {
      mark(styleRow, value.style == null ? 'default' : value.style);
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
