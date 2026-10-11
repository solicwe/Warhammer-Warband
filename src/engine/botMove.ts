// Bot movement: where a whole unit can legally get to, and how good each spot is.
// Moves follow the shortest route (A* around walls the model can't cross and around enemy models); a squad keeps
// its shape where it can and otherwise re-forms around the new spot. Every end position is scored the way a player
// weighs it: objectives held, the shots and the charge it sets up this turn, and what the enemy can do back.
import { buildShootPools, expectedDamage, shootingModes } from './attack';
import { primaryById, RULES } from './config';
import { chargeEligibility, findPlacement, formationAt, hasDeepStrike, levelOfControl, validateMove, validatePlacement, zoneOf } from './game';
import { circleTouchesPoly, dist, pointInPoly, polyCentroid } from './geometry';
import { blockingWalls, distanceField, pathLength, pointAt, routeAround } from './pathing';
import { alive, boardUnits, hasKw, isEngaged, other, pace, unitDistance } from './state';
import { hasLos } from './visibility';
import { secondaryGoal } from './secondaries';
import { zonePoly } from './missions';
import { hasAbility } from './weapons';
import { actsOfUnit } from './activations';
import { unitFlags } from './effects';
import { botOff, W as BW, type BotW } from './botWeights';
import { armyPlan, followedJob, unitPunch, type Role } from './botPlan';
import {
  centre, chargeValue, isBrawler, maxRange, meleeKills, moveOf, objPoint, oc, objectiveNeeds, p2d6, perModel, rangedKills, shotValue, unitValue,
} from './botEval';
import type { GameState, ModelState, MoveKind, PlayerId, Pt, UnitState } from './types';

export type Paths = Map<string, Pt[]>;

/** The lookahead plays whole turns on copies of the game: there each unit weighs fewer spots (the closest aims, one
 *  way of getting to each), so more ways of playing the turn fit in the time a phone has. */
let fastPlanning = false;
export function withFastPlanning<T>(fn: () => T): T {
  const was = fastPlanning;
  fastPlanning = true;
  try { return fn(); } finally { fastPlanning = was; }
}
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
  const want = opt.count ?? (fastPlanning ? 1 : 2);
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

/** share: the part of its firepower likely to come our way (it splits its fire among the units it can reach) */
interface Foe { u: UnitState; rk: number; mk: number; brawler: boolean; range: number; M: number; share: number }

