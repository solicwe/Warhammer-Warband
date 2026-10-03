// @ts-nocheck — frozen copy of src/engine/bot.ts (scripts/bot-baseline/snapshot.mjs)
// Rules-legal bot. Used for full-game simulation tests and as the single-player opponent.
// It plays one unit per step so the UI can animate each action.
import { buildFightPools, buildShootPools, expectedDamage, finishAttack, resolveAll, shootingModes, startAttack } from '../attack';
import { RULES } from '../config';
import { smartPlacement } from '../deploy';
import { dist, polyCentroid } from '../geometry';
import { detChoices, pickDetChoice } from '../detachments';
import {
  autoApproach, autoCharge, autoPileMove, callWaaagh, discardSecondary, swapSecondary, canIngress, chargeEligibility, chargeTargetOptions, closeWindow, commitCharge, commitMove, consolidateEligible, consolidateMode,
  declareCharge, deployUnit, endConsolidateStep, endPhase, endPileInStep, endScouts, fightCandidates, findPlacement, ingressUnit, levelOfControl, markFought,
  objectiveTerrain, openCounteroffensive, overwatchCandidates, pileInEligible, remainStationary, rerollCharge, rollAdvance, rollBattleShock, scoutUnits,
  sendToReserves, setOathTarget, validateMove, validatePlacement, chooseFixedSecondaries, canDetReroll, detReroll, beginMove, hasDeepStrike, setOathBackup,
  canEmbarkIn, disembarkMode, disembarkUnit, embarkedIn, embarkUnit, ringFormation, validateDisembark,
} from '../game';
import { abilityChoices, botUseActs, closeOffers, pickAbilities, unitSelected } from '../activations';
import { abilityRule, unitFlags, withRuleCache } from '../effects';
import { alive, boardUnits, canUseStratagem, engagedEnemies, isEngaged, log, onBoard, other, spendStratagem, unitById, unitDistance } from '../state';
import { actionOptions, startAction } from '../missions';
import { secondaryDead } from '../secondaries';
import {
  centre, chargeValue, isBrawler, meleeKills, moveOf, objectiveNeeds, objPoint, onObjective, p2d6, perModel, shotValue as shotWorth, unitValue,
} from './botEval';
import { bestArrival, bestFallBack, bestMove, canLeave, ctxFor, movesTowards, planMove, scoreSpot } from './botMove';
import {
  botCounteroffensive, botCrushingImpact, botEpicChallenge, botExplosives, botHeroic, botOffensiveStratagem, botRapidIngress, botSmokescreen, isBot, wantsBravery,
} from './botStrats';
import type { GameState, PlayerId, UnitState } from '../types';

const stay = (u: UnitState) => new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y }]]));

/** Has the bot already handled this unit in the current phase? */
function tried(s: GameState, u: UnitState): boolean {
  return (s.botTried ?? []).includes(`${s.turn}|${s.phase}|${u.id}`);
}
function markTried(s: GameState, u: UnitState) {
  const key = `${s.turn}|${s.phase}|${u.id}`;
  s.botTried = [...(s.botTried ?? []).filter((k) => k.startsWith(`${s.turn}|${s.phase}|`)), key];
}

/** Resolve a bot attack. Against a player's unit (vs-bot games) the attack stays open: the player rolls the saves and can
 *  use Command Re-roll or a stratagem, then closes the dice tray. Returns false while it is open. */
function botAttack(s: GameState, kind: 'shoot' | 'fight' | 'overwatch', attackerId: string, targetId: string, pools: Parameters<typeof startAttack>[4]): boolean {
  startAttack(s, kind, attackerId, targetId, pools);
  if (!s.attack) return true;
  const owner = unitById(s, targetId).owner;
  if (!isBot(s, owner) && (s.bots?.length ?? 0) > 0 && s.defenderRolls !== false) { s.attack.defenderRolls = true; return false; }
  resolveAll(s);
  finishAttack(s);
  return true;
}

// ---------- stratagems ----------

// ---------- deployment ----------

