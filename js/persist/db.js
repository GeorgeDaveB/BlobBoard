// Small promise-based IndexedDB wrapper.
export const DB_NAME = 'blobboard';
const VERSION = 1;
const STORES = [
  ['canvases', 'id'],
  ['syncMeta', 'id'],
  ['tags', 'id'],
  ['images', 'id'],
  ['settings', 'key']
];

const done = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export function openDb(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [store, keyPath] of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath });
      }
    };
    req.onsuccess = () => resolve(wrap(req.result));
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is blocked by another open window'));
  });
}

function wrap(db) {
  const os = (store, mode) => db.transaction(store, mode).objectStore(store);
  return {
    get: (store, key) => done(os(store, 'readonly').get(key)),
    getAll: store => done(os(store, 'readonly').getAll()),
    put: (store, value) => done(os(store, 'readwrite').put(value)),
    del: (store, key) => done(os(store, 'readwrite').delete(key)),
    // Several writes in one transaction: all land or none do.
    putMany(store, values) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const s = tx.objectStore(store);
        for (const v of values) s.put(v);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    close: () => db.close()
  };
}
