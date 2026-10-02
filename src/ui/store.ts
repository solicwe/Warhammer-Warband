import { useCallback, useRef, useState } from 'react';
import type { GameState } from '../engine/types';

const KEY = 'w40k11-save';

export function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
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
  const [state, setState] = useState<GameState>(initial);
  const act = useCallback(<T,>(fn: (s: GameState) => T): T => {
    const next = structuredClone(ref.current);
    const out = fn(next);
    ref.current = next;
    setState(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
    return out;
  }, []);
  return { state, act };
}
