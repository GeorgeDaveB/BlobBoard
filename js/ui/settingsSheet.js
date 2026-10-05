// ⚙ Settings for the current canvas (saved with the canvas, so they sync).
// Phase 2: how an expanded item shows what's inside it.
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
  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent = 'Saved with this canvas.';

  box.append(head, group, note);
  back.append(box);
  host.append(back);

  done.addEventListener('click', () => onRequestClose());
  back.addEventListener('click', e => { if (e.target === back) onRequestClose(); });

  return {
    get isOpen() { return !back.hidden; },
    open() {
      const doc = store.canvas();
      for (const r of radios) r.checked = doc.settings.insideView === r.value;
      back.hidden = false;
    },
    close() { back.hidden = true; }
  };
}
