// The bot's use of the rules that are a decision rather than a straight buff: which unit gets which combat doctrine,
// command-phase stratagems (+OC, securing objectives, buffs that last the turn), moves offered by reactions and after
// shooting, and pulling a threatened unit back into Strategic Reserves.
import { manualActs, useActByKey } from './activations';
import { ctxFor, bestMove, scoreSpot } from './botMove';
import { isBrawler, maxRange, moveOf, onObjective, unitValue } from './botEval';
import { unitDoctrines } from './effects';
import { commitMove, levelOfControl, validateMove } from './game';
import { alive, boardUnits, isEngaged, other, unitDistance } from './state';
import { applyDetachmentStratagem, stratagemBlock, stratRule, stratChoices } from './stratagems';
import type { GameState, PlayerId, StratagemData, UnitState } from './types';
import { stratCost } from './state';

type Doctrine = 'assault' | 'devastator' | 'tactical';

/** The combat doctrine that does something for this unit this turn, if it doesn't have it already. */
export function doctrineFor(s: GameState, u: UnitState): Doctrine | null {
  const has = unitDoctrines(s, u);
  const foes = boardUnits(s, other(u.owner));
  const near = foes.length ? Math.min(...foes.map((e) => unitDistance(u, e))) : 99;
  let want: Doctrine | null = null;
  if (isEngaged(s, u)) want = isBrawler(s, u) ? null : 'tactical'; // fall back and still shoot / charge
  else if (isBrawler(s, u) && near <= moveOf(u) + 12) want = 'assault'; // Advance and still charge
  else if (maxRange(u) > 0 && near > maxRange(u)) want = 'devastator'; // Advance into range and still shoot
  return want && !has.has(want) ? want : null;
}

const docOf = (label?: string): Doctrine | null => (/^Assault/.test(label ?? '') ? 'assault' : /^Devastator/.test(label ?? '') ? 'devastator' : /^Tactical/.test(label ?? '') ? 'tactical' : null);

/** Abilities that make a doctrine active for a unit (Strategic Acumen, Author of the Codex, Master Tactician …). */
export function botDoctrineActs(s: GameState, p: PlayerId) {
  const used = new Set<string>();
  for (const m of manualActs(s, p)) {
    const d = docOf(m.def.spec.label);
    if (!d || m.why || used.has(`${m.def.holder.id}|${m.def.name}`)) continue;
    const side = m.def.spec.target?.side;
    if (!side || side === 'self') {
      if (doctrineFor(s, m.def.holder) !== d) continue;
      if (!useActByKey(s, m.def.holder.id, m.def.key)) used.add(`${m.def.holder.id}|${m.def.name}`);
      continue;
    }
    // a friendly unit: the most valuable one that wants exactly this doctrine
    const t = m.targets.filter((x) => doctrineFor(s, x) === d).sort((a, b) => unitValue(b) - unitValue(a))[0];
    if (t && !useActByKey(s, m.def.holder.id, m.def.key, t.id)) used.add(`${m.def.holder.id}|${m.def.name}`);
  }
}

const spare = (s: GameState, p: PlayerId, cost: number) => s.players[p].cp >= cost + 1;
const strats = (s: GameState, p: PlayerId) => s.players[p].detachments.flatMap((d) => d.stratagems.map((st) => ({ st, rule: stratRule(st, s.players[p].factionId, d.name) })));

/** Command phase: doctrine stratagems, +OC on a contested objective, and buffs that last the turn for a unit in the fight. */
export function botCommandStratagems(s: GameState, p: PlayerId) {
  const mine = boardUnits(s, p);
  const foes = boardUnits(s, other(p));
  for (const { st, rule } of strats(s, p)) {
    if (rule.react || rule.status === 'manual') continue;
    const cost = (u: UnitState) => stratCost(s, st.id, u, st.cp);
    const ok = (u: UnitState) => !stratagemBlock(s, p, st, u) && spare(s, p, cost(u));
    // "select one combat doctrine; that combat doctrine is active for your unit"
    const docOpts = (rule.choice ?? []).map((o, i) => ({ i, d: /^doctrine:(\w+)/.exec(o.mark ?? '')?.[1] as Doctrine | undefined })).filter((x) => x.d);
    if (docOpts.length) {
      const best = mine.filter((u) => unitValue(u) >= 150 && ok(u)).map((u) => ({ u, d: doctrineFor(s, u) })).filter((x) => x.d && docOpts.some((o) => o.d === x.d))
        .sort((a, b) => unitValue(b.u) - unitValue(a.u))[0];
      if (best) applyDetachmentStratagem(s, p, st, best.u.id, { choice: docOpts.find((o) => o.d === best.d)!.i });
      continue;
    }
    const fx = rule.effects ?? [];
    // +1 OC: on an objective the enemy holds by that much or less
    const oc = fx.reduce((a, e) => a + (e.oc ?? 0), 0);
    if (oc > 0 && fx.every((e) => !e.hit && !e.toughness)) {
      for (const u of mine) {
        const o = s.objectives.find((x) => onObjective(s, u, x));
        if (!o || !ok(u)) continue;
        const [a, b] = levelOfControl(s, o);
        const ours = p === 0 ? a : b, theirs = p === 0 ? b : a;
        if (theirs > 0 && theirs >= ours && theirs - ours < oc) { applyDetachmentStratagem(s, p, st, u.id); break; }
      }
      continue;
    }
    // a buff till the next Command phase (Ancient Fury …): the most expensive unit that will fight this turn
    if (rule.until === 'nextCommand' && fx.some((e) => e.hit || e.toughness || e.ignoreMods)) {
      const u = mine.filter((x) => ok(x) && foes.some((e) => unitDistance(x, e) <= 18)).sort((a, b) => unitValue(b) - unitValue(a))[0];
      if (u && unitValue(u) >= 150) applyDetachmentStratagem(s, p, st, u.id);
    }
  }
}

