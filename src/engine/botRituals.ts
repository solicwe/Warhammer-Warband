// The bot (and a player on automatic rules) attempts Rituals at the start of its Shooting phase: for every sorcerer it
// weighs each Ritual still open — mortal wounds now, better shooting at a unit many of its guns can reach, a move —
// against the chance of manifesting it and the mortal wounds a double would cost, and decides whether to Channel the Warp.
import { maxRange, unitValue } from './botEval';
import { moveGain } from './botPlus';
import { withRuleCache } from './effects';
import { alive, boardUnits, engagedEnemies, unitDistance } from './state';
import { attemptRitual, casters, endRituals, ritualsLeft, ritualsPending, ritualTargets, testOdds, type Caster, type Ritual } from './rituals';
import type { GameState, PlayerId, UnitState } from './types';

const woundsLeft = (u: UnitState) => alive(u).reduce((a, m) => a + m.wounds, 0);
const ptsPerWound = (u: UnitState) => unitValue(u) / Math.max(1, woundsLeft(u));

/** How much of the army's shooting can reach this enemy unit this phase (points of shooters in range). */
function firepowerOn(s: GameState, p: PlayerId, t: UnitState) {
  return boardUnits(s, p)
    .filter((u) => u.factionKeywords.some((k) => k === 'THOUSAND SONS' || k === 'SCINTILLATING LEGIONS') && !engagedEnemies(s, u).length)
    .filter((u) => unitDistance(u, t) <= maxRange(u) + 0.5)
    .reduce((a, u) => a + unitValue(u), 0);
}

/** Value of a manifested Ritual on a target, at an average result (good results add their bonus with some chance).
 *  `memo` keeps the costly parts (firepower in range, how much a move helps) per target for one planning pass. */
function ritualValue(s: GameState, c: Caster, r: Ritual, t: UnitState, strongChance: number, memo: Map<string, number>): number {
  const p = c.unit.owner;
  const get = (k: string, f: () => number) => { let v = memo.get(k); if (v === undefined) { v = f(); memo.set(k, v); } return v; };
  if (r.id === 'doombolt') {
    const mw = 2 + 3 * strongChance;
    return Math.min(mw, woundsLeft(t)) * ptsPerWound(t) * 1.1;
  }
  if (r.id === 'temporal-surge') {
    if (engagedEnemies(s, t).length) return 0;
    // one planner run at a typical distance (D6", 6" on a strong result)
    const g = get(`mv|${t.id}`, () => withRuleCache(() => moveGain(s, t, 4)));
    return g * (1 + strongChance * 0.4) * 0.6;
  }
  const fire = get(`fire|${t.id}`, () => Math.min(firepowerOn(s, p, t), unitValue(t) * 3));
  if (r.id === 'twist-of-fate') return 0.09 * fire * (1 + strongChance);
  if (r.id === 'destinys-ruin') return 0.04 * fire * (1 + strongChance * 2);
  return 0;
}

const STRONG: Record<string, number> = { 'destinys-ruin': 10, 'temporal-surge': 10, doombolt: 11, 'twist-of-fate': 12 };

interface Plan { c: Caster; r: Ritual; t: UnitState; channel: boolean; ev: number }

function bestPlan(s: GameState, p: PlayerId, memo: Map<string, number>): Plan | null {
  let best: Plan | null = null;
  for (const c of casters(s, p)) {
    const lossPerMW = ptsPerWound(c.unit) * (alive(c.unit).length === 1 ? 1.4 : 1);
    for (const r of ritualsLeft(s, p, c)) {
      const targets = ritualTargets(s, c, r);
      if (!targets.length) continue;
      for (const channel of [false, true]) {
        const odds = testOdds(channel ? 3 : 2, c.bonus, r.wc);
        const strong = testOdds(channel ? 3 : 2, c.bonus, STRONG[r.id]).pass / Math.max(0.01, odds.pass);
        let bestT: UnitState | null = null, bestV = 0;
        for (const t of targets) {
          const v = ritualValue(s, c, r, t, Math.min(1, strong), memo);
          if (v > bestV) { bestV = v; bestT = t; }
        }
        if (!bestT) continue;
        const ev = odds.pass * bestV - odds.perils * 2 * lossPerMW;
        if (ev > 1 && (!best || ev > best.ev)) best = { c, r, t: bestT, channel, ev };
      }
    }
  }
  return best;
}

/** Attempt every Ritual worth it, one after another (each result changes what is worth doing next). */
export function botRituals(s: GameState, p: PlayerId) {
  const memo = new Map<string, number>();
  for (let i = 0; i < 6 && ritualsPending(s, p); i++) {
    const plan = bestPlan(s, p, memo);
    if (!plan) break;
    // Arcane Focus re-rolls a failing test that Channelled the Warp, when a CP can be spared for a Ritual that matters
    const arcane = plan.channel && plan.ev > 12 && s.players[p].cp >= 2;
    const res = attemptRitual(s, p, plan.c.model.id, plan.r.id, plan.t.id, {
      channel: plan.channel, arcaneFocus: arcane, syphon: plan.channel, dagger: plan.r.wc - plan.c.bonus >= 8,
    });
    if (res.error) break;
  }
  endRituals(s, p);
}

export { ritualsPending };
