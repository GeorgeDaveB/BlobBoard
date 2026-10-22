// Dropbox sign-in (phase 8): OAuth 2 "authorization code + PKCE" for a
// public client — no app secret anywhere. The person signs in on Dropbox's
// own page; we get a short access token + a long-lived refresh token, kept
// in this device's database (setting 'dropbox'). Nothing here ever sees the
// Dropbox password.
import { DROPBOX_APP_KEY } from '../config.js';
import { toBase64 } from '../services/backup.js';

const AUTHORIZE = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN = 'https://api.dropboxapi.com/oauth2/token';
const PKCE_KEY = 'slimegate-pkce';

const b64url = bytes => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The page Dropbox sends people back to: this folder (must match the app's
// registered Redirect URIs exactly).
export function redirectUri(loc = location) {
  return loc.origin + loc.pathname.replace(/[^/]*$/, '');
}

export async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export function authorizeUrl({ challenge, state, redirect = redirectUri(), appKey = DROPBOX_APP_KEY }) {
  const q = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: redirect,
    state
  });
  return AUTHORIZE + '?' + q.toString();
}

export function createDropboxAuth({ repo, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
  let tokens = null; // { access, expiresAt, refresh, accountId }
  let loaded = false;
  let refreshing = null;

  async function load() {
    if (!loaded) { tokens = (await repo.getSetting('dropbox')) || null; loaded = true; }
    return tokens;
  }
  function save(t) {
    tokens = t;
    repo.setSetting('dropbox', t);
  }

  async function postToken(params) {
    let res;
    try {
      res = await fetchImpl(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    } catch (_) {
      const e = new Error('No connection');
      e.kind = 'offline';
      throw e;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error_description || data.error || 'Dropbox sign-in failed');
      e.kind = res.status === 400 || res.status === 401 ? 'auth' : 'other';
      throw e;
    }
    return data;
  }

  const auth = {
    async isConnected() { return !!(await load()); },
    async accountId() { const t = await load(); return t ? t.accountId : null; },

    // Goes to Dropbox's sign-in page (leaves the app; it comes back to
    // redirectUri with ?code=…).
    async connect() {
      const { verifier, challenge } = await pkcePair();
      const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
      try { localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, at: now() })); } catch (_) { /* private mode: sign-in will fail cleanly */ }
      if (repo.flush) await repo.flush();
      location.assign(authorizeUrl({ challenge, state }));
    },

    // On start: finishes a sign-in if Dropbox just sent us back. Returns
    // 'connected' | 'denied' | 'failed' | null (nothing to do).
    async handleRedirect(loc = location) {
      const q = new URLSearchParams(loc.search);
      if (!q.has('code') && !q.has('error')) return null;
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null'); localStorage.removeItem(PKCE_KEY); } catch (_) { saved = null; }
      history.replaceState(history.state, '', loc.pathname + loc.hash);
      if (q.has('error')) return 'denied';
      if (!saved || saved.state !== q.get('state') || now() - saved.at > 30 * 60 * 1000) return 'failed';
      try {
        const t = await postToken({ code: q.get('code'), grant_type: 'authorization_code', client_id: DROPBOX_APP_KEY, code_verifier: saved.verifier, redirect_uri: redirectUri(loc) });
        save({ access: t.access_token, expiresAt: now() + (t.expires_in || 14400) * 1000, refresh: t.refresh_token, accountId: t.account_id || '' });
        return 'connected';
      } catch (_) {
        return 'failed';
      }
    },

    // A valid access token (refreshed when about to expire).
    async getToken() {
      const t = await load();
      if (!t) { const e = new Error('Not connected'); e.kind = 'auth'; throw e; }
      if (t.expiresAt - 60000 > now()) return t.access;
      await auth.refresh();
      return tokens.access;
    },

    async refresh() {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        const t = await load();
        if (!t || !t.refresh) { const e = new Error('Not connected'); e.kind = 'auth'; throw e; }
        const r = await postToken({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: DROPBOX_APP_KEY });
        save({ ...t, access: r.access_token, expiresAt: now() + (r.expires_in || 14400) * 1000 });
      })().finally(() => { refreshing = null; });
      return refreshing;
    },

    // Signs this device out (Dropbox forgets the token too, when online).
    async disconnect() {
      const t = await load();
      if (t) {
        try { await fetchImpl('https://api.dropboxapi.com/2/auth/token/revoke', { method: 'POST', headers: { Authorization: 'Bearer ' + t.access } }); } catch (_) { /* offline: forget locally anyway */ }
      }
      save(null);
    }
  };
  return auth;
}
