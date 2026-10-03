// Bot movement: where a whole unit can legally get to, and how good each spot is.
// Moves follow the shortest route (A* around walls the model can't cross and around enemy models); a squad keeps
// its shape where it can and otherwise re-forms around the new spot. Every end position is scored the way a player
// weighs it: objectives held, the shots and the charge it sets up this turn, and what the enemy can do back.
import { buildShootPools, expectedDamage, shootingModes } from './attack';
import { RULES } from './config';
import { chargeEligibility, findPlacement, formationAt, levelOfControl, validateMove, validatePlacement } from './game';
import { circleTouchesPoly, dist, polyCentroid } from './geometry';
import { blockingWalls, distanceField, pathLength, pointAt, routeAround } from './pathing';
import { alive, boardUnits, other, unitDistance } from './state';
import { hasLos } from './visibility';
import { secondaryGoal } from './secondaries';
import { hasAbility } from './weapons';
import {
  centre, chargeValue, isBrawler, maxRange, meleeKills, moveOf, objPoint, oc, objectiveNeeds, p2d6, perModel, rangedKills, shotValue, unitValue,
} from './botEval';
import type { GameState, ModelState, MoveKind, Pt, UnitState } from './types';

export type Paths = Map<string, Pt[]>;
type Spot = Map<string, Pt>;

const W = RULES.battlefield.width;
const H = RULES.battlefield.height;
/** Holding an objective is worth about this many points of damage (a few VP each turn). */
const OBJECTIVE = 40;

const endOf = (paths: Paths): Spot => new Map([...paths].map(([id, p]) => [id, p[p.length - 1]]));
const clampIn = (p: Pt, r: number): Pt => ({ x: Math.min(W - r, Math.max(r, p.x)), y: Math.min(H - r, Math.max(r, p.y)) });

/** The model that finds the route: the biggest one (it has the least room), then the one in the middle. */
function leaderOf(u: UnitState): ModelState {
  const c = centre(u);
  return [...alive(u)].sort((a, b) => b.r - a.r || dist(a, c) - dist(b, c))[0];
}

/** Every model moves by `d`, each routed around what it can't cross. Null if one of them can't get there. */
function shiftPaths(s: GameState, u: UnitState, kind: MoveKind, max: number, d: Pt, fly: boolean): Paths | null {
  const out: Paths = new Map();
  for (const m of alive(u)) {
    const to = { x: m.x + d.x, y: m.y + d.y };
    const r = routeAround(s, u, kind, m, m, to, max, { fly });
    if (!r || dist(r[r.length - 1], to) > 0.4) return null;
    out.set(m.id, r);
  }
  return out;
}

/** The unit re-forms around `c` (characters in the middle), each model routed to its own place. */
function formPaths(s: GameState, u: UnitState, kind: MoveKind, max: number, c: Pt, up: boolean, fly: boolean): Paths | null {
  const slots = formationAt(u, c, up);
  const out: Paths = new Map();
  for (const m of alive(u)) {
    const to = slots.get(m.id)!;
    const r = routeAround(s, u, kind, m, m, to, max, { fly });
    if (!r || dist(r[r.length - 1], to) > 0.4) return null;
    out.set(m.id, r);
  }
  return out;
}

export interface MoveOpts { fly?: boolean; count?: number; ignoreMax?: boolean }

