// How the bot spends Command Points the way a player would: Command Re-rolls on the dice that matter, Insane Bravery
// to keep an objective, the reactive core stratagems (Rapid Ingress, Smokescreen, Heroic Intervention, Counteroffensive),
// Explosives, Crushing Impact, Epic Challenge, and its detachments' defensive stratagems when one of its units is
// attacked. It keeps a CP back for a re-roll until the last round unless the play is worth more.
import { botOff } from './botWeights';
import { on } from './events';
import { freeDiceNow, useFreeDie } from './activations';
import { applyMortalWounds, buildFightPools, buildShootPools, expectedDamage, onAttackStart, onMortalWounds, rerollOne, setDiceHook, shootingModes, targetToughness, woundNeed } from './attack';
import { chargeValue, isBrawler, maxRange, meleeKills, onObjective, oc, p2d6, perModel, rangedKills, unitValue } from './botEval';
import { bestArrival } from './botMove';
import { RULES } from './config';
import { rollN, exprAverage } from './dice';
import {
  arrivalRound, autoApproach, chargeReach, bestLd, chargeTargetOptions, commitCharge, counteroffensiveCandidates, declareCharge, heroicCandidates, hasDeepStrike,
  ingressUnit, rapidIngressCandidates, smokescreenCandidates, useCounteroffensive, validateMove, validatePlacement, crushingImpact,
} from './game';
import { addTimed, applyLateEffects, cond, targetHasCover, unitFlags, withRuleCache } from './effects';
import { botFightOnDeath } from './botPlus';
import { alive, boardUnits, canUseStratagem, engagedEnemies, hasKw, isEngaged, lastRound, log, onBoard, other, pace, phaseKey, playsItself, spendStratagem, stratCost, unitById, unitDistance } from './state';
import { applyDetachmentStratagem, stratagemBlock, stratChoices, stratRule, withChoice, type StratRule } from './stratagems';
import { unitVisibleTo } from './visibility';
import type { AttackSession, GameState, PlayerId, StratagemData, TimedEffect, UnitState } from './types';

/** Does the bot's logic take this player's decisions (a bot, or a player on auto rules)? */
export const isBot = (s: GameState, p: PlayerId) => (s.botPlayer != null && !s.bots && s.botPlayer === p) || playsItself(s, p);

/** Can the bot afford this now and still keep a CP for a re-roll (until the last round)? */
const spare = (s: GameState, p: PlayerId, cost: number, keep = s.campaign || s.round >= lastRound(s) ? 0 : 1) => s.players[p].cp - cost >= keep;

/**
 * What one CP is worth right now, in points of damage done or saved. A good player spends CP every turn: points left
 * over at the end are wasted, so the more CP there are for the rounds left, the cheaper each one is (and the last
 * round spends what's left).
 */
export function cpWorth(s: GameState, p: PlayerId): number {
  if (s.campaign) return 2; // Aggressive CP spending in Rogue-like mode
  // the battle's last turn: a CP not spent now is never spent
  if (s.round >= lastRound(s) && s.active !== s.firstPlayer) return 1;
  const left = Math.max(1, lastRound(s) + 1 - s.round); // rounds still to play, this one included
  const perRound = s.players[p].cp / left;
  // a bank of CP that can't all be spent in the rounds left is cheap: use it (a player ending on 7 CP wasted 7 stratagems)
  const w = botOff('cpBank') ? (perRound < 1 ? 14 : perRound < 2 ? 10 : 7)
    : perRound < 1 ? 14 : perRound < 1.5 ? 10 : perRound < 2.5 ? 6 : 3;
  return s.round >= lastRound(s) ? w * 0.6 : w;
}

// ---------- Command Re-roll on attack dice ----------

/** Points a single failed hit / wound / save is worth if it turns around, for the pool being resolved. */
function dieWorth(s: GameState, at: AttackSession, stage: 'hit' | 'wound' | 'save'): number {
  const p = at.pools[at.idx];
  const T = unitById(s, at.targetId);
  const m = alive(T)[0];
  if (!p || !m) return 0;
  const ev = expectedDamage(s, { ...p, instances: [{ A: '1', extras: [], flat: 0 }] as typeof p.instances, attackBonus: 0 }, T);
  const perUnsaved = (Math.min(exprAverage(p.damage), m.profile.W) / m.profile.W) * perModel(T);
  const pUnsaved = ev.wounds > 0 ? ev.unsaved / ev.wounds : 0;
  if (stage === 'save') return perUnsaved;
  if (stage === 'wound') return pUnsaved * perUnsaved;
  const pWound = ev.hits > 0 ? ev.wounds / ev.hits : 0;
  return pWound * pUnsaved * perUnsaved;
}

