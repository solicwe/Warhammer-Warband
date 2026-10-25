// A save file: everything the app keeps for the player in one JSON file, to move armies and the campaign to another
// device or keep a copy. No account and no server; the file is checked whole before anything is written.
import { KEYS, readText, removeKey, writeText } from './storage';

/** What a save holds: armies, the campaign run, the battle in progress and settings. Custom photos have their own export. */
export const SAVE_KEYS: string[] = [KEYS.armies, KEYS.battlePrefs, KEYS.game, KEYS.campaignRun, KEYS.coach, KEYS.sound, KEYS.fx];

export interface SaveFile { kind: 'warhammer-warband-save'; version: 1; savedAt: number; data: Record<string, string> }

export function makeSave(): SaveFile {
  const data: Record<string, string> = {};
  for (const k of SAVE_KEYS) { const v = readText(k); if (v !== null) data[k] = v; }
  return { kind: 'warhammer-warband-save', version: 1, savedAt: Date.now(), data };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

/** Only our keys, only text, readable JSON, and armies that look like army lists; anything else is refused whole. */
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
