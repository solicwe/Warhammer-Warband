// The expert bot plans its turn the way a tournament player does before moving anything:
//  - objectives: which ones to take or hold this turn and with how much OC (enough to beat what the enemy has there
//    and can bring in its turn), from the cheapest units that get there, instead of every unit piling onto the nearest;
//  - kills: the enemy models that must die for an objective to change hands, and the units screening a charge;
//  - charges: one charger per target that one charger can deal with.
// Movement (botMove.ctxFor), the target choice (botEval.shotValue), the charge (bot.botChargeOne), the secondaries
// (botMove.cardJobs, bot.cardIsDead) and Deep Strike screening (botMove.denialFor) read it. Only the expert level
// plans this way: every other level returns null and plays as before. The plan is made again each phase and whenever a
// model dies or arrives, from where the armies stand then; it takes a few milliseconds even in a 2000-point game.
import { dist, pointInPoly, pointSegDist } from '../engine/geometry';
import { primaryById } from '../engine/config';
import { chargeEligibility } from '../engine/game';
import { objectivePolys } from '../engine/missions';
import { alive, boardUnits, hasKw, isEngaged, lastRound, other, unitDistance } from '../engine/state';
import { centre, isBrawler, lockValue, meleeKills, moveOf, objPoint, oc, p2d6, perModel, unitPunch, unitValue } from './botEval';
import { armyPlan, followedJob, homeScoresVp } from './botPlan';
import { botOff, W } from './botWeights';
import type { GameState, ModelState, ObjectiveState, PlayerId, Pt, UnitState } from '../engine/types';

/** An objective the plan takes or holds: the units sent there, the OC it needs and the OC they bring. */
export interface ObjOrder { o: ObjectiveState; at: Pt; units: string[]; need: number; have: number; value: number }
/** Models of an enemy unit the plan wants dead this turn, and what killing them all is worth (points of damage). */
export interface KillOrder { models: number; bonus: number; why: 'objective' | 'screen' }
export interface TurnPlan {
  orders: ObjOrder[];
  /** unit id -> the objective it is sent to */
  post: Map<string, Pt>;
  /** objectives that have enough OC sent: other units leave them alone */
  covered: Pt[];
  /** enemy unit id -> models to kill */
  kills: Map<string, KillOrder>;
  /** our charger id -> the enemy unit it means to charge */
  charges: Map<string, string>;
}

export const isExpert = (s: GameState, p: PlayerId) => ((s.botLevels as Partial<Record<PlayerId, string>> | undefined)?.[p] ?? s.botLevel) === 'expert';

// How much the plan asks for (data/bot-weights.json, scripts/tune.mjs): planFlip, planScreen, planThreat, planSpare

const cache = new WeakMap<GameState, Map<PlayerId, { key: string; plan: TurnPlan }>>();

/** The expert's plan for this turn (null for every other level, or with BOT_OFF=turnplan). */
export function turnPlan(s: GameState, p: PlayerId): TurnPlan | null {
  if (!isExpert(s, p) || botOff('turnplan')) return null;
  // shotValue asks for the plan thousands of times a step: the key is a number worked out without allocating
  let h = 0;
  for (const o of s.objectives) h = (Math.imul(h, 31) + (o.secured ?? 2) * 3 + (o.controller ?? 2)) | 0;
  for (const u of s.units) {
    let n = 0;
    if (u.status === 'board') for (const m of u.models) if (!m.dead) n++;
    h = (Math.imul(h, 31) + n * 256 + u.status.charCodeAt(0)) | 0;
  }
  const key = `${s.turn}|${s.phase}|${s.active}|${h}`;
  let per = cache.get(s);
  if (!per) { per = new Map(); cache.set(s, per); }
  const hit = per.get(p);
  if (hit && hit.key === key) return hit.plan;
  const plan = makePlan(s, p);
  per.set(p, { key, plan });
  return plan;
}

/** What killing `kills` models of `t` adds to a shot, by the expert's plan (0 for other levels). */
export function planKillBonus(s: GameState, p: PlayerId, t: UnitState, kills: number): number {
  if (botOff('tpKills')) return 0;
  const k = turnPlan(s, p)?.kills.get(t.id);
  return k ? k.bonus * Math.min(1, kills / Math.max(1, k.models)) : 0;
}