/** What the enemy army can do to this unit (computed once per unit, positions vary). */
export interface Ctx {
  foes: Foe[]; brawler: boolean; target?: UnitState; range: number; heavy: boolean; ocNeed: Pt[];
  /** route distances for units that can't cross ruin walls (vehicles, monsters): to the melee target, to objectives */
  toTarget?: (p: Pt) => number; toObjective?: (p: Pt) => number; toFront?: (p: Pt) => number; toPost?: (p: Pt) => number;
  /** a transport with units inside: where to drop them off (the enemy for fighters, a contested objective for the rest) */
  deliver?: Pt;
  /** a cheap objective holder (Battleline or a low-cost squad with OC): its job is standing on objectives, not hiding */
  holder?: boolean;
  /** a unit that leaves objectives secured behind it (Objective Secured …): the next objective to claim, then it moves on */
  claim?: Pt;
  /** an expensive fighting unit (Terminators, big squads, tanks): where the fight is — the centre, then the enemy */
  front?: Pt;
  /** the front is an objective to stand on (early rounds), not an enemy unit to shoot from a distance */
  frontObj?: boolean;
  /** a table quarter to hold for the mission (Reconnaissance Sweep, Engage on All Fronts): where to stand in it */
  quarter?: { q: number; aim: Pt };
  /** deep strike denial: spots near our valuable units an enemy unit in Reserves could land on (more than 9" from all
   *  our models), the ones another of our units already covers, and what covering one is worth */
  denial?: { pts: Pt[]; covered: boolean[]; per: number };
  /** a secondary card this unit is sent to score: where to go, and when it counts as there */
  card?: { aim: Pt; card: string; done: (u: UnitState) => boolean };
  /** a character or model whose ability works on friendly units nearby (Techmarine and vehicles, auras): stay by them */
  escort?: { u: UnitState; range: number; weight: number };
  /** its job in the army's plan (botPlan.ts), and where that job wants it (an objective to hold, a spot to screen) */
  role?: Role;
  post?: Pt;
  /** how much losses count this round (the plan: careful while ahead, risky while behind, little in the last turn) */
  risk?: number;
  /** what an inch closer to its fight is worth: the damage it does in a turn over the distance it moves in one
   *  (a turn sooner into the fight is a turn more of its damage), for hammers and fighters */
  perInch?: number;
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
  const solo = alive(u).every((m) => m.isCharacter) && unitValue(u) < 150 && !hasKw(u, 'MONSTER') && !hasKw(u, 'VEHICLE');
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

// ---------- the army's hammer ----------

/**
 * Where an expensive unit that is not a cheap holder should be heading: the central / middle objectives the army
 * doesn't hold yet in the first rounds (Terminators take the middle of the board), then the enemy unit worth the
 * most that is within a couple of moves. Cheap units hold home and do missions; this is the one that wins the fight.
 */
function frontFor(s: GameState, u: UnitState, ctx: Ctx): Pt | undefined {
  if (ctx.holder || ctx.quarter || ctx.card || ctx.deliver || u.transport || (ctx.escort && ctx.escort.weight >= 3)) return undefined;
  const role = botOff('hammer') ? undefined : ctx.role;
  if (role && role !== 'hammer') return undefined;
  if (role !== 'hammer' && (unitValue(u) < 150 || alive(u).every((m) => m.isCharacter))) return undefined;
  const c = centre(u);
  const mine = (o: { controller: PlayerId | null }) => o.controller === u.owner;
  const mid = s.objectives.filter((o) => o.type !== 'home' && !mine(o)).map((o) => objPoint(s, o)).sort((a, b) => dist(a, c) - dist(b, c));
  const foes = boardUnits(s, other(u.owner)).filter((e) => !hasKw(e, 'AIRCRAFT'));
  const reach = 2 * moveOf(u) + Math.max(ctx.range, 1);
  const prey = foes.map((e) => ({ e, v: unitValue(e) / (1 + Math.max(0, unitDistance(u, e) - reach) / 6) })).sort((a, b) => b.v - a.v)[0]?.e;
  if (s.round <= 2 && mid.length) return mid[0];
  if (prey) return centre(prey);
  return mid[0];
}

// ---------- table quarters ----------

const BOARD_W = RULES.battlefield.width, BOARD_H = RULES.battlefield.height;

const quarterOf = (m: Pt) => (m.x < BOARD_W / 2 ? 0 : 1) + (m.y < BOARD_H / 2 ? 0 : 2);
/** Is the unit wholly in one table quarter and more than 6" from the centre (what quarter missions count)? */
export function unitQuarter(u: UnitState): number | null {
  const ms = alive(u);
  if (!ms.length) return null;
  const c = { x: BOARD_W / 2, y: BOARD_H / 2 };
  const q0 = quarterOf(ms[0]);
  const ok = ms.every((m) => quarterOf(m) === q0 && dist(m, c) - m.r > 6 && Math.abs(m.x - c.x) >= m.r && Math.abs(m.y - c.y) >= m.r);
  return ok ? q0 : null;
}

/** Does player p score for units in table quarters this turn (the primary or an active secondary card)? */
export function wantsQuarters(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (P.secMode !== 'none' && P.secActive.includes('engage-on-all-fronts')) return true;
  const prim = P.primaryId ? primaryById(P.primaryId) : undefined;
  return !!prim?.scoring.some((r) => r.condition === 'tableQuarters' && s.round >= r.rounds[0] && s.round <= r.rounds[1]);
}

/** A spot in quarter q for the unit: its centre pulled into the quarter, at least 9" from the board centre. */
function quarterAim(u: UnitState, q: number): Pt {
  const c = centre(u);
  const x0 = q % 2 === 0 ? 2 : BOARD_W / 2 + 2, x1 = q % 2 === 0 ? BOARD_W / 2 - 2 : BOARD_W - 2;
  const y0 = q < 2 ? 2 : BOARD_H / 2 + 2, y1 = q < 2 ? BOARD_H / 2 - 2 : BOARD_H - 2;
  let p = { x: Math.min(x1, Math.max(x0, c.x)), y: Math.min(y1, Math.max(y0, c.y)) };
  const mid = { x: BOARD_W / 2, y: BOARD_H / 2 };
  const d = dist(p, mid);
  if (d < 9) {
    const dx = (q % 2 === 0 ? -1 : 1) * 0.7, dy = (q < 2 ? -1 : 1) * 0.7;
    p = { x: mid.x + dx * 9 / 0.99, y: mid.y + dy * 9 / 0.99 };
  }
  return p;
}

const quarterCache = new WeakMap<GameState, { key: string; jobs: Map<string, { q: number; aim: Pt }> }>();
/**
 * Who holds which table quarter: a unit already standing in a quarter keeps it; each empty quarter goes to the
 * cheapest unit that can get there soonest (cheap squads and scouts, not the army's hammer).
 */
function quarterJobs(s: GameState, p: PlayerId): Map<string, { q: number; aim: Pt }> {
  const key = `${s.turn}|${s.phase}|${p}|${boardUnits(s, p).map((u) => u.id + ':' + alive(u).length).join(',')}`;
  const hit = quarterCache.get(s);
  if (hit && hit.key === key) return hit.jobs;
  const jobs = new Map<string, { q: number; aim: Pt }>();
  if (wantsQuarters(s, p)) {
    // sitting in a corner is a job for cheap units: never the army's fighters, monsters or anything expensive
    // (Magnus or a Deff Dread parked in a table quarter is a unit out of the battle)
    const free = boardUnits(s, p).filter((u) => !u.transport && !isEngaged(s, u) && !hasKw(u, 'AIRCRAFT') && !hasKw(u, 'MONSTER')
      && unitValue(u) <= 150 && !(isBrawler(s, u) && unitValue(u) > 60));
    const taken = new Set<number>();
    for (const u of free) {
      const q = unitQuarter(u);
      if (q === null || taken.has(q)) continue;
      // the cheapest unit already in the quarter keeps it
      const holders = free.filter((x) => unitQuarter(x) === q).sort((a, b) => unitValue(a) - unitValue(b));
      jobs.set(holders[0].id, { q, aim: centre(holders[0]) });
      taken.add(q);
    }
    for (const q of [0, 1, 2, 3]) {
      if (taken.has(q)) continue;
      const cands = free.filter((u) => !jobs.has(u.id))
        .map((u) => ({ u, cost: unitValue(u) + 8 * dist(centre(u), quarterAim(u, q)) / Math.max(4, moveOf(u)) * 10 }))
        .sort((a, b) => a.cost - b.cost);
      if (!cands.length) continue;
      jobs.set(cands[0].u.id, { q, aim: quarterAim(cands[0].u, q) });
      taken.add(q);
    }
  }
  quarterCache.set(s, { key, jobs });
  return jobs;
}

const cardCache = new WeakMap<GameState, { key: string; jobs: Map<string, { aim: Pt; card: string; done: (u: UnitState) => boolean }> }>();
/**
 * Where the active secondary cards want a unit by the end of this turn (a battlefield edge for Outflank, the enemy
 * deployment zone, the centre, an objective to do an action on, the objective the opponent picked …): the cheapest
 * unit that gets there soonest takes each card, the way a player sends a cheap squad to score a card while the army
 * fights. Cards about killing are left to the target choice.
 */
function cardJobs(s: GameState, p: PlayerId): Map<string, { aim: Pt; card: string; done: (u: UnitState) => boolean }> {
  const P = s.players[p];
  const key = `${s.turn}|${s.phase}|${p}|${P.secActive.join(',')}|${boardUnits(s, p).map((u) => u.id + ':' + alive(u).length).join(',')}`;
  const hit = cardCache.get(s);
  if (hit && hit.key === key) return hit.jobs;
  const jobs = new Map<string, { aim: Pt; card: string; done: (u: UnitState) => boolean }>();
  if (P.secMode !== 'none' && s.round >= 1 && !botOff('cards')) {
    const quarters = quarterJobs(s, p);
    // the squad kept on the home objective stays there (a card is no reason to give up home)
    const plan = armyPlan(s, p);
    const free = boardUnits(s, p).filter((u) => !u.transport && !isEngaged(s, u) && !hasKw(u, 'AIRCRAFT') && !hasKw(u, 'MONSTER') && !quarters.has(u.id)
      && unitValue(u) <= 150 && !(isBrawler(s, u) && unitValue(u) > 90) && !followedJob(plan, u.id)?.keep);
    const mine = zonePoly(s, p), theirs = zonePoly(s, other(p));
    const centreB = { x: BOARD_W / 2, y: BOARD_H / 2 };
    const wholly = (u: UnitState, poly: Pt[]) => alive(u).every((m) => pointInPoly(m, poly));
    for (const id of P.secActive) {
      const g = secondaryGoal(s, p, id);
      // each card: candidate spots and when a unit counts as there
      let spots: Pt[] = [];
      let done: (u: UnitState) => boolean = () => false;
      let pool = free;
      if (id === 'behind-enemy-lines') { spots = [polyCentroid(theirs)]; done = (u) => wholly(u, theirs); }
      else if (id === 'outflank') {
        spots = [3, BOARD_W - 3].flatMap((x) => [BOARD_H * 0.3, BOARD_H * 0.5, BOARD_H * 0.7].map((y) => ({ x, y }))).filter((q) => !pointInPoly(q, mine));
        done = (u) => alive(u).every((m) => (m.x <= 6 || m.x >= BOARD_W - 6) && !pointInPoly(m, mine));
      } else if (id === 'centre-ground') { spots = [centreB]; done = (u) => alive(u).some((m) => dist(m, centreB) <= 3); }
      else if (id === 'beacon' && g.units.length) { pool = free.filter((u) => g.units.includes(u.id)); spots = [polyCentroid(theirs), centreB]; done = (u) => !alive(u).some((m) => pointInPoly(m, mine)); }
      else if (id === 'plunder' || id === 'cleanse' || id === 'a-tempting-target') {
        spots = g.objectives.map((oid) => s.objectives.find((o) => o.id === oid)).filter((o): o is NonNullable<typeof o> => !!o)
          .filter((o) => id === 'a-tempting-target' || !(o.type === 'home' && o.owner === p) || pace(s) >= 4).map((o) => objPoint(s, o));
        done = (u) => spots.some((q) => alive(u).some((m) => dist(m, q) <= 3 + m.r));
      }
      if (!spots.length) continue;
      // the unit that is cheapest to send: points, plus how many moves it needs (a unit two moves away is no use this turn)
      let best: { u: UnitState; aim: Pt; cost: number } | null = null;
      for (const u of pool) {
        if (jobs.has(u.id)) continue;
        const c = centre(u);
        const aim = spots.reduce((a, q) => (dist(q, c) < dist(a, c) ? q : a));
        const moves = dist(aim, c) / Math.max(4, moveOf(u) + 3);
        if (moves > 2) continue;
        const cost = unitValue(u) + moves * 60;
        if (!best || cost < best.cost) best = { u, aim, cost };
      }
      if (best) jobs.set(best.u.id, { aim: best.aim, card: id, done });
    }
  }
  cardCache.set(s, { key, jobs });
  return jobs;
}

/**
 * Screening against Deep Strike: while the enemy has units waiting to land, a cheap unit standing in the open ground
 * round our valuable units keeps them out (they must arrive more than 9" from every model of ours). The spots that
 * matter are rings 6-12" round those units; each one a cheap unit covers that nobody else does is worth a share of
 * what is waiting in Reserves.
 */
function denialFor(s: GameState, u: UnitState, ctx: Ctx): Ctx['denial'] {
  if (botOff('screenDS') || pace(s) > 3 || unitValue(u) > 150 || ctx.role === 'hammer' || u.transport || isEngaged(s, u)) return undefined;
  const waiting = s.units.filter((e) => e.owner !== u.owner && e.status === 'reserves' && hasDeepStrike(s, e)).reduce((a, e) => a + unitValue(e), 0);
  if (waiting < 100) return undefined;
  const guarded = boardUnits(s, u.owner).filter((f) => f.id !== u.id && unitValue(f) >= 150 && !f.transport);
  if (!guarded.length) return undefined;
  const pts: Pt[] = [];
  for (const f of guarded) {
    const c = centre(f);
    for (const R of [7, 11]) for (let k = 0; k < 10; k++) {
      const p = { x: c.x + Math.cos((k / 10) * Math.PI * 2) * R, y: c.y + Math.sin((k / 10) * Math.PI * 2) * R };
      if (p.x > 1 && p.y > 1 && p.x < W - 1 && p.y < H - 1 && !pts.some((q) => dist(q, p) < 2.5)) pts.push(p);
    }
  }
  const others = boardUnits(s, u.owner).filter((f) => f.id !== u.id).flatMap(alive);
  const covered = pts.map((p) => others.some((m) => dist(m, p) - m.r < 9));
  const open = covered.filter((x) => !x).length;
  if (!open) return undefined;
  return { pts, covered, per: (waiting * 0.15) / pts.length };
}

/** The easy bot misjudges spots now and then: a fixed jitter per spot and turn (the same game replays the same way). */
function slip(s: GameState, u: UnitState): number {
  if ((s.botLevels?.[u.owner] ?? s.botLevel) !== 'easy') return 0;
  const c = centre(u);
  let h = Math.imul(Math.round(c.x * 4) + 7919 * Math.round(c.y * 4), 2654435761) ^ Math.imul(s.turn + 31 * u.id.length, 40503);
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 40;
}

/** What a spot is worth for screening: the landing spots this unit's models keep the enemy out of. */
function denialScore(u: UnitState, ctx: Ctx): number {
  const d = ctx.denial;
  if (!d) return 0;
  let n = 0;
  const ms = alive(u);
  d.pts.forEach((p, i) => { if (!d.covered[i] && ms.some((m) => dist(m, p) - m.r < 9)) n++; });
  return n * d.per;
}

export function ctxFor(s: GameState, u: UnitState): Ctx {
  const friends = boardUnits(s, u.owner).filter((f) => !hasKw(f, 'AIRCRAFT'));
  const foes = boardUnits(s, other(u.owner)).map((e) => {
    const range = maxRange(e), M = moveOf(e);
    // a gun that can reach several of our units splits its fire: each gets part of it (focus fire is common: 1/√n)
    const reach = friends.filter((f) => unitDistance(e, f) <= range + M).length;
    return { u: e, rk: Math.min(alive(u).length, rangedKills(e, u)), mk: Math.min(alive(u).length, meleeKills(e, u)), brawler: isBrawler(s, e), range, M, share: botOff('share') ? 1 : 1 / Math.sqrt(Math.max(1, reach)) };
  });
  const brawler = isBrawler(s, u);
  const target = brawler ? [...foes].sort((a, b) => (chargeValue(s, u, b.u) / (1 + unitDistance(u, b.u) / 10)) - (chargeValue(s, u, a.u) / (1 + unitDistance(u, a.u) / 10)))[0]?.u : undefined;
  const heavy = alive(u).some((m) => m.weapons.some((w) => w.profiles.some((p) => hasAbility(p, 'heavy'))));
  // an expensive unit is not pulled back to the home objective (it goes for the ones out on the field)
  const big = unitValue(u) > 200;
  const ocNeed = oc(u) > 0 ? objectiveNeeds(s, u.owner).filter((n) => n.need > 0 && !(big && n.o.type === 'home' && n.o.owner === u.owner)).map((n) => objPoint(s, n.o)) : [];
  const ctx: Ctx = { foes, brawler, target, range: maxRange(u), heavy, ocNeed };
  const battleline = alive(u).some((m) => m.keywords.includes('BATTLELINE'));
  // melee units go and fight; holding is a job for BATTLELINE and cheap shooting squads
  ctx.holder = oc(u) > 0 && !u.transport && (battleline || unitValue(u) <= 130) && !(brawler && (unitValue(u) > 130 || !battleline));
  const plan = armyPlan(s, u.owner);
  const job = followedJob(plan, u.id);
  ctx.risk = plan.risk;
  ctx.perInch = botOff('perInch') ? 1 : Math.min(12, Math.max(1, unitPunch(s, u) / Math.max(4, moveOf(u))));
  if (job) {
    ctx.role = job.role === 'screen' && botOff('screen') ? undefined : job.role;
    ctx.post = botOff('posts') ? undefined : job.post;
    if (!botOff('posts')) {
      if (job.role === 'home' || job.role === 'anchor') ctx.holder = oc(u) > 0;
      else if (job.role !== 'firebase') ctx.holder = false;
      // a unit sent to hold one objective doesn't wander to the others that need bodies
      if (job.post && (job.role === 'home' || job.role === 'anchor')) ctx.ocNeed = ctx.ocNeed.filter((q) => dist(q, job.post!) < 0.5);
      else if (job.role === 'screen' || job.role === 'hammer') ctx.ocNeed = s.round >= 2 ? ctx.ocNeed.filter((q) => dist(q, centre(u)) <= moveOf(u) + 3) : [];
    }
  }
  if (oc(u) > 0 && !u.battleShocked && securesObjectives(s, u)) {
    // the closest objective not yet ours for good, within two moves; the home one only if nobody holds it
    const M = moveOf(u);
    const c = centre(u);
    const open = s.objectives.filter((o) => o.secured !== u.owner && !(o.type === 'home' && o.controller === u.owner))
      .map((o) => objPoint(s, o)).filter((p) => dist(p, c) <= 2 * M + 6).sort((a, b) => dist(a, c) - dist(b, c));
    ctx.claim = open[0];
  }
  ctx.escort = escortFor(s, u);
  ctx.quarter = quarterJobs(s, u.owner).get(u.id);
  ctx.card = cardJobs(s, u.owner).get(u.id);
  if (ctx.quarter) ctx.post = undefined;
  ctx.denial = denialFor(s, u, ctx);
  ctx.front = frontFor(s, u, ctx);
  ctx.frontObj = !!ctx.front && s.objectives.some((o) => dist(objPoint(s, o), ctx.front!) < 0.5);
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
    if (ctx.ocNeed.length) ctx.toObjective = distanceField(s, u, 'normal', lead, ctx.ocNeed);
    if (ctx.front) ctx.toFront = distanceField(s, u, 'normal', lead, [ctx.front]);
    if (ctx.post) ctx.toPost = distanceField(s, u, 'normal', lead, [ctx.post]);
  }
  return ctx;
}