/** Legal moves of the whole unit along its best route towards `aim`: the furthest one first, then shorter ones. */
export function movesTowards(s: GameState, u: UnitState, kind: MoveKind, max: number, aim: Pt, opt: MoveOpts = {}): Paths[] {
  const ms = alive(u);
  if (!ms.length || max < 0.5) return [];
  const fly = !!opt.fly;
  const lead = leaderOf(u);
  const c = centre(u);
  const goal = clampIn({ x: lead.x + aim.x - c.x, y: lead.y + aim.y - c.y }, lead.r);
  // look a little past this move so the route bends around a wall instead of stopping against it
  let route = routeAround(s, u, kind, lead, lead, goal, max + 6, { fly });
  if (!route) return [];
  // little progress (a vehicle nosing into a dead end): follow the whole route, even if it first leads away
  const progress = dist(lead, goal) - dist(route[route.length - 1], goal);
  if (progress < 0.5 * Math.min(max, dist(lead, goal))) route = routeAround(s, u, kind, lead, lead, goal, 150, { fly }) ?? route;
  const L = Math.min(max, pathLength(route));
  if (L < 0.5) return [];
  const vopt = { fly, maxOverride: opt.ignoreMax ? max : undefined };
  const out: Paths[] = [];
  const want = opt.count ?? 2;
  let below = Infinity;
  const step = Math.max(0.35, L / 8);
  for (let len = L; len >= 0.45 && out.length < want; len -= step) {
    if (len > below) continue;
    const p = pointAt(route, len);
    const d = { x: p.x - lead.x, y: p.y - lead.y };
    const mid = { x: c.x + d.x, y: c.y + d.y };
    const tries = ms.length === 1 ? [() => shiftPaths(s, u, kind, max, d, fly)]
      : [() => shiftPaths(s, u, kind, max, d, fly), () => formPaths(s, u, kind, max, mid, d.y < 0, fly), () => formPaths(s, u, kind, max, mid, d.y >= 0, fly)];
    for (const t of tries) {
      const paths = t();
      if (paths && validateMove(s, u, kind, paths, vopt).ok) { out.push(paths); below = len * 0.55; break; }
    }
  }
  return out;
}

// ---------- scoring ----------

interface Foe { u: UnitState; rk: number; mk: number; brawler: boolean; range: number; M: number }

/** What the enemy army can do to this unit (computed once per unit, positions vary). */
export interface Ctx {
  foes: Foe[]; brawler: boolean; target?: UnitState; range: number; heavy: boolean; ocNeed: Pt[];
  /** route distances for units that can't cross ruin walls (vehicles, monsters): to the melee target, to objectives */
  toTarget?: (p: Pt) => number; toObjective?: (p: Pt) => number;
}

export function ctxFor(s: GameState, u: UnitState): Ctx {
  const foes = boardUnits(s, other(u.owner)).map((e) => ({
    u: e, rk: Math.min(alive(u).length, rangedKills(e, u)), mk: Math.min(alive(u).length, meleeKills(e, u)), brawler: isBrawler(s, e), range: maxRange(e), M: moveOf(e),
  }));
  const brawler = isBrawler(s, u);
  const target = brawler ? [...foes].sort((a, b) => (chargeValue(s, u, b.u) / (1 + unitDistance(u, b.u) / 10)) - (chargeValue(s, u, a.u) / (1 + unitDistance(u, a.u) / 10)))[0]?.u : undefined;
  const heavy = alive(u).some((m) => m.weapons.some((w) => w.profiles.some((p) => hasAbility(p, 'heavy'))));
  const ocNeed = oc(u) > 0 ? objectiveNeeds(s, u.owner).filter((n) => n.need > 0).map((n) => objPoint(s, n.o)) : [];
  const ctx: Ctx = { foes, brawler, target, range: maxRange(u), heavy, ocNeed };
  const lead = leaderOf(u);
  if (lead && blockingWalls(s, lead).length) {
    if (target) ctx.toTarget = distanceField(s, u, 'normal', lead, alive(target));
    if (ocNeed.length) ctx.toObjective = distanceField(s, u, 'normal', lead, ocNeed);
  }
  return ctx;
}

function objectiveScore(s: GameState, u: UnitState): number {
  let v = 0;
  for (const o of s.objectives) {
    const [a, b] = levelOfControl(s, o);
    const ours = u.owner === 0 ? a : b, theirs = u.owner === 0 ? b : a;
    if (ours || theirs) v += OBJECTIVE * Math.tanh((ours - theirs) / 3);
  }
  return v;
}

