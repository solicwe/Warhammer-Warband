// Line of sight on a 2D board (06.01, 13.07-13.11).
// Terrain areas with light/dense features are obscuring; dense walls are Solid at ground level.
import { RULES } from './config';
import { baseDist, bodyTouchesPoly, bodyWhollyInPoly, circleTouchesPoly, pointInPoly, pointSegDist, samplePoints, segCrossesPoly, segLengthInPoly, segSegDist, segsTouch } from './geometry';
import { alive, everyModelKw } from './state';
import type { GameState, ModelState, Pt, TerrainPiece, UnitState } from './types';

interface Blockers { grid: WallGrid; areas: { poly: Pt[] }[] }

/** Rules from abilities that change visibility (registered by effects.ts so this module stays dependency-free). */
export interface VisibilityHooks {
  loneOperative?: (s: GameState, u: UnitState) => boolean;
  detection?: (s: GameState, u: UnitState) => number;
  /** extra detection range the observing model brings (Servants of Change: MUTANT units shooting) */
  spotting?: (s: GameState, observer: ModelState, u: UnitState) => number;
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


// Line-of-sight checks are evaluated model-to-model (13.10): a model standing in an
// obscuring terrain feature sees out of it and can be seen into it; a model outside behind
// the terrain feature remains obscured even if other models in its unit are inside.

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

/** Dense-terrain walls bucketed on a 2" grid: a line of sight is only tested against the walls in the cells it crosses. */
type Wall = { a: Pt; b: Pt };
interface WallGrid { cells: Map<number, Wall[]> }
const CELL = 2;
const emptyWallGrid: WallGrid = { cells: new Map() };
const gridByList = new WeakMap<TerrainPiece[], WallGrid>();
const cellKey = (cx: number, cy: number) => cy * 1000 + cx;
function wallGridOf(s: GameState): WallGrid {
  let g = gridByList.get(s.terrain);
  if (g) return g;
  g = { cells: new Map() };
  for (const t of s.terrain) {
    if (t.category !== 'dense') continue;
    for (const w of t.walls) {
      const cx0 = Math.floor((Math.min(w.a.x, w.b.x) - 0.05) / CELL), cx1 = Math.floor((Math.max(w.a.x, w.b.x) + 0.05) / CELL);
      const cy0 = Math.floor((Math.min(w.a.y, w.b.y) - 0.05) / CELL), cy1 = Math.floor((Math.max(w.a.y, w.b.y) + 0.05) / CELL);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const k = cellKey(cx, cy);
        let list = g.cells.get(k);
        if (!list) g.cells.set(k, (list = []));
        list.push(w);
      }
    }
  }
  gridByList.set(s.terrain, g);
  return g;
}
/** The walls in the cells a segment passes through (grid traversal), each once. */
function wallsAlong(g: WallGrid, p: Pt, q: Pt): Wall[] {
  const out: Wall[] = [];
  const seen = new Set<Wall>();
  const add = (cx: number, cy: number) => {
    const list = g.cells.get(cellKey(cx, cy));
    if (list) for (const w of list) if (!seen.has(w)) { seen.add(w); out.push(w); }
  };
  let cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
  const ex = Math.floor(q.x / CELL), ey = Math.floor(q.y / CELL);
  const dx = q.x - p.x, dy = q.y - p.y;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const tdx = dx ? Math.abs(CELL / dx) : Infinity, tdy = dy ? Math.abs(CELL / dy) : Infinity;
  let tx = dx ? ((sx > 0 ? (cx + 1) * CELL - p.x : p.x - cx * CELL) / Math.abs(dx)) : Infinity;
  let ty = dy ? ((sy > 0 ? (cy + 1) * CELL - p.y : p.y - cy * CELL) / Math.abs(dy)) : Infinity;
  add(cx, cy);
  for (let n = 0; n < 200 && (cx !== ex || cy !== ey); n++) {
    if (tx < ty) { cx += sx; tx += tdx; } else { cy += sy; ty += tdy; }
    add(cx, cy);
  }
  return out;
}
/** The walls near a point (its cell and the ones around it). */
function wallsNear(g: WallGrid, p: Pt, r: number): Wall[] {
  const out: Wall[] = [];
  const seen = new Set<Wall>();
  for (let cy = Math.floor((p.y - r) / CELL); cy <= Math.floor((p.y + r) / CELL); cy++) {
    for (let cx = Math.floor((p.x - r) / CELL); cx <= Math.floor((p.x + r) / CELL); cx++) {
      const list = g.cells.get(cellKey(cx, cy));
      if (list) for (const w of list) if (!seen.has(w)) { seen.add(w); out.push(w); }
    }
  }
  return out;
}

