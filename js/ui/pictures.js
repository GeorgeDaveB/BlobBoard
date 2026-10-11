// The picture library at run time (R7, phase 4): every picture on this
// device, newest first, with reusable blob: URLs for display. Pictures never
// change once added. Deleting one only hides it ("deleted" flag) so Undo can
// bring back the items that used it; at the next start a hidden picture that
// no canvas uses any more is removed for good (purgeDeleted).
import { processImage, clampAspect } from '../services/imageProcessor.js';

export async function createPictureLibrary(repo, canvases = []) {
  const recs = new Map();
  for (const r of await repo.loadImages()) if (r && r.id && r.blob) recs.set(r.id, r);
  await purgeDeleted(repo, recs, canvases);
  const urls = new Map();
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };

  const lib = {
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // Visible pictures, newest first.
    list() {
      return [...recs.values()].filter(r => !r.deleted).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
    },
    has(id) { return recs.has(id); },

    // { url, aspect } for display (also for hidden pictures still in use,
    // e.g. after Undo), or null if this device doesn't have it.
    get(id) {
      const r = id && recs.get(id);
      if (!r) return null;
      if (!urls.has(id)) urls.set(id, URL.createObjectURL(r.blob));
      return { url: urls.get(id), aspect: clampAspect(r.w, r.h), w: r.w, h: r.h };
    },

    // Adds picked files. Returns { added: [ids], existing: [ids], errors:
    // [messages] }. A picture already here (same fingerprint) is not stored
    // again; a hidden one comes back.
    async add(files) {
      const out = { added: [], existing: [], errors: [] };
      const known = new Set(recs.keys());
      let t = Date.now();
      for (const f of files) {
        try {
          const p = await processImage(f, { knownIds: known });
          const old = recs.get(p.id);
          if (p.duplicate && old) {
            if (old.deleted) {
              old.deleted = false;
              old.createdAt = ++t;
              await repo.putImage(old);
              out.added.push(p.id);
            } else out.existing.push(p.id);
            continue;
          }
          const rec = { id: p.id, blob: p.blob, w: p.w, h: p.h, bytes: p.blob.size, createdAt: ++t };
          await repo.putImage(rec);
          recs.set(rec.id, rec);
          known.add(rec.id);
          out.added.push(rec.id);
        } catch (err) {
          out.errors.push(err && err.message ? err.message : String(err));
        }
      }
      if (out.added.length) emit();
      return out;
    },

    // Hides a picture from the library (kept until the next start, see top).
    async remove(id) {
      const r = recs.get(id);
      if (!r || r.deleted) return false;
      r.deleted = true;
      await repo.putImage(r);
      emit();
      return true;
    },

    // Phase 7: the stored file of a picture (for the save file), or null.
    blobOf(id) {
      const r = recs.get(id);
      return r ? { blob: r.blob, w: r.w, h: r.h } : null;
    },

    // Phase 7: a picture from a save file (same fingerprint = already here).
    async importRecord({ id, blob, w, h }) {
      const old = recs.get(id);
      if (old) {
        if (old.deleted) { old.deleted = false; await repo.putImage(old); emit(); }
        return false;
      }
      const rec = { id, blob, w, h, bytes: blob.size, createdAt: Date.now() };
      await repo.putImage(rec);
      recs.set(id, rec);
      emit();
      return true;
    },

    // Undo of a delete: shows it in the library again.
    async restore(id) {
      const r = recs.get(id);
      if (!r || !r.deleted) return false;
      r.deleted = false;
      await repo.putImage(r);
      emit();
      return true;
    },

    totalBytes() { return lib.list().reduce((s, r) => s + (r.bytes || 0), 0); }
  };
  return lib;
}

// Removes hidden pictures that no canvas uses; un-hides ones that are used
// again (their delete was undone).
export async function purgeDeleted(repo, recs, canvases) {
  const used = new Set();
  for (const c of canvases) for (const it of Object.values(c.items || {})) if (it.thumbId) used.add(it.thumbId);
  for (const r of [...recs.values()]) {
    if (!r.deleted) continue;
    if (used.has(r.id)) { r.deleted = false; await repo.putImage(r); continue; }
    await repo.deleteImage(r.id);
    recs.delete(r.id);
  }
}
