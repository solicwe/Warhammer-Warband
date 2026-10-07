// Movement helpers: what a model may pass through, routing around walls / enemy models (A*),
// and settling a dragged draft into legal end positions (models stop at base contact instead of overlapping).
import { RULES } from './config';
import { dist, pointInPoly, pointSegDist, segSegDist } from './geometry';
import { alive, boardUnits, hasKw, onBoard, other } from './state';
import type { GameState, ModelState, MoveKind, Pt, Seg, UnitState } from './types';

const W = RULES.battlefield.width;
const H = RULES.battlefield.height;

export const canCrossDense = (m: ModelState) => ['INFANTRY', 'BEASTS', 'SWARM', 'MOBILE'].some((k) => m.keywords.includes(k));

/** Abilities that let a unit move through enemy models ("Get Out da Way!", Shokk-boosta); registered by effects.ts. */
type ThroughHook = (s: GameState, u: UnitState, kind: MoveKind) => 'all' | 'nonMV' | null;
let throughHook: ThroughHook | null = null;
export const setThroughHook = (fn: ThroughHook) => { throughHook = fn; };
export const isMV = (m: ModelState) => m.keywords.includes('MONSTER') || m.keywords.includes('VEHICLE');

/** Vehicles and monsters in ruins: they may drive into a terrain footprint (or just onto its edge) and out of the one
 *  they stand in, but never across one — a footprint their move neither starts nor ends on is a wall to them. */
export const noCrossingFootprints = (m: ModelState) => isMV(m) && !canCrossDense(m);
/** Terrain footprints (objective markers are not terrain). */
export const ruinFootprints = (s: GameState) => s.terrain.filter((t) => t.kind !== 'objective-area' && t.poly.length >= 3);

const footprintCache = new WeakMap<GameState['terrain'], { poly: Pt[]; edges: Seg[] }[]>();
function footprints(s: GameState) {
  const hit = footprintCache.get(s.terrain);
  if (hit) return hit;
  const out = ruinFootprints(s).map((t) => ({ poly: t.poly, edges: t.poly.map((a, i) => ({ a, b: t.poly[(i + 1) % t.poly.length] })) }));
  footprintCache.set(s.terrain, out);
  return out;
}

/** Walls a model may not move through: dense terrain taller than 2" for anything but INFANTRY / BEASTS / SWARM / MOBILE,
 *  and for VEHICLE / MONSTER models the outline of every footprint the move does not start or end on (`ends`). */
export function blockingWalls(s: GameState, m: ModelState, fly = false, ends: Pt[] = [m]): Seg[] {
  if (fly || canCrossDense(m)) return [];
  const walls = s.terrain.filter((t) => t.category === 'dense' && t.height > 2).flatMap((t) => t.walls);
  if (!noCrossingFootprints(m)) return walls;
  // the footprint the model stands in (centre inside) can be left, the one it ends in can be entered; any other one is
  // a wall: the hull may overlap its edge a little (the wall clearance), never cross it
  const touches = (poly: Pt[]) => ends.some((p) => pointInPoly(p, poly));
  return [...walls, ...footprints(s).filter((f) => !touches(f.poly)).flatMap((f) => f.edges)];
}

/** How close a model's centre may come to a wall: a round token stands in for a hull, so allow a little overlap. */
export const wallClearance = (m: ModelState, blocking: boolean) => (blocking ? m.r * 0.6 : m.r * 0.5);

export interface MoveOpts { fly?: boolean }

interface Ctx { m: ModelState; enemies: ModelState[]; walls: Seg[]; clear: number }

function ctxFor(s: GameState, u: UnitState, kind: MoveKind, m: ModelState, opt: MoveOpts, ends: Pt[] = [m]): Ctx {
  const desperate = kind === 'fallback' && u.battleShocked;
  const through = opt.fly || desperate || (isMV(m) && (kind === 'normal' || kind === 'advance'));
  const thr = throughHook?.(s, u, kind) ?? null;
  const enemies = boardUnits(s, other(u.owner)).filter((e) => !hasKw(e, 'AIRCRAFT')).flatMap(alive)
    .filter((e) => thr !== 'all' && !(thr === 'nonMV' && !isMV(e)))
    .filter((e) => !through || (isMV(m) && isMV(e) && !opt.fly && !desperate));
  return { m, enemies, walls: blockingWalls(s, m, opt.fly, ends), clear: wallClearance(m, true) };
}