/** Is the model in this terrain area, so the area doesn't hide what's beyond it (13.10)?
 *  A model stands in an area if its centre is inside, or (for large models / vehicles or models substantially on the plate)
 *  its base touches the plate. Also, if two terrain pieces form parts of the same ruin (connected by a bridge or sharing an
 *  objective feature), standing in one part allows seeing out through the feature without the sister piece obscuring it. */
function modelInPiece(m: ModelState, t: TerrainPiece): boolean {
  if (pointInPoly(m, t.poly)) return true;
  const b = boxOf(t);
  if (m.x < b.x0 - m.r || m.x > b.x1 + m.r || m.y < b.y0 - m.r || m.y > b.y1 + m.r) return false;
  const isLarge = m.r >= 1.0 || (m.keywords && ['VEHICLE', 'MONSTER', 'WALKER'].some((k) => m.keywords.includes(k)));
  if (!bodyTouchesPoly(m, 0, t.poly)) return false;
  if (isLarge) return true;
  return polyDist(m, t.poly) <= m.r * 0.5;
}

interface ConnectedTerrain {
  sisters: TerrainPiece[];
  bridges: Bridge[];
}
const connectedByList = new WeakMap<TerrainPiece[], Map<TerrainPiece, ConnectedTerrain>>();

function connectedMapOf(s: GameState): Map<TerrainPiece, ConnectedTerrain> {
  let map = connectedByList.get(s.terrain);
  if (map) return map;
  map = new Map();
  const bridges = bridgesOf(s);
  for (const t of s.terrain) {
    const sisters: TerrainPiece[] = [];
    const tBridges: Bridge[] = [];
    for (const br of bridges) {
      if (br.of.includes(t)) {
        tBridges.push(br);
        const other = br.of[0] === t ? br.of[1] : br.of[0];
        if (!sisters.includes(other)) sisters.push(other);
      }
    }
    if (t.objectiveId) {
      for (const x of s.terrain) {
        if (x !== t && x.objectiveId === t.objectiveId && !sisters.includes(x)) {
          sisters.push(x);
        }
      }
    }
    map.set(t, { sisters, bridges: tBridges });
  }
  connectedByList.set(s.terrain, map);
  return map;
}

function standsIn(s: GameState, m: ModelState, t: TerrainPiece): boolean {
  if (modelInPiece(m, t)) return true;
  const conn = connectedMapOf(s).get(t);
  if (!conn || (!conn.sisters.length && !conn.bridges.length)) return false;
  for (const sister of conn.sisters) {
    if (modelInPiece(m, sister)) return true;
  }
  for (const br of conn.bridges) {
    const q = br.box;
    if (m.x < q.x0 - m.r || m.x > q.x1 + m.r || m.y < q.y0 - m.r || m.y > q.y1 + m.r) continue;
    if (pointInPoly(m, br.poly) || bodyTouchesPoly(m, 0, br.poly)) return true;
  }
  return false;
}

function blockers(s: GameState, a: ModelState, b: ModelState, denseOnly = false): Blockers {
  const isToweringOrTitanic = (m: ModelState) => (m.keywords ?? []).some((k) => k === 'TOWERING' || k === 'TITANIC' || k === 'AIRCRAFT');
  const towering = isToweringOrTitanic(a) || isToweringOrTitanic(b);
  if (towering) {
    // 10th edition: TOWERING, TITANIC and AIRCRAFT models ignore obscuring ruin footprints
    // Physical walls also do not block line of sight to/from towering models, which stand high above ruins
    return { grid: emptyWallGrid, areas: [] };
  }
  // only terrain overlapping the box around both models can be crossed by a line between them
  const x0 = Math.min(a.x - a.r, b.x - b.r), x1 = Math.max(a.x + a.r, b.x + b.r);
  const y0 = Math.min(a.y - a.r, b.y - b.r), y1 = Math.max(a.y + a.r, b.y + b.r);
  const near = s.terrain.filter((t) => { const q = boxOf(t); return q.x1 >= x0 && q.x0 <= x1 && q.y1 >= y0 && q.y0 <= y1; });
  const obscuring = near.filter((t) => (denseOnly ? t.category === 'dense' : t.category !== 'exposed'));
  const areas: { poly: Pt[] }[] = obscuring.filter((t) => !standsIn(s, a, t) && !standsIn(s, b, t));
  for (const br of bridgesOf(s)) {
    if (denseOnly && !br.dense) continue;
    const q = br.box;
    if (q.x1 < x0 || q.x0 > x1 || q.y1 < y0 || q.y0 > y1) continue;
    if ([a, b].some((m) => br.of.some((t) => standsIn(s, m, t)) || pointInPoly(m, br.poly) || (m.r >= 1.0 && bodyTouchesPoly(m, 0, br.poly)))) continue;
    areas.push(br);
  }
  // an area either model stands in does not block (13.10): a model inside sees out and is seen in it; walls still block
  return { grid: wallGridOf(s), areas };
}

