// Tiny publish/subscribe.
export function createEmitter() {
  const listeners = new Set();
  return {
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(payload) {
      for (const fn of [...listeners]) fn(payload);
    }
  };
}
