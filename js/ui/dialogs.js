// Confirm dialog and toast messages. All text is set with textContent.

let toastHost = null;

export function initDialogs(host) {
  toastHost = document.createElement('div');
  toastHost.className = 'toasts';
  toastHost.setAttribute('role', 'status');
  host.append(toastHost);
}

export function toast(message, { actionLabel, onAction, ms = 5000 } = {}) {
  const t = document.createElement('div');
  t.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  t.append(text);
  let timer = 0;
  const close = () => { clearTimeout(timer); t.remove(); };
  if (actionLabel) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-text';
    b.textContent = actionLabel;
    b.addEventListener('click', () => { close(); onAction(); });
    t.append(b);
  }
  toastHost.replaceChildren(t);
  timer = setTimeout(close, ms);
  return close;
}

// Several answers: choices = [{ label, value, kind: 'primary' | 'danger' |
// undefined, note }]; a note is a short line under the button's label.
// Resolves to the chosen value, or null (Cancel, Esc, tap outside).
export function choiceDialog({ title, message, choices }) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const box = document.createElement('div');
    box.className = 'modal modal-choices';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const h = document.createElement('h2');
    h.textContent = title;
    box.append(h);
    if (message) {
      const p = document.createElement('p');
      p.textContent = message;
      box.append(p);
    }
    const list = document.createElement('div');
    list.className = 'modal-choice-list';
    const finish = value => {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      resolve(value);
    };
    let first = null;
    for (const c of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn modal-choice' + (c.kind === 'danger' ? ' btn-danger' : c.kind === 'primary' ? ' btn-primary' : '');
      const l = document.createElement('span');
      l.textContent = c.label;
      b.append(l);
      if (c.note) {
        const n = document.createElement('small');
        n.textContent = c.note;
        b.append(n);
      }
      b.addEventListener('click', () => finish(c.value));
      list.append(b);
      if (!first) first = b;
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn modal-choice';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => finish(null));
    list.append(cancel);
    box.append(list);
    back.append(box);
    document.body.append(back);
    if (first) first.focus();
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', e => { if (e.target === back) finish(null); });
  });
}

export function confirmDialog({ title, message, okLabel = 'OK', danger = false }) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    ok.textContent = okLabel;
    actions.append(cancel, ok);
    box.append(h, p, actions);
    back.append(box);
    document.body.append(back);
    ok.focus();

    const finish = value => {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      resolve(value);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
    };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    back.addEventListener('click', e => { if (e.target === back) finish(false); });
  });
}
