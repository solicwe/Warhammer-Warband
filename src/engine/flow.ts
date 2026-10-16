// Hexwarp Thrallband: the army's Flow of Magic. Its own deployment zone always counts; No Man's Land counts for a phase
// when the army controls at least half of the objectives there at the start of that phase, and the opponent's
// deployment zone the same way. "Wholly within" means every model of the unit is inside the areas that count.
import { circleTouchesPoly, circleWhollyInPoly, pointInPoly } from './geometry';
import { zonePoly } from './missions';
import { alive, onBoard, other, phaseKey } from './state';
import type { GameState, PlayerId, UnitState } from './types';

export const FLOW_DETACHMENT = 'Hexwarp Thrallband';
const NOCTILITH = 'Noctilith Mantle';

/** Which areas are in player p's Flow of Magic this phase (worked out the first time it is asked in a phase). */
export function flowAreas(s: GameState, p: PlayerId): { nml: boolean; opp: boolean } {
  const key = phaseKey(s);
  const P = s.players[p];
  if (P.flow?.key === key) return P.flow;
  const own = zonePoly(s, p), opp = zonePoly(s, other(p));
  const nmlObjs = s.objectives.filter((o) => !pointInPoly(o, own) && !pointInPoly(o, opp));
  const oppObjs = s.objectives.filter((o) => pointInPoly(o, opp));
  const half = (list: typeof s.objectives) => list.length > 0 && list.filter((o) => o.controller === p).length * 2 >= list.length;
  P.flow = { key, nml: half(nmlObjs), opp: half(oppObjs) };
  return P.flow;
}

/** Is the unit wholly within its army's Flow of Magic? */
export function inFlow(s: GameState, u: UnitState): boolean {
  if (!onBoard(u)) return false;
  if (!isThousandSonsArmy(s, u.owner)) return false;
  if (u.enhancements.some((e) => e.name === NOCTILITH)) return true;
  return alive(u).every((m) => circleInFlow(s, u.owner, m, m.r));
}

/** Is a base at this spot wholly within player p's Flow of Magic? */
export function circleInFlow(s: GameState, p: PlayerId, m: { x: number; y: number }, r: number): boolean {
  const { nml, opp } = flowAreas(s, p);
  const ownZ = zonePoly(s, p), oppZ = zonePoly(s, other(p));
  if (nml && opp) return true;
  if (nml) return !circleTouchesPoly(m, r, oppZ) || circleWhollyInPoly(m, r, ownZ);
  if (opp) return circleWhollyInPoly(m, r, ownZ) || circleWhollyInPoly(m, r, oppZ);
  return circleWhollyInPoly(m, r, ownZ);
}

export function isThousandSonsArmy(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (!P) return false;
  return P.factionId === 'TS' || (P.detachments ?? []).some((d) => d.name === 'Hexwarp Thrallband' || d.name === 'Flow of Magic' || (d.rules ?? []).some((r) => r.name === 'Flow of Magic'));
}
