import { useCallback, useRef, useState } from 'react';
import type { GameState } from '../engine/types';

const KEY = 'w40k11-save';

export const SAVE_VERSION = 3;

export function loadSaved(): GameState | null {
  flushSave(); // a save still waiting goes in first
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
  pending = null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Write the save now (a long game is a big string: done when the app is idle, or when the page is hidden). */
let pending: GameState | null = null;
let timer: number | null = null;
function flushSave() {
  if (timer !== null) { window.clearTimeout(timer); timer = null; }
  if (!pending) return;
  const s = pending;
  pending = null;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked */ }
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
export function useGame(initial: GameState) {
  const ref = useRef<GameState>(initial);
  const history = useRef<GameState[]>([]);
  const [state, setState] = useState<GameState>(initial);
  const [undoCount, setUndoCount] = useState(0);
  const commit = (next: GameState) => {
    ref.current = next;
    setState(next);
    queueSave(next);
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