/** Fixed secondaries: a bot picks two cards the matchup is likely to pay out. */
function botPickFixed(s: GameState, p: PlayerId) {
  const P = s.players[p];
  if (P.secMode !== 'fixed' || P.secActive.length >= 2) return;
  const e = other(p);
  const enemy = s.units.filter((u) => u.owner === e);
  const picks: string[] = [];
  if (enemy.some((u) => u.models.some((m) => m.profile.W >= 10))) picks.push('bring-it-down');
  if (enemy.some((u) => u.startingStrength >= 13)) picks.push('a-grievous-blow');
  picks.push('assassination', 'engage-on-all-fronts');
  chooseFixedSecondaries(s, p, picks.slice(0, 2));
}

export function botDeploy(s: GameState) {
  const p = s.deployTurn;
  botPickFixed(s, p);
  // Declare Battle Formations: a passenger for every empty transport (an empty Dedicated Transport is lost)
  for (const t of s.units.filter((x) => x.owner === p && x.transport && ['pending', 'board', 'reserves'].includes(x.status))) {
    if (embarkedIn(s, t).length) continue;
    const riders = s.units.filter((x) => x.owner === p && x.status === 'pending' && !canEmbarkIn(s, x, t))
      .sort((a, b) => Number(isBrawler(s, b)) - Number(isBrawler(s, a)) || unitValue(b) - unitValue(a));
    if (riders.length && !embarkUnit(s, riders[0], t, true)) return;
  }
  const u = s.units.find((x) => x.owner === p && x.status === 'pending');
  if (!u) return;
  // deep strikers go to reserves when there is room, the rest deploy towards the most central objective
  if (hasDeepStrike(s, u) && sendToReserves(s, u.id) === null) return;
  // a vehicle must not be set up where ruin walls box it in for the whole game
  const pos = smartPlacement(s, u) ?? findPlacement(s, u, 'deploy', undefined, (q) => canLeave(s, u, q)) ?? findPlacement(s, u, 'deploy');
  if (pos && deployUnit(s, u.id, pos).ok) return;
  if (sendToReserves(s, u.id)) {
    // could not place or reserve: last resort, drop the unit
    u.status = 'destroyed';
    const o = other(p);
    if (s.units.some((x) => x.owner === o && x.status === 'pending')) s.deployTurn = o;
  }
}

// ---------- command ----------

/**
 * Tactical cards that cannot score any more: nothing left to kill for them, or no unit able to get where they
 * want this turn. Swapped for a new card (once per battle, 1CP) or discarded for +1CP.
 */
export function botManageCards(s: GameState, p: PlayerId) {
  const P = s.players[p];
  if (P.secMode !== 'tactical' || s.botIgnoresCards?.includes(p)) return;
  const dead = (id: string) => secondaryDead(s, p, id);
  for (const id of [...P.secActive]) {
    if (!dead(id)) continue;
    if (!P.secSwapUsed && P.cp >= 2 && s.phase === 'command' && s.active === p) swapSecondary(s, p, id);
    else discardSecondary(s, p, id);
  }
}

export function botCommand(s: GameState) {
  for (const t of s.shockTests) if (t.passed === null) rollBattleShock(s, t.unitId, wantsBravery(s, unitById(s, t.unitId)));
  const p = s.active;
  botManageCards(s, p);
  const P = s.players[p];
  const mine = boardUnits(s, p);
  const enemies = boardUnits(s, other(p));
  if (P.armyRules.some((r) => r.name === 'Oath of Moment') && enemies.length) {
    // the most valuable enemy our army can actually reach this turn
    const reach = (e: UnitState) => Math.min(...mine.map((m) => unitDistance(m, e)), 99);
    const t = [...enemies].sort((a, b) => (unitValue(b) / (1 + Math.max(0, reach(b) - 24) / 6)) - (unitValue(a) / (1 + Math.max(0, reach(a) - 24) / 6)))[0];
    setOathTarget(s, p, t.id);
  }
  if (P.armyRules.some((r) => r.name === 'Waaagh!') && !P.waaaghUsed && s.round >= 2) {
    const brawlers = mine.filter((u) => isBrawler(s, u));
    const close = brawlers.filter((u) => enemies.some((e) => unitDistance(u, e) <= 16));
    if (s.round >= 3 || close.length >= Math.max(1, brawlers.length / 2)) callWaaagh(s, p);
  }
  botDetachmentChoices(s, p, mine, enemies);
  // Master of Battle: a second Oath of Moment target
  if (P.oathTarget && mine.some((u) => unitFlags(s, u).oathBackup)) {
    const second = [...enemies].filter((e) => e.id !== P.oathTarget).sort((a, b) => unitValue(b) - unitValue(a))[0];
    if (second) setOathBackup(s, p, second.id);
  }
  // "select two of these abilities": keep the ones that do something by themselves
  for (const c of abilityChoices(s, p)) {
    const score = (name: string) => {
      const a = c.unit.abilities.find((x) => x.name === name);
      const r = a ? abilityRule(c.unit, a) : undefined;
      const act = r?.act as { botUse?: string } | undefined;
      return (r?.effects?.length ? 2 : 0) + (act && act.botUse !== 'never' ? 1 : 0);
    };
    pickAbilities(s, c.unit.id, [...c.options].sort((a, b) => score(b) - score(a)).slice(0, c.pick));
  }
  botUseActs(s, p, ['command', 'anyCommand', 'battleStart', 'opponentTurnEnd', 'anyPhase']);
  endPhase(s);
}