/** How far a model is from standing in an objective's area (0: it is in it). */
function gapToObjective(m: ModelState, polys: Pt[][]): number {
  let g = Infinity;
  for (const poly of polys) {
    if (pointInPoly(m, poly)) return 0;
    for (let i = 0; i < poly.length; i++) g = Math.min(g, pointSegDist(m, { a: poly[i], b: poly[(i + 1) % poly.length] }) - m.r);
  }
  return Math.max(0, g);
}

interface Spot { o: ObjectiveState; i: number; polys: Pt[][]; at: Pt; oc: [number, number] }
/**
 * Each objective's area and each side's OC in it, and every unit's gap to every objective. A unit counts on the one
 * objective it has the most models in, as the engine's levelOfControl does, but without OC-changing rules (a planning
 * estimate: levelOfControl costs ~8 ms an objective on a 2000-point board).
 */
function objectiveSpots(s: GameState): { spots: Spot[]; gaps: Map<string, number[]> } {
  const spots: Spot[] = s.objectives.map((o, i) => ({ o, i, polys: objectivePolys(s, o), at: objPoint(s, o), oc: [0, 0] }));
  const gaps = new Map<string, number[]>();
  for (const u of boardUnits(s)) {
    const ms = alive(u);
    const per = spots.map((sp) => ms.map((m) => gapToObjective(m, sp.polys)));
    gaps.set(u.id, per.map((g) => Math.min(...g)));
    if (u.battleShocked) continue;
    let best = -1, most = 0;
    per.forEach((g, i) => { const k = g.filter((x) => x <= 0).length; if (k > most) { most = k; best = i; } });
    if (best >= 0) spots[best].oc[u.owner] += ms.reduce((a, m, j) => a + (per[best][j] <= 0 ? m.profile.OC ?? 0 : 0), 0);
  }
  return { spots, gaps };
}

/** Engaged or not, worked out once per unit (with a quick check that an enemy is anywhere near first). */
function engagedCheck(s: GameState) {
  const memo = new Map<string, boolean>();
  const reach = (u: UnitState) => { const c = centre(u); return { c, r: Math.max(...alive(u).map((m) => dist(m, c) + m.r)) }; };
  const shape = new Map(boardUnits(s).map((u) => [u.id, reach(u)]));
  return (u: UnitState) => {
    let v = memo.get(u.id);
    if (v === undefined) {
      const a = shape.get(u.id)!;
      v = boardUnits(s, other(u.owner)).some((e) => { const b = shape.get(e.id)!; return dist(a.c, b.c) <= a.r + b.r + 2.5; }) && isEngaged(s, u);
      memo.set(u.id, v);
    }
    return v;
  };
}

function makePlan(s: GameState, p: PlayerId): TurnPlan {
  const plan: TurnPlan = { orders: [], post: new Map(), covered: [], kills: new Map(), charges: new Map() };
  if (s.active !== p || s.phase === 'gameover') return plan;
  const mine = boardUnits(s, p).filter((u) => !hasKw(u, 'AIRCRAFT'));
  const foes = boardUnits(s, other(p)).filter((u) => !hasKw(u, 'AIRCRAFT'));
  if (!foes.length) return plan;
  const { spots, gaps } = objectiveSpots(s);
  const engaged = engagedCheck(s);
  if (s.phase === 'movement' && !botOff('tpPosts')) planObjectives(s, p, mine, foes, spots, gaps, engaged, plan);
  else standingKills(s, p, foes, spots, plan);
  if (s.phase === 'shooting' || s.phase === 'charge') planCharges(s, p, mine, foes, engaged, plan);
  return plan;
}

/**
 * What controlling `o` is worth to p in VP by p's primary mission: the rules scored at the end of this turn, and the
 * ones scored at its next Command phase (`hold`: the objective must still be ours after the enemy's turn). Each rule
 * counts what this one objective adds to what p holds elsewhere: "control at least one objective" pays for the
 * first only, "control 3+" for the third, "per objective" for each. A mission that pays nothing for an objective
 * gets no unit sent there.
 */