setDiceHook((s, stage) => {
  const at = s.attack;
  if (!at) return;
  const p = at.pools[at.idx];
  if (!p) return;
  const A = unitById(s, at.attackerId);
  const T = unitById(s, at.targetId);
  if (stage === 'hit' || stage === 'wound') {
    if (!isBot(s, A.owner)) return;
    const dice = stage === 'hit' ? p.hits : p.wounds;
    const failed = (d: (typeof dice)[number]) => (stage === 'hit' ? d.o === 'miss' : d.o === 'fail');
    // free re-rolls / "make it a 6" from abilities and detachment rules first (they cost nothing)
    for (const f of freeDiceNow(s).filter((x) => x.stage === stage)) {
      const k = dice.findIndex((d) => failed(d) && (f.kind === 'setSix' || !d.rerolled));
      if (k >= 0) useFreeDie(s, f.key, k);
    }
    if (canUseStratagem(s, A.owner, 'command-reroll', A) || !spare(s, A.owner, 1)) return;
    const i = dice.findIndex((d) => failed(d) && !d.rerolled);
    if (i < 0 || (stage === 'hit' && p.noHitReroll)) return;
    const isHighValue = unitValue(A) >= 80 || A.isWarlordUnit || A.models.some((m) => m.profile.W >= 3);
    if (s.campaign && isHighValue && s.players[A.owner].cp >= 1) {
      spendStratagem(s, A.owner, 'command-reroll', A);
      rerollOne(s, stage, i);
      log(s, `Bot CP Override: ${A.name} aggressively re-rolls failed ${stage} roll (${p.weapon})`, 'roll', A.owner);
      return;
    }
    const need = stage === 'hit' ? (p.hitOn6Only ? 6 : Math.max(2, Math.min(6, (p.skill ?? 7) - p.hitMod))) : Math.max(2, Math.min(6, p.woundNeed - p.woundMod));
    const gain = dieWorth(s, at, stage) * ((7 - need) / 6);
    if (gain < cpWorth(s, A.owner) - 2) return;
    spendStratagem(s, A.owner, 'command-reroll', A);
    rerollOne(s, stage, i);
    log(s, `Command Re-roll: a failed ${stage === 'hit' ? 'Hit' : 'Wound'} roll re-rolled (${p.weapon})`, 'roll', A.owner);
    return;
  }
  // saves: the defender re-rolls its lowest failed save when the damage it stops is worth the CP
  if (!isBot(s, T.owner) || canUseStratagem(s, T.owner, 'command-reroll', T) || !spare(s, T.owner, 1)) return;
  const m = alive(T)[0];
  if (!m) return;
  const sv = Math.min(m.profile.Sv - p.ap, m.profile.InSv ?? 7);
  const i = p.saves.map((d, k) => ({ d, k })).filter(({ d }) => !d.rerolled && (d.v === 1 || d.v < sv)).sort((a, b) => a.d.v - b.d.v)[0]?.k;
  if (i === undefined || sv > 6) return;
  const gain = dieWorth(s, at, 'save') * ((7 - Math.max(2, sv)) / 6);
  if (gain < cpWorth(s, T.owner) - 2) return;
  // a unit about to answer with a reaction (Hail of Vengeance, Power of the Machine Spirit …) keeps its one stratagem
  // of the phase for that
  if (at.kind === 'shoot' && s.players[T.owner].detachments.some((d) => d.stratagems.some((st) => {
    const r = stratRule(st, s.players[T.owner].factionId, d.name);
    return r.react === 'enemyShot' && !!r.botReact && s.players[T.owner].cp >= st.cp + 1;
  }))) return;
  spendStratagem(s, T.owner, 'command-reroll', T);
  rerollOne(s, 'save', i);
  log(s, `Command Re-roll: a failed saving throw re-rolled (${T.name})`, 'roll', T.owner);
});

// ---------- detachment stratagems, any of them: try the effect, measure, use the best ----------

