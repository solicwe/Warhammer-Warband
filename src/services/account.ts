// Sign-in and saves that follow the player between devices, with no server of our own: Google sign-in runs in the
// browser (Google Identity Services) and the save goes to the hidden app folder of the player's own Google Drive.
// The access token is kept in memory only; what stays on the device between sessions is who signed in.
import { KEYS, readJSON, readText, removeKey, setWriteHook, writeJSON, writeText } from './storage';

/** The Google OAuth client id, set at build time (VITE_GOOGLE_CLIENT_ID). It is public, not a secret. */
export const CLIENT_ID = ((import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '').trim();
const SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
const FILE = 'warhammer-warband-save.json';
const PROFILE_KEY = 'warband-account';
const BACKUP_DELAY = 20_000;

/** What a save holds: armies, the campaign run, the battle in progress and settings. Custom photos have their own export. */
export const SAVE_KEYS: string[] = [KEYS.armies, KEYS.battlePrefs, KEYS.game, KEYS.campaignRun, KEYS.coach, KEYS.sound, KEYS.fx];

export interface Profile { email: string; name: string; picture?: string }
export interface SaveFile { kind: 'warhammer-warband-save'; version: 1; savedAt: number; data: Record<string, string> }
export interface AccountStatus { profile: Profile | null; busy: boolean; lastBackup: number | null; error: string | null; originHint: boolean }

export function makeSave(): SaveFile {
  const data: Record<string, string> = {};
  for (const k of SAVE_KEYS) { const v = readText(k); if (v !== null) data[k] = v; }
  return { kind: 'warhammer-warband-save', version: 1, savedAt: Date.now(), data };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

/** A save from a file or from Drive is checked before anything is written: only our keys, only text, readable JSON,
 *  and the armies must look like army lists. Anything else is refused whole. */
export function parseSave(text: string): SaveFile | null {
  if (text.length > 25_000_000) return null;
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  const f = j as Partial<SaveFile>;
  if (!isObj(j) || f.kind !== 'warhammer-warband-save' || f.version !== 1 || !isObj(f.data)) return null;
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.data!)) {
    if (!SAVE_KEYS.includes(k) || typeof v !== 'string') return null;
    data[k] = v;
  }
  for (const k of [KEYS.armies, KEYS.battlePrefs, KEYS.game, KEYS.campaignRun]) {
    if (data[k] === undefined) continue;
    let v: unknown;
    try { v = JSON.parse(data[k]); } catch { return null; }
    if (k === KEYS.armies ? !Array.isArray(v) || !v.every((a) => isObj(a) && typeof a.factionId === 'string' && Array.isArray(a.units) && (a.name === undefined || typeof a.name === 'string')) : !isObj(v)) return null;
  }
  return { kind: 'warhammer-warband-save', version: 1, savedAt: Number(f.savedAt) || 0, data };
}

/** Replaces this device's saves with the file's (keys the file doesn't have are cleared, as in the file). */
export function applySave(f: SaveFile) {
  for (const k of SAVE_KEYS) if (k in f.data) writeText(k, f.data[k]); else removeKey(k);
}

// ---------- status ----------

let status: AccountStatus = { profile: readJSON<Profile>(PROFILE_KEY), busy: false, lastBackup: null, error: null, originHint: false };
const listeners = new Set<() => void>();
const set = (p: Partial<AccountStatus>) => { status = { ...status, ...p }; listeners.forEach((l) => l()); };
export const accountStatus = () => status;
export const onAccountChange = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

// ---------- Google ----------

type TokenClient = { requestAccessToken: (o?: { prompt?: string; login_hint?: string }) => void };
type TokenReply = { access_token?: string; expires_in?: number };
declare global {
  interface Window {
    google?: { accounts: { oauth2: {
      initTokenClient: (c: { client_id: string; scope: string; callback: (r: TokenReply) => void; error_callback: (e: { type?: string }) => void }) => TokenClient;
      revoke: (token: string, done?: () => void) => void;
    } } };
  }
}

let token: { value: string; until: number } | null = null;
let client: TokenClient | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