/** Half the thickness of a ruin wall: a line of sight can't slip through the hairline where two walls meet. */
const WALL_HALF = 0.04;
// a wall end or the joint of two walls blocks too: a 1mm line can't slip through a corner
// bounding boxes of walls and footprints, so a line only does the exact test against what it can reach
const segBoxes = new WeakMap<object, Box>();
const segBox = (w: { a: Pt; b: Pt }) => {
  let b = segBoxes.get(w);
  if (!b) { b = { x0: Math.min(w.a.x, w.b.x), y0: Math.min(w.a.y, w.b.y), x1: Math.max(w.a.x, w.b.x), y1: Math.max(w.a.y, w.b.y) }; segBoxes.set(w, b); }
  return b;
};
const polyBox = (poly: Pt[]) => {
  let b = segBoxes.get(poly);
  if (!b) {
    b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const p of poly) { b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y); }
    segBoxes.set(poly, b);
  }
  return b;
};
const lineClear = (p: Pt, q: Pt, bl: Blockers) => {
  const seg = { a: p, b: q };
  const x0 = Math.min(p.x, q.x) - WALL_HALF, x1 = Math.max(p.x, q.x) + WALL_HALF, y0 = Math.min(p.y, q.y) - WALL_HALF, y1 = Math.max(p.y, q.y) + WALL_HALF;
  const near = (b: Box) => b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1;
  for (const w of wallsAlong(bl.grid, p, q)) if (near(segBox(w)) && segSegDist(seg, w) < WALL_HALF) return false;
  for (const t of bl.areas) if (near(polyBox(t.poly)) && segCrossesPoly(seg, t.poly)) return false;
  return true;
};

/** Points of a base to look from / at. A token pressed against a ruin wall overlaps it a little (it stands for a hull),
 *  but the part on the far side of the wall isn't really there: it can't see or be seen through the wall. */
function lookPoints(m: ModelState, bl: Blockers): Pt[] {
  const c = { x: m.x, y: m.y };
  const walls = wallsNear(bl.grid, c, m.r + 0.1);
  return samplePoints(m).filter((p, i) => i === 0 || !walls.some((w) => segsTouch({ a: c, b: p }, w)));
}

/** True line-of-sight test ignoring Hidden / Lone Operative. */
export function hasLos(s: GameState, a: ModelState, b: ModelState): boolean {
  const bl = blockers(s, a, b);
  const pa = lookPoints(a, bl), pb = lookPoints(b, bl);
  return pa.some((p) => pb.some((q) => lineClear(p, q, bl)));
}

/** A quick sight check for planning (deployment): from `a`'s centre to `b`'s centre and four points of its rim. */
export function roughLos(s: GameState, a: ModelState, b: ModelState): boolean {
  const bl = blockers(s, a, b);
  const c = { x: a.x, y: a.y };
  const pts = [{ x: b.x, y: b.y }, { x: b.x + b.r * 0.8, y: b.y }, { x: b.x - b.r * 0.8, y: b.y }, { x: b.x, y: b.y + b.r * 0.8 }, { x: b.x, y: b.y - b.r * 0.8 }];
  return pts.some((q) => lineClear(c, q, bl));
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
  return s.terrain.some((t) => t.category !== 'exposed' && bodyTouchesPoly(m, 0, t.poly));
}

export function detectionRange(s: GameState, observer: ModelState, u: UnitState, m: ModelState): number {
  let range = RULES.hidden.detectionRange + (hooks.detection?.(s, u) ?? 0) + (hooks.spotting?.(s, observer, u) ?? 0);
  if (!fullyVisible(s, observer, m, true)) range -= RULES.hidden.goneToGroundReduction; // gone to ground
  return range;
}

