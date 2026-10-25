// The army's plan: a tournament player doesn't let every unit decide on its own. At the start of each phase the bot
// gives each unit a job for the army as a whole (who holds home, who takes the middle, who hunts, who screens, who
// stays back and shoots) and picks how to play the battle round by round: careful while it leads, risky while it
// trails, everything onto the objectives in the last turn. botMove.ctxFor reads the job; the movement scoring does
// the rest.
import { dist } from '../engine/geometry';
import { alive, boardUnits, hasKw, isEngaged, lastRound, other, pace, zombieRush } from '../engine/state';
import { centre, isBrawler, maxRange, moveOf, objPoint, oc, unitPunch, unitValue } from './botEval';
import { hasAbility } from '../engine/weapons';
import { botOff } from './botWeights';
import { primaryById } from '../engine/config';
import type { GameState, PlayerId, Pt, UnitState } from '../engine/types';

/**
 *  - home: holds our home objective (the cheapest unit that can, ideally one that shoots well from there)
 *  - anchor: takes a field objective and holds it, shooting from it
 *  - hammer: the army's damage — the middle early, then the enemy units worth the most
 *  - screen: cheap fighters: close in out of sight, to a charge's reach of the enemy, and charge whatever comes near
 *  - firebase: long guns that stay back in cover and shoot
 *  - support: characters on their own and others whose job is a friendly unit (botMove's escort)
 *  - taxi: a transport with units inside
 */
export type Role = 'home' | 'anchor' | 'hammer' | 'screen' | 'firebase' | 'support' | 'taxi';

export interface Job {
  role: Role; post?: Pt; why: string;
  /** a cheap squad kept on the home objective all game (Gretchin, Cultists): movement follows it */
  keep?: boolean;
}

/** open: first round · push: we are stronger or behind · hold: we lead or are weaker · all-in: the last turn */
export type Stance = 'open' | 'push' | 'hold' | 'all-in';

export interface ArmyPlan { stance: Stance; risk: number; jobs: Map<string, Job> }

export { unitPunch };

/** Is this the last turn of the battle for p (round 5, and p is the second player or the first player's turn)? */
export const lastTurn = (s: GameState, p: PlayerId) => s.round >= lastRound(s) && (p !== s.firstPlayer || s.active === p);

const vpOf = (s: GameState, p: PlayerId) => s.players[p].vp + s.players[p].secVp;
const armyValue = (s: GameState, p: PlayerId) => boardUnits(s, p).reduce((a, u) => a + unitValue(u), 0)
  + s.units.filter((u) => u.owner === p && (u.status === 'reserves' || u.status === 'embarked')).reduce((a, u) => a + unitValue(u), 0);

/**
 * Does holding our own home objective score any VP in this battle right now?
 * Returns false when the primary mission specifically excludes home (e.g. perObjectiveControlledExclHome)
 * and no active secondary cards require holding home (defend-stronghold).
 */
export function homeScoresVp(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (!P) return true;
  // Check active secondaries
  const secondaries = P.secActive ?? [];
  if (secondaries.some((c) => c === 'defend-stronghold' || c === 'controlOwnHome')) return true;

  // Check primary scoring rules
  const prim = P.primaryId ? primaryById(P.primaryId) : undefined;
  const rules = prim?.scoring ?? [];
  if (!rules.length) return true;

  let anyExcl = false;
  for (const r of rules) {
    const cond = r.condition;
    // Conditions where own home gives VP or is needed
    if (cond === 'perObjectiveControlled' || cond === 'controlMoreThanOpponent' ||
        cond === 'control2Plus' || cond === 'control3Plus' || cond === 'control4Plus' ||
        cond === 'perNonHomeIfHomeControlled' || cond === 'onlyOneOwnMarkerHeld') {
      return true;
    }
    if (cond === 'perObjectiveControlledExclHome' || cond === 'controlAnyExclHome' || cond === 'controlAnyExclHomes') {
      anyExcl = true;
    }
  }

  // If mission only has excluding-home conditions and no rules that reward home
  if (anyExcl) return false;
  return true;
}

