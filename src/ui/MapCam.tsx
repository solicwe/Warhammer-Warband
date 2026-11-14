import type { GameState, Pt, UnitState } from '../engine/types';

/** Former live map / mirror camera module — removed per user request. */
export function camFocus(_picked: UnitState | null): Pt | null {
  return null;
}

export function MapCam(_props: { s: GameState; focus: Pt | null; onClose?: () => void; forceShow?: boolean }) {
  return null;
}
