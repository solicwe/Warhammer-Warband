// T’au Empire army rule For the Greater Good. Observer units mark one visible enemy unit each as Spotted; units with
// the ability (excluding Observers) are Guided while targeting a Spotted unit: +1 BS, and [IGNORES COVER] when the
// Observer has MARKERLIGHT. The Observer is picked for the player when a Guided shot is made (the best one that can
// see the target), so a shot only becomes Guided when some unit could have spotted it.
// Detachment rules, enhancements, datasheet abilities and stratagems are data.
import { alive, boardUnits, hasKw, log, onBoard, pushFx, unitById } from '../engine/state';
import type { GameState, PlayerId, UnitState } from '../engine/types';
import { modelVisible } from '../engine/visibility';

type Spot = NonNullable<GameState['ftggPairs']>[number];

export const isTauArmy = (s: GameState, p: PlayerId) => !!s.players[p]?.armyRules?.some((r) => r.name === 'For the Greater Good');
export const hasFtgg = (u: UnitState) => u.abilities.some((a) => a.name === 'For the Greater Good');
export const hasMarkerlight = (u: UnitState) => u.keywords.includes('MARKERLIGHT');
const has = (u: UnitState, n: string) => u.abilities.some((a) => a.name === n);

const spotsNow = (s: GameState) => (s.ftggPairs ?? []).filter((p) => p.turn === s.turn && p.phase === s.phase);
export const spotOf = (s: GameState, T: UnitState): Spot | undefined => spotsNow(s).find((p) => p.spottedId === T.id);
export const isObserver = (s: GameState, u: UnitState) => spotsNow(s).some((p) => p.observerId === u.id);

/** Can this unit still become an Observer this phase (not shot yet, not Battle-shocked, not a FORTIFICATION)? */
export function canBeObserver(s: GameState, u: UnitState): boolean {
  return onBoard(u) && hasFtgg(u) && !u.battleShocked && !hasKw(u, 'FORTIFICATION') && u.shotTurn !== s.turn && !isObserver(s, u);
}

const sees = (s: GameState, o: UnitState, t: UnitState) => alive(o).some((m) => alive(t).some((n) => modelVisible(s, m, t, n)));

/** The Observer that spots T for A's shot: the one already spotting it, else the best free one that can see it
 *  (Pathfinders with Target Uploaded spot for themselves; then Forward Observers, MARKERLIGHT, the cheapest). */
export function observerFor(s: GameState, A: UnitState, T: UnitState): UnitState | undefined {
  if (s.phase !== 'shooting' || s.active !== A.owner || !isTauArmy(s, A.owner)) return undefined;
  const sp = spotOf(s, T);
  if (sp) return unitById(s, sp.observerId);
  if (has(A, 'Target Uploaded') && canBeObserver(s, A) && sees(s, A, T)) return A;
  if (!hasFtgg(A) || isObserver(s, A)) return undefined;
  const score = (u: UnitState) => (has(u, 'Forward Observers') ? 1000 : 0) + (hasMarkerlight(u) ? 500 : 0) - u.pts;
  return boardUnits(s, A.owner).filter((u) => u.id !== A.id && canBeObserver(s, u) && sees(s, u, T)).sort((a, b) => score(b) - score(a))[0];
}

/** A's attacks on T: Guided against a Spotted unit (or its own Spotted unit, for Target Uploaded). */
export function ftggMods(s: GameState, A: UnitState, T: UnitState) {
  const o = observerFor(s, A, T);
  if (!o) return null;
  if (o.id === A.id) return has(A, 'Target Uploaded') ? { skillBonus: 1, ignoresCover: true, notes: ['Target Uploaded: +1 BS, [IGNORES COVER]'] } : null;
  if (!hasFtgg(A) || isObserver(s, A)) return null;
  const fo = has(o, 'Forward Observers');
  return {
    skillBonus: 1, ignoresCover: hasMarkerlight(o), rerollHits1: fo, rerollWounds1: fo,
    notes: [`For the Greater Good (${o.name}): +1 BS${hasMarkerlight(o) ? ', [IGNORES COVER]' : ''}${fo ? ', re-roll 1s' : ''}`],
  };
}

/** Is A Guided against T right now (detachment rules and abilities ask: Kauyon, Mont’ka, Coordinated Strike)? */
export function guidedVs(s: GameState, A: UnitState, T: UnitState): boolean {
  const o = observerFor(s, A, T);
  return !!o && o.id !== A.id && hasFtgg(A) && !isObserver(s, A);
}

/** The shot is made: the Observer marks the target as Spotted for the rest of the phase. */
export function ftggTargetChosen(s: GameState, A: UnitState, T: UnitState) {
  if (spotOf(s, T)) return;
  const o = observerFor(s, A, T);
  if (!o) return;
  (s.ftggPairs ??= []).push({ guidedId: A.id, observerId: o.id, spottedId: T.id, turn: s.turn, phase: s.phase });
  log(s, `[Greater Good] For the Greater Good: ${o.name} marks ${T.name} as Spotted${o.id === A.id ? '' : ` for ${A.name}`}`, 'info', A.owner);
  const m = alive(o)[0];
  if (m) pushFx(s, { kind: 'skill', unitId: o.id, owner: o.owner, at: { x: m.x, y: m.y }, name: 'For the Greater Good', who: `Spotting ${T.name}`, style: 'holy', epic: false });
}