function shootScore(s: GameState, u: UnitState, kind: MoveKind | 'stationary', ctx: Ctx): number {
  if (!ctx.range) return 0;
  const modes = shootingModes(s, u);
  if (!modes.length) return 0;
  let best = 0;
  for (const f of ctx.foes) {
    const gap = unitDistance(u, f.u);
    if (gap > ctx.range + 0.5) continue;
    const r = buildShootPools(s, u.id, f.u.id, { mode: modes[0] });
    if (r.error || !r.pools.length) continue;
    const ev = r.pools.reduce((a, p) => a + expectedDamage(s, p, f.u).models, 0);
    best = Math.max(best, shotValue(s, u, f.u, ev, gap));
  }
  if (ctx.heavy && (kind === 'stationary' || u.maxMoved <= RULES.heavyMaxMove)) best *= 1.1;
  return best;
}

function chargeScore(s: GameState, u: UnitState, ctx: Ctx): number {
  if (chargeEligibility(s, u)) return 0;
  let best = 0;
  for (const f of ctx.foes) {
    const gap = unitDistance(u, f.u);
    if (gap > RULES.charge.declareRange) continue;
    const v = chargeValue(s, u, f.u);
    if (v > 0) best = Math.max(best, v * p2d6(gap));
  }
  return best * (ctx.brawler ? 1 : 0.5);
}

/** Can any model of `e` see any model of `u` from where it stands (closest pair only, for speed)? */
function seen(s: GameState, e: UnitState, u: UnitState): boolean {
  let best: [ModelState, ModelState] | null = null;
  let bd = Infinity;
  for (const a of alive(e)) for (const b of alive(u)) { const d = dist(a, b); if (d < bd) { bd = d; best = [a, b]; } }
  if (!best) return false;
  if (hasLos(s, best[0], best[1])) return true;
  // a unit spread around a corner: try its other end too
  const far = alive(u).reduce((x, m) => (dist(m, best![0]) > dist(x, best![0]) ? m : x), best[1]);
  return far !== best[1] && hasLos(s, best[0], far);
}

/** Expected loss (in points) during the enemy's next turn: shots from units in range after a move, charges from brawlers. */
function dangerScore(s: GameState, u: UnitState, ctx: Ctx): number {
  let shots = 0, melee = 0;
  const infantryInCover = alive(u).every((m) => ['INFANTRY', 'BEASTS', 'SWARM'].some((k) => m.keywords.includes(k)) && s.terrain.some((t) => t.category !== 'exposed' && circleTouchesPoly(m, m.r, t.poly)));
  for (const f of ctx.foes) {
    const gap = unitDistance(u, f.u);
    if (f.range > 0 && f.rk > 0 && gap <= f.range + f.M) {
      shots += f.rk * perModel(u) * (seen(s, f.u, u) ? 1 : 0.3) * (gap <= f.range ? 1 : 0.6) * (infantryInCover ? 0.8 : 1);
    }
    if (f.brawler && f.mk > 0) melee = Math.max(melee, f.mk * perModel(u) * p2d6(Math.max(0, gap - f.M)));
  }
  return shots * 0.35 + melee * 0.8;
}

/** Long-range pull so units far from everything still make progress (along the route, for units walls can stop). */
function pullScore(s: GameState, u: UnitState, ctx: Ctx): number {
  const c = centre(u);
  const lead = leaderOf(u);
  let v = 0;
  if (ctx.brawler && ctx.target && alive(ctx.target).length) {
    const far = ctx.toTarget?.(lead);
    v -= 0.6 * (far !== undefined && Number.isFinite(far) ? Math.max(unitDistance(u, ctx.target), far - 1.5) : unitDistance(u, ctx.target));
  } else if (ctx.range) {
    const near = Math.min(99, ...ctx.foes.map((f) => unitDistance(u, f.u)));
    v -= 0.4 * Math.max(0, near - ctx.range);
  }
  if (ctx.ocNeed.length) {
    const far = ctx.toObjective?.(lead);
    v -= 0.35 * (far !== undefined && Number.isFinite(far) ? far : Math.min(...ctx.ocNeed.map((p) => dist(c, p))));
  }
  return v;
}