/** Combat Doctrines and other "pick one" detachment rules: shoot on the move early, charge once the armies meet. */
function botDetachmentChoices(s: GameState, p: PlayerId, mine: UnitState[], enemies: UnitState[]) {
  const near = mine.some((u) => enemies.some((e) => unitDistance(u, e) <= 14));
  const engaged = mine.some((u) => isEngaged(s, u));
  const prefer: Record<string, string[]> = {
    command: engaged ? ['tactical', 'assault', 'devastator'] : near ? ['assault', 'devastator', 'tactical'] : ['devastator', 'assault', 'tactical'],
  };
  for (const c of detChoices(s, p)) {
    if (!c.open) continue;
    const free = c.options.filter((o) => !o.why).map((o) => o.o.id);
    if (!free.length) continue;
    const want = c.choice.pick ?? 1;
    // generic order: the rule's own preference list for doctrines, else the listed order (round / battle choices)
    const order = [...(prefer[c.choice.when] ?? []), ...c.choice.options.map((o) => o.id)];
    const ids = [...new Set(order.filter((id) => free.includes(id)))].slice(0, want);
    // keep limited-use rules (e.g. 3 doctrines in 5 rounds) for when the armies are close
    if (c.choice.uses === 'limit' && !near && s.round < 3) continue;
    if (ids.length === want) pickDetChoice(s, p, c.rule, ids);
  }
}

// ---------- movement ----------

/** Front units move first so they don't block the ones behind them. */
function moveOrder(s: GameState, p: PlayerId): UnitState[] {
  const foes = boardUnits(s, other(p));
  const gap = (u: UnitState) => (onBoard(u) && foes.length ? Math.min(...foes.map((e) => unitDistance(u, e))) : 99);
  return s.units.filter((x) => x.owner === p).sort((a, b) => Number(isEngaged(s, b)) - Number(isEngaged(s, a)) || gap(a) - gap(b));
}

/** Passengers get out before their transport moves (Tactical Disembark: they can still move afterwards)
 *  once the enemy or an objective that needs bodies is close, or late in the game. */
function botDisembark(s: GameState, p: PlayerId): boolean {
  const key = (u: UnitState) => `${s.turn}|${s.phase}|${u.id}:out`;
  for (const u of s.units.filter((x) => x.owner === p && x.status === 'embarked' && x.embarkedIn && !(s.botTried ?? []).includes(key(x)))) {
    const t = unitById(s, u.embarkedIn!);
    if (!onBoard(t) || t.move || disembarkMode(s, t) !== 'tactical') continue;
    s.botTried = [...(s.botTried ?? []), key(u)];
    const tm = alive(t)[0];
    const foes = boardUnits(s, other(p));
    const near = foes.length ? Math.min(...foes.map((e) => unitDistance(t, e))) : 99;
    const need = objectiveNeeds(s, p).filter((n) => n.need > 0).map((n) => objPoint(s, n.o)).sort((a, b) => dist(a, tm) - dist(b, tm))[0];
    const go = s.round >= 4 || (s.round >= 2 && (near <= 14 || (need && dist(need, tm) <= 10)));
    if (!go) continue;
    // set up on the side facing the objective / the closest enemy
    const closest = foes.length ? foes.flatMap(alive).reduce((a, m) => (dist(m, tm) < dist(a, tm) ? m : a)) : undefined;
    const goal = need && dist(need, tm) <= 12 ? need : closest ?? need ?? tm;
    const base = Math.atan2(goal.y - tm.y, goal.x - tm.x);
    for (const da of [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9, 2.5, -2.5, Math.PI]) {
      const pos = ringFormation(u, tm, base + da);
      if (validateDisembark(s, u, t, pos).ok) { disembarkUnit(s, u, t, pos); return true; }
    }
  }
  return false;
}

