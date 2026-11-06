import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { KEYS, readJSON, removeKey, writeJSON } from '../services/storage';
import type { GameState } from '../engine/types';
import { sanitizeGameState } from '../engine/game';


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

/** Game state holder: every action runs synchronously on a clone of the latest state, then autosaves. */
export function useGame(initial: GameState, persist = true, readOnly = false, onCommit?: (state: GameState, undone: boolean) => void) {
  const sanitized = sanitizeGameState(initial);
  const ref = useRef<GameState>(sanitized);
  const history = useRef<GameState[]>([]);
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
    ref.current = next;
    setState(next);
    if (persist) queueSave(next);
    onCommit?.(next, undone);
  };
  const act = useCallback(<T,>(fn: (s: GameState) => T): T => {
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
    history.current.push(prev);
    if (history.current.length > 60) history.current.shift();
    setUndoCount(history.current.length);
    commit(next);
    return out;
  }, [onCommit, persist, readOnly]);
  const undo = useCallback(() => {
    if (readOnly) return;
    const prev = history.current.pop();
    setUndoCount(history.current.length);
    if (prev) commit(prev, true);
  }, [onCommit, persist, readOnly]);
  return { state, act, undo, canUndo: undoCount > 0 };
}