function objectiveValue(s: GameState, p: PlayerId, o: ObjectiveState, planned: ObjectiveState[] = []): { vp: number; hold: boolean } {
  const id = s.players[p].primaryId;
  if (!id) return { vp: o.type === 'home' && o.owner === p ? (homeScoresVp(s, p) ? 3 : 0) : 4, hold: true };
  const ownHome = (x: ObjectiveState) => x.type === 'home' && x.owner === p;
  const enemyHome = (x: ObjectiveState) => x.type === 'home' && x.owner !== p;
  const others = s.objectives.filter((x) => x !== o && (x.controller === p || planned.includes(x)));
  const theirs = s.objectives.filter((x) => x !== o && x.controller === other(p) && !planned.includes(x)).length;
  const last = lastRound(s);
  let vp = 0, hold = false;
  for (const r of primaryById(id).scoring) {
    const [from, to] = r.rounds;
    const now = (r.when === 'endOfYourTurn' || (r.round5When === 'endOfYourTurn' && s.round >= last)) && s.round >= from && s.round <= to;
    const next = s.round + 1;
    const cmd = r.when === 'endOfYourCommandPhase' && next >= from && next <= to && next <= last;
    const end = r.when === 'endOfBattle' && s.round >= last - 1;
    if (!now && !cmd && !end) continue;
    const v = r.vp || 0;
    let add = 0;
    switch (r.condition) {
      case 'perObjectiveControlled': add = v; break;
      case 'perObjectiveControlledExclHome': add = ownHome(o) ? 0 : v; break;
      case 'perNonHomeIfHomeControlled': add = ownHome(o) ? v * others.filter((x) => !ownHome(x)).length : others.some(ownHome) ? v : 0.3 * v; break;
      case 'controlCentral': add = o.type === 'central' && !others.some((x) => x.type === 'central') ? v : 0; break;
      case 'control2Plus': case 'control3Plus': case 'control4Plus': {
        const k = Number(r.condition[7]);
        add = others.length === k - 1 ? v : others.length === k - 2 ? 0.4 * v : 0.15 * v;
        break;
      }
      case 'controlAnyExclHome': add = ownHome(o) ? 0 : others.some((x) => !ownHome(x)) ? 0.25 * v : v; break;
      case 'controlAnyExclHomes': add = o.type === 'home' ? 0 : others.some((x) => x.type !== 'home') ? 0.25 * v : v; break;
      case 'controlEnemyHome': add = enemyHome(o) ? v : 0; break;
      case 'controlOwnHome': add = ownHome(o) ? v : 0; break;
      case 'controlMoreThanOpponent': {
        const was = o.controller === other(p) ? 1 : 0;
        const withIt = others.length + 1 > theirs, without = others.length > theirs + was;
        add = withIt && !without ? v : 0.2 * v;
        break;
      }
      case 'perNewObjectiveThisTurnExclHome': add = now && o.type !== 'home' && s.controlAtTurnStart?.[s.objectives.indexOf(o)] !== p ? v : 0; break;
      default: add = 0;
    }
    if (add > 0 && !now) hold = true;
    vp += add;
  }
  return { vp, hold };
}

/** Does the enemy still get a turn after this one (its units can walk onto what we take)? */
const enemyMovesAfter = (s: GameState, p: PlayerId) => !(s.round >= lastRound(s) && p !== s.firstPlayer);