/** Points of damage `u` expects to do to `t` with the effects it has right now. */
function attackValue(s: GameState, u: UnitState, t: UnitState, kind: 'shoot' | 'fight'): number {
  const r = kind === 'shoot' ? buildShootPools(s, u.id, t.id, { mode: shootingModes(s, u)[0] ?? 'normal' }) : buildFightPools(s, u.id, t.id);
  if (r.error || !r.pools.length) return 0;
  const ev = r.pools.reduce((a, p) => a + expectedDamage(s, p, t).models, 0);
  return Math.min(alive(t).length, ev) * perModel(t);
}

/** Put a stratagem's effects on a unit for a moment, measure something, and take them off again. */
export function tryRule<R>(s: GameState, u: UnitState, label: string, rule: StratRule, fn: () => R): R {
  const nb = u.buffs.length, nt = u.timed?.length ?? 0;
  for (const k of rule.buffs ?? []) u.buffs.push({ kind: k, until: 'phase', label });
  for (const e of rule.effects ?? []) addTimed(s, u, { e, label, until: 'phase', by: u.owner });
  try { return fn(); } finally { u.buffs.length = nb; if (u.timed) u.timed.length = nt; }
}

/** The bot's usable stratagems for a unit of the kind it wants ('attack' / 'defend'), with their rules. */
function usable(s: GameState, p: PlayerId, u: UnitState, use: 'attack' | 'defend') {
  return s.players[p].detachments.flatMap((d) => d.stratagems.map((st) => ({ st, rule: stratRule(st, s.players[p].factionId, d.name) })))
    .filter(({ st, rule }) => rule.bot === use && !rule.react && (!rule.enemy || !!rule.enemyMark) && !stratagemBlock(s, p, st, u) && spare(s, p, stratCost(s, st.id, u, st.cp)))
    // "select either …": each option is a separate candidate (Red Thirst ones too: the bot only takes them when they pay)
    .flatMap(({ st, rule }) => (rule.choice?.length ? stratChoices(s, rule, u).filter(({ o }) => !o.shock).map(({ i }) => ({ st, rule: withChoice(rule, i) as StratRule, choice: i as number | undefined })) : [{ st, rule, choice: undefined as number | undefined }]));
}

/** Before one of its units shoots or fights: the stratagem that adds the most expected damage, if it is worth the CP. */
export function botOffensiveStratagem(s: GameState, u: UnitState, kind: 'shoot' | 'fight', targets: UnitState[]) {
  const p = u.owner;
  if (!targets.length || u.battleShocked) return;
  const best0 = () => Math.max(0, ...targets.map((t) => attackValue(s, u, t, kind)));
  const base = best0();
  let best: { st: StratagemData; gain: number; choice?: number; enemyId?: string } | null = null;
  for (const { st, rule, choice } of usable(s, p, u, 'attack')) {
    if (rule.enemyMark) {
      // "select one enemy unit: against it …" (Devoted Duellists): the target it gains most against
      for (const t of targets) {
        const nt = t.timed?.length ?? 0;
        (t.timed ??= []).push({ e: {}, label: st.name, until: 'phase', by: p, mark: rule.enemyMark, turn: s.turn });
        const gain = (() => { try { return tryRule(s, u, st.name, rule, () => attackValue(s, u, t, kind)) - attackValue(s, u, t, kind); } finally { t.timed!.length = nt; } })();
        if (gain > (best?.gain ?? 0)) best = { st, gain, choice, enemyId: t.id };
      }
      continue;
    }
    const gain = tryRule(s, u, st.name, rule, best0) - base;
    if (gain > (best?.gain ?? 0)) best = { st, gain, choice };
  }
  const isHighVal = unitValue(u) >= 80 || u.isWarlordUnit || u.models.some((m) => m.profile.W >= 3);
  if (s.campaign && isHighVal && s.players[p].cp >= 1 && best) {
    applyDetachmentStratagem(s, p, best.st, u.id, { choice: best.choice, enemyId: best.enemyId });
    log(s, `Bot CP Override: ${u.name} aggressively triggers ${best.st.name} for offensive buff!`, 'info', p);
    return;
  }
  if (best && best.gain >= cpWorth(s, p) * best.st.cp) applyDetachmentStratagem(s, p, best.st, u.id, { choice: best.choice, enemyId: best.enemyId });
}