/** End of the Movement phase: secure an objective that is ours but in reach of the enemy (Stand Unyielding …). */
export function botEndOfMovement(s: GameState, p: PlayerId) {
  for (const { st, rule } of strats(s, p)) {
    if (rule.react || !(rule.do ?? []).some((a) => a.secure)) continue;
    for (const u of boardUnits(s, p)) {
      const o = s.objectives.find((x) => onObjective(s, u, x) && x.controller === p && x.secured !== p && x.type !== 'home');
      if (!o || stratagemBlock(s, p, st, u) || !spare(s, p, stratCost(s, st.id, u, st.cp))) continue;
      if (!boardUnits(s, other(p)).some((e) => unitDistance(u, e) <= 18)) continue;
      applyDetachmentStratagem(s, p, st, u.id);
      break;
    }
  }
}

/** How much better off the unit is after the best move of up to `max"` (positive: worth making). */
export function moveGain(s: GameState, u: UnitState, max: number): number {
  const ctx = ctxFor(s, u);
  const stay = scoreSpot(s, u, 'stationary', null, ctx);
  const had = u.extraMove;
  u.extraMove ??= { max, label: '', kind: 'extra' }; // the planner measures an extra move by it
  try {
    const plan = bestMove(s, u, 'extra', max, ctx, { noStay: true });
    return plan.paths ? plan.score - stay : 0;
  } finally { u.extraMove = had; }
}

/** Make the extra move a reaction gave the unit (the bot side of the "move now" prompt). */
export function botExtraMove(s: GameState, u: UnitState): boolean {
  const em = u.extraMove;
  if (!em || em.kind === 'surge') return false;
  const plan = bestMove(s, u, 'extra', em.max - 0.05, ctxFor(s, u), { noStay: true });
  if (!plan.paths || !validateMove(s, u, 'extra', plan.paths).ok) return false;
  commitMove(s, u, 'extra', plan.paths);
  return true;
}

/** Is a reaction that moves the unit (or takes it off the board) worth its CP? */
export function reactWorth(s: GameState, u: UnitState, st: StratagemData, kind: 'move' | 'surge' | 'reserves'): boolean {
  if (!spare(s, u.owner, st.cp)) return false;
  if (kind === 'surge') return isBrawler(s, u) && !isEngaged(s, u);
  if (kind === 'reserves') {
    // a unit about to be swarmed, not holding anything, can come back where it's needed
    if (s.objectives.some((o) => onObjective(s, u, o)) || s.round >= 4) return false;
    const threats = boardUnits(s, other(u.owner)).filter((e) => unitDistance(u, e) <= 9).length;
    return threats >= 2 || alive(u).length * 2 <= u.startingStrength;
  }
  return !isBrawler(s, u) && moveGain(s, u, 4) > unitValue(u) * 0.05;
}

/** The choice index a stratagem with options should take for this unit (first usable). */
export const firstChoice = (s: GameState, rule: ReturnType<typeof stratRule>, u: UnitState) => stratChoices(s, rule, u)[0]?.i;

/** "After this unit has shot, it can make a Normal move" (Tactical Fluidity, Purgation Run …): move on when it pays. */
export function botAfterShootMove(s: GameState, u: UnitState) {
  for (const m of manualActs(s, u.owner)) {
    if (m.why || m.def.holder.id !== u.id || m.def.spec.when !== 'afterShootingButton') continue;
    const mv = m.def.spec.do?.find((a) => a.move);
    if (!mv) continue;
    // a unit that wants to charge keeps its charge
    if (mv.noCharge && isBrawler(s, u) && boardUnits(s, other(u.owner)).some((e) => unitDistance(u, e) <= 12)) continue;
    const max = Number(/(\d+)$/.exec(mv.move!)?.[1] ?? 6);
    if (moveGain(s, u, mv.move!.startsWith('D') ? max / 2 + 0.5 : max) <= unitValue(u) * 0.03) continue;
    if (useActByKey(s, u.id, m.def.key)) continue;
    if (!botExtraMove(s, u)) u.extraMove = undefined;
    if (s.window?.kind === 'abilityMove') s.window.offers = s.window.offers.filter((o) => o.unitId !== u.id);
    if (s.window?.kind === 'abilityMove' && !s.window.offers.length) s.window = null;
    return;
  }
}

/** A unit about to Advance: "Advance 6" instead of rolling" (Sudden Onslaught …) for a unit that has to get there. */
export function botAdvanceStratagem(s: GameState, u: UnitState) {
  if (unitValue(u) < 120) return;
  for (const { st, rule } of strats(s, u.owner)) {
    if (rule.react || !(rule.effects ?? []).some((e) => e.advanceFixed)) continue;
    if (stratagemBlock(s, u.owner, st, u) || !spare(s, u.owner, stratCost(s, st.id, u, st.cp))) continue;
    applyDetachmentStratagem(s, u.owner, st, u.id);
    return;
  }
}

/** A unit about to be wiped out in melee: "if it is destroyed, it can fight on" (A Worthy Death, Duty in Death …). */
export function botFightOnDeath(s: GameState, T: UnitState, lossShare: number) {
  if (lossShare < 0.7 || unitValue(T) < 100 || !isBrawler(s, T)) return;
  for (const { st, rule } of strats(s, T.owner)) {
    if (rule.react || !(rule.effects ?? []).some((e) => e.fightOnDeath)) continue;
    if (stratagemBlock(s, T.owner, st, T) || !spare(s, T.owner, stratCost(s, st.id, T, st.cp))) continue;
    applyDetachmentStratagem(s, T.owner, st, T.id);
    return;
  }
}