/** Why a straight step a→b is illegal for this model ("enemy" / "wall"), or null. `first`: the model may leave a spot it already overlaps. */
function stepBlocked(c: Ctx, a: Pt, b: Pt, first: boolean): 'enemy' | 'wall' | null {
  const seg = { a, b };
  for (const e of c.enemies) {
    const need = e.r + c.m.r - 0.05;
    const d = pointSegDist(e, seg);
    if (d < need && !(first && d >= dist(a, e) - 0.01)) return 'enemy';
  }
  for (const w of c.walls) {
    const d = segSegDist(seg, w);
    if (d < c.clear && !(first && d >= pointSegDist(a, w) - 0.01)) return 'wall';
  }
  return null;
}

export function pathBlocked(s: GameState, u: UnitState, kind: MoveKind, m: ModelState, path: Pt[], opt: MoveOpts = {}): 'enemy' | 'wall' | null {
  const c = ctxFor(s, u, kind, m, opt, [path[0], path[path.length - 1]]);
  for (let i = 1; i < path.length; i++) {
    const why = stepBlocked(c, path[i - 1], path[i], i === 1);
    if (why) return why;
  }
  return null;
}

export function pathLength(path: Pt[]) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += dist(path[i - 1], path[i]);
  return d;
}

/** The path cut to `len` inches. */
export function truncatePath(path: Pt[], len: number): Pt[] {
  const out: Pt[] = [path[0]];
  let left = len;
  for (let i = 1; i < path.length; i++) {
    const d = dist(path[i - 1], path[i]);
    if (d <= left + 1e-9) { out.push(path[i]); left -= d; continue; }
    const k = d ? left / d : 0;
    out.push({ x: path[i - 1].x + (path[i].x - path[i - 1].x) * k, y: path[i - 1].y + (path[i].y - path[i - 1].y) * k });
    break;
  }
  return out;
}

export const pointAt = (path: Pt[], len: number) => { const p = truncatePath(path, len); return p[p.length - 1]; };

/** Shortest legal route (A* on a 0.5" grid, then straightened) from `from` towards `to` within `maxLen` inches.
 *  If `to` cannot be reached it ends at the reachable point closest to it. Null when the model cannot move at all. */
