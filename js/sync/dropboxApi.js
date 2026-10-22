// The few Dropbox HTTP calls BlobBoard needs (phase 8). Paths are inside the
// app's own folder (Apps/SlimeGate/). getToken() gives the current access
// token; refresh() gets a new one (sign-in lasts: PKCE refresh token).
// Errors are DropboxError with kind: 'auth' (sign in again), 'conflict'
// (someone saved first / already exists), 'notfound', 'full', 'offline',
// 'rate', 'other'.
const RPC = 'https://api.dropboxapi.com/2/';
const CONTENT = 'https://content.dropboxapi.com/2/';
const NOTIFY = 'https://notify.dropboxapi.com/2/';

export class DropboxError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}

// Dropbox-API-Arg must be plain ASCII.
export const apiArg = obj => JSON.stringify(obj).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const wait = ms => new Promise(r => setTimeout(r, ms));

export function createDropboxApi({ getToken, refresh, fetchImpl = (...a) => fetch(...a), maxRetries = 3 }) {
  async function request(url, { headers = {}, body, auth = true } = {}, attempt = 0, refreshed = false) {
    let res;
    try {
      const h = { ...headers };
      if (auth) h.Authorization = 'Bearer ' + (await getToken());
      res = await fetchImpl(url, { method: 'POST', headers: h, body });
    } catch (err) {
      if (err instanceof DropboxError) throw err;
      throw new DropboxError('offline', 'No connection');
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => '');
    let summary = '';
    try { summary = JSON.parse(text).error_summary || ''; } catch (_) { summary = text.slice(0, 200); }
    if (res.status === 401) {
      if (auth && !refreshed && /expired_access_token|invalid_access_token/.test(summary + text)) {
        await refresh();
        return request(url, { headers, body, auth }, attempt, true);
      }
      throw new DropboxError('auth', 'Sign in to Dropbox again');
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const after = Number(res.headers.get('Retry-After')) || 2 ** attempt;
      await wait(Math.min(30, after) * 1000);
      return request(url, { headers, body, auth }, attempt + 1, refreshed);
    }
    if (res.status === 429) throw new DropboxError('rate', 'Dropbox is busy — trying again later');
    if (res.status === 409) {
      if (/insufficient_space/.test(summary)) throw new DropboxError('full', 'Your Dropbox is full');
      if (/not_found/.test(summary)) throw new DropboxError('notfound', summary);
      if (/conflict/.test(summary)) throw new DropboxError('conflict', summary);
    }
    if (res.status === 507) throw new DropboxError('full', 'Your Dropbox is full');
    throw new DropboxError('other', 'Dropbox error ' + res.status + (summary ? ': ' + summary : ''));
  }

  const rpc = async (endpoint, args) => {
    const res = await request(RPC + endpoint, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args === undefined ? null : args) });
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  };

  const api = {
    rpc,

    // mode: 'add' (fails if it exists) | 'overwrite' | { update: rev } (fails if
    // Dropbox has a newer version). Returns the file's metadata ({ rev, ... }).
    async upload(path, bytes, mode = 'overwrite') {
      const m = typeof mode === 'string' ? { '.tag': mode } : { '.tag': 'update', update: mode.update };
      const res = await request(CONTENT + 'files/upload', {
        headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': apiArg({ path, mode: m, autorename: false, mute: true }) },
        body: bytes
      });
      return res.json();
    },

    // { bytes, rev } or null if there is no such file.
    async download(path) {
      try {
        const res = await request(CONTENT + 'files/download', { headers: { 'Dropbox-API-Arg': apiArg({ path }) } });
        let meta = {};
        try { meta = JSON.parse(res.headers.get('Dropbox-API-Result') || '{}'); } catch (_) { /* rev unknown */ }
        return { bytes: new Uint8Array(await res.arrayBuffer()), rev: meta.rev || null };
      } catch (err) {
        if (err.kind === 'notfound') return null;
        throw err;
      }
    },

    // Every entry under `path` (all pages): { entries, cursor }. A missing
    // folder is empty.
    async listFolder(path, { recursive = false } = {}) {
      let r;
      try { r = await rpc('files/list_folder', { path, recursive, include_deleted: false, limit: 2000 }); } catch (err) {
        if (err.kind === 'notfound') return { entries: [], cursor: null };
        throw err;
      }
      const entries = [...r.entries];
      while (r.has_more) {
        r = await rpc('files/list_folder/continue', { cursor: r.cursor });
        entries.push(...r.entries);
      }
      return { entries, cursor: r.cursor };
    },

    async remove(path) {
      try { await rpc('files/delete_v2', { path }); return true; } catch (err) { if (err.kind === 'notfound') return false; throw err; }
    },

    async latestCursor(path) {
      const r = await rpc('files/list_folder/get_latest_cursor', { path, recursive: true, include_deleted: true });
      return r.cursor;
    },

    // Waits (up to `timeout` s) for a change under the cursor's folder. No
    // token needed. Returns { changes, backoff }.
    async longpoll(cursor, timeout = 60) {
      const res = await request(NOTIFY + 'files/list_folder/longpoll', {
        auth: false,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursor, timeout })
      });
      return res.json();
    }
  };
  return api;
}
