// ⚙ Settings for the current canvas (saved with the canvas, so they sync):
// how an expanded item shows what's inside it, how much a blob grows per
// item inside it (R30), and the default look of lines (R31) with "apply to
// all lines". Also shows the app version.
// A side pane like the editors (bottom sheet on phones, right panel on PC);
// opening any other panel closes it (app.js).
import { APP_VERSION } from '../version.js';
import { MAX_GROW } from './itemView.js';
import { createLineLookFields } from './lineLookFields.js';
import { confirmDialog, toast } from './dialogs.js';

let sliderSeq = 0;
const OPTIONS = [
  { value: 'tray', label: 'Tray below the blob', hint: 'Inside items float in a tray under the blob.' },
  { value: 'container', label: 'Inside the blob', hint: 'The blob opens into a container: title, description, and its items.' }
];

export function createSettingsSheet({ host, store, onRequestClose }) {
  const sheet = document.createElement('section');
  sheet.className = 'sheet settings-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Canvas settings');

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

  const body = document.createElement('div');
  body.className = 'sheet-body';

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

  // Default look of lines on this canvas. Lines with their own choice keep
  // it; "Apply to all lines" resets them to follow these defaults.
  const linesTitle = document.createElement('div');
  linesTitle.className = 'field-label settings-section';
  linesTitle.textContent = 'Lines — default for this canvas';
  const linesHint = document.createElement('small');
  linesHint.className = 'range-hint';
  linesHint.textContent = 'Lines where you picked their own style, colour or thickness keep it.';
  const KEYS = { style: 'lineStyle', color: 'lineColor', width: 'lineWidth' };
  const lineLook = createLineLookFields({
    withDefault: false,
    onChange: patch => {
      for (const k of Object.keys(patch)) {
        if (KEYS[k]) store.setCanvasSetting(KEYS[k], patch[k], { coalesce: 'line:' + k + ':' + sliderSeq });
      }
    }
  });
  const applyAll = document.createElement('button');
  applyAll.type = 'button';
  applyAll.className = 'btn btn-wide';
  applyAll.textContent = 'Apply to all lines…';
  applyAll.addEventListener('click', async () => {
    const doc = store.canvas();
    const n = Object.keys(doc.links).length;
    if (!n) { toast('There are no lines on this canvas yet'); return; }
    const ok = await confirmDialog({
      title: 'Apply to all lines?',
      message: 'All ' + n + ' line' + (n === 1 ? '' : 's') + ' on this canvas will use these defaults (style, colour, thickness). Their own choices are cleared; their text stays. You can undo this.',
      okLabel: 'Apply'
    });
    if (!ok) return;
    const changed = store.resetLineLooks();
    toast(changed ? 'Applied to ' + changed + ' line' + (changed === 1 ? '' : 's') : 'All lines already use the defaults',
      changed ? { actionLabel: 'Undo', onAction: () => store.undo() } : {});
  });

  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent = 'Saved with this canvas. · Version ' + APP_VERSION;

  body.append(group, grow, linesTitle, linesHint, lineLook.el, applyAll, note);
  sheet.append(head, body);
  host.append(sheet);

  done.addEventListener('click', () => onRequestClose());

  // Shows the canvas's current values (also after undo/redo while open).
  function sync() {
    const doc = store.canvas();
    if (!doc) return;
    for (const r of radios) r.checked = doc.settings.insideView === r.value;
    if (document.activeElement !== slider || !sliderKey) slider.value = String(doc.settings.growth);
    showGrow(doc.settings.growth);
    lineLook.set({ style: doc.settings.lineStyle, color: doc.settings.lineColor, width: doc.settings.lineWidth });
  }
  store.on(() => { if (sheet.classList.contains('open')) sync(); });

  return {
    el: sheet,
    get isOpen() { return sheet.classList.contains('open'); },
    open() {
      sliderSeq++;
      lineLook.reset();
      sync();
      sheet.classList.add('open');
    },
    close() { sheet.classList.remove('open'); }
  };
}