/** How good it is for `u` to end its move at `spot` (null: where it stands now) after a move of this kind. */
export function scoreSpot(s: GameState, u: UnitState, kind: MoveKind | 'stationary', spot: Spot | null, ctx: Ctx, moved = 0): number {
  const ms = alive(u);
  const saved = ms.map((m) => [m, m.x, m.y] as const);
  const was = { move: u.move, maxMoved: u.maxMoved };
  if (spot) for (const m of ms) { const p = spot.get(m.id); if (p) { m.x = p.x; m.y = p.y; } }
  u.move = kind === 'stationary' ? 'stationary' : kind;
  u.maxMoved = Math.max(u.maxMoved, moved);
  try {
    const caution = ctx.brawler ? 0.45 : 1;
    return objectiveScore(s, u) + shootScore(s, u, kind, ctx) + chargeScore(s, u, ctx) - caution * dangerScore(s, u, ctx) + pullScore(s, u, ctx);
  } finally {
    for (const [m, x, y] of saved) { m.x = x; m.y = y; }
    u.move = was.move;
    u.maxMoved = was.maxMoved;
  }
}

// ---------- choosing a move ----------

/** Points worth heading for: objectives, the enemy units that matter, nearby terrain, and a few directions. */
function aimsFor(s: GameState, u: UnitState, max: number, ctx: Ctx): Pt[] {
  const c = centre(u);
  const pts: Pt[] = [];
  const objs = s.objectives.map((o) => objPoint(s, o)).sort((a, b) => dist(c, a) - dist(c, b));
  pts.push(...objs.filter((p, i) => i < 2 || dist(c, p) <= max + 10));
  const nearestModel = (e: UnitState) => alive(e).reduce((a, m) => (dist(m, c) < dist(a, c) ? m : a));
  const foes = [...ctx.foes].sort((a, b) => unitDistance(u, a.u) - unitDistance(u, b.u));
  for (const f of foes.slice(0, 3)) pts.push(nearestModel(f.u));
  if (ctx.target && !foes.slice(0, 3).some((f) => f.u === ctx.target)) pts.push(nearestModel(ctx.target));
  const cover = s.terrain.filter((t) => t.category !== 'exposed' && dist(polyCentroid(t.poly), c) <= max + 3)
    .sort((a, b) => dist(polyCentroid(a.poly), c) - dist(polyCentroid(b.poly), c)).slice(0, 2);
  for (const t of cover) pts.push(polyCentroid(t.poly));
  // where the secondary cards want units: their objectives, areas and circles
  const P = s.players[u.owner];
  if (P.secMode !== 'none') {
    for (const id of P.secActive) {
      const g = secondaryGoal(s, u.owner, id);
      for (const oid of g.objectives) { const o = s.objectives.find((x) => x.id === oid); if (o && dist(o, c) <= max + 12) pts.push({ x: o.x, y: o.y }); }
      for (const a of g.areas) { const p = polyCentroid(a); if (dist(p, c) <= max + 14) pts.push(clampIn(p, 1)); }
      for (const ci of g.circles.slice(0, 1)) if (dist(ci, c) <= max + 12) pts.push({ x: ci.x, y: ci.y });
    }
  }
  for (let k = 0; k < 4; k++) pts.push(clampIn({ x: c.x + Math.cos((k * Math.PI) / 2 + 0.4) * max, y: c.y + Math.sin((k * Math.PI) / 2 + 0.4) * max }, 1));
  const out: Pt[] = [];
  for (const p of pts) if (dist(p, c) > 0.6 && !out.some((q) => dist(p, q) < 1.5)) out.push(p);
  return out;
}

export interface Plan { kind: MoveKind | 'stationary'; paths?: Paths; score: number; aim?: Pt; byAim?: { aim: Pt; score: number }[] }

/** The best move of `kind` (or staying put) for the unit, with up to `max` inches per model. */
export function bestMove(s: GameState, u: UnitState, kind: MoveKind, max: number, ctx: Ctx, opt: MoveOpts & { aims?: Pt[]; noStay?: boolean } = {}): Plan {
  let best: Plan = opt.noStay ? { kind: 'stationary', score: -Infinity } : { kind: 'stationary', score: scoreSpot(s, u, 'stationary', null, ctx) };
  const byAim: { aim: Pt; score: number }[] = [];
  for (const aim of opt.aims ?? aimsFor(s, u, max, ctx)) {
    let top = -Infinity;
    for (const paths of movesTowards(s, u, kind, max, aim, opt)) {
      const moved = Math.max(0, ...[...paths.values()].map(pathLength));
      const sc = scoreSpot(s, u, kind, endOf(paths), ctx, moved);
      top = Math.max(top, sc);
      if (sc > best.score + 1e-6) best = { kind, paths, score: sc, aim };
    }
    byAim.push({ aim, score: top });
  }
  return { ...best, byAim };
}