/** Expected points lost to this attack, with the target's current effects (and those of `rule`, when given). */
function lossFrom(s: GameState, at: AttackSession, T: UnitState, rule?: StratRule): number {
  const kind = at.kind === 'fight' ? 'melee' : 'ranged';
  const A = unitById(s, at.attackerId);
  let fnp = 7;
  const ev = at.pools.reduce((a, p0) => {
    const p = structuredClone(p0);
    if (rule) {
      const b = rule.buffs ?? [];
      if (b.includes('enemyHit-1') && !p.autoHit) p.hitMod -= 1;
      if (b.includes('enemyWound-1')) p.woundMod -= 1;
      if (b.includes('enemyAp-1') && p.ap < 0) p.ap += 1;
      if ((b.includes('cover') || (rule.effects ?? []).some((e) => e.stealth) && !targetHasCover(s, T, unitDistance(A, T))) && kind === 'ranged' && p.skill !== null) p.skill = Math.min(6, (p.skill ?? 6) + 1);
      if (b.includes('damage-1')) p.damage = String(Math.max(1, exprAverage(p.damage) - 1));
      for (const k of ['fnp4', 'fnp5', 'fnp6'] as const) if (b.includes(k)) fnp = Math.min(fnp, Number(k.slice(3)));
      const late = (rule.effects ?? []).map((e) => ({ e, label: 'try', until: 'phase', by: T.owner, turn: s.turn }) as TimedEffect);
      if (late.length) applyLateEffects(s, A, T, p, { attacker: [], target: late }, kind, targetToughness(T, s), woundNeed);
      for (const e of rule.effects ?? []) if (e.defend?.fnp && (!e.defend.fnpVs)) fnp = Math.min(fnp, e.defend.fnp);
      for (const e of rule.effects ?? []) if (e.defend?.damage) p.damage = String(Math.max(1, exprAverage(p.damage) + e.defend.damage));
    }
    return a + expectedDamage(s, p, T).models;
  }, 0);
  return Math.min(alive(T).length, ev * (fnp < 7 ? (fnp - 1) / 6 : 1)) * perModel(T);
}

/** When one of its units is attacked: the stratagem that saves the most, if it is worth the CP. */
onAttackStart((s, at) => {
  if (at.free) return;
  const T = unitById(s, at.targetId);
  const p = T.owner;
  if (!isBot(s, p) || T.battleShocked) return;
  const base = lossFrom(s, at, T);
  if (base < 15) return;
  let best: { st: StratagemData; save: number; choice?: number } | null = null;
  for (const { st, rule, choice } of usable(s, p, T, 'defend')) {
    const save = base - tryRule(s, T, st.name, rule, () => lossFrom(s, at, T, rule));
    if (save > (best?.save ?? 0)) best = { st, save, choice };
  }
  if (best && best.save >= (cpWorth(s, p) - 2) * best.st.cp) applyDetachmentStratagem(s, p, best.st, T.id, { choice: best.choice });
  else if (at.kind === 'fight') botFightOnDeath(s, T, base / Math.max(1, alive(T).length * perModel(T)));
});

/** Mortal wounds coming in: "Feel No Pain 5+ against mortal wounds" (Omnissiah's Grace, Layered Ceramite …) when they would hurt. */
onMortalWounds((s, u, n) => {
  const p = u.owner;
  if (!isBot(s, p) || u.battleShocked) return;

  // Rogue-like mode Bot AI Override: If Bot.CP >= 1 and mortal wounds allocated -> Automatically trigger Omnissiah's Grace / FNP defensive stratagem
  if (s.campaign && s.players[p].cp >= 1) {
    for (const d of s.players[p].detachments) for (const st of d.stratagems) {
      const rule = stratRule(st, s.players[p].factionId, d.name);
      const isDefensive = (rule.effects ?? []).some((e) => e.defend?.fnpVs === 'mortal' || e.defend?.fnp) || (rule.buffs ?? []).some((b) => b.startsWith('fnp') || b === 'damage-1');
      if (isDefensive && !stratagemBlock(s, p, st, u) && s.players[p].cp >= stratCost(s, st.id, u, st.cp)) {
        applyDetachmentStratagem(s, p, st, u.id);
        log(s, `Bot CP Override: Automatically triggered defensive stratagem ${st.name} against mortal wounds!`, 'info', p);
        return;
      }
    }
  }

  const loss = Math.min(alive(u).length, n / Math.max(1, alive(u)[0]?.profile.W ?? 1)) * perModel(u);
  if (loss < 8 && n < 3) return;
  for (const d of s.players[p].detachments) for (const st of d.stratagems) {
    const rule = stratRule(st, s.players[p].factionId, d.name);
    if (!(rule.effects ?? []).some((e) => e.defend?.fnpVs === 'mortal') || stratagemBlock(s, p, st, u) || !spare(s, p, stratCost(s, st.id, u, st.cp))) continue;
    applyDetachmentStratagem(s, p, st, u.id);
    return;
  }
});

