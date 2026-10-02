// Line of sight on a 2D board (06.01, 13.07-13.11).
// Terrain areas with light/dense features are obscuring; dense walls are Solid at ground level.
import { RULES } from './config';
import { baseDist, circleTouchesPoly, samplePoints, segCrossesPoly, segsIntersect } from './geometry';
import { alive, everyModelKw } from './state';
import type { GameState, ModelState, Pt, TerrainPiece, UnitState } from './types';

interface Blockers { walls: { a: Pt; b: Pt }[]; areas: TerrainPiece[] }

function blockers(s: GameState, a: ModelState, b: ModelState, denseOnly = false): Blockers {
  const walls = s.terrain.filter((t) => t.category === 'dense').flatMap((t) => t.walls);
  const areas = s.terrain.filter(
    (t) => (denseOnly ? t.category === 'dense' : t.category !== 'exposed') && !circleTouchesPoly(a, a.r, t.poly) && !circleTouchesPoly(b, b.r, t.poly),
  );
  return { walls, areas };
}

const lineClear = (p: Pt, q: Pt, bl: Blockers) => {
  const seg = { a: p, b: q };
  return !bl.walls.some((w) => segsIntersect(seg, w)) && !bl.areas.some((t) => segCrossesPoly(seg, t.poly));
};

/** True line-of-sight test ignoring Hidden / Lone Operative. */
export function hasLos(s: GameState, a: ModelState, b: ModelState): boolean {
  const bl = blockers(s, a, b);
  const pa = samplePoints(a), pb = samplePoints(b);
  return pa.some((p) => pb.some((q) => lineClear(p, q, bl)));
}

/** Every part of `b` facing `a` is visible (approximated by sample points). */
export function fullyVisible(s: GameState, a: ModelState, b: ModelState, denseOnly = false): boolean {
  const bl = blockers(s, a, b, denseOnly);
  const pa = samplePoints(a);
  const facing = samplePoints(b).filter((q) => Math.hypot(q.x - a.x, q.y - a.y) <= Math.hypot(b.x - a.x, b.y - a.y) + 1e-6);
  return facing.every((q) => pa.some((p) => lineClear(p, q, bl)));
}

function shotRecently(s: GameState, u: UnitState) {
  return u.shotTurn >= s.turn - 1;
}

/** Hidden (13.09): INFANTRY/BEASTS/SWARM in a light/dense terrain area, no ranged attacks this or the previous turn. */
export function isHidden(s: GameState, u: UnitState, m: ModelState): boolean {
  if (!['INFANTRY', 'BEASTS', 'SWARM'].some((k) => m.keywords.includes(k))) return false;
  if (shotRecently(s, u)) return false;
  return s.terrain.some((t) => t.category !== 'exposed' && circleTouchesPoly(m, m.r, t.poly));
}

export function detectionRange(s: GameState, observer: ModelState, u: UnitState, m: ModelState): number {
  let range = RULES.hidden.detectionRange;
  if (!fullyVisible(s, observer, m, true)) range -= RULES.hidden.goneToGroundReduction; // gone to ground
  return range;
}

/** Can `observer` see model `m` of unit `u`, applying Hidden and Lone Operative. */
export function modelVisible(s: GameState, observer: ModelState, u: UnitState, m: ModelState): boolean {
  const d = baseDist(observer, m);
  if (u.core.loneOperative && u.sources.length === 1 && d > u.core.loneOperative) return false;
  if (isHidden(s, u, m) && d > detectionRange(s, observer, u, m)) return false;
  return hasLos(s, observer, m);
}

export function unitVisibleTo(s: GameState, observer: ModelState, u: UnitState): boolean {
  return alive(u).some((m) => modelVisible(s, observer, u, m));
}

/** Benefit of cover (13.08) against attacks from one attacking model. */
export function hasCover(s: GameState, attacker: ModelState, target: UnitState): boolean {
  if (target.core.stealth || target.buffs.some((b) => b.kind === 'smoke' || b.kind === 'cover')) return true;
  return alive(target).every((m) => {
    const inArea = ['INFANTRY', 'BEASTS', 'SWARM'].some((k) => m.keywords.includes(k)) && s.terrain.some((t) => circleTouchesPoly(m, m.r, t.poly));
    return inArea || !fullyVisible(s, attacker, m);
  });
}

export const unitIsInfantryLike = (u: UnitState) => everyModelKw(u, ['INFANTRY', 'BEASTS', 'SWARM']);