export function routeAround(s: GameState, u: UnitState, kind: MoveKind, m: ModelState, from: Pt, to: Pt, maxLen: number, opt: MoveOpts = {}): Pt[] | null {
  const all = ctxFor(s, u, kind, m, opt, [from, to]);
  // only what lies within reach of this move can be in the way
  const reach = maxLen + 1.5;
  const c: Ctx = { ...all, enemies: all.enemies.filter((e) => dist(e, from) <= reach + e.r + m.r), walls: all.walls.filter((w) => pointSegDist(from, w) <= reach + all.clear) };
  const far = dist(from, to);
  if (far <= maxLen + 1e-6 ? !stepBlocked(c, from, to, true) : false) return [from, to];
  // out of reach but nothing in the way: the straight line gets as close as any route could
  if (far > maxLen + 1e-6) {
    const p = { x: from.x + ((to.x - from.x) * maxLen) / far, y: from.y + ((to.y - from.y) * maxLen) / far };
    if (p.x >= m.r && p.y >= m.r && p.x <= W - m.r && p.y <= H - m.r && !stepBlocked(c, from, p, true)) return [from, p];
  }
  const { step, nx, ny, cx, cy, free, idx } = gridOf(c, m);
  const start = idx(from);
  const g = new Float32Array(nx * ny).fill(Infinity);
  const fv = new Float32Array(nx * ny);
  const prev = new Int32Array(nx * ny).fill(-1);
  const closed = new Uint8Array(nx * ny);
  g[start] = dist(from, { x: cx(start), y: cy(start) });
  // binary heap on f = g + h (f stored when a cell is pushed)
  const heap: number[] = [];
  const push = (i: number) => {
    fv[i] = g[i] + Math.hypot(cx(i) - to.x, cy(i) - to.y);
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (fv[heap[p]] <= fv[heap[k]]) break; const t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p; }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let b = k;
        if (l < heap.length && fv[heap[l]] < fv[heap[b]]) b = l;
        if (r < heap.length && fv[heap[r]] < fv[heap[b]]) b = r;
        if (b === k) break;
        const t = heap[b]; heap[b] = heap[k]; heap[k] = t;
        k = b;
      }
    }
    return top;
  };
  push(start);
  let best = start;
  let bestD = dist({ x: cx(start), y: cy(start) }, to);
  const goal = idx(to);
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.length) {
    const i = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    const p = { x: cx(i), y: cy(i) };
    const dTo = dist(p, to);
    if (dTo < bestD - 1e-6 || (Math.abs(dTo - bestD) < 1e-6 && g[i] < g[best])) { best = i; bestD = dTo; }
    if (i === goal) break;
    const ix = i % nx, iy = Math.floor(i / nx);
    for (const [dx, dy] of D) {
      const jx = ix + dx, jy = iy + dy;
      if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
      const j = jy * nx + jx;
      if (closed[j] || !free(j)) continue;
      const ng = g[i] + step * (dx && dy ? Math.SQRT2 : 1);
      if (ng > maxLen + step || ng >= g[j]) continue;
      g[j] = ng;
      prev[j] = i;
      push(j);
    }
  }
  if (best === start) return null;
  const cells: Pt[] = [];
  for (let k = best; k !== -1 && k !== start; k = prev[k]) cells.unshift({ x: cx(k), y: cy(k) });
  // finish exactly on the dragged point when it was reached and is reachable in a straight line
  const end = best === goal && !stepBlocked(c, cells[cells.length - 1], to, false) ? to : cells[cells.length - 1];
  const raw = [from, ...cells.slice(0, -1), end];
  // straighten: from each kept point, jump to the farthest point still in a clear straight line
  const out: Pt[] = [from];
  let k = 0;
  while (k < raw.length - 1) {
    let j = raw.length - 1;
    while (j > k + 1 && stepBlocked(c, raw[k], raw[j], k === 0)) j--;
    out.push(raw[j]);
    k = j;
  }
  const route = pathLength(out) > maxLen + 0.01 ? truncatePath(out, maxLen) : out;
  for (let i = 1; i < route.length; i++) if (stepBlocked(c, route[i - 1], route[i], i === 1)) return null;
  return route;
}

/** The 0.5" grid a model moves on: which cells it can stand on (walls it can't cross, enemy models, board edges). */
function gridOf(c: Ctx, m: ModelState) {
  const step = 0.5;
  const nx = Math.floor(W / step) + 1;
  const ny = Math.floor(H / step) + 1;
  const state = new Uint8Array(nx * ny); // 0 unknown, 1 free, 2 blocked
  const cx = (i: number) => (i % nx) * step;
  const cy = (i: number) => Math.floor(i / nx) * step;
  // cells keep a little extra room so a diagonal step between two free cells can't cut a corner
  const pad = (d: number) => Math.sqrt(d * d + step * step * 0.52);
  const wallRoom = pad(c.clear);
  const free = (i: number) => {
    if (!state[i]) {
      const p = { x: cx(i), y: cy(i) };
      const bad = p.x < m.r || p.y < m.r || p.x > W - m.r || p.y > H - m.r
        || c.enemies.some((e) => dist(p, e) < pad(e.r + m.r - 0.05))
        || c.walls.some((w) => pointSegDist(p, w) < wallRoom);
      state[i] = bad ? 2 : 1;
    }
    return state[i] === 1;
  };
  const idx = (p: Pt) => Math.min(ny - 1, Math.max(0, Math.round(p.y / step))) * nx + Math.min(nx - 1, Math.max(0, Math.round(p.x / step)));
  return { step, nx, ny, cx, cy, free, idx };
}

/** How far (along legal routes) every spot on the board is from the nearest of `goals` for this model, e.g. a vehicle
 *  inside a U-shaped ruin is far from the enemy behind the closed wall even though the straight line is short. */
