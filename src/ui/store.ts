import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { KEYS, readJSON, removeKey, writeJSON } from '../services/storage';
import type { GameState } from '../engine/types';
import { sanitizeGameState, updateControl } from '../engine/game';


export const SAVE_VERSION = 3;

export function loadSaved(): GameState | null {
  flushSave(); // a save still waiting goes in first
  try {
    const s = readJSON<GameState>(KEYS.game);
    if (s && s.version === SAVE_VERSION && Array.isArray(s.units)) {
      return sanitizeGameState(s);
    }
    return null; // saves from older app versions are ignored
  } catch {
    return null;
  }
}

export function clearSaved() {
  pending = null;
  removeKey(KEYS.game);
}

/** Write the save now (a long game is a big string: done when the app is idle, or when the page is hidden). */
let pending: GameState | null = null;
let timer: number | null = null;
function flushSave() {
  if (timer !== null) { window.clearTimeout(timer); timer = null; }
  if (!pending) return;
  const s = pending;
  pending = null;
  // storage full or blocked: say so (the game screen shows it), or the battle is silently lost on close
  if (!writeJSON(KEYS.game, s)) window.dispatchEvent(new CustomEvent('save-error'));
}
function queueSave(s: GameState) {
  pending = s;
  if (timer === null) timer = window.setTimeout(flushSave, 700);
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
}

export interface HistoryEntry { state: GameState; auto: boolean }

/**
 * Take back the player's last action together with everything the game did by itself after it (a bot step would
 * otherwise be undone and replayed at once, and an automatic roll would need a second tap). An attack in the middle of
 * its dice goes back to before the shot, not to a half-rolled stage. Pops what it uses off `h`; returns the state to show.
 */
export function undoTarget(h: HistoryEntry[]): GameState | undefined {
  let target: GameState | undefined;
  let firstAuto: GameState | undefined;
  while (h.length) {
    const e = h.pop()!;
    if (e.auto) { firstAuto = e.state; continue; }
    target = e.state;
    if (target.attack && h.length) continue;
    break;
  }
  return target ?? firstAuto; // only automatic steps left: go back before the first of them
}

/** Game state holder: every action runs synchronously on a clone of the latest state, then autosaves. */
export function useGame(initial: GameState, persist = true, readOnly = false, onCommit?: (state: GameState, undone: boolean) => void) {
  const sanitized = sanitizeGameState(initial);
  const ref = useRef<GameState>(sanitized);
  // each entry is the state before one action; `auto` marks what the game did by itself (bot steps, automatic rolls)
  const history = useRef<HistoryEntry[]>([]);
  const [state, setState] = useState<GameState>(sanitized);
  const [undoCount, setUndoCount] = useState(0);
  useLayoutEffect(() => {
    if (!readOnly) return;
    const next = sanitizeGameState(initial);
    ref.current = next;
    setState(next);
  }, [initial, readOnly]);
  // a battle left before its first action is still there to continue from the home screen
  useEffect(() => { if (persist) queueSave(ref.current); }, [persist]);
  const commit = (next: GameState, undone = false) => {
    sanitizeGameState(next);
    // who holds an objective follows the models as they move (it was fixed only at the end of each phase)
    if (next.phase !== 'deploy' && next.phase !== 'scouts' && next.phase !== 'gameover') updateControl(next, true);
    ref.current = next;
    setState(next);
    if (persist) queueSave(next);
    onCommit?.(next, undone);
  };
  const act = useCallback(<T,>(fn: (s: GameState) => T, auto = false): T => {
    if (readOnly) return undefined as T;
    const prev = ref.current;
    const next = structuredClone(prev);
    let out: T;
    try {
      out = fn(next);
    } catch (e) {
      // a failed action never touches the saved game; tell the screen instead of crashing
      console.error(e);
      window.dispatchEvent(new CustomEvent('game-error', { detail: e instanceof Error ? e.message : String(e) }));
      return undefined as T;
    }
    history.current.push({ state: prev, auto });
    if (history.current.length > 60) history.current.shift();
    setUndoCount(history.current.length);
    commit(next);
    return out;
  }, [onCommit, persist, readOnly]);
  const undo = useCallback(() => {
    if (readOnly) return;
    const target = undoTarget(history.current);
    setUndoCount(history.current.length);
    if (target) commit(target, true);
  }, [onCommit, persist, readOnly]);
  return { state, act, undo, canUndo: undoCount > 0 };
}