/** How to play this battle round, and how much to fear losses (a factor on the movement scoring's caution). */
export function stanceFor(s: GameState, p: PlayerId): { stance: Stance; risk: number } {
  // Zombie Rush: Enemy bot plays 100% fearless attack mode
  if (zombieRush(s, p)) return { stance: 'push', risk: 0 };
  if (s.isBossAnnihilation) return { stance: 'push', risk: 0.2 };
  if (lastTurn(s, p) && !botOff('allin')) return { stance: 'all-in', risk: 0.3 };
  // an aggressive army at every level: it goes forward from the first turn and keeps pressing (the home objective
  // keeps its one guard, the missions their objectives); only a big late lead makes it a little more careful
  if (s.round <= 1) return { stance: 'open', risk: 0.7 };
  const lead = vpOf(s, p) - vpOf(s, other(p));
  const strength = armyValue(s, p) / Math.max(1, armyValue(s, other(p)));
  const late = pace(s) >= 3;
  if (late && lead >= 15) return { stance: 'push', risk: 0.9 };
  if (late && lead <= -12) return { stance: 'push', risk: 0.5 };
  if (strength >= 1.35) return { stance: 'push', risk: 0.55 };
  if (strength <= 0.7) return { stance: 'push', risk: 0.8 };
  return { stance: 'push', risk: 0.65 };
}

/**
 * The job a unit's movement follows. Measured on the Elo ladder (scripts/elo.mjs, 96 games each against the last
 * bot): fixed posts for the whole army played clearly worse than each unit weighing its own spot (-62 Elo against
 * +42), so movement follows only the jobs that hold up — cheap fighters screening, a cheap squad kept on the home
 * objective, and the last turn's rush onto the objectives. The rest of the plan is the bot's reading of the battle
 * (who would hold home, who hunts).
 */
export function followedJob(plan: ArmyPlan, unitId: string): Job | undefined {
  const j = plan.jobs.get(unitId);
  if (!j || botOff('jobs')) return undefined;
  if (botOff('lean') || plan.stance === 'all-in' || j.role === 'screen' || (j.keep && !botOff('keep'))) return j;
  return undefined;
}

const cache = new WeakMap<GameState, Map<PlayerId, { key: string; plan: ArmyPlan }>>();

export function armyPlan(s: GameState, p: PlayerId): ArmyPlan {
  if (botOff('plan')) return { stance: 'open', risk: 1, jobs: new Map() };
  const mine = boardUnits(s, p).filter((u) => !hasKw(u, 'AIRCRAFT'));
  const key = `${s.turn}|${s.phase}|${mine.map((u) => `${u.id}:${alive(u).length}`).join(',')}`;
  let per = cache.get(s);
  if (!per) { per = new Map(); cache.set(s, per); }
  const hit = per.get(p);
  if (hit && hit.key === key) return hit.plan;
  const plan = makePlan(s, p, mine);
  per.set(p, { key, plan });
  return plan;
}