export function distanceField(s: GameState, u: UnitState, kind: MoveKind, m: ModelState, goals: Pt[], opt: MoveOpts = {}): (p: Pt) => number {
  const c = ctxFor(s, u, kind, m, opt, [m, ...goals]);
  const { step, nx, ny, cx, cy, free, idx } = gridOf(c, m);
  const d = new Float32Array(nx * ny).fill(Infinity);
  const heap: number[] = [];
  const push = (i: number) => {
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) { const q = (k - 1) >> 1; if (d[heap[q]] <= d[heap[k]]) break; const t = heap[q]; heap[q] = heap[k]; heap[k] = t; k = q; }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let b = k;
        if (l < heap.length && d[heap[l]] < d[heap[b]]) b = l;
        if (r < heap.length && d[heap[r]] < d[heap[b]]) b = r;
        if (b === k) break;
        const t = heap[b]; heap[b] = heap[k]; heap[k] = t;
        k = b;
      }
    }
    return top;
  };
  // a goal inside something the model can't stand on (an enemy unit, a wall) starts from the free cells around it
  for (const g of goals) {
    for (let rad = 0; rad <= 4; rad += step) {
      let found = false;
      for (let a = 0; a < (rad ? 16 : 1); a++) {
        const p = { x: g.x + Math.cos((a / 16) * Math.PI * 2) * rad, y: g.y + Math.sin((a / 16) * Math.PI * 2) * rad };
        const i = idx(p);
        if (!free(i)) continue;
        found = true;
        if (rad < d[i]) { d[i] = rad; push(i); }
      }
      if (found) break;
    }
  }
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const closed = new Uint8Array(nx * ny);
  while (heap.length) {
    const i = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    const ix = i % nx, iy = Math.floor(i / nx);
    for (const [dx, dy] of D) {
      const jx = ix + dx, jy = iy + dy;
      if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
      const j = jy * nx + jx;
      if (closed[j] || !free(j)) continue;
      const nd = d[i] + step * (dx && dy ? Math.SQRT2 : 1);
      if (nd < d[j]) { d[j] = nd; push(j); }
    }
  }
  return (p: Pt) => {
    const i = idx(p);
    if (Number.isFinite(d[i])) return d[i] + dist(p, { x: cx(i), y: cy(i) });
    // a spot off the grid's free cells (the model's own base overlapping something): use the best neighbour
    let best = Infinity;
    const ix = i % nx, iy = Math.floor(i / nx);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const jx = ix + dx, jy = iy + dy;
      if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
      const j = jy * nx + jx;
      if (Number.isFinite(d[j])) best = Math.min(best, d[j] + dist(p, { x: cx(j), y: cy(j) }));
    }
    return best;
  };
}

export interface SettleOpts extends MoveOpts { maxFor: (m: ModelState) => number; targets?: string[] }

/** Turn a dragged draft into something the rules allow, where that is possible:
 *  1) a model whose straight line crosses a wall it can't pass or an enemy model gets routed around it;
 *  2) models are settled front first, each sliding back along its own path until it doesn't overlap a model,
 *     sit in a wall, leave the board or (Normal / Advance / Fall Back) end in engagement range. */
