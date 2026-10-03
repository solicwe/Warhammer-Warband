// Line of sight on a 2D board (06.01, 13.07-13.11).
// Terrain areas with light/dense features are obscuring; dense walls are Solid at ground level.
import { RULES } from './config';
import { baseDist, circleTouchesPoly, samplePoints, segCrossesPoly, segsIntersect } from './geometry';
import { alive, everyModelKw } from './state';
import type { GameState, ModelState, Pt, TerrainPiece, UnitState } from './types';

interface Blockers { walls: { a: Pt; b: Pt }[]; areas: TerrainPiece[] }

/** Rules from abilities that change visibility (registered by effects.ts so this module stays dependency-free). */
export interface VisibilityHooks {
  loneOperative?: (s: GameState, u: UnitState) => boolean;
  detection?: (s: GameState, u: UnitState) => number;
  cannotBeHidden?: (s: GameState, u: UnitState) => boolean;
}
let hooks: VisibilityHooks = {};
export const setVisibilityHooks = (h: VisibilityHooks) => { hooks = h; };

interface Box { x0: number; y0: number; x1: number; y1: number }
const boxes = new WeakMap<TerrainPiece, Box>();
function boxOf(t: TerrainPiece): Box {
  let b = boxes.get(t);
  if (!b) {
    const pts = [...t.poly, ...t.walls.flatMap((w) => [w.a, w.b])];
    b = { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
    boxes.set(t, b);
  }
  return b;
}

function blockers(s: GameState, a: ModelState, b: ModelState, denseOnly = false): Blockers {
  // only terrain overlapping the box around both models can be crossed by a line between them
  const x0 = Math.min(a.x - a.r, b.x - b.r), x1 = Math.max(a.x + a.r, b.x + b.r);
  const y0 = Math.min(a.y - a.r, b.y - b.r), y1 = Math.max(a.y + a.r, b.y + b.r);
  const near = s.terrain.filter((t) => { const q = boxOf(t); return q.x1 >= x0 && q.x0 <= x1 && q.y1 >= y0 && q.y0 <= y1; });
  const walls = near.filter((t) => t.category === 'dense').flatMap((t) => t.walls);
  const areas = near.filter(
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
  if (hooks.cannotBeHidden?.(s, u)) return false;
  if (shotRecently(s, u)) return false;
  return s.terrain.some((t) => t.category !== 'exposed' && circleTouchesPoly(m, m.r, t.poly));
}

export function detectionRange(s: GameState, observer: ModelState, u: UnitState, m: ModelState): number {
  let range = RULES.hidden.detectionRange + (hooks.detection?.(s, u) ?? 0);
  if (!fullyVisible(s, observer, m, true)) range -= RULES.hidden.goneToGroundReduction; // gone to ground
  return range;
}

/** Can `observer` see model `m` of unit `u`, applying Hidden and Lone Operative. */
export function modelVisible(s: GameState, observer: ModelState, u: UnitState, m: ModelState): boolean {
  const d = baseDist(observer, m);
  if (u.sources.length === 1 && (u.core.loneOperative || hooks.loneOperative?.(s, u)) && d > (u.core.loneOperative ?? 12)) return false;
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