/** Move (or bring in) one unit. Returns false when there is nothing left to do this phase. */
export function botMoveOne(s: GameState): boolean {
  botUseActs(s, s.active, ['movement']);
  if (botDisembark(s, s.active)) return true;
  for (const u of moveOrder(s, s.active)) {
    if (tried(s, u)) continue;
    if (u.status === 'reserves') {
      if (!canIngress(s, u)) continue;
      markTried(s, u);
      const how = hasDeepStrike(s, u) ? 'deepStrike' : 'ingress';
      const pos = withRuleCache(() => bestArrival(s, u, how));
      if (pos && validatePlacement(s, u, pos, how).ok) { ingressUnit(s, u, pos); return true; }
      continue;
    }
    if (!onBoard(u) || u.move) continue;
    markTried(s, u);
    const M = moveOf(u);
    if (!M || !Number.isFinite(M)) { remainStationary(s, u); return true; }
    const MM = M + unitFlags(s, u).move;
    if (isEngaged(s, u)) {
      const foes = engagedEnemies(s, u);
      const back = withRuleCache(() => {
        const ctx = ctxFor(s, u);
        // staying in: what we do in the fight against what they do to us, plus whatever objective we sit on
        const net = foes.reduce((a, e) => a + meleeKills(u, e) * perModel(e) - meleeKills(e, u) * perModel(u) * 0.6, 0);
        const stayScore = scoreSpot(s, u, 'stationary', null, ctx) + net;
        const plan = bestFallBack(s, u, MM - 0.05, ctx, foes);
        // Desperate Escape costs a hazard roll per model; leaving frees the enemy unit for our shooting
        const cost = u.battleShocked ? alive(u).length * perModel(u) * 0.33 : 0;
        const gain = ctx.brawler ? 0 : 0.2 * foes.reduce((a, e) => a + unitValue(e), 0);
        return plan.paths && plan.score - cost + gain > stayScore ? plan.paths : null;
      });
      if (!back) { remainStationary(s, u); return true; }
      if (!beginMove(s, u, 'fallback')) return true;
      if (onBoard(u) && validateMove(s, u, 'fallback', back).ok) commitMove(s, u, 'fallback', back);
      else remainStationary(s, u);
      return true;
    }
    const { normal, advance: adv } = withRuleCache(() => planMove(s, u, MM, ctxFor(s, u)));
    // advancing: worth it when the extra distance (3.5" on average) reaches somewhere better than a Normal move does
    if (adv && adv.score > normal.score + 3) {
      if (!beginMove(s, u, 'advance')) return true;
      rollAdvance(s, u);
      const max = MM + (u.advanceRoll ?? 0) - 0.05;
      const aims = [adv.aim!, ...(normal.aim ? [normal.aim] : [])];
      const plan = onBoard(u) ? withRuleCache(() => bestMove(s, u, 'advance', max, ctxFor(s, u), { aims, noStay: true })) : null;
      if (plan?.paths && validateMove(s, u, 'advance', plan.paths).ok) commitMove(s, u, 'advance', plan.paths);
      else remainStationary(s, u);
      return true;
    }
    if (!normal.paths) { remainStationary(s, u); return true; }
    if (!beginMove(s, u, 'normal')) return true;
    if (onBoard(u) && validateMove(s, u, 'normal', normal.paths).ok) {
      commitMove(s, u, 'normal', normal.paths);
      botUseActs(s, u.owner, ['endOfNormalMove'], u.id);
    } else remainStationary(s, u);
    return true;
  }
  return false;
}

