// Everything the app keeps on the device goes through here: army lists, the battle in progress, the campaign run,
// preferences and custom photos. Reads and writes never throw (a private window or a full / blocked storage just
// means this session only), so callers do not need their own try/catch. A cloud sync hooks in at this one place.
import type { Run } from '../engine/campaign';

/** The storage keys in use. */
export const KEYS = {
  armies: 'w40k11-armies',
  /** before the army library: exactly two lists, one per player */
  oldPair: 'w40k11-lists',
  battlePrefs: 'w40k11-battle',
  game: 'w40k11-save',
  portraits: 'w40k11-portraits',
  campaignRun: 'campaign-run',
  coach: 'coach',
  sound: 'sfx-on',
  fx: 'fx-level',
} as const;

export function readText(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** false when the value could not be stored (storage full or blocked) */
export function writeText(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function readJSON<T>(key: string): T | null {
  const raw = readText(key);
  if (raw === null) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export function writeJSON(key: string, value: unknown): boolean {
  let text: string;
  try { text = JSON.stringify(value); } catch { return false; }
  return writeText(key, text);
}

export function removeKey(key: string) {
  try { localStorage.removeItem(key); } catch { /* nothing stored */ }
}

// ---------- campaign ----------

export function loadRun(): Run | null {
  const v = readJSON<Run>(KEYS.campaignRun);
  return v && v.version === 1 && Array.isArray(v.map) ? v : null;
}

export function saveRun(run: Run | null) {
  if (run) writeJSON(KEYS.campaignRun, run); else removeKey(KEYS.campaignRun);
}
