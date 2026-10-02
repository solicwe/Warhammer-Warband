import { useCallback, useRef, useState } from 'react';
import type { GameState } from '../engine/types';

const KEY = 'w40k11-save';

export const SAVE_VERSION = 2;

export function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    return s && s.version === SAVE_VERSION && Array.isArray(s.units) ? s : null; // saves from older app versions are ignored
  } catch {
    return null;
  }
}

export function clearSaved() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Game state holder: every action runs synchronously on a clone of the latest state, then autosaves. */
export function useGame(initial: GameState) {
  const ref = useRef<GameState>(initial);
  const history = useRef<GameState[]>([]);
  const [state, setState] = useState<GameState>(initial);
  const [undoCount, setUndoCount] = useState(0);
  const commit = (next: GameState) => {
    ref.current = next;
    setState(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  };
  const act = useCallback(<T,>(fn: (s: GameState) => T): T => {
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
  }, []);
  const undo = useCallback(() => {
    const prev = history.current.pop();
    setUndoCount(history.current.length);
    if (prev) commit(prev);
  }, []);
  return { state, act, undo, canUndo: undoCount > 0 };
}