// ---------- battle-shock ----------

/** Use Insane Bravery on this test? Once per battle, for a unit that holds ground or is worth a lot. */
export function wantsBravery(s: GameState, u: UnitState): boolean {
  if (!isBot(s, u.owner) || canUseStratagem(s, u.owner, 'insane-bravery', u)) return false;
  const pFail = 1 - p2d6(bestLd(u, s));
  const holds = oc(u) > 0 && s.objectives.some((o) => onObjective(s, u, o));
  const big = unitValue(u) >= 150 || u.isWarlordUnit;
  return pFail >= 0.25 && (holds || big) && s.players[u.owner].cp >= 1;
}

// ---------- reactions in the opponent's turn ----------

/** Rapid Ingress (or a free arrival such as Deff from the Shadows) at the end of the opponent's Movement phase. */
export function botRapidIngress(s: GameState, p: PlayerId): boolean {
  const cands = [...rapidIngressCandidates(s, p)].sort((a, b) => unitValue(b) - unitValue(a));
  for (const u of cands) {
    const free = unitFlags(s, u).oppMoveIngress && s.round >= arrivalRound(s, u);
    if (!free && (canUseStratagem(s, p, 'rapid-ingress', u) || !spare(s, p, 1))) continue;
    const how = hasDeepStrike(s, u) ? 'deepStrike' : 'ingress';
    const pos = withRuleCache(() => bestArrival(s, u, how));
    if (!pos || !validatePlacement(s, u, pos, how).ok) continue;
    if (!free && ingressWorth(s, u, pos) < cpWorth(s, p)) continue;
    if (!free) spendStratagem(s, p, 'rapid-ingress', u);
    ingressUnit(s, u, pos);
    return true;
  }
  return false;
}

/**
 * What arriving now (at the end of the opponent's move) rather than in our own Movement phase is worth, the way a
 * tournament player sees Rapid Ingress: the unit is on the table before our turn starts, so it can move again and
 * charge, it can reach an objective to take or contest in our turn, it gets a full move towards targets, and the
 * opponent has already moved so can't react to where it lands (a little risk: their shooting is still to come next
 * turn, not this one). Late in the game a unit still in reserves is points doing nothing.
 */
function ingressWorth(s: GameState, u: UnitState, pos: Map<string, { x: number; y: number }>): number {
  const at = [...pos.values()];
  const c = { x: at.reduce((a, q) => a + q.x, 0) / at.length, y: at.reduce((a, q) => a + q.y, 0) / at.length };
  const near = (o: { x: number; y: number }, r: number) => Math.hypot(o.x - c.x, o.y - c.y) <= r;
  let v = 0;
  // melee: a charge in our turn from where it lands (move + 2D6)
  if (isBrawler(s, u)) v += 0.5 * unitValue(u);
  // objectives it can stand on in our turn (a normal move away) that we don't hold yet
  const reach = (alive(u)[0]?.profile.M ?? 6) + 3;
  const objs = s.objectives.filter((o) => near(o, reach) && o.controller !== u.owner);
  v += objs.length * 15 * Math.min(2, oc(u) / 4);
  // shooting: targets within its best range after a move
  const foes = boardUnits(s, other(u.owner)).filter((e) => alive(e).some((m) => near(m, maxRange(u) + reach)));
  if (foes.length) v += 0.25 * Math.max(...foes.map((e) => Math.min(alive(e).length, rangedKills(u, e)) * perModel(e)));
  // from round 3 on a unit in reserves is wasted points
  if (pace(s) >= 3) v += 0.3 * unitValue(u);
  return v;
}

/** Shots the enemy can put into this unit this phase (points), from units that are in range and can see it. */
function incoming(s: GameState, u: UnitState): number {
  return boardUnits(s, other(u.owner)).reduce((a, e) => {
    if (isEngaged(s, e) || unitDistance(e, u) > maxRange(e) || !alive(e).some((m) => unitVisibleTo(s, m, u))) return a;
    return a + Math.min(alive(u).length, rangedKills(e, u)) * perModel(u);
  }, 0);
}

