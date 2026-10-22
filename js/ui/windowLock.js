// One window at a time (phase 8): two windows of BlobBoard on one device
// would each save over the other's changes (and sync twice). The first
// window holds a lock; another one shows "Open in another window — Use here",
// which takes the lock over; the first then stops and says so.
const NAME = 'blobboard-window';

function overlay(text, button, onClick) {
  const back = document.createElement('div');
  back.className = 'modal-back window-lock';
  const box = document.createElement('div');
  box.className = 'modal';
  const h = document.createElement('h2');
  h.textContent = 'BlobBoard';
  const p = document.createElement('p');
  p.textContent = text;
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-primary';
  b.textContent = button;
  b.addEventListener('click', () => onClick(back));
  actions.append(b);
  box.append(h, p, actions);
  back.append(box);
  document.body.append(back);
  return back;
}

// Resolves once this window may run. onLost() is called if another window
// takes over later.
export function acquireWindowLock({ onLost }) {
  if (!navigator.locks || !navigator.locks.request) return Promise.resolve();
  const hold = opts => new Promise(resolve => {
    navigator.locks.request(NAME, opts, lock => {
      if (!lock) { resolve(false); return undefined; }
      resolve(true);
      return new Promise(() => {}); // held until this window closes
    }).catch(() => onLost());
  });
  return hold({ ifAvailable: true }).then(ok => {
    if (ok) return undefined;
    return new Promise(resolve => {
      overlay('BlobBoard is open in another window or tab. Use it here instead? (The other one stops.)', 'Use here', back => {
        back.remove();
        hold({ steal: true }).then(() => resolve());
      });
    });
  });
}

// Shown in the window that lost the lock.
export function showLostLock() {
  if (document.querySelector('.window-lock')) return;
  overlay('BlobBoard was opened in another window or tab, so it stopped here (your changes are saved).', 'Use here', () => location.reload());
}
