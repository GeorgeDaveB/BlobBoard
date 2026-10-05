// ⚙ → Motion (R33): switch each animation / physics effect on or off, for
// speed (phones). Saved on this device only. Switching effects off never
// changes where blobs end up: pushing aside on drop always happens.
import { MOTION_KEYS } from './physics.js';

export const EFFECTS = [
  { key: 'wobble', label: 'Idle wobble', hint: 'Outlines slowly change shape. The heaviest effect.' },
  { key: 'bob', label: 'Floating', hint: 'Blobs gently bob up and down.' },
  { key: 'lines', label: 'Gooey line wobble', hint: 'Lines lag, bend and wobble when blobs move.' },
  { key: 'drag', label: 'Drag feel', hint: 'Squeeze, flatten and lift while dragging.' },
  { key: 'contact', label: 'Touching blobs', hint: 'Edges flatten where a dragged blob touches another.' },
  { key: 'bounce', label: 'Bounces', hint: 'Splat on drop, wobble on tap, bouncy size changes.' },
  { key: 'glide', label: 'Gliding when pushed', hint: 'Pushed-aside blobs glide over (off: they jump).' },
  { key: 'birth', label: 'New blob pop', hint: 'A new blob grows from a dot.' },
  { key: 'morph', label: 'Shape morph', hint: 'Blob ↔ card shape change animates.' },
  { key: 'swell', label: 'Target swell', hint: 'A blob you hold over puffs up.' },
  { key: 'ui', label: 'Trays & lists', hint: 'Trays slide in, inside items pop in, reorder slides.' }
];

const all = v => Object.fromEntries(MOTION_KEYS.map(k => [k, v]));
export const PRESETS = {
  full: all(true),
  // Phones start here: the continuous effects off, the feel of touch kept.
  light: { ...all(true), wobble: false, bob: false, lines: false },
  off: all(false)
};

// The default for this device when nothing was saved yet.
export function defaultMotion() {
  return { ...(matchMedia('(pointer: coarse)').matches ? PRESETS.light : PRESETS.full) };
}

// get(): current switches; set(next): apply + save.
export function createMotionPanel({ get, set }) {
  const el = document.createElement('div');
  el.className = 'motion-panel';

  const intro = document.createElement('small');
  intro.className = 'range-hint';
  intro.textContent = 'Turn effects off if the board feels slow (phones). Saved on this device only. Blobs are still pushed aside when you drop one.';

  const presets = document.createElement('div');
  presets.className = 'seg';
  const presetBtns = [['full', 'All on'], ['light', 'Light'], ['off', 'All off']].map(([id, text]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.dataset.preset = id;
    b.textContent = text;
    b.addEventListener('click', () => { set({ ...PRESETS[id] }); sync(); });
    presets.append(b);
    return b;
  });

  const list = document.createElement('div');
  list.className = 'toggle-list';
  const boxes = EFFECTS.map(e => {
    const row = document.createElement('label');
    row.className = 'toggle-row';
    const text = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = e.label;
    const small = document.createElement('small');
    small.textContent = e.hint;
    text.append(strong, small);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'switch';
    box.addEventListener('change', () => { set({ ...get(), [e.key]: box.checked }); sync(); });
    row.append(text, box);
    list.append(row);
    return { key: e.key, box };
  });

  el.append(intro, presets, list);

  function sync() {
    const m = get();
    for (const { key, box } of boxes) box.checked = !!m[key];
    for (const b of presetBtns) {
      const p = PRESETS[b.dataset.preset];
      b.classList.toggle('on', MOTION_KEYS.every(k => !!p[k] === !!m[k]));
    }
  }

  return { el, sync };
}