/** Smokescreen on the SMOKE unit that is about to take the most fire. */
export function botSmokescreen(s: GameState, p: PlayerId): boolean {
  if (!spare(s, p, 1)) return false;
  const best = smokescreenCandidates(s, p).map((u) => ({ u, v: incoming(s, u) })).sort((a, b) => b.v - a.v)[0];
  if (!best || best.v < 2 * cpWorth(s, p)) return false;
  spendStratagem(s, p, 'smokescreen', best.u);
  best.u.buffs.push({ kind: 'smoke', until: 'phase', label: 'Smokescreen' });
  return true;
}

/** Heroic Intervention (Leap to Defend) into a unit that just charged, when the fight is worth it. */
export function botHeroic(s: GameState, p: PlayerId): boolean {
  if (!spare(s, p, 1)) return false;
  let best: { u: UnitState; v: number } | null = null;
  for (const u of heroicCandidates(s, p)) {
    for (const e of boardUnits(s, other(p)).filter((x) => x.chargedTurn === s.turn)) {
      const gap = unitDistance(u, e);
      if (gap > RULES.charge.declareRange) continue;
      const v = chargeValue(s, u, e) * p2d6(gap);
      if (!best || v > best.v) best = { u, v };
    }
  }
  if (!best || best.v < 1.6 * cpWorth(s, p)) return false;
  const u = best.u;
  spendStratagem(s, p, 'heroic-intervention', u);
  declareCharge(s, u);
  const opts = chargeTargetOptions(s, u, { onlyChargedThisPhase: true });
  if (!opts.length) return true;
  const t = [...opts].sort((a, b) => chargeValue(s, u, b) - chargeValue(s, u, a))[0];
  const stay = new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y }]]));
  const paths = new Map([...stay, ...autoApproach(s, u, [t], chargeReach(s, u, [t]))]);
  if (validateMove(s, u, 'charge', paths, { targets: [t.id] }).ok) commitCharge(s, u, paths, [t.id]);
  return true;
}

/** Counteroffensive (2CP): our best melee unit fights next when it would hurt a lot. */
export function botCounteroffensive(s: GameState, p: PlayerId): boolean {
  if (!spare(s, p, 2)) return false;
  const score = (u: UnitState) => Math.max(0, ...boardUnits(s, other(p)).filter((e) => unitDistance(u, e) <= RULES.engagementRange).map((e) => Math.min(alive(e).length, meleeKills(u, e)) * perModel(e)));
  const best = counteroffensiveCandidates(s, p).map((u) => ({ u, v: score(u) })).sort((a, b) => b.v - a.v)[0];
  if (!best || best.v < 2.8 * cpWorth(s, p)) return false;
  useCounteroffensive(s, best.u);
  return true;
}

// ---------- our own turn ----------

/** Explosives / Grenades before the unit shoots: 6D6, 4+ = 1 mortal wound, on the enemy unit it hurts most. */
export function botExplosives(s: GameState, u: UnitState): boolean {
  const p = u.owner;
  if (!(hasKw(u, 'GRENADES') || hasKw(u, 'EXPLOSIVES')) || u.selectedToShoot || isEngaged(s, u) || u.move === 'advance' || u.move === 'fallback') return false;
  if (canUseStratagem(s, p, 'explosives', u) || !spare(s, p, 1)) return false;
  const flags = unitFlags(s, u);
  const gheist = flags.gheistskull && !u.used?.['Gheistskull'];
  const maxRange = gheist ? 18 : 8;
  const threshold = flags.esotericExplosives ? 3 : 4;
  const expectedMortal = threshold === 3 ? 4 : 3;
  // mortal wounds on average: worth most against a few tough models with good saves
  const worth = (t: UnitState) => {
    const m = alive(t)[0];
    return Math.min(expectedMortal / m.profile.W, alive(t).length) * perModel(t);
  };
  const t = boardUnits(s, other(p)).filter((e) => !isEngaged(s, e) && unitDistance(u, e) <= maxRange && alive(u).some((m) => unitVisibleTo(s, m, e)))
    .sort((a, b) => worth(b) - worth(a))[0];
  if (!t || worth(t) < 1.6 * cpWorth(s, p)) return false;
  spendStratagem(s, p, 'explosives', u);
  if (gheist && unitDistance(u, t) > 8) {
    (u.used ??= {})['Gheistskull'] = `battle|${s.round}`;
  }
  const r = rollN(s, 6);
  const n = r.filter((x) => x >= threshold).length;
  log(s, `Bot uses Explosives: ${u.name} → ${t.name} [${r.join(' ')}] = ${n} MW`, 'roll', p);
  if (n) applyMortalWounds(s, t, n, 'Explosives');
  return true;
}