/**
 * How much the home objective counts for this unit. It is a job for a cheap unit: a tournament player doesn't park 400
 * points of Terminators on it, nor a full squad of Battleline with its Sorcerer (they go and take the middle).
 */
function homeFactorOf(u: UnitState, ctx: Ctx, w: BotW): number {
  if (ctx.role && !botOff('homeF')) return ctx.role === 'home' ? 1 : w.homeExpensive;
  return unitValue(u) <= 200 ? 1 : w.homeExpensive;
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
      shots += f.rk * perModel(u) * f.share * (seen(s, f.u, u) ? 1 : BW(u.owner).dangerUnseen) * (gap <= f.range ? 1 : 0.6) * (infantryInCover ? 0.8 : 1);
    }
    if (f.brawler && f.mk > 0) melee = Math.max(melee, f.mk * perModel(u) * p2d6(Math.max(0, gap - f.M)));
  }
  // the enemy can't kill more than the whole unit, however many guns could reach it
  return Math.min(unitValue(u), shots * BW(u.owner).dangerShots + melee * BW(u.owner).dangerMelee);
}

/**
 * How far a goal is for a pull: along the route for a unit walls can stop (`far`, from its distance field), else in a
 * straight line. With no route from here at all, every spot is equally far (no pull into a wall it can't get past).
 */
