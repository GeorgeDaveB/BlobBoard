// ⚙ Settings for the current canvas (saved with the canvas, so they sync):
// how an expanded item shows what's inside it, and how much a blob grows
// per item inside it (R30). Also shows the app version.
import { APP_VERSION } from '../version.js';
import { MAX_GROW } from './itemView.js';

let sliderSeq = 0;
const OPTIONS = [
  { value: 'tray', label: 'Tray below the blob', hint: 'Inside items float in a tray under the blob.' },
  { value: 'container', label: 'Inside the blob', hint: 'The blob opens into a container: title, description, and its items.' }
];

export function createSettingsSheet({ host, store, onRequestClose }) {
  const back = document.createElement('div');
  back.className = 'modal-back settings-back';
  back.hidden = true;
  const box = document.createElement('section');
  box.className = 'modal settings';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Canvas settings');

  const head = document.createElement('div');
  head.className = 'sheet-head';
  const h = document.createElement('h2');
  h.className = 'sheet-title';
  h.textContent = 'Settings';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'btn btn-primary';
  done.textContent = 'Done';
  head.append(h, done);

  const group = document.createElement('fieldset');
  group.className = 'choice-group';
  const legend = document.createElement('legend');
  legend.className = 'field-label';
  legend.textContent = 'Show inside items';
  group.append(legend);
  const radios = OPTIONS.map(o => {
    const label = document.createElement('label');
    label.className = 'choice';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'insideView';
    input.value = o.value;
    const text = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = o.label;
    const small = document.createElement('small');
    small.textContent = o.hint;
    text.append(strong, small);
    label.append(input, text);
    input.addEventListener('change', () => { if (input.checked) store.setCanvasSetting('insideView', o.value); });
    group.append(label);
    return input;
  });
  // Growth per inside item: 0 (never grows) … 3 blobs' worth of area each.
  const grow = document.createElement('div');
  grow.className = 'range-field';
  const growLabel = document.createElement('label');
  growLabel.className = 'field-label';
  growLabel.htmlFor = 'growth-range';
  growLabel.textContent = 'Growth per inside item';
  const growValue = document.createElement('output');
  growValue.className = 'range-value';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = 'growth-range';
  slider.min = '0';
  slider.max = '3';
  slider.step = '0.25';
  const growHint = document.createElement('small');
  growHint.className = 'range-hint';
  growHint.textContent = 'How much bigger a blob gets for each item inside it (max ' + MAX_GROW + '× its size). 0 = never grows.';
  const growTop = document.createElement('div');
  growTop.className = 'range-top';
  growTop.append(growLabel, growValue);
  grow.append(growTop, slider, growHint);
  const showGrow = v => {
    growValue.textContent = v === 0 ? 'off' : (v === 1 ? '1 blob' : v + ' blobs');
  };
  let sliderKey = null;
  slider.addEventListener('pointerdown', () => { sliderKey = 'growth:' + (++sliderSeq); });
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    showGrow(v);
    store.setCanvasSetting('growth', v, { coalesce: sliderKey || 'growth:' + (++sliderSeq) });
  });
  slider.addEventListener('change', () => { sliderKey = null; });

  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent = 'Saved with this canvas. · Version ' + APP_VERSION;

  box.append(head, group, grow, note);
  back.append(box);
  host.append(back);

  done.addEventListener('click', () => onRequestClose());
  back.addEventListener('click', e => { if (e.target === back) onRequestClose(); });

  // Shows the canvas's current values (also after undo/redo while open).
  function sync() {
    const doc = store.canvas();
    if (!doc) return;
    for (const r of radios) r.checked = doc.settings.insideView === r.value;
    if (document.activeElement !== slider || !sliderKey) slider.value = String(doc.settings.growth);
    showGrow(doc.settings.growth);
  }
  store.on(() => { if (!back.hidden) sync(); });

  return {
    get isOpen() { return !back.hidden; },
    open() {
      sync();
      back.hidden = false;
    },
    close() { back.hidden = true; }
  };
}