export function botMovement(s: GameState) {
  while (botMoveOne(s)) { /* one unit at a time */ }
  endPhase(s);
}

// ---------- shooting ----------

const shotValue = (s: GameState, u: UnitState, t: UnitState, ev: number) => shotWorth(s, u, t, ev, unitDistance(u, t));

export function botShootOne(s: GameState): boolean {
  const mine = boardUnits(s, s.active);
  // a unit that fired some of its weapons carries on with the rest (split fire), e.g. after the player rolled saves
  const busy = mine.find((u) => tried(s, u) && !u.selectedToShoot && u.weaponsFired.length > 0 && shootingModes(s, u).length > 0);
  for (const u of busy ? [busy] : mine) {
    if (!busy && tried(s, u)) continue;
    const modes = shootingModes(s, u);
    if (!modes.length) continue;
    const mode = modes[0];
    const rank = () => boardUnits(s, other(u.owner)).map((t) => {
      const r = buildShootPools(s, u.id, t.id, { mode });
      if (r.error || !r.pools.length) return null;
      const ev = r.pools.reduce((a, p) => a + expectedDamage(s, p, t).models, 0);
      return { t, v: shotValue(s, u, t, ev) };
    }).filter((x): x is { t: UnitState; v: number } => !!x).sort((a, b) => b.v - a.v);
    if (!busy) {
      markTried(s, u);
      unitSelected(s, u, 'shoot');
      botUseActs(s, u.owner, ['selectedToShoot', 'shooting'], u.id);
      // a mission action is worth roughly 8 points of damage per VP it brings
      const ACTION_VP: Record<string, number> = { cleanse: 3, plunder: 5, 'booby-trap': 3, decoy: 4, 'sensor-sweep': 4, triangulate: 5, surveil: 4, 'extract-intelligence': 7, 'secure-asset': 4, 'maintain-control': 3, 'vanguard-operation': 4, sabotage: 4 };
      const acts = actionOptions(s, u.owner).filter((o) => o.unitId === u.id);
      if (acts.length) {
        const P = s.players[u.owner];
        const already = (a: string) => P.mission.done.some((d) => d.action === a && d.turn === s.turn) || s.pendingActions.some((x) => x.action === a && x.player === u.owner && x.turn === s.turn);
        const pick = acts
          .filter((o) => !(o.action === 'surveil' && already('surveil')))
          .sort((a, b) => Number(b.objId?.startsWith('home') ?? 0) - Number(a.objId?.startsWith('home') ?? 0))[0];
        const best = rank()[0]?.v ?? 0;
        if (pick && (ACTION_VP[pick.action] ?? 3) * 8 >= best) {
          startAction(s, pick);
          return true;
        }
      }
      botExplosives(s, u);
    }
    const ranked = rank();
    if (!busy && ranked.length) botOffensiveStratagem(s, u, 'shoot', ranked.slice(0, 3).map((x) => x.t));
    for (const { t } of ranked) {
      if (!onBoard(t)) continue;
      const r = buildShootPools(s, u.id, t.id, { mode });
      if (r.error || !r.pools.length) continue;
      if (!botAttack(s, 'shoot', u.id, t.id, r.pools)) return true;
      if (!u.selectedToShoot) continue; // split fire: remaining weapons try the next target
      break;
    }
    u.selectedToShoot = true;
    return true;
  }
  return false;
}

export function botShooting(s: GameState) {
  while (botShootOne(s)) { /* one unit at a time */ }
  endPhase(s);
}

// ---------- charge ----------