/** Movement: send just enough OC to each objective worth taking, cheapest units first, and list what must die there. */
function planObjectives(s: GameState, p: PlayerId, mine: UnitState[], foes: UnitState[], spots: Spot[], gaps: Map<string, number[]>, engaged: (u: UnitState) => boolean, plan: TurnPlan) {
  const army = armyPlan(s, p);
  const w = W(p);
  const threatLater = enemyMovesAfter(s, p);
  // units that can be sent: they score OC, are free to move (an engaged unit only counts where it stands), carry
  // nobody (a loaded transport delivers its squad) and are not the squad kept on the home objective all game. What
  // a unit costs to send: its points and damage (a hammer standing on a marker is a waste)
  const info = mine.filter((u) => oc(u) > 0).map((u) => ({
    u, oc: oc(u), M: moveOf(u), gap: gaps.get(u.id)!, base: unitValue(u) + 2 * unitPunch(s, u),
    pinned: !!followedJob(army, u.id)?.keep || (!!u.transport && s.units.some((x) => x.embarkedIn === u.id && x.status === 'embarked')),
  }));
  const objs = spots.map((sp) => {
    const ours = sp.oc[p], theirs = sp.oc[other(p)];
    // enemy units off the objective that could walk onto it in their turn
    const v = objectiveValue(s, p, sp.o);
    const threat = threatLater && v.hold ? foes.reduce((x, e) => {
      const g = gaps.get(e.id)![sp.i];
      return g > 0 && g <= moveOf(e) + 3 && oc(e) > 0 && !engaged(e) ? x + oc(e) : x;
    }, 0) : 0;
    // what it scores the enemy's mission: taking it (or keeping it) from them is worth part of that
    const deny = w.planDeny * objectiveValue(s, other(p), sp.o).vp;
    return { ...sp, ours, theirs, threat, deny, value: (v.vp + deny) / 4 };
  }).filter((x) => x.value > 0 && x.polys.length && !(x.o.secured === p && x.theirs === 0 && x.threat === 0));

  // the moves a unit needs to get there: two at most (it heads there now and arrives next turn)
  const cands = (obj: (typeof objs)[number], taken: Set<string>) => info.filter((x) => !x.pinned && !taken.has(x.u.id)).map((x) => {
    const g = x.gap[obj.i];
    if (g > 0 && engaged(x.u)) return null;
    const moves = g <= 0 ? 0 : g <= x.M ? 1 : g <= x.M + 3.5 ? 1.3 : g <= 2 * x.M + 3.5 && threatLater ? 2 : Infinity;
    return Number.isFinite(moves) ? { u: x.u, oc: x.oc, cost: x.base + moves * 40 } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.cost - b.cost);
  const pick = (obj: (typeof objs)[number], taken: Set<string>) => {
    const base = obj.theirs + Math.ceil(w.planThreat * obj.threat) + 1;
    const need = base + Math.ceil(w.planSpare * base);
    const out: { u: UnitState; oc: number; cost: number }[] = [];
    // the squad kept on the home objective counts where it stands
    let have = info.filter((x) => x.pinned && x.gap[obj.i] <= 0).reduce((a, x) => a + x.oc, 0);
    for (const c of cands(obj, taken)) { if (have >= need) break; out.push(c); have += c.oc; }
    // short of OC: it is still worth going if our guns can take enough of theirs off it
    const ok = have >= need || (obj.theirs > 0 && have >= 0.4 * obj.theirs + 1);
    return { need, have, out, ok, cost: out.reduce((a, c) => a + c.cost, 0) };
  };
  // the objective that gives the most VP for the least first, then the rest valued again with it counted as ours
  // ("control at least one objective" pays once); each unit goes to one
  const taken = new Set<string>();
  const planned: ObjectiveState[] = [];
  const left = [...objs];
  while (left.length) {
    let best: { obj: (typeof objs)[number]; r: ReturnType<typeof pick>; score: number } | null = null;
    for (const obj of left) {
      const value = planned.length ? (objectiveValue(s, p, obj.o, planned).vp + obj.deny) / 4 : obj.value;
      if (value <= 0) continue;
      const r = pick(obj, taken);
      if (!r.ok) continue;
      const score = value / (r.cost + 50);
      if (!best || score > best.score) best = { obj: { ...obj, value }, r, score };
    }
    if (!best) break;
    const { obj, r } = best;
    left.splice(left.findIndex((x) => x.o === obj.o), 1);
    planned.push(obj.o);
    if (r.have >= r.need) plan.covered.push(obj.at);
    if (!r.out.length) continue;
    for (const c of r.out) { taken.add(c.u.id); plan.post.set(c.u.id, obj.at); }
    plan.orders.push({ o: obj.o, at: obj.at, units: r.out.map((c) => c.u.id), need: r.need, have: r.have, value: obj.value });
    // what they bring is not enough on its own: the models on it that must die first
    if (r.have <= obj.theirs) addObjectiveKills(foes, obj.polys, obj.theirs - r.have + 1, w.planFlip * obj.value, plan);
  }
}

/** Shooting and later: objectives where our models stand but theirs still outnumber them. */
function standingKills(s: GameState, p: PlayerId, foes: UnitState[], spots: Spot[], plan: TurnPlan) {
  for (const sp of spots) {
    const value = (objectiveValue(s, p, sp.o).vp + W(p).planDeny * objectiveValue(s, other(p), sp.o).vp) / 4;
    const ours = sp.oc[p], theirs = sp.oc[other(p)];
    if (value && ours > 0 && theirs >= ours) addObjectiveKills(foes, sp.polys, theirs - ours + 1, W(p).planFlip * value, plan);
  }
}

/** The enemy models on an objective to kill to take `ocToTake` off it (worth `worth` points of damage): the units
 *  with the most OC per point first. */
function addObjectiveKills(foes: UnitState[], polys: Pt[][], ocToTake: number, worth: number, plan: TurnPlan) {
  const on = foes.filter((e) => oc(e) > 0 && alive(e).some((m) => gapToObjective(m, polys) <= 0))
    .sort((a, b) => oc(b) / Math.max(1, unitValue(b)) - oc(a) / Math.max(1, unitValue(a)));
  let left = ocToTake;
  for (const e of on) {
    if (left <= 0) break;
    const inside = alive(e).filter((m) => gapToObjective(m, polys) <= 0);
    const per = Math.max(1, oc(e) / alive(e).length);
    const n = Math.min(inside.length, Math.ceil(left / per));
    left -= n * per;
    const k = plan.kills.get(e.id);
    plan.kills.set(e.id, { models: Math.max(n, k?.models ?? 0), bonus: (k?.bonus ?? 0) + worth, why: 'objective' });
  }
}

/**
 * Charges: each fighter that can still charge goes for its best target, one fighter per target one can deal with;
 * the enemy units standing between a fighter and its target are screens, shot first.
 */
function planCharges(s: GameState, p: PlayerId, mine: UnitState[], foes: UnitState[], engaged: (u: UnitState) => boolean, plan: TurnPlan) {
  if (botOff('tpCharge')) return;
  const near = (u: UnitState) => foes.some((e) => dist(centre(u), centre(e)) <= 24);
  const fighters = mine.filter((u) => !engaged(u) && near(u) && isBrawler(s, u) && !chargeEligibility(s, u)).sort((a, b) => unitValue(b) - unitValue(a));
  // what a charge into e is worth: the points it kills (no more than are there), less what it takes back, plus the guns
  // it ties up
  const worth = (u: UnitState, e: UnitState) => Math.min(alive(e).length, meleeKills(u, e)) * perModel(e) - Math.min(alive(u).length, meleeKills(e, u)) * perModel(u) * 0.5 + lockValue(s, e);
  const dealt = new Map<string, number>(); // target id -> models the planned chargers are expected to kill
  for (const u of fighters) {
    let best: { e: UnitState; v: number; d: number } | null = null;
    for (const e of foes) {
      const d = unitDistance(u, e);
      if (d > 12) continue;
      if ((dealt.get(e.id) ?? 0) >= alive(e).length * 1.2) continue; // already dealt with by another charger
      const v = worth(u, e) * p2d6(d);
      if (v > 0 && (!best || v > best.v)) best = { e, v, d };
    }
    if (!best) continue;
    const target = best.e;
    plan.charges.set(u.id, target.id);
    dealt.set(target.id, (dealt.get(target.id) ?? 0) + meleeKills(u, target));
    if (s.phase !== 'shooting') continue;
    // the screen: enemy units nearer than the target, standing across the way from our closest model to it
    const tc = centre(target);
    const from = alive(u).reduce((a, m) => (dist(m, tc) < dist(a, tc) ? m : a));
    const to = alive(target).reduce((a, m) => (dist(m, from) < dist(a, from) ? m : a));
    for (const f of foes) {
      if (f.id === target.id || unitDistance(u, f) >= best.d) continue;
      if (!alive(f).some((m) => pointSegDist(m, { a: from, b: to }) <= m.r + 2)) continue;
      const k = plan.kills.get(f.id);
      plan.kills.set(f.id, { models: Math.max(alive(f).length, k?.models ?? 0), bonus: (k?.bonus ?? 0) + W(p).planScreen * best.v + perModel(f), why: k?.why ?? 'screen' });
    }
  }
}
