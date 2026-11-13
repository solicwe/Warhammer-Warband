// Everything the app keeps on the device goes through here: army lists, the battle in progress,
// preferences and custom photos. Reads and writes never throw (a private window or a full / blocked storage just
// means this session only), so callers do not need their own try/catch. A cloud sync hooks in at this one place.
import type { GameState } from '../engine/types';

/** The storage keys in use. */
export const KEYS = {
  armies: 'w40k11-armies',
  /** before the army library: exactly two lists, one per player */
  oldPair: 'w40k11-lists',
  battlePrefs: 'w40k11-battle',
  game: 'w40k11-save',
  portraits: 'w40k11-portraits',
  coach: 'coach',
  sound: 'sfx-on',
  fx: 'fx-level',
  liveMap: 'live-map-on',
  fastShooting: 'fast-shooting',
  botTactics: 'bot-tactics',
  battleLogs: 'w40k11-battle-logs',
} as const;

// Ensure any legacy campaign keys are permanently purged from device storage
try {
  localStorage.removeItem('campaign-run');
  localStorage.removeItem('campaign-presets');
  localStorage.removeItem('campaign-state');
  localStorage.removeItem('w40k-campaign');
} catch {
  // ignore in private/restricted browsing
}

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

// ---------- battle logs & match history ----------

export interface BattleRecord {
  id: string;
  timestamp: number;
  mode: 'simulator' | 'tabletop';
  title?: string;
  players: {
    name: string;
    faction?: string;
    score: number;
    cp?: number;
    isWinner?: boolean;
  }[];
  turn: number;
  maxTurns?: number;
  layoutName?: string;
  summary?: string;
  replayState?: {
    seed: number;
    timeline?: string;
    savedGame?: GameState;
  };
}

export function loadBattleLogs(): BattleRecord[] {
  const logs = readJSON<BattleRecord[]>(KEYS.battleLogs);
  if (!Array.isArray(logs)) return [];
  let hadSavedGame = false;
  const cleaned = logs.map((r) => {
    if (r.replayState && 'savedGame' in r.replayState) {
      hadSavedGame = true;
      const { savedGame: _, ...cleanReplay } = r.replayState as { savedGame?: unknown; seed: number; timeline?: string };
      return { ...r, replayState: cleanReplay };
    }
    return r;
  });
  if (hadSavedGame) {
    writeJSON(KEYS.battleLogs, cleaned);
  }
  return cleaned;
}

export function saveBattleLog(record: BattleRecord): void {
  const current = loadBattleLogs();
  const cleanRecord: BattleRecord = {
    ...record,
    replayState: record.replayState ? {
      seed: record.replayState.seed,
      ...(record.replayState.timeline ? { timeline: record.replayState.timeline } : {}),
    } : undefined,
  };
  const filtered = current.filter((r) => r.id !== cleanRecord.id);
  const trimmed = [cleanRecord, ...filtered].slice(0, 30).map((r, idx) => {
    if (idx >= 10 && r.replayState?.timeline) {
      const { timeline: _, ...restReplay } = r.replayState;
      return { ...r, replayState: restReplay };
    }
    return r;
  });
  if (!writeJSON(KEYS.battleLogs, trimmed)) {
    const minimal = [cleanRecord, ...filtered].slice(0, 15).map((r, idx) => {
      if (idx >= 5 && r.replayState?.timeline) {
        const { timeline: _, ...restReplay } = r.replayState;
        return { ...r, replayState: restReplay };
      }
      return r;
    });
    writeJSON(KEYS.battleLogs, minimal);
  }
}

export function deleteBattleLog(id: string): void {
  const current = loadBattleLogs();
  const updated = current.filter((r) => r.id !== id);
  writeJSON(KEYS.battleLogs, updated);
}

export function clearBattleLogs(): void {
  removeKey(KEYS.battleLogs);
}