function routeGap(far: number | undefined, straight: number, slack = 0, routeOnly = false): number {
  if (far === undefined) return straight;
  if (!Number.isFinite(far)) return botOff('route') ? straight : 99;
  return routeOnly ? far : Math.max(straight, far - slack);
}

/** Long-range pull so units far from everything still make progress (along the route, for units walls can stop). */
function pullScore(s: GameState, u: UnitState, ctx: Ctx): number {
  const c = centre(u);
  const lead = leaderOf(u);
  const w = BW(u.owner);
  let v = 0;
  if (ctx.brawler && ctx.target && alive(ctx.target).length) {
    const far = ctx.toTarget?.(lead);
    const gap = routeGap(far, unitDistance(u, ctx.target), 1.5);
    // a screen doesn't walk out into the open towards a far-off target: it closes to a charge's reach and waits there
    v -= w.pullBrawler * (ctx.perInch ?? 1) * gap;
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
  if (ctx.front && !ctx.brawler) {
    // a shooter worth its points goes where the fight is, and stops at a good firing distance
    const far = ctx.toFront?.(lead);
    const gap = routeGap(far, dist(c, ctx.front));
    v -= w.pullHammer * (ctx.perInch ?? 1) * Math.max(0, gap - (ctx.frontObj ? 2 : Math.min(ctx.range * 0.6, 12)));
  }
  if (ctx.card && !ctx.deliver && !ctx.quarter) {
    // its card: be where the card wants it at the end of the turn
    v += ctx.card.done(u) ? w.claimBonus : -w.claimPull * Math.max(0, dist(c, ctx.card.aim) - 2);
  }
  if (ctx.quarter && !ctx.deliver) {
    // its job this turn: be wholly in that quarter, more than 6" from the centre, at the end of the turn
    v += unitQuarter(u) === ctx.quarter.q ? w.claimBonus : -w.claimPull * Math.max(0, dist(c, ctx.quarter.aim) - 2);
  }
  if (ctx.escort && alive(ctx.escort.u).length) v -= ctx.escort.weight * 2 * Math.max(0, unitDistance(u, ctx.escort.u) - (ctx.escort.range - 1));
  if (ctx.post && !ctx.deliver && !ctx.quarter) {
    // its post in the plan: standing on an objective it holds, or the screening spot (anywhere close will do)
    const on = (ctx.role === 'home' || ctx.role === 'anchor') && alive(u).some((m) => dist(m, ctx.post!) <= 3 + m.r);
    const far = ctx.toPost?.(lead);
    const gap = routeGap(far, dist(c, ctx.post));
    v += on ? w.claimBonus * 0.6 : -w.pullPost * Math.max(0, gap - 2);
  }
  if (ctx.ocNeed.length && !ctx.deliver) {
    const far = ctx.toObjective?.(lead);
    v -= (ctx.holder ? w.pullHolder : w.pullObjective) * routeGap(far, Math.min(...ctx.ocNeed.map((p) => dist(c, p))), 0, true);
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
  // a small character on its own stays with the army; a big one (Magnus, a Daemon Prince, a tank) fights on its own
  if (alive(u).every((m) => m.isCharacter) && unitValue(u) < 150 && !hasKw(u, 'MONSTER') && !hasKw(u, 'VEHICLE')) {
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

/** The parts of scoreSpot, for tests and tuning: objectives, shooting, charging, danger (already × caution), pulls, crowding, position. */
export function scoreParts(s: GameState, u: UnitState, kind: MoveKind | 'stationary', spot: Spot | null, ctx: Ctx): Record<string, number> {
  const ms = alive(u);
  const saved = ms.map((m) => [m, m.x, m.y] as const);
  const was = { move: u.move, maxMoved: u.maxMoved };
  if (spot) for (const m of ms) { const p = spot.get(m.id); if (p) { m.x = p.x; m.y = p.y; } }
  u.move = kind === 'stationary' ? 'stationary' : kind;
  try {
    const w = BW(u.owner);
    const caution = (ctx.role === 'screen' ? w.cautionBrawler * 1.4 : ctx.holder ? w.cautionHolder : ctx.brawler ? w.cautionBrawler : w.cautionOther) * (ctx.risk ?? 1);
    const homeFactor = homeFactorOf(u, ctx, w);
    return { obj: objectiveWeight(s, u, ctx) * objectiveScore(s, u, homeFactor), shoot: shootScore(s, u, kind, ctx), charge: chargeScore(s, u, ctx), danger: -caution * dangerScore(s, u, ctx), pull: pullScore(s, u, ctx), crowd: -crowdScore(s, u), pos: positionScore(s, u) };
  } finally {
    for (const [m, x, y] of saved) { m.x = x; m.y = y; }
    u.move = was.move;
    u.maxMoved = was.maxMoved;
  }
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
    // a screen keeps out of sight like a shooting unit (it's there to be in the way later, not shot now)
    const caution = (ctx.role === 'screen' ? w.cautionBrawler * 1.4 : ctx.holder ? w.cautionHolder : ctx.brawler ? w.cautionBrawler : w.cautionOther) * (ctx.risk ?? 1);
    const homeFactor = homeFactorOf(u, ctx, w);
    return objectiveWeight(s, u, ctx) * objectiveScore(s, u, homeFactor) + shootScore(s, u, kind, ctx) + chargeScore(s, u, ctx) - caution * dangerScore(s, u, ctx) + pullScore(s, u, ctx) - crowdScore(s, u) + positionScore(s, u) + denialScore(u, ctx) + slip(s, u);
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
  if (ctx.quarter) pts.push(ctx.quarter.aim);
  if (ctx.card) pts.push(ctx.card.aim);
  if (ctx.front) pts.push(ctx.front);
  if (ctx.post) pts.push(ctx.post);
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
  for (const aim of opt.aims ?? (fastPlanning ? aimsFor(s, u, max, ctx).slice(0, 7) : aimsFor(s, u, max, ctx))) {
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
  for (const f of [...ctx.foes].sort((a, b) => unitValue(b.u) - unitValue(a.u)).slice(0, 3)) {
    near.push(centre(f.u));
    // a melee unit dropping in wants the closest legal ring around a target (just over 9"), from every side
    if (how === 'deepStrike' && ctx.brawler) for (let k = 0; k < 8; k++) near.push({ x: centre(f.u).x + Math.cos((k * Math.PI) / 4) * 10, y: centre(f.u).y + Math.sin((k * Math.PI) / 4) * 10 });
  }
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
      // a melee unit 13" away is a turn late; land as close as the rules allow
      v -= ctx.brawler ? 4 * Math.max(0, gap - 9.5) : 1.2 * Math.max(0, gap - 12);
      v += 0.8 * arrivalStrike(s, u, pos);
    }
    if (!best || v > best.v) best = { pos, v };
  }
  return best?.pos ?? null;
}

/**
 * What a unit set up at `pos` can take off the board this turn: its guns at the best target in range, or (a melee
 * unit) its charge at the best target times the chance of making that charge. Points of enemy models.
 */
export function arrivalStrike(s: GameState, u: UnitState, pos: Spot): number {
  const ms = alive(u), saved = ms.map((m) => [m, m.x, m.y] as const);
  for (const m of ms) { const q = pos.get(m.id); if (q) { m.x = q.x; m.y = q.y; } }
  try {
    const range = maxRange(u), brawler = isBrawler(s, u);
    let best = 0;
    for (const e of boardUnits(s, other(u.owner))) {
      const gap = unitDistance(u, e);
      const left = alive(e).length;
      const shot = gap <= range + 0.5 ? Math.min(left, rangedKills(u, e)) * perModel(e) : 0;
      const charge = brawler ? Math.min(left, meleeKills(u, e)) * perModel(e) * p2d6(gap) : 0;
      // finishing a valuable unit off counts for more than scratching it
      const v = Math.max(shot, charge) * (Math.max(shot, charge) >= unitValue(e) * 0.8 ? 1.3 : 1);
      best = Math.max(best, v);
    }
    return best;
  } finally {
    for (const [m, x, y] of saved) { m.x = x; m.y = y; }
  }
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