export function botChargeOne(s: GameState): boolean {
  for (const u of boardUnits(s, s.active)) {
    if (tried(s, u) || chargeEligibility(s, u)) continue;
    markTried(s, u);
    const enemies = boardUnits(s, other(u.owner)).filter((e) => unitDistance(u, e) <= RULES.charge.declareRange);
    if (!enemies.length) continue;
    const brawler = isBrawler(s, u);
    const value = (e: UnitState) => meleeKills(u, e) * perModel(e) - meleeKills(e, u) * perModel(u) * 0.5 + (s.players[u.owner].oathTarget === e.id ? 8 : 0);
    const best = [...enemies].sort((a, b) => value(b) * p2d6(unitDistance(u, b)) - value(a) * p2d6(unitDistance(u, a)))[0];
    const p = p2d6(unitDistance(u, best));
    // shooters only charge weak, close targets; brawlers accept long shots
    if (value(best) <= 0 || p < (brawler ? 0.25 : 0.58)) continue;
    declareCharge(s, u);
    let opts = chargeTargetOptions(s, u);
    if (!opts.length && canDetReroll(s, u, 'charge')) { detReroll(s, u, 'charge'); opts = chargeTargetOptions(s, u); }
    if (!opts.length && brawler && !canUseStratagem(s, u.owner, 'command-reroll', u) && p2d6(unitDistance(u, best)) >= 0.27) {
      rerollCharge(s, u);
      opts = chargeTargetOptions(s, u);
    }
    if (!opts.length) return true;
    const target = [...opts].sort((a, b) => value(b) - value(a))[0];
    if (autoCharge(s, u, [target.id])) { botCrushingImpact(s, u, target.id); return true; }
    // fall back to the nearest legal target
    const near = [...opts].sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
    if (autoCharge(s, u, [near.id])) botCrushingImpact(s, u, near.id);
    return true;
  }
  return false;
}

export function botCharge(s: GameState) {
  while (botChargeOne(s)) { /* one unit at a time */ }
  endPhase(s);
}

// ---------- fight ----------

/** Resolve one fight-phase step for the bot (or both sides when `only` is undefined). */
export function botFightStep(s: GameState, only?: PlayerId): boolean {
  const f = s.fight;
  if (!f) return false;
  if (f.step === 'pileIn' || f.step === 'consolidate') {
    if (only !== undefined && f.stepPlayer !== only) return false;
    for (const u of boardUnits(s, f.stepPlayer)) {
      if (f.step === 'pileIn' && !pileInEligible(s, u)) continue;
      if (f.step === 'consolidate' && !(consolidateEligible(s, u) && consolidateMode(s, u).mode)) continue;
      autoPileMove(s, u, f.step === 'pileIn' ? 'pileIn' : 'consolidate');
    }
    if (f.step === 'pileIn') endPileInStep(s); else endConsolidateStep(s);
    return true;
  }
  const c = fightCandidates(s);
  if (c.player === null) return false;
  if (only !== undefined && c.player !== only) return false;
  // fight with the unit that does the most damage first
  const pick = (x: UnitState) => Math.max(0, ...engagedEnemies(s, x).map((e) => meleeKills(x, e) * perModel(e)));
  const u = [...c.units].sort((a, b) => pick(b) - pick(a))[0];
  unitSelected(s, u, 'fight');
  botUseActs(s, u.owner, ['selectedToFight', 'fightStartButton'], u.id);
  const eng = engagedEnemies(s, u);
  if (eng.length) {
    const scored = eng.map((e) => {
      const r = buildFightPools(s, u.id, e.id);
      const ev = r.pools.reduce((a, p) => a + expectedDamage(s, p, e).models, 0);
      return { e, r, v: shotValue(s, u, e, ev) };
    }).filter((x) => x.r.pools.length).sort((a, b) => b.v - a.v);
    if (scored.length) {
      botOffensiveStratagem(s, u, 'fight', [scored[0].e]);
      const epic = botEpicChallenge(s, u, scored[0].e.id);
      const r = buildFightPools(s, u.id, scored[0].e.id, { epicChallengeModel: epic });
      // the player rolls the saves: the dice tray finishes the fight (marks it fought, offers Counteroffensive)
      if (!botAttack(s, 'fight', u.id, scored[0].e.id, r.pools.length ? r.pools : scored[0].r.pools)) return true;
    }
  }
  markFought(s, unitById(s, u.id));
  openCounteroffensive(s, u.owner);
  return true;
}

// ---------- reactions ----------

