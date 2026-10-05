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