export function settleMove(s: GameState, u: UnitState, kind: MoveKind, paths: Map<string, Pt[]>, opt: SettleOpts): Map<string, Pt[]> {
  const out = new Map(paths);
  const movers = alive(u).filter((m) => (paths.get(m.id)?.length ?? 0) >= 2 && pathLength(paths.get(m.id)!) > 0.01);
  if (!movers.length) return out;
  for (const m of movers) {
    let path = paths.get(m.id)!;
    const max = opt.maxFor(m);
    if (pathBlocked(s, u, kind, m, path, opt)) {
      const r = routeAround(s, u, kind, m, path[0], path[path.length - 1], max, opt);
      path = r ?? [path[0], path[0]];
    }
    if (pathLength(path) > max + 0.01) path = truncatePath(path, max);
    out.set(m.id, path);
  }
  const keepOutOfEr = ['normal', 'advance', 'fallback', 'ingress', 'scout', 'extra'].includes(kind);
  const enemies = boardUnits(s, other(u.owner)).filter((e) => !hasKw(e, 'AIRCRAFT')).flatMap(alive);
  const statics: (Pt & { r: number; id: string })[] = s.units.filter((x) => x.id !== u.id && onBoard(x)).flatMap(alive);
  const settled: (Pt & { r: number; id: string })[] = alive(u).filter((m) => !movers.includes(m)).map((m) => ({ x: m.x, y: m.y, r: m.r, id: m.id }));
  const walls = s.terrain.filter((t) => t.walls.length).map((t) => ({ walls: t.walls, blocks: t.category === 'dense' && t.height > 2 }));
  // a charging model that moves at all has to end closer to the charge targets than it started
  const targetModels = kind === 'charge' && opt.targets?.length ? s.units.filter((x) => opt.targets!.includes(x.id)).flatMap(alive) : [];
  // …and may not end engaged with an enemy unit it did not declare
  const bystanders = kind === 'charge' ? boardUnits(s, other(u.owner)).filter((e) => !opt.targets?.includes(e.id) && !hasKw(e, 'AIRCRAFT')).flatMap(alive) : [];
  const gap = (p: Pt, m: ModelState) => Math.min(...targetModels.map((e) => dist(p, e) - e.r - m.r));
  // until a mover is settled its starting spot stays taken (it may end up staying there)
  const pending = new Map(movers.map((m) => [m.id, { x: m.x, y: m.y, r: m.r, id: m.id }]));
  const ok = (m: ModelState, p: Pt) => {
    if (p.x - m.r < -0.01 || p.y - m.r < -0.01 || p.x + m.r > W + 0.01 || p.y + m.r > H + 0.01) return false;
    if (statics.some((o) => dist(p, o) < o.r + m.r - 0.02)) return false;
    if (settled.some((o) => dist(p, o) < o.r + m.r - 0.02)) return false;
    for (const [id, o] of pending) if (id !== m.id && dist(p, o) < o.r + m.r - 0.02) return false;
    const blockable = !canCrossDense(m);
    if (walls.some((t) => t.walls.some((w) => pointSegDist(p, w) < wallClearance(m, blockable && t.blocks)))) return false;
    if (keepOutOfEr && enemies.some((e) => dist(p, e) - e.r - m.r <= RULES.engagementRange + 1e-6)) return false;
    if (targetModels.length && gap(p, m) > gap(m, m) - 1e-6) return false;
    if (bystanders.some((e) => dist(p, e) - e.r - m.r <= RULES.engagementRange + 1e-6)) return false;
    return true;
  };
  const c = (m: ModelState, to: Pt) => ctxFor(s, u, kind, m, opt, [m, to]);
  // front first: along the average direction of travel
  const dir = movers.reduce((a, m) => { const p = out.get(m.id)!; const e = p[p.length - 1]; return { x: a.x + e.x - p[0].x, y: a.y + e.y - p[0].y }; }, { x: 0, y: 0 });
  const ahead = (m: ModelState) => { const p = out.get(m.id)!; const e = p[p.length - 1]; return e.x * dir.x + e.y * dir.y + (p[0].x * dir.x + p[0].y * dir.y) * 1e-3; };
  for (const m of [...movers].sort((a, b) => ahead(b) - ahead(a))) {
    const path = out.get(m.id)!;
    const L = pathLength(path);
    const want = path[path.length - 1];
    let len = L;
    for (; len > 0; len -= 0.1) if (ok(m, pointAt(path, len))) break;
    len = Math.max(0, len);
    let next = len < L - 1e-6 ? truncatePath(path, len) : path;
    // pushed far back (or all the way home)? look for a free spot right around where it was dragged instead,
    // the way a player shuffles a model into the gap next to its squad mates
    if (dist(pointAt(path, len), want) > 0.6) {
      const cm = c(m, want);
      const max = opt.maxFor(m);
      search: for (let rad = 0.2; rad <= 3.01; rad += 0.2) {
        for (let k = 0; k < 24; k++) {
          const ang = (k / 24) * Math.PI * 2;
          const q = { x: want.x + Math.cos(ang) * rad, y: want.y + Math.sin(ang) * rad };
          if (dist(path[0], q) > max + 1e-6 || dist(q, want) >= dist(pointAt(path, len), want)) continue;
          if (!ok(m, q) || stepBlocked(cm, path[0], q, true)) continue;
          next = [path[0], q];
          break search;
        }
      }
    }
    const p = next[next.length - 1];
    out.set(m.id, next);
    pending.delete(m.id);
    settled.push({ x: p.x, y: p.y, r: m.r, id: m.id });
  }
  return out;
}
