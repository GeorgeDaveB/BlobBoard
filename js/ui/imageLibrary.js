// The picture library UI (R7, phase 4):
//  - openPicturePicker(): from the item editor — Add pictures (several at
//    once from the device; Android offers the camera there too), tap one to
//    use it, Remove picture.
//  - createLibraryGrid(): the grid itself, also used by ⚙ → Pictures (with
//    delete buttons).
import { toast } from './dialogs.js';

// "Add pictures" button + hidden multi-file input. onAdded({ added, existing, errors }).
export function addPicturesButton(pictures, onAdded, label = 'Add pictures') {
  const wrap = document.createElement('label');
  wrap.className = 'btn btn-primary add-pics';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.hidden = true;
  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(input, text);
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    wrap.classList.add('busy');
    text.textContent = files.length === 1 ? 'Adding…' : 'Adding ' + files.length + '…';
    let res;
    try { res = await pictures.add(files); } finally {
      wrap.classList.remove('busy');
      text.textContent = label;
    }
    if (res.errors.length) toast(res.errors[0] + (res.errors.length > 1 ? ' (+' + (res.errors.length - 1) + ' more)' : ''), { ms: 7000 });
    else if (!res.added.length && res.existing.length) toast(res.existing.length === 1 ? 'That picture is already in the library' : 'Those pictures are already in the library');
    onAdded(res);
  });
  return wrap;
}

// Grid of library pictures, newest first. onPick(id) when one is tapped;
// onDelete(id) adds a × on each. selectedId gets a ring.
export function createLibraryGrid({ pictures, onPick, onDelete, selectedId = null, empty = 'No pictures yet.' }) {
  const el = document.createElement('div');
  el.className = 'pic-grid';
  let selected = selectedId;
  function refresh() {
    const list = pictures.list();
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'pic-empty';
      p.textContent = empty;
      el.replaceChildren(p);
      return;
    }
    el.replaceChildren(...list.map(r => {
      const cell = document.createElement('div');
      cell.className = 'pic-cell' + (r.id === selected ? ' on' : '');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pic-thumb';
      b.setAttribute('aria-label', onPick ? 'Use this picture' : 'Picture');
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = pictures.get(r.id).url;
      b.append(img);
      if (onPick) b.addEventListener('click', () => onPick(r.id));
      else b.tabIndex = -1;
      cell.append(b);
      if (onDelete) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'pic-del';
        x.textContent = '×';
        x.setAttribute('aria-label', 'Delete this picture');
        x.addEventListener('click', () => onDelete(r.id));
        cell.append(x);
      }
      return cell;
    }));
  }
  refresh();
  return { el, refresh, setSelected(id) { selected = id; refresh(); } };
}

// Modal picker. Resolves { id } (use it), { remove: true }, or null (closed).
export function openPicturePicker({ pictures, current = null }) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const box = document.createElement('div');
    box.className = 'modal pic-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Choose a picture');
    const head = document.createElement('div');
    head.className = 'pic-head';
    const h = document.createElement('h2');
    h.textContent = 'Pictures';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'icon-btn';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    head.append(h, close);
    const finish = v => {
      document.removeEventListener('keydown', onKey, true);
      unsub();
      back.remove();
      resolve(v);
    };
    const grid = createLibraryGrid({
      pictures,
      selectedId: current,
      onPick: id => finish({ id }),
      empty: 'No pictures yet. Add some from this device.'
    });
    const unsub = pictures.on(() => grid.refresh());
    const actions = document.createElement('div');
    actions.className = 'pic-actions';
    // Adding exactly one picture here uses it straight away.
    actions.append(addPicturesButton(pictures, res => { if (res.added.length === 1 && !res.errors.length) finish({ id: res.added[0] }); }));
    if (current) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn';
      rm.textContent = 'Remove picture';
      rm.addEventListener('click', () => finish({ remove: true }));
      actions.append(rm);
    }
    box.append(head, actions, grid.el);
    back.append(box);
    document.body.append(back);
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
    document.addEventListener('keydown', onKey, true);
    close.addEventListener('click', () => finish(null));
    back.addEventListener('click', e => { if (e.target === back) finish(null); });
  });
}
