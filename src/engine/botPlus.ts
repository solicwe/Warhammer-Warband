// The bot's use of the rules that are a decision rather than a straight buff: which unit gets which combat doctrine,
// command-phase stratagems (+OC, securing objectives, buffs that last the turn), moves offered by reactions and after
// shooting, and pulling a threatened unit back into Strategic Reserves.
import { manualActs, useActByKey } from './activations';
import { bestArrival, ctxFor, bestMove, planMove, scoreSpot } from './botMove';
import { cpWorth, tryRule } from './botStrats';
import { dist } from './geometry';
import { unitVisibleTo } from './visibility';
import { centre, isBrawler, maxRange, moveOf, objPoint, onObjective, unitValue } from './botEval';
import { rollMods, targetHasCover, unitDoctrines, unitFlags } from './effects';
import { chargeEligibility, commitMove, consolidateMode, levelOfControl, setPhaseEndHook, validateMove } from './game';
import { alive, boardUnits, engagedEnemies, isEngaged, onBoard as onBoardUnit, other, unitDistance } from './state';
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
    // "that objective marker remains under your control" in the Command phase (Warding Hex, Desecration of Worlds …)
    if ((rule.do ?? []).some((a) => a.secure || a.mutate)) {
      for (const u of mine) {
        const o = s.objectives.find((x) => onObjective(s, u, x) && x.controller === p && x.secured !== p && x.type !== 'home');
        if (!o || !ok(u) || !foes.some((e) => unitDistance(u, e) <= 18)) continue;
        applyDetachmentStratagem(s, p, st, u.id);
        break;
      }
      continue;
    }
    // "return destroyed models" (Blessed Transmutations): the unit that lost the most
    if ((rule.do ?? []).some((a) => a.reviveRoll || a.revive)) {
      const u = mine.filter((x) => ok(x) && x.startingStrength - alive(x).length >= 2).sort((a, b) => (b.startingStrength - alive(b).length) - (a.startingStrength - alive(a).length))[0];
      if (u) applyDetachmentStratagem(s, p, st, u.id);
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
    if (rule.react || !(rule.do ?? []).some((a) => a.secure || a.snare)) continue;
    for (const u of boardUnits(s, p)) {
      const snare = (rule.do ?? []).some((a) => a.snare);
      const o = s.objectives.find((x) => onObjective(s, u, x) && x.controller === p && (snare ? x.snared !== p : x.secured !== p && x.type !== 'home'));
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
export function reactWorth(s: GameState, u: UnitState, st: StratagemData, kind: 'move' | 'surge' | 'reserves' | 'embark'): boolean {
  if (!spare(s, u.owner, st.cp)) return false;
  if (kind === 'embark') return redeployWorth(s, u);
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
  // it stays put: "those attacks do not prevent it from being hidden" (Shadow Masters …) costs nothing
  for (const m of manualActs(s, u.owner)) {
    if (m.why || m.def.holder.id !== u.id || m.def.spec.when !== 'afterShootingButton' || !m.def.spec.do?.some((a) => a.unshot)) continue;
    useActByKey(s, u.id, m.def.key);
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

/** Before its consolidation: an engaged unit that may still consolidate onto an objective (Establish Supremacy) does,
 *  when that objective isn't ours yet. */
export function botConsolidateStratagem(s: GameState, u: UnitState) {
  if (!isEngaged(s, u)) return;
  for (const { st, rule } of strats(s, u.owner)) {
    if (rule.react || !(rule.effects ?? []).some((e) => e.objConsolidate)) continue;
    if (stratagemBlock(s, u.owner, st, u) || !spare(s, u.owner, stratCost(s, st.id, u, st.cp))) continue;
    const o = s.objectives.find((x) => x.controller !== u.owner && alive(u).some((m) => Math.hypot(m.x - x.x, m.y - x.y) <= 3 + 3 + m.r));
    if (!o) continue;
    applyDetachmentStratagem(s, u.owner, st, u.id);
    return;
  }
}

// ---------- the rest of the rules the bot plays by itself ----------

const ready = (s: GameState, p: PlayerId, st: StratagemData, u: UnitState, keep = 1) => !stratagemBlock(s, p, st, u) && s.players[p].cp >= stratCost(s, st.id, u, st.cp) + keep;
const fxOf = (r: ReturnType<typeof stratRule>) => r.effects ?? [];
const dosOf = (r: ReturnType<typeof stratRule>) => r.do ?? [];

/** Command phase: "your unit has CHARACTER until your next Command phase" (Instant of Grace, Birth of a Saga) on the
 *  most valuable unit about to fight, while CP is plentiful. */
export function botCharacterStratagem(s: GameState, p: PlayerId) {
  for (const { st, rule } of strats(s, p)) {
    if (rule.react || !dosOf(rule).some((a) => a.characterModel)) continue;
    const foes = boardUnits(s, other(p));
    const u = boardUnits(s, p).filter((x) => !alive(x).every((m) => m.isCharacter) && ready(s, p, st, x, 2) && foes.some((e) => unitDistance(x, e) <= 18))
      .sort((a, b) => unitValue(b) - unitValue(a))[0];
    if (u && unitValue(u) >= 120) applyDetachmentStratagem(s, p, st, u.id);
  }
}

/** Start of the Fight phase: battle-shock rolls for every enemy unit engaged with ours (Adamantine Terror). */
export function botFightStartStratagems(s: GameState, p: PlayerId) {
  for (const { st, rule } of strats(s, p)) {
    if (rule.react || !rule.enemy?.all || !dosOf(rule).some((a) => a.shock !== undefined)) continue;
    const u = boardUnits(s, p).filter((x) => ready(s, p, st, x)).map((x) => ({ x, v: engagedEnemies(s, x).reduce((a, e) => a + unitValue(e), 0) }))
      .sort((a, b) => b.v - a.v)[0];
    if (u && u.v >= 100) applyDetachmentStratagem(s, p, st, u.x.id);
  }
}

/** Our pick in the Fight phase: a unit holding an objective that the enemy is about to hit fights first instead
 *  (Transhuman Swiftness). Returns the unit that must fight next, if the stratagem was used. */
export function botFightsFirstStratagem(s: GameState, p: PlayerId, cands: UnitState[]): UnitState | null {
  for (const { st, rule } of strats(s, p)) {
    if (rule.react || !fxOf(rule).some((e) => e.fightsFirst)) continue;
    const u = cands.filter((x) => ready(s, p, st, x) && engagedEnemies(s, x).some((e) => !e.fought))
      .sort((a, b) => unitValue(b) - unitValue(a))[0];
    if (!u) continue;
    applyDetachmentStratagem(s, p, st, u.id);
    return u;
  }
  return null;
}

/** A pile-in or consolidation that needs more than 3" (Tactical Focus, Devout Push: D3+3"). */
export function botPileStratagem(s: GameState, u: UnitState, step: 'pileIn' | 'consolidate') {
  const key = step === 'pileIn' ? 'pileInRoll' : 'consolidateRoll';
  const foes = boardUnits(s, other(u.owner));
  let need = 0;
  if (step === 'pileIn') need = Math.min(99, ...foes.map((e) => unitDistance(u, e)));
  else {
    const cm = consolidateMode(s, u);
    if (cm.mode === 'engaging') need = Math.min(99, ...cm.enemies.map((e) => unitDistance(u, e)));
    else if (cm.mode === 'objective' && cm.objective) need = Math.min(...alive(u).map((m) => dist(m, cm.objective!) - 3 - m.r));
  }
  if (need <= 2.9 || need > 6) return;
  for (const { st, rule } of strats(s, u.owner)) {
    if (rule.react || !dosOf(rule).some((a) => a[key])) continue;
    if (!ready(s, u.owner, st, u)) continue;
    applyDetachmentStratagem(s, u.owner, st, u.id);
    return;
  }
}

/** A vehicle or monster boxed in by ruin walls: MOBILE for the move when it reaches somewhere clearly better. */
export function botMobileStratagem(s: GameState, u: UnitState, M: number) {
  if (alive(u).every((m) => m.keywords.includes('INFANTRY'))) return;
  for (const { st, rule } of strats(s, u.owner)) {
    if (rule.react || !fxOf(rule).some((e) => e.mobile)) continue;
    if (!ready(s, u.owner, st, u)) continue;
    const base = planMove(s, u, M, ctxFor(s, u));
    const withIt = tryRule(s, u, st.name, rule, () => planMove(s, u, M, ctxFor(s, u)));
    const best = (x: typeof base) => Math.max(x.normal.score, x.advance?.score ?? -Infinity);
    if (best(withIt) - best(base) >= cpWorth(s, u.owner) * st.cp) applyDetachmentStratagem(s, u.owner, st, u.id);
    return;
  }
}

/** Advancing or falling back with guns that still want to shoot this turn (Mobile Lethality). */
export function botShootOnTheMove(s: GameState, u: UnitState) {
  if (!maxRange(u) || isBrawler(s, u)) return;
  if (!boardUnits(s, other(u.owner)).some((e) => unitDistance(u, e) <= maxRange(u) + moveOf(u))) return;
  for (const { st, rule } of strats(s, u.owner)) {
    if (rule.react || !fxOf(rule).some((e) => e.eligible?.includes('shootAfterFallBack') || e.abilities?.includes('assault'))) continue;
    if (!ready(s, u.owner, st, u)) continue;
    applyDetachmentStratagem(s, u.owner, st, u.id);
    return;
  }
}

/** "Advance 6" instead of rolling" from a psychic power (Veil of Time): when nothing else gave the unit a fixed Advance. */
export function botAdvanceActs(s: GameState, u: UnitState) {
  if (rollMods(s, u).advanceFixed) return;
  for (const m of manualActs(s, u.owner)) {
    if (m.why || m.def.holder.id !== u.id || !m.def.spec.do?.some((a) => a.buff?.some((e) => e.advanceFixed))) continue;
    useActByKey(s, u.id, m.def.key);
    return;
  }
}

/** Deep Strike that may land closer to the enemy (Relic Teleportarium): where it lands with it, if that is worth it. */
export function botArrivalStratagem(s: GameState, u: UnitState, how: 'ingress' | 'deepStrike'): boolean {
  if (how !== 'deepStrike') return false;
  for (const { st, rule } of strats(s, u.owner)) {
    if (!fxOf(rule).some((e) => e.deepStrikeRange) || stratagemBlock(s, u.owner, st, u) || s.players[u.owner].cp < st.cp + 1) continue;
    const pos = tryRule(s, u, st.name, rule, () => bestArrival(s, u, how));
    if (!pos) continue;
    const foes = boardUnits(s, other(u.owner)).flatMap(alive);
    const gap = Math.min(99, ...[...pos.values()].flatMap((p) => foes.map((e) => dist(p, e))));
    // only when it lands nearer than the usual 9" (a short-ranged or melee unit gets its shots / its fight)
    if (gap < 8.5 && (isBrawler(s, u) || maxRange(u) <= 18)) { applyDetachmentStratagem(s, u.owner, st, u.id); return true; }
  }
  return false;
}

/** Getting out where only "wholly within" fails (Aggressive Disembarkation): returns true if the stratagem was used. */
export function botLooseDisembark(s: GameState, u: UnitState, fits: () => boolean): boolean {
  for (const { st, rule } of strats(s, u.owner)) {
    if (!fxOf(rule).some((e) => e.looseDisembark) || stratagemBlock(s, u.owner, st, u) || s.players[u.owner].cp < st.cp + 1) continue;
    if (!tryRule(s, u, st.name, rule, fits)) continue;
    applyDetachmentStratagem(s, u.owner, st, u.id);
    return true;
  }
  return false;
}

/** Psychic and wargear choices when a unit is selected to shoot: more range when the enemy is just out of reach
 *  (Thunderous Force), [IGNORES COVER] on a target in cover (Soul Sight), a hidden target found (Special-issue Optics). */
export function botShootActs(s: GameState, u: UnitState) {
  const foes = boardUnits(s, other(u.owner));
  const R = maxRange(u);
  const inRange = foes.filter((e) => unitDistance(u, e) <= R);
  const seen = (e: UnitState) => alive(u).some((m) => unitVisibleTo(s, m, e));
  for (const m of manualActs(s, u.owner)) {
    if (m.why || m.def.spec.botUse !== 'never') continue;
    const dos = m.def.spec.do ?? [];
    if (m.def.holder.id === u.id && dos.some((a) => a.buff?.some((e) => e.rangeBonus))) {
      const bonus = Math.max(...dos.flatMap((a) => a.buff ?? []).map((e) => e.rangeBonus ?? 0));
      if (!inRange.length && foes.some((e) => unitDistance(u, e) <= R + bonus)) useActByKey(s, u.id, m.def.key);
      continue;
    }
    if (dos.some((a) => a.incoming?.noCover)) {
      const t = inRange.filter((e) => seen(e) && alive(u).some((mm) => targetHasCover(s, e, unitDistance(u, e)))).sort((a, b) => unitValue(b) - unitValue(a))[0];
      if (t && m.targets.some((x) => x.id === t.id)) useActByKey(s, m.def.holder.id, m.def.key, t.id);
      continue;
    }
    if (m.def.holder.id === u.id && dos.some((a) => a.buff?.some((e) => e.detection))) {
      // nothing visible to shoot, but a hidden unit in reach: find it instead of the other option
      const t = m.targets.find((e) => unitDistance(u, e) <= R && !seen(e));
      if (!inRange.some(seen) && t) useActByKey(s, u.id, m.def.key, t.id);
    }
  }
}

/** "Select one of the following" when selected to fight (Angelic Executioner): [LETHAL HITS] against tough targets,
 *  [SUSTAINED HITS 1] against ones it wounds easily. */
export function botFightChoice(s: GameState, u: UnitState) {
  const opts = manualActs(s, u.owner).filter((m) => !m.why && m.def.holder.id === u.id && m.def.spec.when === 'selectedToFight'
    && m.def.spec.do?.some((a) => a.buff?.some((e) => e.abilities?.some((x) => /lethal hits|sustained hits/.test(x)))));
  if (opts.length < 2) return;
  const e = engagedEnemies(s, u)[0];
  if (!e) return;
  const T = Math.max(...alive(e).map((m) => m.profile.T));
  const S = Math.max(...alive(u).flatMap((m) => m.weapons.flatMap((w) => w.profiles.filter((p) => p.range === 'Melee').map((p) => Number(p.S) || 0))));
  const want = S >= 2 * T ? /sustained/ : S > T ? /sustained/ : /lethal/;
  const pick = opts.find((m) => m.def.spec.do!.some((a) => a.buff?.some((x) => x.abilities?.some((y) => want.test(y))))) ?? opts[0];
  useActByKey(s, u.id, pick.def.key);
}

/** Is it worth pulling this unit back into Strategic Reserves (or into a transport) right now? */
export function redeployWorth(s: GameState, u: UnitState): boolean {
  if (s.objectives.some((o) => onObjective(s, u, o)) || s.round >= 4) return false;
  const threats = boardUnits(s, other(u.owner)).filter((e) => unitDistance(u, e) <= 9).length;
  if (threats >= 2 || alive(u).length * 2 <= u.startingStrength) return true;
  // a cheap raider (Tzaangors' Ambushing Hunters): out of the board now, back next turn by an objective it could not
  // walk to — the enemy's home, an empty flank — instead of wandering in the middle
  if (unitValue(u) > 160 || isEngaged(s, u)) return false;
  const reach = 2 * moveOf(u) + 3;
  return s.objectives.some((o) => o.controller !== u.owner && !(o.type === 'home' && o.owner === u.owner) && dist(centre(u), objPoint(s, o)) > reach);
}

/** Abilities that take a unit off the board to come back elsewhere (Echo of the Ravenspire, Parabolic Jetleap,
 *  Spectrus Doctrines), at their moment. */
export function botRedeployActs(s: GameState, p: PlayerId) {
  for (const m of manualActs(s, p)) {
    if (m.why || !m.def.spec.do?.some((a) => a.reserves)) continue;
    const jump = m.def.spec.do.some((a) => a.earlyArrival || a.buff?.some((b) => b.deepStrike));
    if (jump ? jumpWorth(s, m.def.holder) : redeployWorth(s, m.def.holder)) useActByKey(s, m.def.holder.id, m.def.key);
  }
}

/**
 * "Go into Reserves and Deep Strike" (Da Jump, Umbralefic Crystal, Mist-wreathed Shadow Realms): for a fighting unit
 * worth the trouble that can't reach the enemy this turn on foot, and isn't holding an objective or in a fight.
 */
export function jumpWorth(s: GameState, u: UnitState): boolean {
  if (s.round >= 4 || isEngaged(s, u) || u.battleShocked || s.objectives.some((o) => onObjective(s, u, o))) return false;
  if (unitValue(u) < 120) return false;
  const foes = boardUnits(s, other(u.owner));
  if (!foes.length) return false;
  const gap = Math.min(...foes.map((e) => unitDistance(u, e)));
  const reach = isBrawler(s, u) ? moveOf(u) + 7 : moveOf(u) + maxRange(u);
  return gap > reach;
}

// the end of the enemy's Fight phase: units that may now leave for Strategic Reserves
setPhaseEndHook((s, phase) => {
  const p = other(s.active);
  if (phase === 'fight' && ((s.bots ?? []).includes(p) || (s.autoRules ?? []).includes(p))) botRedeployActs(s, p);
});

// ---------- Adeptus Custodes decisions (and any faction with the same kind of rule) ----------

/** An Advance that stops the charge (Unlimited Endurance, Preternatural Rapidity): worth it when a melee unit can reach. */
export function botAdvanceChargeStratagem(s: GameState, u: UnitState) {
  if (u.move !== 'advance' || !isBrawler(s, u) || !chargeEligibility(s, u)?.startsWith('Advance')) return;
  if (!boardUnits(s, other(u.owner)).some((e) => unitDistance(u, e) <= 9)) return;
  for (const { st, rule } of strats(s, u.owner)) {
    if (rule.react || !fxOf(rule).some((e) => e.eligible?.includes('chargeAfterAdvance')) || !ready(s, u.owner, st, u)) continue;
    applyDetachmentStratagem(s, u.owner, st, u.id);
    return;
  }
}

/** +X to the charge roll (Fury of the Emperor) for a long charge. */
export function botChargeBonusStratagem(s: GameState, u: UnitState, gap: number) {
  if (gap <= 7) return;
  for (const { st, rule } of strats(s, u.owner)) {
    if (rule.react || !fxOf(rule).some((e) => (e.chargeBonus ?? 0) > 0) || !ready(s, u.owner, st, u)) continue;
    applyDetachmentStratagem(s, u.owner, st, u.id);
    return;
  }
}

/** A unit about to fight that is not readied: ready it again (Superhuman Focus) so it gets its ka'tah. */
export function botReadyStratagem(s: GameState, u: UnitState) {
  if (u.readied || !engagedEnemies(s, u).length || unitValue(u) < 150) return;
  for (const { st, rule } of strats(s, u.owner)) {
    if (rule.react || !dosOf(rule).some((a) => a.ready) || !ready(s, u.owner, st, u)) continue;
    applyDetachmentStratagem(s, u.owner, st, u.id);
    return;
  }
}

/** A valuable unit about to arrive from Reserves: -1 to be hit until our next turn (Golden Light of the Moiraides). */
export function botArrivalDefence(s: GameState, u: UnitState) {
  if (unitValue(u) < 150) return;
  for (const { st, rule } of strats(s, u.owner)) {
    if (rule.targetFrom !== 'reserves' || !fxOf(rule).some((e) => e.defend?.hit) || !ready(s, u.owner, st, u)) continue;
    applyDetachmentStratagem(s, u.owner, st, u.id);
    return;
  }
}

/** After shooting: mark the enemy it hit so the rest of the army's attacks get +1 AP (Psy-chaff Volley). */
export function botAfterShootStratagems(s: GameState, u: UnitState) {
  for (const { st, rule } of strats(s, u.owner)) {
    if (rule.react || !rule.enemy?.hitBy || !dosOf(rule).some((a) => a.incoming) || !ready(s, u.owner, st, u)) continue;
    const hit = u.lastHits?.ids.map((id) => s.units.find((x) => x.id === id)).filter((x): x is UnitState => !!x && onBoardUnit(x)) ?? [];
    const t = hit.sort((a, b) => unitValue(b) - unitValue(a))[0];
    if (t && unitValue(t) >= 100) applyDetachmentStratagem(s, u.owner, st, u.id, { enemyId: t.id });
    return;
  }
}

/** Start of the Fight phase: an enemy unit engaged with two of ours: ours with Shield of Honour punishes it for hitting the other. */
export function botShieldStratagem(s: GameState, p: PlayerId) {
  for (const { st, rule } of strats(s, p)) {
    if (rule.react || !fxOf(rule).some((e) => e.shieldOfHonour)) continue;
    const u = boardUnits(s, p).filter((x) => ready(s, p, st, x) && engagedEnemies(s, x).some((e) => boardUnits(s, p).some((y) => y.id !== x.id && engagedEnemies(s, y).some((f) => f.id === e.id))))
      .sort((a, b) => unitValue(a) - unitValue(b))[0];
    if (u) applyDetachmentStratagem(s, p, st, u.id);
  }
}

/** Command phase: a once-per-battle ability used up on a character (Gilded Champion), a Terminator squad that would hold
 *  more ground as single models (Unleash the Lions). */
export function botCommandExtras(s: GameState, p: PlayerId) {
  for (const { st, rule } of strats(s, p)) {
    if (rule.react) continue;
    if (dosOf(rule).some((a) => a.moreBattleUses)) {
      const u = boardUnits(s, p).filter((x) => ready(s, p, st, x, 2)).sort((a, b) => unitValue(b) - unitValue(a))[0];
      if (u) applyDetachmentStratagem(s, p, st, u.id);
    }
    if (dosOf(rule).some((a) => a.splitSingles) && s.round >= 2) {
      const open = s.objectives.filter((o) => o.controller !== p);
      const u = boardUnits(s, p).filter((x) => ready(s, p, st, x) && !engagedEnemies(s, x).length && alive(x).length >= 2
        && open.filter((o) => alive(x).some((m) => dist(m, o) <= 10)).length >= 2)[0];
      if (u) applyDetachmentStratagem(s, p, st, u.id);
    }
  }
}

/** End of a Fight phase: a once-per-battle move (Sweeping Advance) out of a fight it is losing, or on towards the enemy. */
export function botFightEndActs(s: GameState, p: PlayerId) {
  for (const m of manualActs(s, p)) {
    if (m.why || m.def.spec.when !== 'fightEndButton' || !m.def.spec.do?.some((a) => a.move)) continue;
    const u = m.def.holder;
    const losing = engagedEnemies(s, u).length > 0 && alive(u).reduce((a, x) => a + x.wounds, 0) * 2 < u.models.reduce((a, x) => a + x.profile.W, 0);
    const free = !engagedEnemies(s, u).length && moveGain(s, u, moveOf(u)) > 3;
    if (!losing && !free) continue;
    useActByKey(s, u.id, m.def.key);
    if (u.extraMove) botExtraMove(s, u);
  }
}

/** Movement phase: a unit far from everything teleports (Archeotech Teleport-shunter) and arrives this phase. */
export function botTeleportActs(s: GameState, p: PlayerId) {
  if (s.round < 2) return;
  for (const m of manualActs(s, p)) {
    if (m.why || !m.def.spec.do?.some((a) => a.reserves && a.earlyArrival)) continue;
    const u = m.def.holder;
    if (s.objectives.some((o) => onObjective(s, u, o)) || boardUnits(s, other(p)).some((e) => unitDistance(u, e) <= 18)) continue;
    useActByKey(s, u.id, m.def.key);
  }
}

/** A unit slowed by the enemy (-M, -advance / charge): ignore those modifiers this turn (Inexorable). */
export function botIgnoreModsStratagem(s: GameState, u: UnitState) {
  const slowed = unitFlags(s, u).move < 0 || rollMods(s, u).chargeBonus < 0 || rollMods(s, u).advanceBonus < 0;
  if (!slowed) return;
  for (const { st, rule } of strats(s, u.owner)) {
    if (rule.react || rule.until !== 'turn' || !fxOf(rule).some((e) => e.ignoreMods) || !ready(s, u.owner, st, u)) continue;
    applyDetachmentStratagem(s, u.owner, st, u.id);
    return;
  }
}
