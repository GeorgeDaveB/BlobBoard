// The canvas keys this device has unlocked (owner 2026-10-26): canvasId ->
// non-extractable CryptoKey, kept in this device's settings ('canvasKeys').
// Never synced; the passwords themselves are never stored.
export async function createKeyStore(repo) {
  const keys = new Map(Object.entries((await repo.getSetting('canvasKeys')) || {}));
  const save = () => repo.setSetting('canvasKeys', Object.fromEntries(keys));
  return {
    get: id => keys.get(id) || null,
    has: id => keys.has(id),
    set(id, key) { if (key) keys.set(id, key); else keys.delete(id); save(); },
    delete(id) { keys.delete(id); save(); }
  };
}
