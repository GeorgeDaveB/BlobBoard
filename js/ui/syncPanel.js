// Sync UI (phase 8): the ⚙ → Sync tab and the status pill (top bar on PC,
// footer on phones). All the work is in sync/syncController.js. Wording:
// "cloud" + the provider's name (Dropbox today), "sync password" (owner).
import { DROPBOX_APP_NAME } from '../config.js';
import { MIN_PASSPHRASE } from '../sync/vault.js';
import { promptDialog, confirmDialog, choiceDialog, toast } from './dialogs.js';

const PROVIDER = 'Dropbox';
const FOLDER = 'Apps/' + DROPBOX_APP_NAME;
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18Z"/></svg>';

export function pillText(s) {
  switch (s.state) {
    case 'synced': return '✓ Synced';
    case 'saving': case 'syncing': case 'waiting': return 'Saving…';
    case 'offline': return 'Offline' + (s.pending ? ' – ' + s.pending + ' waiting' : '');
    case 'auth': return 'Sign in again';
    case 'full': return PROVIDER + ' full';
    case 'locked': return s.phase === 'setup' ? 'Finish setup' : 'Password needed';
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

// Asks for a new sync password (twice). null = cancelled.
async function askNewPassword(title = 'Choose a sync password') {
  const a = await promptDialog({
    title,
    message: 'You type it once on each of your devices. It can’t be recovered — keep it safe.',
    okLabel: 'Next',
    input: { type: 'password', placeholder: 'At least ' + MIN_PASSPHRASE + ' characters', autocomplete: 'new-password' },
    check: v => (v.length >= MIN_PASSPHRASE ? '' : 'Use at least ' + MIN_PASSPHRASE + ' characters')
  });
  if (a == null) return null;
  const b = await promptDialog({ title: 'Type it again', okLabel: 'OK', input: { type: 'password', autocomplete: 'new-password' }, check: v => (v === a ? '' : 'The passwords don’t match') });
  return b == null ? null : a;
}

// No password / with a sync password. Resolves null (no), a string, or undefined (cancelled).
async function askFolderPassword(title) {
  const how = await choiceDialog({
    title,
    choices: [
      { label: 'No password', value: 'none', kind: 'primary', note: 'Simplest — your boards are kept in your ' + PROVIDER + ' as they are' },
      { label: 'With a sync password', value: 'pw', note: 'Locked with a password before they leave this device' }
    ]
  });
  if (!how) return undefined;
  if (how === 'none') return null;
  const pw = await askNewPassword();
  return pw == null ? undefined : pw;
}

export function createSyncPanel({ controller }) {
  const el = document.createElement('div');
  el.className = 'sync-panel';
  let last = controller.status;

  const p = (text, cls = 'range-hint') => { const e = document.createElement('p'); e.className = cls; e.textContent = text; return e; };
  const btn = (text, fn, cls = 'btn btn-wide') => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.addEventListener('click', fn); return b; };
  const fail = err => toast((err && err.message) || 'Could not reach ' + PROVIDER);

  // After connecting: join the folder the right way.
  async function setUp() {
    let mode;
    try { mode = await controller.folderMode(); } catch (err) { fail(err); return; }
    if (mode === 'plain') { await controller.join().catch(fail); toast('Sync is on'); return; }
    if (mode === 'password') return unlock();
    const pw = await askFolderPassword('How should your boards be kept in ' + PROVIDER + '?');
    if (pw === undefined) return;
    const r = await controller.createFolder(pw).catch(err => { fail(err); return null; });
    if (r === 'exists') { toast('Your other device just set up sync'); setUp(); }
    else if (r === 'ok') toast('Sync is on');
  }

  async function unlock() {
    let message = 'Type the sync password you chose on your other device.';
    for (;;) {
      const pw = await promptDialog({ title: 'Sync password', message, okLabel: 'Unlock', input: { type: 'password', autocomplete: 'current-password' } });
      if (pw == null) return;
      const r = await controller.unlock(pw).catch(err => { fail(err); return null; });
      if (r === true || r === 'ok') { toast('Sync is on'); return; }
      if (r === 'none') return setUp();
      if (r === null) return;
      message = 'That password doesn’t match — try again.';
    }
  }

  async function rewrite(password, doneText) {
    const close = toast('Updating the files in ' + PROVIDER + '…', { ms: 600000 });
    try {
      await controller.setPassword(password, (n, total) => { if (n === total) close(); });
      close();
      toast(doneText);
    } catch (err) { close(); fail(err); }
  }
  async function addPassword() {
    const pw = await askNewPassword('Add a sync password');
    if (pw) rewrite(pw, 'Sync password added — type it once on your other device');
  }
  async function changePassword() {
    const pw = await askNewPassword('New sync password');
    if (pw) rewrite(pw, 'Sync password changed — type the new one once on your other device');
  }
  async function removePassword() {
    const ok = await confirmDialog({ title: 'Remove the sync password?', message: 'Your boards will be kept in your ' + PROVIDER + ' without a password. Your other device follows by itself.', okLabel: 'Remove password' });
    if (ok) rewrite(null, 'Sync password removed');
  }

  async function startOver() {
    const ok = await confirmDialog({
      title: 'Start over?',
      message: 'This empties the ' + FOLDER + ' folder in your ' + PROVIDER + ' and uploads the boards on THIS device. Boards that exist only on your other devices are not in the cloud any more until those devices sync again (after setting it up again).',
      okLabel: 'Empty and start over',
      danger: true
    });
    if (!ok) return;
    const pw = await askFolderPassword('Start over — how should your boards be kept?');
    if (pw === undefined) return;
    try { await controller.startOver(pw); toast('Started over — sync is on'); } catch (err) { fail(err); }
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
        p('Keep your boards the same on your PC and phone through the cloud. Cloud: ' + PROVIDER + ' — the app only uses its own folder, ' + FOLDER + '. You can add a sync password.', 'sync-intro'),
        btn('Connect ' + PROVIDER, () => controller.connect(), 'btn btn-primary btn-wide')
      );
    } else if (s.phase === 'setup') {
      nodes.push(
        p('Connected to ' + PROVIDER + '. ' + (s.message || 'One more step.'), 'sync-intro'),
        btn('Finish setting up sync…', setUp, 'btn btn-primary btn-wide'),
        btn('Forgot the sync password? Start over…', startOver, 'btn btn-wide btn-danger'),
        btn('Disconnect this device', disconnect)
      );
    } else if (s.phase === 'stopped') {
      nodes.push(p('Sync is paused here because BlobBoard is open in another window or tab.', 'sync-intro'));
    } else {
      const when = s.lastSync ? new Date(s.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const pw = s.mode === 'password';
      nodes.push(
        p(pillText(s) + (s.state === 'synced' && when ? ' · ' + when : '') + (s.message && s.state !== 'synced' ? ' — ' + s.message : ''), 'sync-state'),
        p('Cloud: ' + PROVIDER + ' (' + FOLDER + ') · Sync password: ' + (pw ? 'on' : 'off')),
        btn('Sync now', () => controller.syncNow()),
        ...(s.state === 'auth' ? [btn('Sign in to ' + PROVIDER + ' again', () => controller.connect(), 'btn btn-primary btn-wide')] : []),
        ...(pw ? [btn('Change sync password…', changePassword), btn('Remove sync password…', removePassword)] : [btn('Add a sync password…', addPassword)]),
        btn('Disconnect this device', disconnect),
        btn('Start over…', startOver, 'btn btn-wide btn-danger')
      );
    }
    el.replaceChildren(...nodes);
  }
  render();
  return { el, update(s) { last = s; render(); }, setUp };
}
