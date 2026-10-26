import { assert, assertEqual } from './runner.js';
import { encryptJson, decryptFile, isBackupFile, buildPayload, readPayload, backupName, BackupError, MAGIC, plainFile, sniffFile, baseName } from '../js/services/backup.js';
import { drawScene, wrap, textBlocks } from '../js/services/exportPng.js';
import { createStore } from '../js/core/store.js';
import { newCanvas } from '../js/core/model.js';

const FAST = { iterations: 20000 }; // tests only; real files use 600 000
const bytesOf = async blob => new Uint8Array(await blob.arrayBuffer());
async function codeOf(p) { try { await p; return 'ok'; } catch (e) { return e instanceof BackupError ? e.code : 'other:' + e.message; } }

function setup() {
  let t = 1000;
  const store = createStore({ repo: { saveCanvas() {}, saveTag() {} }, now: () => ++t });
  const c = newCanvas('Life', 1);
  store.load([c], c.id, []);
  return store;
}

export const tests = {
  'encrypt -> decrypt gives the same data; the file starts with the BlobBoard mark': async () => {
    const obj = { app: 'BlobBoard', hello: 'κόσμε', n: [1, 2, 3] };
    const blob = await encryptJson(obj, 'secret pass', FAST);
    const bytes = await bytesOf(blob);
    assert(isBackupFile(bytes), 'marked');
    assertEqual(new TextDecoder().decode(bytes.subarray(0, MAGIC.length)), MAGIC);
    assert(!new TextDecoder().decode(bytes).includes('κόσμε'), 'content is not readable in the file');
    assertEqual(await decryptFile(bytes, 'secret pass'), obj);
  },

  'wrong password, tampered data, or not our file: clear errors': async () => {
    const bytes = await bytesOf(await encryptJson({ a: 1 }, 'right-one', FAST));
    assertEqual(await codeOf(decryptFile(bytes, 'wrong-one')), 'password');
    const bad = bytes.slice();
    bad[bad.length - 5] ^= 0xff;
    assertEqual(await codeOf(decryptFile(bad, 'right-one')), 'password', 'tampering is detected');
    assertEqual(await codeOf(decryptFile(new TextEncoder().encode('{"app":"x"}'), 'x')), 'format');
    assertEqual(await codeOf(encryptJson({}, '')), 'password');
  },

  'payload: canvases + only the tags and pictures they use; read back checks everything': async () => {
    const store = setup();
    const t1 = store.ensureTag('Used'), t2 = store.ensureTag('Unused');
    store.createItem({ title: 'A', tagIds: [t1], thumbId: 'p-' + 'a'.repeat(64) });
    const pic = { blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' }), w: 10, h: 20 };
    const p = await buildPayload({ canvases: [store.canvas()], tags: store.tags(), pictureBlob: id => (id === 'p-' + 'a'.repeat(64) ? pic : null), appVersion: 'x' });
    assertEqual([p.app, p.canvases.length, p.tags.map(t => t.name), p.pictures.length], ['BlobBoard', 1, ['Used'], 1]);
    assert(!p.tags.some(t => t.id === t2));
    p.pictures.push({ id: 'evil', type: 'text/html', w: 1, h: 1, data: 'PGI+' });
    const r = readPayload(JSON.parse(JSON.stringify(p)));
    assertEqual([r.canvases.length, r.tags.length, r.pictures.length, r.skipped], [1, 1, 1, 1]);
    assertEqual(r.pictures[0].blob.size, 4);
    let code = '';
    try { readPayload({ app: 'Other', canvases: [] }); } catch (e) { code = e.code; }
    assertEqual(code, 'format');
    try { readPayload({ app: 'BlobBoard', v: 99, canvases: [] }); code = 'ok'; } catch (e) { code = e.message; }
    assert(code.includes('newer'), 'newer files are refused');
  },

  'whole trip: save on one device, open on another -> new canvas, tags by name, fresh ids': async () => {
    const a = setup();
    const ta = a.ensureTag('Health');
    const x = a.createItem({ title: 'X', tagIds: [ta], x: 5, y: 6 });
    const y = a.createItem({ title: 'Y', x: 300 });
    a.createLink(x, y);
    const file = await encryptJson(await buildPayload({ canvases: [a.canvas()], tags: a.tags(), pictureBlob: () => null }), 'pw123456', FAST);
    const b = setup();
    const tb = b.ensureTag('health'); // same tag by name on the other device
    const data = readPayload(await decryptFile(await bytesOf(file), 'pw123456'));
    const tagMap = new Map(data.tags.map(t => [t.id, b.ensureTag(t.name)]));
    const id = b.importCanvas(data.canvases[0], { tagMap });
    const doc = b.canvas(id);
    assertEqual(doc.name, 'Life (2)', 'unique name');
    const items = Object.values(doc.items);
    assertEqual(items.map(i => i.title).sort(), ['X', 'Y']);
    assert(items.every(i => i.id !== x && i.id !== y), 'fresh ids');
    assertEqual(items.find(i => i.title === 'X').tagIds, [tb]);
    assertEqual(Object.keys(doc.links).length, 1);
    assertEqual(b.tags().length, 1, 'no duplicate tag');
  },

  'file names': () => {
    assertEqual(backupName(['Life']), 'Life.blobboard');
    assertEqual(backupName(['a/b:c']), 'a b c.blobboard');
    assertEqual(backupName(['A', 'B'], new Date(2026, 9, 12, 0, 30)), 'BlobBoard-all-2026-10-12.blobboard', 'local date');
  },

  'export picture: draws the view at 2x; text helpers': () => {
    const scene = {
      view: { x: 10, y: 20, z: 1 }, width: 300, height: 200,
      items: [
        { id: 'a', kind: 'blob', x: 0, y: 0, w: 120, h: 90, rd: 1, color: '#ff8a7a', title: 'Hello', notes: 'one two', done: true, tags: [{ name: 'T', color: '#8ec5ff' }], kids: ['#ffd966'], kidCount: 1 },
        { id: 's', kind: 'shape', shape: 'hexagon', x: 150, y: 0, w: 100, h: 80, color: '#9be3b5', title: 'S', tags: [], kids: [], kidCount: 0 },
        { id: 't', kind: 'text', x: 0, y: 120, w: 200, h: 60, color: '#2b2a28', notes: 'Plan', notesHtml: '<h3>Plan</h3><ul><li>one</li></ul>', tags: [], kids: [], kidCount: 0 }
      ],
      links: [{ d: 'M0 0L50 0L50 4L0 4Z', arrows: '', x1: 0, y1: 0, x2: 50, y2: 0, c0: '#f00', c1: '#00f', label: 'go', labelAt: { x: 25, y: 2 } }]
    };
    const c = drawScene(scene, 2);
    assertEqual([c.width, c.height], [600, 400]);
    const px = c.getContext('2d').getImageData(0, 0, 1, 1).data;
    assert(px[3] === 255, 'opaque background');
    const g = document.createElement('canvas').getContext('2d');
    g.font = '13px sans-serif';
    const lines = wrap(g, 'a b c d e f g h i j k l m n o p q r s t u v w x y z '.repeat(4), 60, 3);
    assert(lines.length === 3 && lines[2].endsWith('…'), 'wraps to 3 lines and ends with …');
    assertEqual(textBlocks('<h3>Plan</h3><ul><li>one</li><li>two</li></ul>').map(b => [b.text, !!b.heading, b.bullet || '']), [['Plan', true, ''], ['one', false, '•'], ['two', false, '•']]);
  }
};

// ---- files without a password (owner 2026-10-26) ----
tests['no-password file and JSON export: plain JSON that opens; locked files are recognised'] = async () => {
  const payload = { app: 'BlobBoard', v: 1, canvases: [], tags: [], pictures: [] };
  const blob = plainFile(payload);
  assertEqual(blob.type, 'application/json');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assertEqual(JSON.parse(new TextDecoder().decode(bytes)).app, 'BlobBoard', 'readable JSON');
  assertEqual(sniffFile(bytes), { kind: 'plain', payload });
  const locked = new Uint8Array(await (await encryptJson(payload, 'pw123456', FAST)).arrayBuffer());
  assertEqual(sniffFile(locked).kind, 'locked');
  assertEqual(sniffFile(new TextEncoder().encode('{"app":"Other"}')).kind, 'unknown');
  assertEqual([baseName('Life.blobboard'), baseName('Life.json'), baseName('Life')], ['Life', 'Life', 'Life']);
};

// ---- passwords per canvas (owner 2026-10-26) ----
tests['canvas password: lock holds no password; key fits; undo and duplicate keep it'] = async () => {
  const { makeLock, unlockWith, keyFits } = await import('../js/services/canvasLock.js');
  const { lock, key } = await makeLock('secret1', FAST);
  assert(!JSON.stringify(lock).includes('secret1'), 'no password stored');
  assert(await keyFits(lock, key), 'key fits');
  assertEqual(await unlockWith(lock, 'nope!!'), null);
  const other = await makeLock('secret2', FAST);
  assertEqual(await keyFits(lock, other.key), false);
  const store = setup();
  const cid = store.ui.canvasId;
  store.createItem({ title: 'A' });
  store.setCanvasLock(cid, lock);
  store.createItem({ title: 'B' });
  store.undo();
  store.undo();
  assert(store.canvas().lock, 'undo keeps the password');
  const copy = store.duplicateCanvas(cid);
  assertEqual(store.canvas(copy).lock, lock, 'duplicate keeps it');
  store.setCanvasLock(cid, null);
  assertEqual(store.canvas(cid).lock, undefined);
};

tests['save this canvas: its password opens the file; locked canvases stay locked inside "save all"'] = async () => {
  const { makeLock } = await import('../js/services/canvasLock.js');
  const { encryptWithKey, sealEntry, openEntry } = await import('../js/services/backup.js');
  const { lock, key } = await makeLock('canvaspw', FAST);
  const payload = { app: 'BlobBoard', v: 1, canvases: [], tags: [], pictures: [] };
  const file = new Uint8Array(await (await encryptWithKey(payload, key, lock.kdf)).arrayBuffer());
  assertEqual(await decryptFile(file, 'canvaspw'), payload, 'the canvas password opens its file');
  const sub = { app: 'BlobBoard', v: 1, canvases: [newCanvas('Diary', 1)], tags: [], pictures: [] };
  const entry = await sealEntry(key, lock, 'Diary', sub);
  assert(!entry.sealed.includes('Diary'), 'contents locked');
  const all = readPayload({ app: 'BlobBoard', v: 1, canvases: [], tags: [], pictures: [], lockedCanvases: [entry, { name: 'bad' }] });
  assertEqual([all.locked.length, all.skipped], [1, 1]);
  assertEqual(await openEntry(all.locked[0], 'wrong!'), null);
  const opened = await openEntry(all.locked[0], 'canvaspw');
  assertEqual(opened.payload.canvases[0].name, 'Diary');
};
