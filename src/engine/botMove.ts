// Bot movement: where a whole unit can legally get to, and how good each spot is.
// Moves follow the shortest route (A* around walls the model can't cross and around enemy models); a squad keeps
// its shape where it can and otherwise re-forms around the new spot. Every end position is scored the way a player
// weighs it: objectives held, the shots and the charge it sets up this turn, and what the enemy can do back.
import { buildShootPools, expectedDamage, shootingModes } from './attack';
import { RULES } from './config';
import { chargeEligibility, findPlacement, formationAt, levelOfControl, validateMove, validatePlacement, zoneOf } from './game';
import { circleTouchesPoly, dist, pointInPoly, polyCentroid } from './geometry';
import { blockingWalls, distanceField, pathLength, pointAt, routeAround } from './pathing';
import { alive, boardUnits, other, unitDistance } from './state';
import { hasLos } from './visibility';
import { secondaryGoal } from './secondaries';
import { hasAbility } from './weapons';
import { actsOfUnit } from './activations';
import { unitFlags } from './effects';
import { W as BW } from './botWeights';
import {
  centre, chargeValue, isBrawler, maxRange, meleeKills, moveOf, objPoint, oc, objectiveNeeds, p2d6, perModel, rangedKills, shotValue, unitValue,
} from './botEval';
import type { GameState, ModelState, MoveKind, Pt, UnitState } from './types';

export type Paths = Map<string, Pt[]>;
type Spot = Map<string, Pt>;

const W = RULES.battlefield.width;
const H = RULES.battlefield.height;
/** Holding an objective is worth about this many points of damage (a few VP each turn). */

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

/** Last resort when the squad can't move as a block or re-form (a wall or a container in the way): each model takes
 *  its own route the same way, as far as it gets within its move; coherency is checked afterwards. */
function trailPaths(s: GameState, u: UnitState, kind: MoveKind, max: number, d: Pt, fly: boolean): Paths | null {
  const out: Paths = new Map();
  let moved = false;
  for (const m of alive(u)) {
    const to = clampIn({ x: m.x + d.x, y: m.y + d.y }, m.r);
    const r = routeAround(s, u, kind, m, m, to, max + 6, { fly });
    if (!r) { out.set(m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y }]); continue; }
    const L = Math.min(max, pathLength(r));
    const cut: Pt[] = [r[0]];
    let run = 0;
    for (let i = 1; i < r.length; i++) {
      const seg = dist(r[i - 1], r[i]);
      if (run + seg >= L) { cut.push(pointAt(r, L)); break; }
      run += seg;
      cut.push(r[i]);
    }
    if (cut.length < 2) cut.push(r[0]);
    if (dist(cut[0], cut[cut.length - 1]) > 0.3) moved = true;
    out.set(m.id, cut);
  }
  return moved ? out : null;
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
    const tries = ms.length === 1 ? [() => shiftPaths(s, u, kind, max, d, fly), () => trailPaths(s, u, kind, max, d, fly)]
      : [() => shiftPaths(s, u, kind, max, d, fly), () => formPaths(s, u, kind, max, mid, d.y < 0, fly), () => formPaths(s, u, kind, max, mid, d.y >= 0, fly), () => trailPaths(s, u, kind, max, d, fly)];
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
  /** a transport with units inside: where to drop them off (the enemy for fighters, a contested objective for the rest) */
  deliver?: Pt;
  /** a cheap objective holder (Battleline or a low-cost squad with OC): its job is standing on objectives, not hiding */
  holder?: boolean;
  /** a unit that leaves objectives secured behind it (Objective Secured …): the next objective to claim, then it moves on */
  claim?: Pt;
  /** a character or model whose ability works on friendly units nearby (Techmarine and vehicles, auras): stay by them */
  escort?: { u: UnitState; range: number; weight: number };
}

/** Can this unit make objectives stay ours after it leaves them? */
export function securesObjectives(s: GameState, u: UnitState): boolean {
  const f = unitFlags(s, u);
  return f.secureAtMovementEnd || f.secureAtCommandEnd || actsOfUnit(s, u).some((d) => d.spec.do?.some((a) => a.secure));
}