/** Fire Overwatch when it is worth the CP, otherwise decline the window. */
export function botWindow(s: GameState) {
  const w = s.window;
  if (!w) return;
  if (w.kind === 'abilityMove') {
    // surge moves (towards the closest enemy) are made; optional reaction moves are declined
    for (const o of w.offers) {
      const u = unitById(s, o.unitId);
      if (o.key || !u.extraMove || !onBoard(u)) continue;
      const foes = boardUnits(s, other(u.owner)).sort((a, b) => unitDistance(u, a) - unitDistance(u, b));
      if (u.extraMove.kind !== 'surge' || !foes.length) continue;
      const near = alive(foes[0]).reduce((a, m) => (dist(m, centre(u)) < dist(a, centre(u)) ? m : a));
      const [paths] = movesTowards(s, u, 'surge', u.extraMove.max - 0.05, near, { count: 1 });
      if (paths) commitMove(s, u, 'surge', paths);
    }
    closeOffers(s);
    return;
  }
  if (w.kind === 'rapidIngress') { botRapidIngress(s, w.player); closeWindow(s); return; }
  if (w.kind === 'smokescreen') { botSmokescreen(s, w.player); closeWindow(s); return; }
  if (w.kind === 'heroicIntervention') { botHeroic(s, w.player); closeWindow(s); return; }
  if (w.kind === 'counteroffensive') { if (!botCounteroffensive(s, w.player)) closeWindow(s); return; }
  if (w.kind === 'fireOverwatch' && s.players[w.player].cp >= 2) {
    let best: { u: UnitState; t: UnitState; v: number } | null = null;
    for (const u of overwatchCandidates(s, w.player)) {
      for (const t of boardUnits(s, other(w.player))) {
        const r = buildShootPools(s, u.id, t.id, { mode: 'snap' });
        if (r.error || !r.pools.length) continue;
        const ev = r.pools.reduce((a, p) => a + expectedDamage(s, p, t).models, 0);
        const v = shotValue(s, u, t, ev);
        if (!best || v > best.v) best = { u, t, v };
      }
    }
    if (best && best.v >= 12) {
      const r = buildShootPools(s, best.u.id, best.t.id, { mode: 'snap' });
      spendStratagem(s, w.player, 'fire-overwatch', best.u);
      if (!botAttack(s, 'overwatch', best.u.id, best.t.id, r.pools)) return; // closing the dice tray closes the window
    }
  }
  closeWindow(s);
}

// ---------- drivers ----------

/** Play the active player's whole phase (or deployment step). */
export function botAct(s: GameState) {
  if (s.window) { botWindow(s); return; }
  switch (s.phase) {
    case 'deploy': botDeploy(s); return;
    case 'scouts': for (const u of scoutUnits(s, s.deployTurn)) u.scoutDone = true; endScouts(s); return;
    case 'command': botCommand(s); return;
    case 'movement': botMovement(s); return;
    case 'shooting': botShooting(s); return;
    case 'charge': botCharge(s); return;
    case 'fight': if (!botFightStep(s)) endPhase(s); return;
    default: return;
  }
}

/** One bot step for a human-vs-bot game: at most one unit acts. Returns true if the bot did something. */
export function botStep(s: GameState, bot: PlayerId): boolean {
  if (s.window) { if (s.window.player === bot) { botWindow(s); return true; } return false; }
  if (s.phase === 'deploy') { if (s.deployTurn !== bot) return false; botDeploy(s); return true; }
  if (s.phase === 'scouts') { if (s.deployTurn !== bot) return false; for (const u of scoutUnits(s, bot)) u.scoutDone = true; endScouts(s); return true; }
  if (s.phase === 'fight') return botFightStep(s, bot);
  if (s.phase === 'gameover' || s.active !== bot) return false;
  const one = s.phase === 'movement' ? botMoveOne : s.phase === 'shooting' ? botShootOne : s.phase === 'charge' ? botChargeOne : null;
  if (one) { if (!one(s)) endPhase(s); return true; }
  botAct(s);
  return true;
}

export function botShouldAct(s: GameState, bot: PlayerId): boolean {
  if (s.attack || s.phase === 'gameover') return false;
  if (s.window) return s.window.player === bot;
  if (s.phase === 'deploy' || s.phase === 'scouts') return s.deployTurn === bot;
  if (s.phase === 'fight' && s.fight) {
    if (s.fight.step !== 'fight') return s.fight.stepPlayer === bot;
    return fightCandidates(s).player === bot;
  }
  return s.active === bot;
}