/** Check if unit is an "Infantry Beast" */
export function isInfantryBeastUnit(u: UnitState): boolean {
  const typeStr = (u as any).type;
  if (typeof typeStr === 'string' && typeStr.toLowerCase().includes('infantry') && typeStr.toLowerCase().includes('beast')) {
    return true;
  }
  const allKw = [...u.keywords, ...u.models.flatMap((m) => m.keywords)];
  const hasInf = allKw.some((k) => k.toUpperCase() === 'INFANTRY');
  const hasBst = allKw.some((k) => k.toUpperCase() === 'BEAST' || k.toUpperCase() === 'BEASTS');
  return hasInf && hasBst;
}

/** Check if "Infantry Beast" 15" Lone Operative stealth rule is active:
 * IF Unit.type === "Infantry Beast" AND Unit.hasFiredThisTurn === false AND Unit.isWhollyWithinTerrain === true
 * Effect: Dynamically append Lone Operative keyword and restrict ranged targeting to 15".
 */
export function isInfantryBeastLoneOpActive(s: GameState, u: UnitState): boolean {
  if (!isInfantryBeastUnit(u)) return false;
  // Unit.hasFiredThisTurn === false
  const hasFired = (u as any).hasFiredThisTurn === true || u.shotTurn === s.turn || (u.weaponsFired && u.weaponsFired.length > 0);
  if (hasFired) return false;
  // Unit.isWhollyWithinTerrain === true
  const ms = alive(u);
  if (!ms.length) return false;
  const whollyIn = ms.every((m) =>
    s.terrain.some((t) => t.category !== 'exposed' && bodyWhollyInPoly(m, t.poly))
  );
  if (whollyIn) {
    if (!u.keywords.includes('Lone Operative') && !u.keywords.includes('LONE OPERATIVE')) {
      u.keywords.push('Lone Operative');
    }
    return true;
  }
  return false;
}

/** Can `observer` see model `m` of unit `u`, applying Hidden, Lone Operative, and Infantry Beast 15" rule. */
export function modelVisible(s: GameState, observer: ModelState, u: UnitState, m: ModelState, ignoreLoneOperative = false): boolean {
  const d = baseDist(observer, m);
  if (!ignoreLoneOperative) {
    if (isInfantryBeastLoneOpActive(s, u)) {
      if (d > 15) return false;
    } else if ((!u.sources || u.sources.length <= 1) && (u.core.loneOperative || hooks.loneOperative?.(s, u)) && d > (u.core.loneOperative ?? 12)) {
      return false;
    }
  }
  return hasLos(s, observer, m);
}

export function unitVisibleTo(s: GameState, observer: ModelState, u: UnitState): boolean {
  return alive(u).some((m) => modelVisible(s, observer, u, m));
}

/** Benefit of cover (13.08) against attacks from one attacking model.
 * Strict Footprint Matrix:
 * 1. Attacker outside + Target outside + Ray crosses Footprint: BLOCKED
 * 2. Attacker outside + Target inside Footprint: LoS ESTABLISHED, Target gains Benefit of Cover (-1 BS / +1 Sv).
 * 3. Attacker inside Footprint + Target outside Footprint: LoS ESTABLISHED, Target does NOT gain Cover from that footprint.
 * 4. Attacker inside Footprint + Target inside SAME Footprint: LoS ESTABLISHED, Target does NOT gain Cover from shared footprint.
 */
export function hasCover(s: GameState, attacker: ModelState, target: UnitState): boolean {
  if (target.core.stealth || target.buffs.some((b) => b.kind === 'smoke' || b.kind === 'cover')) return true;
  return alive(target).every((m) => {
    // Check if target model is inside a footprint that the attacker is NOT inside (Rule 2)
    const inDifferentFootprint = s.terrain.some((t) =>
      t.category !== 'exposed' &&
      standsIn(s, m, t) &&
      !standsIn(s, attacker, t)
    );
    if (inDifferentFootprint) return true;

    // Attacker inside footprint + Target inside SAME footprint (Rule 4): Target does NOT gain cover from shared footprint.
    // Attacker inside footprint + Target outside footprint (Rule 3): Target does NOT gain cover from attacker's footprint.
    // Check if intervening terrain or walls partially obscure target:
    if (!fullyVisible(s, attacker, m)) return true;
    return false;
  });
}

export const unitIsInfantryLike = (u: UnitState) => everyModelKw(u, ['INFANTRY', 'BEASTS', 'SWARM']);