/** Crushing Impact after a MONSTER / VEHICLE charge: T dice, 5+ = 1 mortal wound (max 6), 1 = 1 back. */
export function botCrushingImpact(s: GameState, u: UnitState, targetId: string) {
  if (!(hasKw(u, 'MONSTER') || hasKw(u, 'VEHICLE')) || canUseStratagem(s, u.owner, 'crushing-impact', u) || !spare(s, u.owner, 1)) return;
  const t = unitById(s, targetId);
  const T = alive(u)[0]?.profile.T ?? 0;
  const worth = Math.min(6, T / 3) * (perModel(t) / Math.max(1, alive(t)[0]?.profile.W ?? 1)) - (T / 6) * (perModel(u) / Math.max(1, alive(u)[0]?.profile.W ?? 1));
  if (worth < cpWorth(s, u.owner)) return;
  crushingImpact(s, u, targetId);
}

/** Epic Challenge: give a CHARACTER [PRECISION] when the enemy unit has a CHARACTER worth killing. */
export function botEpicChallenge(s: GameState, u: UnitState, targetId: string): string | undefined {
  const t = unitById(s, targetId);
  const chars = alive(u).filter((m) => m.isCharacter);
  const theirs = alive(t).filter((m) => m.isCharacter);
  if (!chars.length || !theirs.length || alive(t).length === theirs.length) return undefined;
  if (canUseStratagem(s, u.owner, 'epic-challenge', u) || !spare(s, u.owner, 1)) return undefined;
  spendStratagem(s, u.owner, 'epic-challenge', u);
  return chars[0].id;
}

// Emperor's Children: stratagems the bot plays when one of its units wipes out an enemy unit (after Slaanesh's Chosen
// has picked the Favoured Champions)
on('modelKilled', (s, { u, killerId }) => {
  if (alive(u).length || !killerId) return;
  const k = s.units.find((x) => x.id === killerId);
  if (!k || !onBoard(k) || !playsItself(s, k.owner)) return;
  const p = k.owner;
  const find = (name: string) => s.players[p].detachments.flatMap((d) => d.stratagems).find((st) => st.name === name);
  const can = (name: string, x: UnitState, keep = 1) => { const st = find(name); return st && !stratagemBlock(s, p, st, x) && s.players[p].cp >= stratCost(s, st.id, x, st.cp) + keep ? st : undefined; };
  // Unbound Arrogance: the pledge is already beaten, so raising it is a free Pact point
  const ua = can('UNBOUND ARROGANCE', k);
  if (ua && cond('pledgeBeaten', { s, A: k })) applyDetachmentStratagem(s, p, ua, k.id);
  const fav = s.players[p].favoured === k.id;
  // Diabolic Majesty: the new Favoured Champions terrify the enemy units around them
  const dm = fav && s.players[p].favouredTurn === s.turn ? can('DIABOLIC MAJESTY', k) : undefined;
  if (dm && boardUnits(s, other(p)).some((e) => unitDistance(k, e) <= 6)) applyDetachmentStratagem(s, p, dm, k.id);
  // Heightened Jealousy: other CHARACTER units still to fight this phase hit harder
  const hj = fav && s.phase === 'fight' ? can('HEIGHTENED JEALOUSY', k, 2) : undefined;
  if (hj && boardUnits(s, p).some((x) => x.id !== k.id && alive(x).some((mm) => mm.isCharacter) && !x.fought && engagedEnemies(s, x).length)) applyDetachmentStratagem(s, p, hj, k.id);
  // Ecstatic Slaughter: a Legions of Excess kill lets an Emperor's Children unit nearby charge
  if (s.phase === 'fight' && k.factionKeywords.includes('LEGIONS OF EXCESS')) {
    const x = boardUnits(s, p).find((f) => f.factionKeywords.includes('EMPEROR’S CHILDREN') && unitDistance(f, k) <= 6 && !engagedEnemies(s, f).length && !f.fought
      && boardUnits(s, other(p)).some((e) => unitDistance(f, e) <= 8));
    const es = x && can('ECSTATIC SLAUGHTER', x);
    if (x && es) { (k.used ??= {}).killedUnit = phaseKey(s); applyDetachmentStratagem(s, p, es, x.id); }
  }
});
