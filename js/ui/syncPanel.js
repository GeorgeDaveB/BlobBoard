// Sync UI (phase 8): the ⚙ → Sync tab and the status pill (top bar on PC,
// footer on phones). All the work is in sync/syncController.js.
import { DROPBOX_APP_NAME } from '../config.js';
import { MIN_PASSPHRASE } from '../sync/vault.js';
import { promptDialog, confirmDialog, toast } from './dialogs.js';

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18Z"/></svg>';

export function pillText(s) {
  switch (s.state) {
    case 'synced': return '✓ Synced';
    case 'saving': case 'syncing': return 'Saving…';
    case 'waiting': return 'Saving…';
    case 'offline': return 'Offline' + (s.pending ? ' – ' + s.pending + ' waiting' : '');
    case 'auth': return 'Sign in again';
    case 'full': return 'Dropbox full';
    case 'locked': return 'Passphrase needed';
    case 'stopped': return 'Paused';
    case 'error': return 'Sync problem';
    default: return 'Not connected';
  }
}
const pillTone = s => (['synced'].includes(s.state) ? 'ok' : ['saving', 'syncing', 'waiting'].includes(s.state) ? 'busy' : ['off'].includes(s.state) ? 'off' : 'warn');

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
      b.title = 'Dropbox sync: ' + pillText(s) + (s.message ? ' — ' + s.message : '');
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

  async function askNew() {
    const a = await promptDialog({
      title: 'Choose a sync passphrase',
      message: 'Everything is encrypted with it before it leaves this device. You type it once on each of your devices. It can’t be recovered — keep it safe.',
      okLabel: 'Next',
      input: { type: 'password', placeholder: 'At least ' + MIN_PASSPHRASE + ' characters', autocomplete: 'new-password' },
      check: v => (v.length >= MIN_PASSPHRASE ? '' : 'Use at least ' + MIN_PASSPHRASE + ' characters')
    });
    if (a == null) return null;
    const b = await promptDialog({ title: 'Type it again', okLabel: 'Start syncing', input: { type: 'password', autocomplete: 'new-password' }, check: v => (v === a ? '' : 'The passphrases don’t match') });
    return b == null ? null : a;
  }

  async function setUp() {
    let has;
    try { has = await controller.hasVault(); } catch (err) { toast(err.message || 'Could not reach Dropbox'); return; }
    if (has) return unlock();
    const pass = await askNew();
    if (!pass) return;
    const r = await controller.createPassphrase(pass).catch(err => { toast(err.message); return null; });
    if (r === 'exists') { toast('Another device just set up sync — type its passphrase'); unlock(); }
    else if (r === 'ok') toast('Sync is on');
  }

  async function unlock() {
    let message = 'Type the passphrase you chose on your other device.';
    for (;;) {
      const pass = await promptDialog({ title: 'Sync passphrase', message, okLabel: 'Unlock', input: { type: 'password', autocomplete: 'current-password' } });
      if (pass == null) return;
      const r = await controller.unlock(pass).catch(err => { toast(err.message); return null; });
      if (r === true) { toast('Sync is on'); return; }
      if (r === 'none') return setUp();
      if (r === null) return;
      message = 'That passphrase doesn’t match — try again.';
    }
  }

  async function startOver() {
    const ok = await confirmDialog({
      title: 'Start over?',
      message: 'This empties the ' + DROPBOX_APP_NAME + ' folder in your Dropbox and uploads the boards on THIS device with a new passphrase. Boards that exist only on your other devices are not in Dropbox any more; those devices need the new passphrase.',
      okLabel: 'Empty and start over',
      danger: true
    });
    if (!ok) return;
    const pass = await askNew();
    if (!pass) return;
    try { await controller.startOver(pass); toast('Started over — sync is on'); } catch (err) { toast(err.message || 'Could not start over'); }
  }

  async function disconnect() {
    const ok = await confirmDialog({ title: 'Disconnect this device?', message: 'Your boards stay on this device and in Dropbox. This device stops syncing until you connect again.', okLabel: 'Disconnect' });
    if (ok) { await controller.disconnect(); toast('Disconnected'); }
  }

  function render() {
    const s = last;
    const nodes = [];
    if (s.phase === 'off') {
      nodes.push(
        p('Keep your boards the same on your PC and phone through your Dropbox. Everything is encrypted with a passphrase before it leaves this device, and the app only uses its own folder: Apps/' + DROPBOX_APP_NAME + '.', 'sync-intro'),
        btn('Connect Dropbox', () => controller.connect(), 'btn btn-primary btn-wide')
      );
    } else if (s.phase === 'locked') {
      nodes.push(
        p('Connected to Dropbox. ' + (s.message || 'One more step: the sync passphrase.'), 'sync-intro'),
        btn('Set up / unlock sync…', setUp, 'btn btn-primary btn-wide'),
        btn('Forgot the passphrase? Start over…', startOver, 'btn btn-wide btn-danger'),
        btn('Disconnect this device', disconnect)
      );
    } else if (s.phase === 'stopped') {
      nodes.push(p('Sync is paused here because BlobBoard is open in another window or tab.', 'sync-intro'));
    } else {
      const when = s.lastSync ? new Date(s.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      nodes.push(
        p(pillText(s) + (s.state === 'synced' && when ? ' · ' + when : '') + (s.message && s.state !== 'synced' ? ' — ' + s.message : ''), 'sync-state'),
        p('Your boards are encrypted before they go to Dropbox (Apps/' + DROPBOX_APP_NAME + ').'),
        btn('Sync now', () => controller.syncNow()),
        ...(s.state === 'auth' ? [btn('Sign in to Dropbox again', () => controller.connect(), 'btn btn-primary btn-wide')] : []),
        btn('Disconnect this device', disconnect),
        btn('Start over…', startOver, 'btn btn-wide btn-danger')
      );
    }
    el.replaceChildren(...nodes);
  }
  render();
  return { el, update(s) { last = s; render(); }, setUp };
}
