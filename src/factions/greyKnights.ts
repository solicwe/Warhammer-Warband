// Grey Knights: Hallowed Ground (Warpbane Task Force). Gate of Infinity, the other detachment rules,
// enhancements, datasheet abilities and stratagems are data (detachment-rules.json, abilities/GK.json, stratagems/GK.json).
import { alive, boardUnits, other } from '../engine/state';
import { dist, pointInPoly } from '../engine/geometry';
import { zonePoly } from '../engine/missions';
import type { GameState, PlayerId, Pt, UnitState } from '../engine/types';

/** Is this point within the player's Hallowed Ground: the own deployment zone, 6" around PURIFIER SQUAD units, and
 *  No Man's Land / the enemy deployment zone while the player controls at least half of the objective markers in it. */
export function inHallowedGround(s: GameState, p: PlayerId, q: Pt): boolean {
  const own = zonePoly(s, p), opp = zonePoly(s, other(p));
  if (pointInPoly(q, own)) return true;
  if (boardUnits(s, p).some((u) => u.keywords.includes('PURIFIER SQUAD') && alive(u).some((m) => dist(q, m) - m.r <= 6 + 1e-6))) return true;
  const nml = (o: Pt) => !pointInPoly(o, own) && !pointInPoly(o, opp);
  const half = (inZone: (o: Pt) => boolean) => { const os = s.objectives.filter(inZone); return os.length > 0 && os.filter((o) => o.controller === p).length * 2 >= os.length; };
  return (nml(q) && half(nml)) || (pointInPoly(q, opp) && half((o) => pointInPoly(o, opp)));
}

/** The unit is wholly within its army's Hallowed Ground (Paragon of Sanctity puts a unit there for a phase). */
export function whollyHallowed(s: GameState, u: UnitState): boolean {
  if ((u.timed ?? []).some((t) => t.mark === 'Paragon of Sanctity')) return true;
  const ms = alive(u);
  return ms.length > 0 && ms.every((m) => inHallowedGround(s, u.owner, m));
}