/** Normal move, Advance or staying put: the Advance is planned with an average roll along the most promising routes. */
export function planMove(s: GameState, u: UnitState, M: number, ctx: Ctx): { normal: Plan; advance: Plan | null } {
  const normal = bestMove(s, u, 'normal', M - 0.05, ctx);
  const aims = [...(normal.byAim ?? [])].sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.aim);
  for (const o of s.objectives) { const p = objPoint(s, o); if (dist(p, centre(u)) > M && !aims.some((q) => dist(q, p) < 1.5)) aims.push(p); }
  const advance = aims.length ? bestMove(s, u, 'advance', M + 3.5, ctx, { aims, ignoreMax: true, noStay: true, count: 1 }) : null;
  return { normal, advance: advance?.paths ? advance : null };
}

/** Where to fall back to: away from the fight, towards objectives and cover. */
export function bestFallBack(s: GameState, u: UnitState, max: number, ctx: Ctx, from: UnitState[]): Plan {
  const c = centre(u);
  const ec = polyCentroid(from.flatMap(alive));
  const L = Math.max(0.1, dist(c, ec));
  const away = clampIn({ x: c.x + ((c.x - ec.x) / L) * max, y: c.y + ((c.y - ec.y) / L) * max }, 1);
  const aims = [away, ...aimsFor(s, u, max, ctx).filter((p) => dist(p, ec) > dist(c, ec))];
  return bestMove(s, u, 'fallback', max, ctx, { aims, noStay: true });
}

// ---------- reserves and deployment ----------

/** The best place to arrive from Reserves: by objectives that need bodies, or where it can shoot or charge right away. */
export function bestArrival(s: GameState, u: UnitState, how: 'ingress' | 'deepStrike'): Spot | null {
  const ctx = ctxFor(s, u);
  const near: Pt[] = [];
  for (const n of objectiveNeeds(s, u.owner)) if (n.need > 0) near.push(objPoint(s, n.o));
  for (const f of [...ctx.foes].sort((a, b) => unitValue(b.u) - unitValue(a.u)).slice(0, 3)) near.push(centre(f.u));
  near.push(...s.objectives.map((o) => objPoint(s, o)));
  let best: { pos: Spot; v: number } | null = null;
  const seen = new Set<string>();
  for (const p of near) {
    const pos = findPlacement(s, u, how, p);
    if (!pos || !validatePlacement(s, u, pos, how).ok) continue;
    const key = [...pos.values()].map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(';');
    if (seen.has(key)) continue;
    seen.add(key);
    // arriving counts as a Normal move: shots and (long) charges this turn
    const v = scoreSpot(s, u, 'ingress', pos, ctx, 0);
    if (!best || v > best.v) best = { pos, v };
  }
  return best?.pos ?? null;
}

/** Can a unit set up at `pos` drive out again? (A vehicle boxed in by ruin walls would sit there all game.) */
export function canLeave(s: GameState, u: UnitState, pos: Spot): boolean {
  const ms = alive(u);
  if (!ms.some((m) => blockingWalls(s, m).length)) return true;
  const saved = ms.map((m) => [m, m.x, m.y] as const);
  for (const m of ms) { const p = pos.get(m.id); if (p) { m.x = p.x; m.y = p.y; } }
  try {
    const lead = leaderOf(u);
    // it has to be able to get well on its way towards the middle of the board
    const goal = { x: W / 2, y: H / 2 };
    const r = routeAround(s, u, 'normal', lead, lead, goal, 90);
    if (!r) return false;
    return dist(lead, goal) - dist(r[r.length - 1], goal) >= Math.min(10, dist(lead, goal) - 5);
  } finally {
    for (const [m, x, y] of saved) { m.x = x; m.y = y; }
  }
}
