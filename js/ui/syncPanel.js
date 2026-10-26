// Sync UI (phase 8): the ⚙ → Sync tab and the status pill (top bar on PC,
// footer on phones). All the work is in sync/syncController.js. Wording:
// "cloud" + the provider's name (Dropbox today). Passwords are per canvas
// (canvas menu → Password ▸); here a canvas this device can't open yet is
// listed with "Type its password…".
import { DROPBOX_APP_NAME } from '../config.js';
import { promptDialog, confirmDialog, toast } from './dialogs.js';

const PROVIDER = 'Dropbox';
const FOLDER = 'Apps/' + DROPBOX_APP_NAME;
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18Z"/></svg>';

export function pillText(s) {
  switch (s.state) {
    case 'synced': return '✓ Synced';
    case 'needs': return 'Password needed';
    case 'saving': case 'syncing': case 'waiting': return 'Saving…';
    case 'offline': return 'Offline' + (s.pending ? ' – ' + s.pending + ' waiting' : '');
    case 'auth': return 'Sign in again';
    case 'full': return PROVIDER + ' full';
    case 'stopped': return 'Paused';
    case 'error': return 'Sync problem';
    default: return 'Not connected';
  }
}
const pillTone = s => (s.state === 'synced' ? 'ok' : ['saving', 'syncing', 'waiting'].includes(s.state) ? 'busy' : s.state === 'off' ? 'off' : 'warn');

// A pill button; update(status) keeps it current.
export function createSyncPill(onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sync-pill';
  b.innerHTML = ICON;
  const t = document.createElement('span');
  t.className = 'sync-text';
  b.append(t);
  b.addEventListener('click', onClick);
  return {
    el: b,
    update(s) {
      t.textContent = pillText(s);
      b.dataset.tone = pillTone(s);
      b.title = 'Sync (' + PROVIDER + '): ' + pillText(s) + (s.message ? ' — ' + s.message : '');
      b.setAttribute('aria-label', b.title);
    }
  };
}

export function createSyncPanel({ controller }) {
  const el = document.createElement('div');
  el.className = 'sync-panel';
  let last = controller.status;

  const p = (text, cls = 'range-hint') => { const e = document.createElement('p'); e.className = cls; e.textContent = text; return e; };
  const btn = (text, fn, cls = 'btn btn-wide') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.addEventListener('click', fn); return b; };
  const fail = err => toast((err && err.message) || 'Could not reach ' + PROVIDER);

  async function unlock(n) {
    let message = 'This canvas has a password (set on your other device). Type it once here.';
    for (;;) {
      const pw = await promptDialog({ title: 'Password for “' + n.name + '”', message, okLabel: 'Unlock', input: { type: 'password', autocomplete: 'current-password' } });
      if (pw == null) return;
      const r = await controller.unlockCanvas(n.id, pw).catch(err => { fail(err); return null; });
      if (r === true) { toast('“' + n.name + '” is unlocked on this device'); return; }
      if (r !== false) return;
      message = 'Wrong password — try again.';
    }
  }

  async function startOver() {
    const ok = await confirmDialog({
      title: 'Start over?',
      message: 'This empties the ' + FOLDER + ' folder in your ' + PROVIDER + ' and uploads the boards on THIS device. Boards that exist only on your other devices come back when those devices sync.',
      okLabel: 'Empty and start over',
      danger: true
    });
    if (!ok) return;
    try { await controller.startOver(); toast('Started over'); } catch (err) { fail(err); }
  }

  async function disconnect() {
    const ok = await confirmDialog({ title: 'Disconnect this device?', message: 'Your boards stay on this device and in ' + PROVIDER + '. This device stops syncing until you connect again.', okLabel: 'Disconnect' });
    if (ok) { await controller.disconnect(); toast('Disconnected'); }
  }

  function render() {
    const s = last;
    const nodes = [];
    if (s.phase === 'off') {
      nodes.push(
        p('Keep your boards the same on your PC and phone through the cloud. Cloud: ' + PROVIDER + ' — the app only uses its own folder, ' + FOLDER + '. A canvas with a password (canvas menu → Password) is kept there locked with it.', 'sync-intro'),
        btn('Connect ' + PROVIDER, () => controller.connect(), 'btn btn-primary btn-wide')
      );
    } else if (s.phase === 'stopped') {
      nodes.push(p('Sync is paused here because BlobBoard is open in another window or tab.', 'sync-intro'));
    } else {
      const when = s.lastSync ? new Date(s.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      nodes.push(
        p(pillText(s) + ((s.state === 'synced' || s.state === 'needs') && when ? ' · ' + when : '') + (s.message && s.state !== 'synced' ? ' — ' + s.message : ''), 'sync-state'),
        p('Cloud: ' + PROVIDER + ' (' + FOLDER + ')')
      );
      for (const n of s.needs || []) nodes.push(btn('Type the password of “' + n.name + '”…', () => unlock(n), 'btn btn-primary btn-wide'));
      nodes.push(
        btn('Sync now', () => controller.syncNow()),
        ...(s.state === 'auth' ? [btn('Sign in to ' + PROVIDER + ' again', () => controller.connect(), 'btn btn-primary btn-wide')] : []),
        btn('Disconnect this device', disconnect),
        btn('Start over…', startOver, 'btn btn-wide btn-danger')
      );
    }
    el.replaceChildren(...nodes);
  }
  render();
  return { el, update(s) { last = s; render(); } };
}