function makePlan(s: GameState, p: PlayerId, mine: UnitState[]): ArmyPlan {
  const { stance, risk: r0 } = stanceFor(s, p);
  const risk = botOff('risk') ? 1 : r0;
  const jobs = new Map<string, Job>();
  const foes = boardUnits(s, other(p)).filter((e) => !hasKw(e, 'AIRCRAFT'));
  if (!foes.length) return { stance, risk, jobs };

  if (zombieRush(s, p) || s.isBossAnnihilation) {
    for (const u of mine) {
      jobs.set(u.id, { role: 'hammer', why: 'Zombie Rush: seek and destroy player units' });
    }
    return { stance, risk, jobs };
  }
  const info = new Map(mine.map((u) => {
    const value = unitValue(u);
    const punch = unitPunch(s, u);
    return [u.id, { u, value, punch, brawler: isBrawler(s, u), range: maxRange(u), M: moveOf(u), oc: oc(u), solo: alive(u).every((m) => m.isCharacter) }];
  }));
  const free = (u: UnitState) => !jobs.has(u.id);
  for (const u of mine) {
    if (u.transport && s.units.some((x) => x.embarkedIn === u.id && x.status === 'embarked')) jobs.set(u.id, { role: 'taxi', why: 'carries a unit' });
    // a character on its own works for the units round it; a big one (a Daemon Prince, a Warboss on a bike) fights
    else if (info.get(u.id)!.solo && u.sources.length <= 1 && !isEngaged(s, u) && info.get(u.id)!.value < 150 && !hasKw(u, 'MONSTER') && !hasKw(u, 'VEHICLE')) jobs.set(u.id, { role: 'support', why: 'a character on its own' });
  }

  // the last turn: every unit that counts on an objective goes for the nearest one we don't hold for good
  if (stance === 'all-in') {
    const want = s.objectives.filter((o) => o.secured !== p).map((o) => objPoint(s, o));
    for (const u of mine.filter(free)) {
      const i = info.get(u.id)!;
      if (!i.oc || isEngaged(s, u) || !want.length) { jobs.set(u.id, { role: i.brawler ? 'hammer' : 'anchor', why: 'last turn: fight' }); continue; }
      const c = centre(u);
      const post = want.reduce((a, q) => (dist(q, c) < dist(a, c) ? q : a));
      jobs.set(u.id, { role: 'anchor', post: dist(post, c) <= 2 * i.M + 8 ? post : undefined, why: 'last turn: onto an objective' });
    }
    return { stance, risk, jobs };
  }

  // long guns stay back
  for (const u of mine.filter(free)) {
    const i = info.get(u.id)!;
    const heavy = alive(u).some((m) => m.weapons.some((w) => w.profiles.some((pr) => hasAbility(pr, 'heavy'))));
    if (!i.brawler && i.range >= 30 && (i.M <= 6 || heavy) && i.value < 260) jobs.set(u.id, { role: 'firebase', why: `${i.range}" guns` });
  }
  // home: the unit that loses the least by standing still there — cheap, scores OC, shoots well enough from it
  const home = homeScoresVp(s, p) ? s.objectives.find((o) => o.type === 'home' && o.owner === p) : undefined;
  if (home) {
    const hp = objPoint(s, home);
    const cands = mine.filter((u) => (free(u) || jobs.get(u.id)!.role === 'firebase') && info.get(u.id)!.oc > 0 && !isEngaged(s, u))
      .map((u) => {
        const i = info.get(u.id)!;
        const far = Math.max(0, dist(centre(u), hp) - 3);
        // a melee unit sitting at home wastes its points; a long gun there loses nothing
        const waste = i.brawler ? i.value * 1.6 : jobs.get(u.id)?.role === 'firebase' ? i.value * 0.35 : i.value;
        return { u, cost: waste + far * 4 + (i.oc < 2 ? 40 : 0) };
      }).sort((a, b) => a.cost - b.cost);
    // never the army's hammer: 200 points of Dreadnought guarding home is a wasted unit (better nobody, until a cheap one comes)
    const c0 = cands[0] && info.get(cands[0].u.id)!;
    if (c0 && (jobs.get(c0.u.id)?.role === 'firebase' || (c0.value <= 160 && !(c0.brawler && c0.value > 120)))) {
      // a squad this cheap loses nothing by sitting at home all game (the way a player parks Gretchin there); one
      // already out in the field is doing a job there, so it is not called back
      const keep = !c0.brawler && c0.value <= 80 && dist(centre(c0.u), hp) <= c0.M + 3;
      jobs.set(c0.u.id, { role: 'home', post: hp, why: keep ? 'kept on home all game' : 'holds home', keep });
    }
  }

  // hammers: the units that do the most damage, and every expensive one
  const rest = mine.filter(free).map((u) => info.get(u.id)!).sort((a, b) => b.punch - a.punch);
  const topPunch = rest[0]?.punch ?? 0;
  for (const i of rest) {
    if (i.value >= 170 || (i.punch >= topPunch * 0.5 && i.value >= 90)) jobs.set(i.u.id, { role: 'hammer', why: `${Math.round(i.punch)} pts of damage a turn` });
  }

  // anchors: the field objectives, nearest unit first; cheap brawlers screen instead of standing in the open
  const field = s.objectives.filter((o) => !(o.type === 'home' && o.owner === p)).map((o) => ({ o, at: objPoint(s, o) }))
    .filter(({ o }) => !(o.type === 'home'))
    .sort((a, b) => Math.min(...mine.map((u) => dist(centre(u), a.at))) - Math.min(...mine.map((u) => dist(centre(u), b.at))));
  for (const f of field) {
    const c = mine.filter(free).map((u) => info.get(u.id)!).filter((i) => i.oc > 0 && !(i.brawler && i.value <= 120))
      .map((i) => ({ i, d: dist(centre(i.u), f.at) / Math.max(4, i.M) })).sort((a, b) => a.d - b.d)[0];
    if (c && c.d <= 4) jobs.set(c.i.u.id, { role: 'anchor', post: f.at, why: `takes objective ${s.objectives.indexOf(f.o) + 1}` });
  }

  // what's left: cheap fighters close in out of sight and charge what comes near; cheap shooters take what needs bodies
  for (const u of mine.filter(free)) {
    const i = info.get(u.id)!;
    jobs.set(u.id, i.brawler ? { role: 'screen', why: 'cheap fighters: wait in cover, then charge' } : { role: 'anchor', why: 'takes whatever needs bodies' });
  }
  return { stance, risk, jobs };
}
