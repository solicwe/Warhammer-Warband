import type { GameState, PlayerId, UnitState } from '../engine/types';
import { hasKw, log } from '../engine/state';

export interface RisenRubricaeCandidate {
  unit: UnitState;
  kind: 'battleline' | 'other';
  selected: boolean;
  bearer: boolean;
}

/** Check if player has the Risen Rubricae enhancement */
export function hasRisenRubricae(s: GameState, p: PlayerId): boolean {
  return s.units.some((u) => u.owner === p && u.enhancements?.some((e) => e.name === 'Risen Rubricae'));
}

/** Get the bearer unit of Risen Rubricae */
export function risenRubricaeBearer(s: GameState, p: PlayerId): UnitState | undefined {
  return s.units.find((u) => u.owner === p && u.enhancements?.some((e) => e.name === 'Risen Rubricae'));
}

/** Check if unit is a Rubricae Battleline unit (Rubric Marines) */
export function isRubricaeBattleline(u: UnitState): boolean {
  const isRubricae = hasKw(u, 'RUBRICAE') || (u.sources ?? []).includes('Rubric Marines');
  const isBattleline = hasKw(u, 'BATTLELINE') || (u.sources ?? []).includes('Rubric Marines');
  return isRubricae && isBattleline;
}

/** Check if unit is other Rubricae (e.g. Scarab Occult Terminators, or standalone bearer) */
export function isOtherRubricae(u: UnitState): boolean {
  if (isRubricaeBattleline(u)) return false;
  return (
    hasKw(u, 'RUBRICAE') ||
    hasKw(u, 'TERMINATOR') ||
    (u.sources ?? []).includes('Scarab Occult Terminators') ||
    (u.enhancements ?? []).some((e) => e.name === 'Risen Rubricae')
  );
}

/** Get eligible candidates for Risen Rubricae */
export function risenRubricaeCandidates(s: GameState, p: PlayerId): RisenRubricaeCandidate[] {
  if (!hasRisenRubricae(s, p)) return [];
  const selectedIds = new Set(s.players[p]?.risenRubricae ?? []);
  const bearer = risenRubricaeBearer(s, p);

  return s.units
    .filter((u) => u.owner === p && (isRubricaeBattleline(u) || isOtherRubricae(u)))
    .map((u) => ({
      unit: u,
      kind: isRubricaeBattleline(u) ? ('battleline' as const) : ('other' as const),
      selected: selectedIds.has(u.id),
      bearer: bearer?.id === u.id,
    }));
}

/**
 * Apply Risen Rubricae selection:
 * - If selecting an "other" unit (Terminators / non-battleline): exactly 1 unit allowed.
 * - If selecting "battleline" units (Rubric Marines): up to 2 units allowed.
 * - Cannot mix battleline and other.
 */
export function setRisenRubricae(s: GameState, p: PlayerId, selectedIds: string[]): string | null {
  if (!hasRisenRubricae(s, p)) return 'Army does not have Risen Rubricae';
  const cands = risenRubricaeCandidates(s, p);
  const units = selectedIds
    .map((id) => cands.find((c) => c.unit.id === id))
    .filter((c): c is RisenRubricaeCandidate => !!c);

  const hasOther = units.some((c) => c.kind === 'other');
  if (hasOther && units.length > 1) {
    return 'Risen Rubricae can only select 1 Terminator/other Rubricae unit, or up to 2 Rubricae Battleline units';
  }
  if (!hasOther && units.length > 2) {
    return 'Risen Rubricae can select at most 2 Rubricae Battleline units';
  }

  const finalIds = units.map((c) => c.unit.id);
  const P = s.players[p];
  if (P) {
    P.risenRubricae = finalIds;
  }

  // Update Infiltrators on all candidate units
  for (const c of cands) {
    const isSel = finalIds.includes(c.unit.id);
    c.unit.core.infiltrators = isSel;
  }

  log(s, `Risen Rubricae: selected ${units.map((c) => c.unit.name).join(', ') || 'none'} for Infiltrators`, 'info', p);
  return null;
}

/**
 * Toggle a unit in the Risen Rubricae selection:
 * - If clicking an already selected unit: deselect it.
 * - If clicking a Terminator ("other"): switch to only this Terminator (deselects any Rubric Marines).
 * - If clicking a Rubric Marine ("battleline"): if a Terminator was selected, clear it and select this Rubric Marine.
 *   If another Rubric Marine was selected, add this one (up to 2). If 2 already selected, replace the second.
 */
export function toggleRisenRubricae(s: GameState, p: PlayerId, unitId: string): string | null {
  const current = new Set(s.players[p]?.risenRubricae ?? []);
  const cands = risenRubricaeCandidates(s, p);
  const target = cands.find((c) => c.unit.id === unitId);
  if (!target) return 'Unit is not eligible for Risen Rubricae';

  if (current.has(unitId)) {
    // Deselect
    const next = [...current].filter((id) => id !== unitId);
    return setRisenRubricae(s, p, next);
  }

  if (target.kind === 'other') {
    // Selecting Terminator: switches to only this 1 Terminator unit
    return setRisenRubricae(s, p, [unitId]);
  } else {
    // Selecting Rubric Marine (Battleline)
    const battlelineSelected = [...current].filter((id) => {
      const c = cands.find((x) => x.unit.id === id);
      return c && c.kind === 'battleline';
    });
    if (battlelineSelected.length >= 2) {
      battlelineSelected.pop();
    }
    battlelineSelected.push(unitId);
    return setRisenRubricae(s, p, battlelineSelected);
  }
}

/** Initial automatic selection of Risen Rubricae at start of game */
export function autoSelectRisenRubricae(s: GameState, p: PlayerId) {
  if (!hasRisenRubricae(s, p)) return;
  const cands = risenRubricaeCandidates(s, p);
  const bearer = cands.find((c) => c.bearer);

  let initial: string[] = [];
  if (bearer) {
    if (bearer.kind === 'other') {
      // Bearer is on/with Terminators: select this 1 Terminator unit
      initial = [bearer.unit.id];
    } else {
      // Bearer is on/with Rubric Marines: select bearer's unit + up to 1 other Rubric Marines
      const otherBattleline = cands.filter((c) => c.kind === 'battleline' && c.unit.id !== bearer.unit.id);
      initial = [bearer.unit.id, ...otherBattleline.slice(0, 1).map((c) => c.unit.id)];
    }
  } else {
    const bl = cands.filter((c) => c.kind === 'battleline');
    if (bl.length > 0) {
      initial = bl.slice(0, 2).map((c) => c.unit.id);
    } else {
      const oth = cands.filter((c) => c.kind === 'other');
      if (oth.length > 0) initial = [oth[0].unit.id];
    }
  }

  setRisenRubricae(s, p, initial);
}