/** Fetched ahead (when the account panel shows), so a tap opens Google's window straight away. */
export function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://accounts.google.com/gsi/client';
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Could not reach Google. Check the connection and try again.'));
    document.head.appendChild(el);
  });
}

/** A Drive token: the one in memory while it is good, else Google asks (a quick window; must follow a tap). */
async function accessToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  if (!CLIENT_ID) throw new Error('Google sign-in is not set up for this site.');
  await loadGis();
  client ??= window.google!.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (r) => {
      const p = pending; pending = null;
      if (!r.access_token) { p?.reject(new Error('Google did not give access.')); return; }
      token = { value: r.access_token, until: Date.now() + (r.expires_in ?? 3600) * 1000 };
      p?.resolve(r.access_token);
    },
    error_callback: (e) => {
      const p = pending; pending = null;
      if (e.type === 'popup_failed_to_open') p?.reject(new Error('The sign-in window was blocked. Allow pop-ups for this site and try again.'));
      else { set({ originHint: true }); p?.reject(new Error('The sign-in window was closed before it finished.')); }
    },
  });
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client!.requestAccessToken({ prompt: status.profile ? '' : 'select_account', login_hint: status.profile?.email });
  });
}

async function google(url: string, init: RequestInit = {}): Promise<Response> {
  const t = await accessToken();
  const r = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${t}` } });
  if (r.status === 401) { token = null; throw new Error('Your Google session ended. Tap again to sign in.'); }
  if (!r.ok) throw new Error(`Google answered ${r.status}. Try again in a moment.`);
  return r;
}

async function driveFile(): Promise<{ id: string } | null> {
  const q = encodeURIComponent(`name='${FILE}'`);
  const r = await google(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
  return ((await r.json()) as { files?: { id: string }[] }).files?.[0] ?? null;
}

export async function cloudLoad(): Promise<SaveFile | null> {
  const f = await driveFile();
  if (!f) return null;
  return parseSave(await (await google(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`)).text());
}

export async function cloudSave(): Promise<void> {
  const body = JSON.stringify(makeSave());
  const f = await driveFile();
  if (f) {
    await google(`https://www.googleapis.com/upload/drive/v3/files/${f.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
  } else {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name: FILE, parents: ['appDataFolder'] })], { type: 'application/json' }));
    form.append('file', new Blob([body], { type: 'application/json' }));
    await google('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', body: form });
  }
  set({ lastBackup: Date.now() });
}

/** Runs one account step with the busy flag and a readable error. */
export async function withStatus<T>(step: () => Promise<T>): Promise<T | undefined> {
  set({ busy: true, error: null });
  try { return await step(); } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); return undefined; } finally { set({ busy: false }); }
}

/** Signs in and reads the Google backup: returned so the screen can offer it (or use it on a device with nothing yet). */
export async function signIn(): Promise<SaveFile | null> {
  const r = await google('https://www.googleapis.com/oauth2/v3/userinfo');
  const u = (await r.json()) as { email?: string; name?: string; picture?: string };
  const profile: Profile = { email: String(u.email ?? ''), name: String(u.name ?? u.email ?? 'Google account'), ...(typeof u.picture === 'string' && u.picture.startsWith('https://') ? { picture: u.picture } : {}) };
  writeJSON(PROFILE_KEY, profile);
  set({ profile, originHint: false });
  const cloud = await cloudLoad();
  if (!cloud) await cloudSave();
  return cloud;
}

export function signOut() {
  if (token) window.google?.accounts.oauth2.revoke(token.value);
  token = null;
  removeKey(PROFILE_KEY);
  set({ profile: null, lastBackup: null, error: null });
}

// a signed-in player's saves go up a little after they change, while the session's token is still good
let timer: number | undefined;
setWriteHook((key) => {
  if (!SAVE_KEYS.includes(key) || !status.profile || !token || token.until < Date.now() + 60_000) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { cloudSave().catch(() => { /* the next change or "Back up now" tries again */ }); }, BACKUP_DELAY);
});