/**
 * Who the unit's abilities are for: "friendly … VEHICLE model within 3"" (Techmarine), "while a friendly … INFANTRY unit
 * is within 6" of this model" (auras). The most valuable such unit (a hurt vehicle first) is the one to stay with.
 */
function escortFor(s: GameState, u: UnitState): Ctx['escort'] {
  if (u.transport || u.sources.length > 1 || boardUnits(s, u.owner).length < 2) return undefined; // a led squad goes where its squad goes
  let best: Ctx['escort'];
  let bestV = 0;
  const solo = alive(u).every((m) => m.isCharacter);
  for (const a of u.abilities) {
    const t = a.text ?? '';
    const f1 = /friendly ([A-Z][A-Z' -]*?) (?:unit|model)s?\b[^.]*?within (\d+)"/.exec(t);
    const f2 = /within (\d+)" of (?:a|one or more) friendly ([A-Z][A-Z' -]*?) (?:unit|model)/.exec(t);
    const m = f1 ? [f1[1], f1[2]] : f2 ? [f2[2], f2[1]] : null;
    if (!m) continue;
    const kws = m[0].trim().split(/\s+/).filter((k) => !['ADEPTUS', 'ASTARTES', 'IMPERIUM', 'ORKS'].includes(k));
    if (!kws.length) continue;
    const range = Number(m[1]);
    for (const f of boardUnits(s, u.owner)) {
      if (f.id === u.id || !kws.every((k) => alive(f).some((x) => x.keywords.includes(k)))) continue;
      const hurt = alive(f).some((x) => x.wounds < x.profile.W) ? 1.5 : 1;
      const v = unitValue(f) * hurt / (1 + unitDistance(u, f) / 24);
      if (v > bestV) { bestV = v; best = { u: f, range, weight: solo ? 3 : 0.3 }; }
    }
  }
  return best;
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
  const battleline = alive(u).some((m) => m.keywords.includes('BATTLELINE'));
  // melee units go and fight; holding is a job for BATTLELINE and cheap shooting squads
  ctx.holder = oc(u) > 0 && !u.transport && (battleline || unitValue(u) <= 130) && !(brawler && (unitValue(u) > 130 || !battleline));
  if (oc(u) > 0 && !u.battleShocked && securesObjectives(s, u)) {
    // the closest objective not yet ours for good, within two moves; the home one only if nobody holds it
    const M = moveOf(u);
    const c = centre(u);
    const open = s.objectives.filter((o) => o.secured !== u.owner && !(o.type === 'home' && o.controller === u.owner))
      .map((o) => objPoint(s, o)).filter((p) => dist(p, c) <= 2 * M + 6).sort((a, b) => dist(a, c) - dist(b, c));
    ctx.claim = open[0];
  }
  ctx.escort = escortFor(s, u);
  const cargo = s.units.filter((x) => x.embarkedIn === u.id && x.status === 'embarked');
  if (cargo.length) {
    const c = centre(u);
    const near = <T extends Pt>(ps: T[]) => ps.reduce<T | undefined>((a, p) => (!a || dist(p, c) < dist(a, c) ? p : a), undefined);
    const enemy = near(foes.flatMap((f) => alive(f.u)));
    const field = near(s.objectives.filter((o) => o.type !== 'home' && ocNeed.some((q) => dist(q, objPoint(s, o)) < 0.1)).map((o) => objPoint(s, o)));
    ctx.deliver = cargo.some((x) => isBrawler(s, x)) ? enemy ?? field : field ?? enemy;
  }
  const lead = leaderOf(u);
  if (lead && blockingWalls(s, lead).length) {
    if (target) ctx.toTarget = distanceField(s, u, 'normal', lead, alive(target));
    if (ocNeed.length) ctx.toObjective = distanceField(s, u, 'normal', lead, ocNeed);
  }
  return ctx;
}

function objectiveScore(s: GameState, u: UnitState, homeFactor = 1): number {
  let v = 0;
  const OBJECTIVE = BW(u.owner).objective;
  for (const o of s.objectives) {
    const [a, b] = levelOfControl(s, o);
    const ours = u.owner === 0 ? a : b, theirs = u.owner === 0 ? b : a;
    // an objective we secured stays ours while the enemy doesn't take it: nothing to gain by standing on it
    if (o.secured === u.owner && theirs === 0) { v += OBJECTIVE * Math.tanh(2 / 3); continue; }
    if (ours || theirs) v += OBJECTIVE * Math.tanh((ours - theirs) / 3) * (o.type === 'home' ? homeFactor : 1);
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
  if (ctx.heavy && (kind === 'stationary' || u.maxMoved <= RULES.heavyMaxMove)) best *= BW(u.owner).heavyStill;
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
  return best * (ctx.brawler ? 1 : BW(u.owner).chargeNonBrawler);
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
      shots += f.rk * perModel(u) * (seen(s, f.u, u) ? 1 : BW(u.owner).dangerUnseen) * (gap <= f.range ? 1 : 0.6) * (infantryInCover ? 0.8 : 1);
    }
    if (f.brawler && f.mk > 0) melee = Math.max(melee, f.mk * perModel(u) * p2d6(Math.max(0, gap - f.M)));
  }
  // the enemy can't kill more than the whole unit, however many guns could reach it
  return Math.min(unitValue(u), shots * BW(u.owner).dangerShots + melee * BW(u.owner).dangerMelee);
}

/** Long-range pull so units far from everything still make progress (along the route, for units walls can stop). */
function pullScore(s: GameState, u: UnitState, ctx: Ctx): number {
  const c = centre(u);
  const lead = leaderOf(u);
  const w = BW(u.owner);
  let v = 0;
  if (ctx.brawler && ctx.target && alive(ctx.target).length) {
    const far = ctx.toTarget?.(lead);
    v -= w.pullBrawler * (far !== undefined && Number.isFinite(far) ? Math.max(unitDistance(u, ctx.target), far - 1.5) : unitDistance(u, ctx.target));
  } else if (ctx.range) {
    const near = Math.min(99, ...ctx.foes.map((f) => unitDistance(u, f.u)));
    v -= w.pullRange * Math.max(0, near - ctx.range);
  }
  // a loaded transport drives its passengers to where they get out, rather than parking on an objective
  if (ctx.deliver) v -= w.pullDeliver * Math.max(0, dist(c, ctx.deliver) - 9);
  if (ctx.claim && !ctx.deliver) {
    // standing on it is what secures it: a clear reward for getting there, and a pull until then
    const on = alive(u).some((m) => dist(m, ctx.claim!) <= 3 + m.r);
    v += on ? w.claimBonus : -w.claimPull * Math.max(0, dist(c, ctx.claim) - 2);
  }
  if (ctx.escort && alive(ctx.escort.u).length) v -= ctx.escort.weight * 2 * Math.max(0, unitDistance(u, ctx.escort.u) - (ctx.escort.range - 1));
  if (ctx.ocNeed.length && !ctx.deliver) {
    const far = ctx.toObjective?.(lead);
    v -= (ctx.holder ? w.pullHolder : w.pullObjective) * (far !== undefined && Number.isFinite(far) ? far : Math.min(...ctx.ocNeed.map((p) => dist(c, p))));
  }
  return v;
}

/**
 * The way a tournament player places a unit besides objectives, shots and danger:
 *  - a CHARACTER on its own stays with the army (its aura and leadership work within 6", alone it's an easy kill
 *    and does nothing hiding in a corner);
 *  - a unit hugging a board edge away from any objective or fight is wasted;
 *  - an expensive damage dealer doesn't sit on an objective a cheap unit could hold (a factor on objectiveScore).
 */
function positionScore(s: GameState, u: UnitState): number {
  const c = centre(u);
  let v = 0;
  if (alive(u).every((m) => m.isCharacter)) {
    const friends = boardUnits(s, u.owner).filter((f) => f.id !== u.id && !f.transport && !alive(f).every((m) => m.isCharacter));
    const near = Math.min(99, ...friends.map((f) => unitDistance(u, f)));
    if (near > 6) v -= Math.min(15, (near - 6) * BW(u.owner).charLonely);
  }
  const edge = Math.min(c.x, c.y, W - c.x, H - c.y);
  const job = s.objectives.some((o) => dist(o, c) <= 6) || boardUnits(s, other(u.owner)).some((e) => unitDistance(u, e) <= 12);
  if (edge < 3 && !job) v -= (3 - edge) * 1.5;
  return v;
}

/** How much holding objectives matters to this unit: less for an expensive damage dealer (cheap units hold, it fights). */
function objectiveWeight(s: GameState, u: UnitState, ctx: Ctx): number {
  if (ctx.deliver) return 0.3;
  if (ctx.escort && ctx.escort.weight >= 3) return 0.3; // a Techmarine's job is its vehicle, not holding ground
  if (u.keywords?.includes?.('BATTLELINE') || alive(u).some((m) => m.keywords.includes('BATTLELINE'))) return 1;
  const dealer = ctx.brawler || ctx.range >= 18;
  return dealer ? Math.max(0.45, Math.min(1, BW(u.owner).objDealerPts / Math.max(1, unitValue(u)))) : 1;
}

/** Bunched-up units block each other's moves and charges, and give the enemy blast / charge targets: spread out. */
function crowdScore(s: GameState, u: UnitState): number {
  const ms = alive(u);
  let v = 0;
  for (const f of boardUnits(s, u.owner)) {
    if (f.id === u.id || f.transport || u.transport) continue;
    let gap = 99;
    for (const a of ms) for (const b of alive(f)) gap = Math.min(gap, dist(a, b) - a.r - b.r);
    if (gap < 1) v += BW(u.owner).crowdTouch; else if (gap < 3) v += BW(u.owner).crowdNear;
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
    const w = BW(u.owner);
    const caution = ctx.holder ? w.cautionHolder : ctx.brawler ? w.cautionBrawler : w.cautionOther;
    // the home objective is a job for a cheap unit: a tournament player doesn't park 400 points of Terminators on it
    const homeFactor = ctx.holder || unitValue(u) <= 200 ? 1 : w.homeExpensive;
    return objectiveWeight(s, u, ctx) * objectiveScore(s, u, homeFactor) + shootScore(s, u, kind, ctx) + chargeScore(s, u, ctx) - caution * dangerScore(s, u, ctx) + pullScore(s, u, ctx) - crowdScore(s, u) + positionScore(s, u);
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
  if (ctx.claim) pts.push(ctx.claim);
  if (ctx.escort && alive(ctx.escort.u).length) pts.push(centre(ctx.escort.u));
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
  if (u.homer) near.push(u.homer); // Teleport Homer: arriving by its token
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
    // arriving counts as a Normal move: shots and (long) charges this turn. A unit held back to drop in is meant for
    // the fight: landing in its own deployment zone (where it's safe because it's useless) is what a walk does anyway
    const atHome = [...pos.values()].filter((q) => pointInPoly(q, zoneOf(s, u.owner))).length / Math.max(1, pos.size);
    let v = scoreSpot(s, u, 'ingress', pos, { ...ctx, holder: true }, 0) - atHome * 25;
    // dropping in from the sky is for hitting the enemy: within 12" (rapid fire, a charge next turn), not a safe corner
    if (how === 'deepStrike' && ctx.foes.length) {
      const ms = alive(u), saved = ms.map((m) => [m, m.x, m.y] as const);
      for (const m of ms) { const q = pos.get(m.id); if (q) { m.x = q.x; m.y = q.y; } }
      const gap = Math.min(...ctx.foes.map((f) => unitDistance(u, f.u)));
      for (const [m, x, y] of saved) { m.x = x; m.y = y; }
      v -= 1.2 * Math.max(0, gap - 12);
    }
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
