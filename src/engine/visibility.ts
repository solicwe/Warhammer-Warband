// Line of sight on a 2D board (06.01, 13.07-13.11).
// Terrain areas with light/dense features are obscuring; dense walls are Solid at ground level.
import { RULES } from './config';
import { baseDist, circleTouchesPoly, pointInPoly, pointSegDist, samplePoints, segCrossesPoly, segLengthInPoly, segSegDist, segsTouch } from './geometry';
import { alive, everyModelKw } from './state';
import type { GameState, ModelState, Pt, TerrainPiece, UnitState } from './types';

interface Blockers { walls: { a: Pt; b: Pt }[]; areas: { poly: Pt[] }[]; own: { t: TerrainPiece; reach: number }[] }

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

/** Is the model in this terrain area, so the area doesn't hide what's beyond it (13.10)? Its base must be on the
 *  plate, not just touching the edge: a model beside a ruin with its rim over the plate doesn't see through the whole
 *  ruin, and isn't seen through it either. */
function standsIn(m: ModelState, t: TerrainPiece): boolean {
  return pointInPoly(m, t.poly);
}

/** Two terrain areas whose footprints all but touch (a hairline left between them where the layout was traced):
 *  the crack between them is closed, so no line of sight slips through a corner the two pieces share. */
interface Bridge { poly: Pt[]; box: Box; of: [TerrainPiece, TerrainPiece]; dense: boolean }
const BRIDGE_GAP = 0.6;
const bridgeCache = new Map<string, Bridge[]>();
function polyDist(p: Pt, poly: Pt[]): number {
  if (pointInPoly(p, poly)) return 0;
  return Math.min(...poly.map((q, i) => pointSegDist(p, { a: q, b: poly[(i + 1) % poly.length] })));
}
function edgePoints(poly: Pt[], step = 0.25): Pt[] {
  const out: Pt[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  });
  return out;
}
function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
const bridgeByList = new WeakMap<TerrainPiece[], Bridge[]>();
function bridgesOf(s: GameState): Bridge[] {
  const hit = bridgeByList.get(s.terrain);
  if (hit) return hit;
  const key = s.terrain.map((t) => `${t.id}:${t.category}:${t.poly[0]?.x},${t.poly[0]?.y}`).join('|');
  let out = bridgeCache.get(key);
  if (out) { bridgeByList.set(s.terrain, out); return out; }
  out = [];
  const obs = s.terrain.filter((t) => t.category !== 'exposed');
  for (let i = 0; i < obs.length; i++) for (let j = i + 1; j < obs.length; j++) {
    const A = obs[i], B = obs[j], qa = boxOf(A), qb = boxOf(B);
    if (qa.x0 > qb.x1 + BRIDGE_GAP || qb.x0 > qa.x1 + BRIDGE_GAP || qa.y0 > qb.y1 + BRIDGE_GAP || qb.y0 > qa.y1 + BRIDGE_GAP) continue;
    const near = [...edgePoints(A.poly).filter((p) => polyDist(p, B.poly) <= BRIDGE_GAP), ...edgePoints(B.poly).filter((p) => polyDist(p, A.poly) <= BRIDGE_GAP)];
    // pieces that overlap need no bridge; a real gap (one sees between them) is wider than BRIDGE_GAP
    if (near.length < 3 || near.some((p) => pointInPoly(p, A.poly) && pointInPoly(p, B.poly))) continue;
    const poly = hull(near);
    if (poly.length >= 3) out.push({ poly, of: [A, B], dense: A.category === 'dense' && B.category === 'dense',
      box: { x0: Math.min(...poly.map((p) => p.x)), y0: Math.min(...poly.map((p) => p.y)), x1: Math.max(...poly.map((p) => p.x)), y1: Math.max(...poly.map((p) => p.y)) } });
  }
  if (bridgeCache.size > 50) bridgeCache.clear();
  bridgeCache.set(key, out);
  bridgeByList.set(s.terrain, out);
  return out;
}

function blockers(s: GameState, a: ModelState, b: ModelState, denseOnly = false): Blockers {
  // only terrain overlapping the box around both models can be crossed by a line between them
  const x0 = Math.min(a.x - a.r, b.x - b.r), x1 = Math.max(a.x + a.r, b.x + b.r);
  const y0 = Math.min(a.y - a.r, b.y - b.r), y1 = Math.max(a.y + a.r, b.y + b.r);
  const near = s.terrain.filter((t) => { const q = boxOf(t); return q.x1 >= x0 && q.x0 <= x1 && q.y1 >= y0 && q.y0 <= y1; });
  const walls = near.filter((t) => t.category === 'dense').flatMap((t) => t.walls);
  const obscuring = near.filter((t) => (denseOnly ? t.category === 'dense' : t.category !== 'exposed'));
  const areas: { poly: Pt[] }[] = obscuring.filter((t) => !standsIn(a, t) && !standsIn(b, t));
  for (const br of bridgesOf(s)) {
    if (denseOnly && !br.dense) continue;
    const q = br.box;
    if (q.x1 < x0 || q.x0 > x1 || q.y1 < y0 || q.y0 > y1) continue;
    if ([a, b].some((m) => br.of.some((t) => standsIn(m, t)) || pointInPoly(m, br.poly))) continue;
    areas.push(br);
  }
  // both models in the same area: each sees its own stretch of it
  const own = obscuring.filter((t) => !areas.includes(t)).map((t) => ({ t, reach: SEE_IN_AREA * (+standsIn(a, t) + +standsIn(b, t)) }));
  return { walls, areas, own };
}

/** A model sees out of the area it stands in (and is seen in it), but not across all of it: a line may run this far
 *  through that area. A model at one end of a big ruin doesn't see out of its far side. */
export const SEE_IN_AREA = 4;

/** Half the thickness of a ruin wall: a line of sight can't slip through the hairline where two walls meet. */
const WALL_HALF = 0.04;
// a wall end or the joint of two walls blocks too: a 1mm line can't slip through a corner
const lineClear = (p: Pt, q: Pt, bl: Blockers) => {
  const seg = { a: p, b: q };
  return !bl.walls.some((w) => segSegDist(seg, w) < WALL_HALF) && !bl.areas.some((t) => segCrossesPoly(seg, t.poly))
    && !bl.own.some((o) => segLengthInPoly(seg, o.t.poly) > o.reach);
};

/** Points of a base to look from / at. A token pressed against a ruin wall overlaps it a little (it stands for a hull),
 *  but the part on the far side of the wall isn't really there: it can't see or be seen through the wall. */
function lookPoints(m: ModelState, bl: Blockers): Pt[] {
  const c = { x: m.x, y: m.y };
  return samplePoints(m).filter((p, i) => i === 0 || !bl.walls.some((w) => segsTouch({ a: c, b: p }, w)));
}

/** True line-of-sight test ignoring Hidden / Lone Operative. */
export function hasLos(s: GameState, a: ModelState, b: ModelState): boolean {
  const bl = blockers(s, a, b);
  const pa = lookPoints(a, bl), pb = lookPoints(b, bl);
  return pa.some((p) => pb.some((q) => lineClear(p, q, bl)));
}

/** Every part of `b` facing `a` is visible (approximated by sample points). */
export function fullyVisible(s: GameState, a: ModelState, b: ModelState, denseOnly = false): boolean {
  const bl = blockers(s, a, b, denseOnly);
  const pa = lookPoints(a, bl);
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
