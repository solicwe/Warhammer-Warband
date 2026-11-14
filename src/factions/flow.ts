// Hexwarp Thrallband: the army's Flow of Magic. Its own deployment zone always counts; No Man's Land counts for a phase
// when the army controls at least half of the objectives there at the start of that phase, and the opponent's
// deployment zone the same way. "Wholly within" means every model of the unit is inside the areas that count.
import { axis, circleTouchesPoly, EPS, girth, pointInPoly, pointSegDist, polyEdges, segSegDist } from '../engine/geometry';
import { zonePoly } from '../engine/missions';
import { alive, onBoard, other, phaseKey, tableH, tableW } from '../engine/state';
import type { GameState, ModelState, PlayerId, Pt, Seg, UnitState } from '../engine/types';

export const FLOW_DETACHMENT = 'Hexwarp Thrallband';
const NOCTILITH = 'Noctilith Mantle';

/** Checks whether a player's army currently has the Flow of Magic detachment rule active. */
export function hasFlowOfMagic(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (!P || P.factionId !== 'TS') return false;
  return (P.detachments ?? []).some(
    (d: any) => {
      const name = typeof d === 'string' ? d : d?.name;
      return name === FLOW_DETACHMENT || name === 'Flow of Magic' || (d?.rules ?? []).some((r: any) => r.name === 'Flow of Magic');
    }
  );
}

/** Check if an edge lies on the table border (outer boundary) rather than an interior deployment line */
function isTableEdge(e: Seg, W: number, H: number): boolean {
  return (
    (Math.abs(e.a.x) < 0.05 && Math.abs(e.b.x) < 0.05) ||
    (Math.abs(e.a.y) < 0.05 && Math.abs(e.b.y) < 0.05) ||
    (Math.abs(e.a.x - W) < 0.05 && Math.abs(e.b.x - W) < 0.05) ||
    (Math.abs(e.a.y - H) < 0.05 && Math.abs(e.b.y - H) < 0.05)
  );
}

/** Wholly in deployment zone: center is inside, and does not cross interior deployment lines into No Man's Land */
function modelWhollyInZone(m: ModelState, zone: Pt[], s: GameState): boolean {
  if (!pointInPoly(m, zone)) return false;
  const W = tableW(s), H = tableH(s);
  const interior = polyEdges(zone).filter((e) => !isTableEdge(e, W, H));
  if (!interior.length) return true;
  if (!m.hl) {
    return interior.every((e) => pointSegDist(m, e) >= m.r - EPS);
  }
  const ax = axis(m);
  return pointInPoly(ax.a, zone) && pointInPoly(ax.b, zone) && interior.every((e) => segSegDist(ax, e) >= girth(m) - EPS);
}

function circleWhollyInZone(pt: Pt, r: number, zone: Pt[], s: GameState): boolean {
  if (!pointInPoly(pt, zone)) return false;
  const W = tableW(s), H = tableH(s);
  const interior = polyEdges(zone).filter((e) => !isTableEdge(e, W, H));
  return interior.every((e) => pointSegDist(pt, e) >= r - EPS);
}

/** Which areas are in player p's Flow of Magic this phase (worked out the first time it is asked in a phase). */
export function flowAreas(s: GameState, p: PlayerId): { nml: boolean; opp: boolean } {
  const P = s.players[p];
  if (!P || !hasFlowOfMagic(s, p)) {
    if (P?.flow) delete P.flow;
    return { nml: false, opp: false };
  }
  const key = phaseKey(s);
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
  if (!hasFlowOfMagic(s, u.owner)) return false;
  if (!u.factionKeywords.includes('THOUSAND SONS') && !u.keywords.includes('THOUSAND SONS')) return false;
  if (u.enhancements.some((e) => e.name === NOCTILITH)) return true;
  const models = alive(u);
  if (!models.length) return false;
  const { nml, opp } = flowAreas(s, u.owner);
  if (nml && opp) return true;
  const ownZ = zonePoly(s, u.owner);
  if (nml) {
    const oppZ = zonePoly(s, other(u.owner));
    return models.every((m) => !circleTouchesPoly(m, m.r, oppZ) || modelWhollyInZone(m, ownZ, s));
  }
  if (opp) {
    const oppZ = zonePoly(s, other(u.owner));
    return models.every((m) => modelWhollyInZone(m, ownZ, s) || modelWhollyInZone(m, oppZ, s));
  }
  return models.every((m) => modelWhollyInZone(m, ownZ, s));
}

/** Is a base at this spot wholly within player p's Flow of Magic? */
export function circleInFlow(s: GameState, p: PlayerId, m: { x: number; y: number }, r: number): boolean {
  if (!hasFlowOfMagic(s, p)) return false;
  const { nml, opp } = flowAreas(s, p);
  if (nml && opp) return true;
  const ownZ = zonePoly(s, p);
  if (nml) {
    const oppZ = zonePoly(s, other(p));
    return !circleTouchesPoly(m, r, oppZ) || circleWhollyInZone(m, r, ownZ, s);
  }
  if (opp) {
    const oppZ = zonePoly(s, other(p));
    return circleWhollyInZone(m, r, ownZ, s) || circleWhollyInZone(m, r, oppZ, s);
  }
  return circleWhollyInZone(m, r, ownZ, s);
}

export function isThousandSonsArmy(s: GameState, p: PlayerId): boolean {
  return hasFlowOfMagic(s, p);
}
