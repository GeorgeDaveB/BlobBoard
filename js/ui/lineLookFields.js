// Style + colour + thickness choices for lines, used twice: ⚙ (the canvas default) and
// the line editor (one line; adds a "Default" choice = follow the canvas).
import { createColorPicker } from './colorPicker.js';
import { isHex } from '../services/color.js';

const STYLES = [['goo', 'Gooey'], ['straight', 'Straight']];
const COLORS = [['gradient', 'Gradient'], ['start', 'Start blob'], ['end', 'End blob'], ['custom', 'Custom']];
const WIDTHS = [['0.6', 'Thin'], ['1', 'Normal'], ['1.6', 'Thick'], ['2.4', 'Extra thick']];
const NAMES = { goo: 'Gooey', straight: 'Straight', gradient: 'Gradient', start: 'Start blob', end: 'End blob', '0.6': 'Thin', '1': 'Normal', '1.6': 'Thick', '2.4': 'Extra thick' };

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
  const widthRow = chips('Thickness', withDefault ? [['default', 'Default'], ...WIDTHS] : WIDTHS, v => {
    onChange({ width: v === 'default' ? null : Number(v) });
  });
  el.append(styleRow.wrap, colorRow.wrap, picker.el, widthRow.wrap);

  // The chip closest to a stored thickness (e.g. 1.5 -> '1.6').
  function nearestWidth(w) {
    let best = '1', dist = Infinity;
    for (const [v] of WIDTHS) {
      const x = Math.abs(Number(v) - (Number(w) || 1));
      if (x < dist) { dist = x; best = v; }
    }
    return best;
  }

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
      mark(widthRow, value.width == null ? 'default' : nearestWidth(value.width));
      const c = value.color;
      mark(colorRow, isHex(c) || customOpen ? 'custom' : c == null ? 'default' : c);
      if (isHex(c)) { picker.setValue(c); picker.el.hidden = false; }
      else picker.el.hidden = !customOpen;
      if (defaults) {
        const d = (row, v) => { const b = row.buttons.find(x => x.dataset.value === 'default'); if (b) b.textContent = 'Default (' + (isHex(v) ? 'custom' : NAMES[v] || v) + ')'; };
        d(styleRow, defaults.style);
        d(colorRow, defaults.color);
        d(widthRow, nearestWidth(defaults.width));
      }
    },
    // Fresh start (each time a sheet opens).
    reset() { customOpen = false; picker.collapse(); }
  };
}
