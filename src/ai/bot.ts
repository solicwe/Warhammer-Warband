// Rules-legal bot. Used for full-game simulation tests and as the single-player opponent.
// It plays one unit per step so the UI can animate each action.
import { botRituals, ritualsPending } from './botRituals';
import { buildFightPools, buildShootPools, expectedDamage, finishAttack, resolveAll, shootingModes, startAttack } from '../engine/attack';
import { RULES } from '../engine/config';
import { smartPlacement } from './deploy';
import { dist, gap } from '../engine/geometry';
import { detChoices, pickDetChoice } from '../rules-engine/detachments';
import {
  autoCharge, autoPileMove, callWaaagh, discardSecondary, swapSecondary, canIngress, chargeEligibility, chargeTargetOptions, closeWindow, commitMove, consolidateEligible, consolidateMode,
  declareCharge, deployUnit, endConsolidateStep, endPhase, endPileInStep, endScouts, fightCandidates, findPlacement, ingressUnit, markFought,
  openCounteroffensive, overwatchCandidates, pileInEligible, remainStationary, rerollCharge, rollAdvance, rollBattleShock, scoutUnits, scoutsOf,
  sendToReserves, setOathTarget, validateMove, validatePlacement, chooseFixedSecondaries, canDetReroll, detReroll, beginMove, hasDeepStrike, setOathBackup,
  canEmbarkIn, disembarkMode, disembarkUnit, embarkedIn, embarkUnit, hullSpots, validateDisembark, endRedeploy, markRuleName, nextDeployer, startConsolidate } from '../engine/game';
import { applyPick } from '../factions/blessings';
import { botPledge, setPledge } from '../factions/emperorsChildren';
import { botPlague, PLAGUE_IDS } from '../factions/deathGuard';
import { abilityChoices, acceptOffer, botUseActs, closeOffers, pickAbilities, resolvePickUnit, unitSelected } from '../rules-engine/activations';
import { botOff, W } from './botWeights';
import { applyStyle, chooseTurnStyle, lookBudget, styleChosen } from './botLook';
import { roughLos, unitVisibleTo } from '../engine/visibility';
import './botUtility';
import { botAllowChargeStratagem, botDetectionStratagem, botIgnorePenaltiesStratagem, botTauntStratagem, botUnshotStratagem } from './botPlus';
import { botAdvanceChargeStratagem, botAfterShootStratagems, botArrivalDefence, botChargeBonusStratagem, botCommandExtras, botFightEndActs, botIgnoreModsStratagem, botReadyStratagem, botShieldStratagem, botTeleportActs } from './botPlus';
import { botAdvanceActs, botArrivalStratagem, botCharacterStratagem, botFightChoice, botFightStartStratagems, botFightsFirstStratagem, botLooseDisembark, botMobileStratagem, botPileStratagem, botRedeployActs, botShootActs, botShootOnTheMove, botAdvanceStratagem, botAfterShootMove, botConsolidateStratagem, botCommandStratagems, botDoctrineActs, botEndOfMovement, botExtraMove, moveGain } from './botPlus';
import { abilityRule, unitFlags, withRuleCache } from '../rules-engine/effects';
import { alive, boardUnits, canUseStratagem, engagedEnemies, isEngaged, lastRound, log, onBoard, other, pace, spendStratagem, unitById, unitDistance } from '../engine/state';
import { shouldUnleashShadow, unleashShadowInTheWarp } from '../factions/tyranids';
import { actionOptions, startAction } from '../engine/missions';
import { secondaryChance, secondaryDead } from '../engine/secondaries';
import {
  centre, isBrawler, lockValue, maxRange, meleeKills, moveOf, oc, rangedKills, objectiveNeeds, objPoint, onObjective, p2d6, perModel, shotValue as shotWorth, unitValue,
} from './botEval';
import { arrivalStrike, bestArrival, bestFallBack, bestMove, canLeave, ctxFor, movesTowards, planMove, scoreSpot } from './botMove';
import {
  botCounteroffensive, botCrushingImpact, botEpicChallenge, botExplosives, botHeroic, botOffensiveStratagem, botRapidIngress, botSmokescreen, isBot, wantsBravery,
} from './botStrats';
import { answerReaction } from '../rules-engine/stratagems';
import { autoIssueOrders } from '../factions/orders';
import { bestDeathstrikeSpot, canDesignateDeathstrike, canFireDeathstrike, deathstrikeWorth, designateDeathstrikeTarget, fireDeathstrikeWarhead, hasDeathstrikeMissile } from '../factions/deathstrike';
import type { GameState, PlayerId, Pt, UnitState } from '../engine/types';


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
export function botPickFixed(s: GameState, p: PlayerId) {
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
  // a redeploy ability: the bot keeps its deployment (it was placed with the whole board in mind)
  if (s.redeploy?.player === p && !s.units.some((x) => x.owner === p && x.status === 'pending')) { endRedeploy(s); return; }
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
  // the plan for the whole army, said once
  if (!s.log.some((l) => l.player === p && /deploys (open|closed)/.test(l.text))) {
    log(s, `${s.players[p].name} deploys closed: every unit as far out of sight of the enemy as it can be`, 'info', p);
  }
  // deep strikers go to reserves when there is room, the rest deploy towards the most central objective
  if (!(s.deployAllOnField ?? []).includes(p) && hasDeepStrike(s, u) && sendToReserves(s, u.id) === null) return;
  // a vehicle must not be set up where ruin walls box it in for the whole game
  // Infiltrators set up forward, on an objective or in cover near one
  if (u.core.infiltrators) {
    const fwd = smartPlacement(s, u, { how: 'infiltrate' });
    if (fwd && deployUnit(s, u.id, fwd, 'infiltrate').ok) return;
  }
  const pos = smartPlacement(s, u) ?? findPlacement(s, u, 'deploy', undefined, (q) => canLeave(s, u, q)) ?? findPlacement(s, u, 'deploy');
  if (pos && deployUnit(s, u.id, pos).ok) return;
  if (sendToReserves(s, u.id)) {
    // could not place or reserve: last resort, drop the unit
    u.status = 'destroyed';
    log(s, `${u.name} could not be set up and is removed`, 'info', p);
    // the last unit of both armies: this also ends deployment
    nextDeployer(s);
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
  // dead, or very unlikely to score this turn: the slot is better used by a fresh card next turn (and +1CP now)
  const dead = (id: string) => secondaryDead(s, p, id) || (s.round < lastRound(s) && secondaryChance(s, p, id) < 0.2);
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
  if (markRuleName(s, p) && enemies.length) {
    // the enemy our army can hurt most this turn: damage our units in range could do to it, worth more on objectives
    const hurt = (e: UnitState) => {
      let dmg = 0;
      for (const u of mine) {
        const gap = unitDistance(u, e);
        const M = moveOf(u);
        if (isBrawler(s, u)) { if (gap <= M + 9) dmg += Math.min(alive(e).length, meleeKills(u, e)) * perModel(e); }
        else if (gap <= maxRange(u) + M) dmg += Math.min(alive(e).length, rangedKills(u, e)) * perModel(e);
      }
      const onObj = s.objectives.some((o) => onObjective(s, e, o)) ? 1.3 : 1;
      // finishing it this turn is best; a unit we can barely scratch is a waste of the Oath
      return Math.min(dmg, unitValue(e) * 1.2) * onObj + unitValue(e) * 0.05;
    };
    const t = [...enemies].sort((a, b) => hurt(b) - hurt(a))[0];
    setOathTarget(s, p, t.id);
  }
  if (P.armyRules.some((r) => r.name === 'Waaagh!') && !P.waaaghUsed && s.round >= 2) {
    const brawlers = mine.filter((u) => isBrawler(s, u));
    const close = brawlers.filter((u) => enemies.some((e) => unitDistance(u, e) <= 16));
    if (pace(s) >= 3 || close.length >= Math.max(1, brawlers.length / 2)) callWaaagh(s, p);
  }
  if (P.armyRules.some((r) => r.name === 'Shadow in the Warp') && !P.shadowInTheWarpUsed && s.round >= 2) {
    if (shouldUnleashShadow(s, p)) unleashShadowInTheWarp(s, p);
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
  botDoctrineActs(s, p);
  botCommandStratagems(s, p);
  botIgnorePenaltiesStratagem(s, p);
  botCommandExtras(s, p);
  botCharacterStratagem(s, p);
  botRedeployActs(s, p);
  autoIssueOrders(s, p);
  for (const u of mine.filter(hasDeathstrikeMissile)) {
    if (canDesignateDeathstrike(s, u)) {
      const spot = bestDeathstrikeSpot(s, p);
      if (spot) {
        const curWorth = u.dsMarker ? deathstrikeWorth(s, p, u.dsMarker) : 0;
        const newWorth = deathstrikeWorth(s, p, spot);
        if (!u.dsMarker || (curWorth <= 0 && newWorth > 0) || newWorth > curWorth + 25) {
          designateDeathstrikeTarget(s, u, spot);
        }
      }
    }
  }
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
    let ids = [...new Set(order.filter((id) => free.includes(id)))].slice(0, want);
    // one from each group (Code Chivalric: the first Deed and the first Quality left, in the rule's listed order)
    if (c.choice.groups) ids = c.choice.groups.map((g) => free.find((id) => c.choice.options.find((o) => o.id === id)?.group === g && !c.choice.options.find((o) => o.id === id)?.random)).filter((x): x is string => !!x);
    // keep limited-use rules (e.g. 3 doctrines in 5 rounds) for when the armies are close
    if (c.choice.uses === 'limit' && !near && pace(s) < 3) continue;
    // Combat Doctrines (each once per battle): only when it does something this turn — tactical to leave a fight and
    // still shoot / charge, assault to Advance and charge when the enemy is close, devastator to Advance and still shoot
    if (c.rule === 'Combat Doctrines') {
      const pick = engaged && free.includes('tactical') ? 'tactical' : near && free.includes('assault') ? 'assault'
        : s.round >= 2 && free.includes('devastator') ? 'devastator' : pace(s) >= 4 ? free[0] : null;
      if (pick) pickDetChoice(s, p, c.rule, [pick]);
      continue;
    }
    // Ordo Xenos Alien Hunters: Mission Tactics (Furor for melee / engaged, Malleus when close, Purgatus for sniping)
    if (c.rule === 'Ordo Xenos Alien Hunters') {
      const pick = engaged && free.includes('furor') ? 'furor'
        : near && free.includes('malleus') ? 'malleus'
        : pace(s) >= 3 ? free[0] : null;
      if (pick) pickDetChoice(s, p, c.rule, [pick]);
      continue;
    }
    // Imperialis Fleet: Eliminate when enemy is close, Acquire when controlling objectives
    if (c.rule === 'Imperialis Fleet') {
      const pick = near ? 'eliminate' : 'acquire';
      if (free.includes(pick)) pickDetChoice(s, p, c.rule, [pick]);
      continue;
    }
    // Nurgle's Gift / Manifold Maladies: the Plague that hurts this opponent most
    if (free.every((id) => PLAGUE_IDS.includes(id))) { pickDetChoice(s, p, c.rule, [botPlague(s, p)].filter((id) => free.includes(id)).concat(free).slice(0, 1)); continue; }
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

/** Where a passenger unit wants to be: the nearest objective that needs bodies, else the nearest enemy. */
function passengerGoal(s: GameState, p: PlayerId, t: UnitState) {
  const tm = alive(t)[0];
  const foes = boardUnits(s, other(p));
  const near = foes.length ? Math.min(...foes.map((e) => unitDistance(t, e))) : 99;
  const need = objectiveNeeds(s, p).filter((n) => n.need > 0).map((n) => objPoint(s, n.o)).sort((a, b) => dist(a, tm) - dist(b, tm))[0];
  const closest = foes.length ? foes.flatMap(alive).reduce((a, m) => (dist(m, tm) < dist(a, tm) ? m : a)) : undefined;
  return { tm, near, need, goal: need && dist(need, tm) <= 12 ? need : closest ?? need ?? tm };
}

function getOut(s: GameState, u: UnitState, t: UnitState, goal: { x: number; y: number }): boolean {
  const tm = alive(t)[0];
  const base = Math.atan2(goal.y - tm.y, goal.x - tm.x);
  // a compact block on the side facing the goal; wrapping round the hull, or round walls / objective markers / other
  // units in the way, only when that's the only way to fit
  const fits = () => { for (const pos of hullSpots(s, u, tm, base)) if (validateDisembark(s, u, t, pos).ok) return pos; return null; };
  const tryOut = () => { const pos = fits(); if (pos) disembarkUnit(s, u, t, pos); return !!pos; };
  if (tryOut()) return true;
  // no room wholly within 3": models only need to be within it (Aggressive Disembarkation)
  if (isBot(s, u.owner) && botLooseDisembark(s, u, () => !!fits())) return tryOut();
  return false;
}

/** Passengers get out before their transport moves (Tactical Disembark: they can still move and charge)
 *  once the enemy or an objective that needs bodies is within reach of their own move. */
function botDisembark(s: GameState, p: PlayerId): boolean {
  const key = (u: UnitState) => `${s.turn}|${s.phase}|${u.id}:out`;
  for (const u of s.units.filter((x) => x.owner === p && x.status === 'embarked' && x.embarkedIn && !(s.botTried ?? []).includes(key(x)))) {
    const t = unitById(s, u.embarkedIn!);
    if (!onBoard(t) || t.move || disembarkMode(s, t) !== 'tactical') continue;
    s.botTried = [...(s.botTried ?? []), key(u)];
    const { tm, near, need, goal } = passengerGoal(s, p, t);
    // getting out first wastes the transport's move: only when the squad reaches more on foot this turn than by riding
    // (an Assault Ramp lets fighters charge after a Rapid Disembark anyway)
    if (wantsOut(s, u, t, near, need ? dist(need, tm) : undefined) && getOut(s, u, t, goal)) return true;
  }
  return false;
}

/** Getting out before the transport moves (they still move and charge): once the enemy is within a disembark (3"),
 *  a move and a charge, shooters' targets are in range, an objective that needs bodies is a move away, or the battle is
 *  half over (a full transport in round 3 is a wasted squad). */
function wantsOut(s: GameState, u: UnitState, t: UnitState, near: number, need: number | undefined): boolean {
  const M = moveOf(u);
  const fighter = isBrawler(s, u);
  return pace(s) >= 3
    || (fighter && !unitFlags(s, t).assaultDisembark && near <= M + 10)
    || (!fighter && near <= maxRange(u) + 3)
    || (need !== undefined && need <= M + 5);
}

/** After its transport moved: shooters get out (Rapid Disembark) when there is something to shoot or to hold. A
 *  transport that stayed where it was takes nobody anywhere: its passengers get out and go on foot. */
function botRapidDisembark(s: GameState, t: UnitState) {
  if (!t.transport) return;
  const mode = disembarkMode(s, t);
  for (const u of s.units.filter((x) => x.embarkedIn === t.id && x.status === 'embarked')) {
    const { tm, near, need, goal } = passengerGoal(s, t.owner, t);
    if (mode === 'tactical') {
      if (t.move === 'stationary' && (s.round >= 2 || wantsOut(s, u, t, near, need ? dist(need, tm) : undefined))) getOut(s, u, t, goal);
      continue;
    }
    if (mode !== 'rapid') continue;
    const shooter = !isBrawler(s, u) || unitFlags(s, t).assaultDisembark;
    const go = (shooter && near <= Math.min(24, maxRange(u) + 2)) || (need !== undefined && dist(need, tm) <= 6) || pace(s) >= 3;
    if (go) getOut(s, u, t, goal);
  }
}

/** A transport whose best move hardly takes its passengers towards where they want to be (holding back, hiding,
 *  going sideways): they get out first and walk. Returns true if anyone got out (the transport plans again). */
function cargoOffFirst(s: GameState, t: UnitState, plans: { paths?: Map<string, Pt[]> | null }[]): boolean {
  if (s.round < 2 || disembarkMode(s, t) !== 'tactical') return false;
  const cargo = s.units.filter((x) => x.embarkedIn === t.id && x.status === 'embarked');
  if (!cargo.length) return false;
  const { tm, goal } = passengerGoal(s, t.owner, t);
  const progress = Math.max(0, ...plans.map((pl) => {
    const path = pl.paths?.get(tm.id);
    return path?.length ? dist(tm, goal) - dist(path[path.length - 1], goal) : 0;
  }));
  if (progress >= Math.min(...cargo.map(moveOf)) + 1) return false;
  let out = false;
  for (const u of cargo) out = getOut(s, u, t, goal) || out;
  return out;
}

/** Move (or bring in) one unit. Returns false when there is nothing left to do this phase. */
export function botMoveOne(s: GameState): boolean {
  // once per turn, before anything moves: try the turn a few ways on copies of the game and keep the best style
  if (s.phase === 'movement' && !styleChosen(s)) applyStyle(s, s.active, chooseTurnStyle(s, s.active, lookBudget(s, s.active)));
  botUseActs(s, s.active, ['movement']);
  botTeleportActs(s, s.active);
  if (!s.botTried?.includes(`${s.turn}|jump|${s.active}`)) { (s.botTried ??= []).push(`${s.turn}|jump|${s.active}`); botRedeployActs(s, s.active); }
  botDoctrineActs(s, s.active);
  if (botDisembark(s, s.active)) return true;
  for (const u of moveOrder(s, s.active)) {
    if (tried(s, u)) continue;
    if (u.status === 'reserves') {
      if (!canIngress(s, u)) continue;
      markTried(s, u);
      const how = hasDeepStrike(s, u) ? 'deepStrike' : 'ingress';
      botArrivalDefence(s, u);
      if (withRuleCache(() => botArrivalStratagem(s, u, how)) && (u.status as string) === 'board') return true;
      const pos = withRuleCache(() => bestArrival(s, u, how));
      // a deep striker waits in reserve until it can hurt something worth it (or the last round it may arrive) — but a
      // unit that lands on an objective we don't hold scores right away, and a turn in reserve is a turn doing nothing
      if (pos && how === 'deepStrike' && pace(s) < 3 && !u.homer) {
        const strike = withRuleCache(() => arrivalStrike(s, u, pos));
        const valuable = boardUnits(s, other(s.active)).some((e) => unitValue(e) >= 150);
        const grabs = oc(u) > 0 && s.objectives.some((o) => o.controller !== s.active && [...pos.values()].some((q) => Math.hypot(q.x - o.x, q.y - o.y) <= 3.5));
        // a melee unit's damage is next turn's charge (a 9" charge is a long shot), so it doesn't sit in reserve waiting
        const wait = isBrawler(s, u) ? 0 : botOff('dswait') ? (valuable ? 0.3 : 0.2) : (valuable ? 0.18 : 0.1);
        if (!grabs && strike < unitValue(u) * wait) { log(s, `${u.name} waits in reserve for a better target`, 'info', s.active); continue; }
      }
      if (pos && validatePlacement(s, u, pos, how).ok) { ingressUnit(s, u, pos); return true; }
      continue;
    }
    if (!onBoard(u) || u.move) continue;
    markTried(s, u);
    if (hasDeathstrikeMissile(u)) {
      remainStationary(s, u);
      botRapidDisembark(s, u);
      return true;
    }
    const M = moveOf(u);
    if (!M || !Number.isFinite(M)) { remainStationary(s, u); botRapidDisembark(s, u); return true; }
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
      botShootOnTheMove(s, u);
      if (!beginMove(s, u, 'fallback')) return true;
      if (onBoard(u) && validateMove(s, u, 'fallback', back).ok) commitMove(s, u, 'fallback', back);
      else remainStationary(s, u);
      return true;
    }
    botIgnoreModsStratagem(s, u);
    withRuleCache(() => botMobileStratagem(s, u, MM));
    let { normal, advance: adv } = withRuleCache(() => planMove(s, u, MM, ctxFor(s, u)));
    if (u.transport && cargoOffFirst(s, u, [normal, adv ?? {}])) ({ normal, advance: adv } = withRuleCache(() => planMove(s, u, MM, ctxFor(s, u))));
    // advancing: worth it when the extra distance (3.5" on average) reaches somewhere better than a Normal move does
    if (adv && adv.score > normal.score + W(u.owner).advanceMargin) {
      botShootOnTheMove(s, u);
      if (!beginMove(s, u, 'advance')) return true;
      botAdvanceStratagem(s, u);
      botAdvanceActs(s, u);
      rollAdvance(s, u);
      const max = MM + (u.advanceRoll ?? 0) - 0.05;
      const aims = [adv.aim!, ...(normal.aim ? [normal.aim] : [])];
      const plan = onBoard(u) ? withRuleCache(() => bestMove(s, u, 'advance', max, ctxFor(s, u), { aims, noStay: true })) : null;
      if (plan?.paths && validateMove(s, u, 'advance', plan.paths).ok) { commitMove(s, u, 'advance', plan.paths); botRapidDisembark(s, u); }
      else remainStationary(s, u);
      return true;
    }
    if (!normal.paths) { remainStationary(s, u); botRapidDisembark(s, u); return true; }
    if (!beginMove(s, u, 'normal')) return true;
    if (onBoard(u) && validateMove(s, u, 'normal', normal.paths).ok) {
      commitMove(s, u, 'normal', normal.paths);
      botUseActs(s, u.owner, ['endOfNormalMove'], u.id);
      botRapidDisembark(s, u);
    } else remainStationary(s, u);
    return true;
  }
  const endKey = `${s.turn}|${s.phase}|end`;
  if (!(s.botTried ?? []).includes(endKey)) { s.botTried = [...(s.botTried ?? []), endKey]; botEndOfMovement(s, s.active); }
  return false;
}

export function botMovement(s: GameState) {
  while (botMoveOne(s)) { /* one unit at a time */ }
  endPhase(s);
}

// ---------- shooting ----------

const shotValue = (s: GameState, u: UnitState, t: UnitState, ev: number) => shotWorth(s, u, t, ev, unitDistance(u, t));

export function botShootOne(s: GameState): boolean {
  // Thousand Sons: Rituals come first, at the start of the phase
  if (ritualsPending(s, s.active)) { botRituals(s, s.active); return true; }
  const startKey = `${s.turn}|shootStart|${s.active}`;
  if (!(s.botTried ?? []).includes(startKey)) { s.botTried = [...(s.botTried ?? []), startKey]; botDetectionStratagem(s, s.active); }
  const mine = boardUnits(s, s.active);

  // Deathstrike: fire plasma warhead or designate target if available
  for (const u of mine.filter(hasDeathstrikeMissile)) {
    if (canFireDeathstrike(s, u)) {
      const worth = u.dsMarker ? deathstrikeWorth(s, s.active, u.dsMarker) : 0;
      if (worth > 0) {
        fireDeathstrikeWarhead(s, u);
        return true;
      }
    }
    if (canDesignateDeathstrike(s, u)) {
      const spot = bestDeathstrikeSpot(s, s.active);
      if (spot) {
        const curWorth = u.dsMarker ? deathstrikeWorth(s, s.active, u.dsMarker) : 0;
        const newWorth = deathstrikeWorth(s, s.active, spot);
        if (!u.dsMarker || (curWorth <= 0 && newWorth > 0) || newWorth > curWorth + 25) {
          designateDeathstrikeTarget(s, u, spot);
        }
      }
    }
  }

  // Pre-filter: any unit that has no ranged weapons or cannot shoot this phase is marked tried immediately
  for (const u of mine) {
    if (!tried(s, u) && !shootingModes(s, u).length) {
      markTried(s, u);
    }
  }

  // a unit that fired some of its weapons carries on with the rest (split fire), e.g. after the player rolled saves
  const busy = mine.find((u) => tried(s, u) && !u.selectedToShoot && u.weaponsFired.length > 0 && shootingModes(s, u).length > 0);
  const untried = mine.filter((u) => !tried(s, u));
  if (!untried.length && !busy) return false;

  // the unit that loses the most if its best target is gone shoots first (a lascannon on the tank, the bolters on what
  // is left): what its best target is worth over its second best. Flexible units go last and finish things off.
  const foes = boardUnits(s, other(s.active));
  const canSeeFoe = (u: UnitState, e: UnitState) => {
    const uAlive = alive(u), eAlive = alive(e);
    if (!uAlive.length || !eAlive.length) return false;
    const targetModel = eAlive[0];
    if (uAlive.length <= 3) return uAlive.some((m) => roughLos(s, m, targetModel));
    return roughLos(s, uAlive[0], targetModel) || roughLos(s, uAlive[uAlive.length - 1], targetModel) || roughLos(s, uAlive[Math.floor(uAlive.length / 2)], targetModel);
  };
  const regret = (u: UnitState) => {
    const rMax = maxRange(u);
    if (rMax <= 0) return -1;
    const inRange = foes.filter((e) => unitDistance(u, e) <= rMax + 0.5);
    if (!inRange.length) return -1;
    const vals = inRange.filter((e) => canSeeFoe(u, e))
      .map((e) => shotValue(s, u, e, Math.min(alive(e).length, rangedKills(u, e)))).sort((a, b) => b - a);
    return vals.length ? vals[0] - (vals[1] ?? 0) : -1;
  };
  const options = (u: UnitState) => {
    const rMax = maxRange(u);
    if (rMax <= 0) return 0;
    return foes.filter((e) => unitDistance(u, e) <= rMax + 0.5 && canSeeFoe(u, e)).length;
  };
  const order = busy ? [busy] : botOff('order')
    ? untried.map((u) => ({ u, n: options(u) })).sort((a, b) => (a.n || 99) - (b.n || 99)).map((x) => x.u)
    : untried.map((u) => ({ u, r: regret(u) })).sort((a, b) => b.r - a.r).map((x) => x.u);

  for (const u of order) {
    if (!busy && tried(s, u)) continue;
    const modes = shootingModes(s, u);
    if (!modes.length) {
      markTried(s, u);
      continue;
    }
    const mode = modes[0];
    const rank = () => boardUnits(s, other(u.owner)).map((t) => {
      const r = buildShootPools(s, u.id, t.id, { mode });
      if (r.error || !r.pools.length) return null;
      const ev = r.pools.reduce((a, p) => a + expectedDamage(s, p, t).models, 0);
      return { t, v: shotValue(s, u, t, ev) };
    }).filter((x): x is { t: UnitState; v: number } => !!x).sort((a, b) => b.v - a.v);

    const ranked = rank();
    if (!busy) {
      markTried(s, u);
      unitSelected(s, u, 'shoot');
      botShootActs(s, u);
      botUseActs(s, u.owner, ['selectedToShoot', 'shooting'], u.id);
      // a mission action is worth roughly 16 points of damage per VP it brings (a 1000-point game is decided by ~30 VP)
      const ACTION_VP: Record<string, number> = { cleanse: 3, plunder: 5, 'booby-trap': 3, decoy: 4, 'sensor-sweep': 4, triangulate: 5, surveil: 4, 'extract-intelligence': 7, 'secure-asset': 4, 'maintain-control': 3, 'vanguard-operation': 4, sabotage: 4 };
      const acts = actionOptions(s, u.owner).filter((o) => o.unitId === u.id);
      if (acts.length) {
        const P = s.players[u.owner];
        const already = (a: string) => P.mission.done.some((d) => d.action === a && d.turn === s.turn) || s.pendingActions.some((x) => x.action === a && x.player === u.owner && x.turn === s.turn);
        const pick = acts
          .filter((o) => !(o.action === 'surveil' && already('surveil')))
          .sort((a, b) => Number(b.objId?.startsWith('home') ?? 0) - Number(a.objId?.startsWith('home') ?? 0))[0];
        const best = ranked[0]?.v ?? 0;
        if (pick && (ACTION_VP[pick.action] ?? 3) * 16 >= best) {
          startAction(s, pick);
          return true;
        }
      }
      botExplosives(s, u);
    }

    let didShoot = false;
    if (!busy && ranked.length) botOffensiveStratagem(s, u, 'shoot', ranked.slice(0, 3).map((x) => x.t));
    for (const { t } of ranked) {
      if (!onBoard(t)) continue;
      const r = buildShootPools(s, u.id, t.id, { mode });
      if (r.error || !r.pools.length) continue;
      didShoot = true;
      if (!botAttack(s, 'shoot', u.id, t.id, r.pools)) return true;
      if (!u.selectedToShoot) continue; // split fire: remaining weapons try the next target
      break;
    }
    u.selectedToShoot = true;
    if (!s.window && !s.attack) withRuleCache(() => botAfterShootMove(s, u));
    if (!s.window && !s.attack) botAfterShootStratagems(s, u);
    if (!s.window && !s.attack) botUnshotStratagem(s, u);
    if (didShoot || s.attack || s.window) return true;
  }
  return false;
}

export function botShooting(s: GameState) {
  while (botShootOne(s)) { /* one unit at a time */ }
  endPhase(s);
}

// ---------- charge ----------

/** One charge for the active player. `eager` (the player tapped "Charge for me"): any unit with a fair chance goes in. */
export function botChargeOne(s: GameState, eager = false): boolean {
  for (const u of boardUnits(s, s.active)) {
    if (!tried(s, u)) { botAdvanceChargeStratagem(s, u); botAllowChargeStratagem(s, u); }
    if (tried(s, u) || chargeEligibility(s, u)) continue;
    markTried(s, u);
    const enemies = boardUnits(s, other(u.owner)).filter((e) => unitDistance(u, e) <= RULES.charge.declareRange);
    if (!enemies.length) continue;
    const brawler = isBrawler(s, u);
    // a shooting unit stuck in a fight next turn loses its guns (vehicles and monsters keep shooting): that is a cost
    const bigGuns = alive(u).some((m) => m.keywords.includes('VEHICLE') || m.keywords.includes('MONSTER'));
    const gunsLost = brawler || bigGuns || s.round >= lastRound(s) ? 0 : Math.max(0, ...boardUnits(s, other(u.owner)).map((e) => Math.min(alive(e).length, rangedKills(u, e)) * perModel(e))) * 0.6;
    // what the enemy answers with: Fire Overwatch from its best gun in range, a Heroic Intervention from a fighter nearby
    const threat = chargeAnswer(s, u);
    const value = (e: UnitState) => {
      let v = meleeKills(u, e) * perModel(e) - meleeKills(e, u) * perModel(u) * 0.5 + (s.players[u.owner].oathTarget === e.id ? 8 : 0) - gunsLost;
      // a gun line we tie up can't shoot next turn (a cheap unit traded for its shooting)
      v += lockValue(s, e) - threat.overwatch - threat.heroic(e);
      // a melee unit that would charge us next turn anyway: going in first means we strike first
      if (isBrawler(s, e) && unitDistance(u, e) <= moveOf(e) + 12) v += meleeKills(e, u) * perModel(u) * 0.4;
      // an objective they hold: our models on it contest it
      if (s.objectives.some((o) => onObjective(s, e, o))) v += 10;
      return v;
    };
    const best = [...enemies].sort((a, b) => value(b) * p2d6(unitDistance(u, b)) - value(a) * p2d6(unitDistance(u, a)))[0];
    const p = p2d6(unitDistance(u, best));
    // shooters only charge weak, close targets; brawlers accept long shots
    if (value(best) <= (eager ? -4 : 0) || p < (eager ? 0.2 : brawler ? 0.25 : 0.58)) continue;
    botChargeBonusStratagem(s, u, unitDistance(u, best), best);
    declareCharge(s, u);
    let opts = chargeTargetOptions(s, u);
    if (!opts.length && canDetReroll(s, u, 'charge')) { detReroll(s, u, 'charge'); opts = chargeTargetOptions(s, u); }
    if (!opts.length && brawler && !canUseStratagem(s, u.owner, 'command-reroll', u) && p2d6(unitDistance(u, best)) >= 0.27) {
      rerollCharge(s, u);
      opts = chargeTargetOptions(s, u);
    }
    if (!opts.length) return true;
    // Lethal Obsession / Refusal to be Outdone: the unit it must reach comes first
    const must = (u.chargeMust?.turn === s.turn ? opts.find((e) => e.id === u.chargeMust!.id) : undefined) ?? (unitFlags(s, u).chargeMustEngaged ? opts.find((e) => engagedEnemies(s, e).length > 0) : undefined);
    const target = must ?? [...opts].sort((a, b) => value(b) - value(a))[0];
    if (autoCharge(s, u, [target.id])) { botCrushingImpact(s, u, target.id); return true; }
    // fall back to the nearest legal target
    const near = [...opts].sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
    if (autoCharge(s, u, [near.id])) botCrushingImpact(s, u, near.id);
    return true;
  }
  return false;
}

/**
 * Expected points a charging unit loses to the enemy's reactions: Fire Overwatch (the best enemy gun unit that could
 * use it, hitting on 6s) and a Heroic Intervention by an enemy fighter near the target. Each needs the enemy's CP.
 */
function chargeAnswer(s: GameState, u: UnitState): { overwatch: number; heroic: (e: UnitState) => number } {
  const p = other(u.owner);
  if (botOff('answer') || s.players[p].cp < 1) return { overwatch: 0, heroic: () => 0 };
  let ow = 0;
  if (!canUseStratagem(s, p, 'fire-overwatch')) {
    for (const e of boardUnits(s, p)) {
      if (e.battleShocked || isEngaged(s, e) || unitDistance(u, e) > RULES.snapShooting.range) continue;
      // hits on unmodified 6s: about a third of what its guns usually do
      ow = Math.max(ow, Math.min(alive(u).length, rangedKills(e, u) * 0.3) * perModel(u));
    }
  }
  const fighters = boardUnits(s, p).filter((e) => !isEngaged(s, e) && isBrawler(s, e) && !canUseStratagem(s, p, 'heroic-intervention', e));
  return {
    overwatch: ow * 0.7, // it may keep the CP for something else
    heroic: (t) => {
      let worst = 0;
      for (const e of fighters) if (e.id !== t.id && unitDistance(e, t) <= 6) worst = Math.max(worst, Math.min(alive(u).length, meleeKills(e, u)) * perModel(u));
      return worst * 0.4 * 0.6; // it may keep the CP, and it has to make its own charge roll
    },
  };
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
    const startKey = `${s.turn}|fightStart|${f.stepPlayer}`;
    if (f.step === 'pileIn' && isBot(s, f.stepPlayer) && !(s.botTried ?? []).includes(startKey)) {
      s.botTried = [...(s.botTried ?? []), startKey];
      botFightStartStratagems(s, f.stepPlayer);
      botShieldStratagem(s, f.stepPlayer);
      botTauntStratagem(s, f.stepPlayer);
      botUseActs(s, f.stepPlayer, ['fightStartButton']);
    }
    for (const u of boardUnits(s, f.stepPlayer)) {
      if (f.step === 'pileIn' && !pileInEligible(s, u)) continue;
      if (isBot(s, u.owner) && (f.step === 'pileIn' || consolidateEligible(s, u))) botPileStratagem(s, u, f.step === 'pileIn' ? 'pileIn' : 'consolidate');
      if (f.step === 'consolidate' && consolidateEligible(s, u) && isBot(s, u.owner)) botConsolidateStratagem(s, u);
      if (f.step === 'consolidate' && !(consolidateEligible(s, u) && consolidateMode(s, u).mode)) continue;
      autoPileMove(s, u, f.step === 'pileIn' ? 'pileIn' : 'consolidate');
    }
    if (f.step === 'consolidate' && isBot(s, f.stepPlayer)) botFightEndActs(s, f.stepPlayer);
    if (f.step === 'pileIn') endPileInStep(s); else endConsolidateStep(s);
    return true;
  }
  const c = fightCandidates(s);
  if (c.player === null) {
    if (f.step === 'fight') {
      startConsolidate(s);
      return true;
    }
    return false;
  }
  if (only !== undefined && c.player !== only) return false;
  // fight with the unit that does the most damage first
  const pick = (x: UnitState) => Math.max(0, ...engagedEnemies(s, x).map((e) => meleeKills(x, e) * perModel(e)));
  const u = (isBot(s, c.player) ? botFightsFirstStratagem(s, c.player, c.units) : null) ?? [...c.units].sort((a, b) => pick(b) - pick(a))[0];
  unitSelected(s, u, 'fight');
  if (isBot(s, u.owner)) botReadyStratagem(s, u);
  if (isBot(s, u.owner)) botFightChoice(s, u);
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

/** Fire Overwatch when it is worth the CP, otherwise decline the window. Resolves chained bot reaction windows. */
export function botWindow(s: GameState) {
  let loops = 0;
  const p = s.window?.player;
  while (s.window && (s.window.player === p || isBot(s, s.window.player)) && !s.attack && loops++ < 12) {
    const w = s.window;
    if (w.kind === 'blessings') { applyPick(s, w.player, w.picks[0] ?? null, w.extra); continue; }
    if (w.kind === 'pledge') { setPledge(s, w.player, botPledge(s, w.player)); continue; }
    if (w.kind === 'pickUnit') { resolvePickUnit(s, [...w.units].sort((a, b) => unitById(s, b).pts - unitById(s, a).pts)[0]); continue; }
    if (w.kind === 'abilityMove') {
      // reaction moves ("an enemy ended a move near this unit") are taken when there is somewhere better to be
      for (const o of [...w.offers]) {
        const u = unitById(s, o.unitId);
        if (!o.key || !onBoard(u)) continue;
        const mv = Number(/(\d+)"/.exec(o.label)?.[1] ?? moveOf(u));
        if (withRuleCache(() => moveGain(s, u, mv)) > unitValue(u) * 0.05) acceptOffer(s, u.id, o.key);
      }
      // surge moves go towards the closest enemy; other extra moves to the best spot the planner finds
      for (const o of [...w.offers]) {
        const u = unitById(s, o.unitId);
        if (o.key || !u.extraMove || !onBoard(u)) continue;
        if (u.extraMove.kind !== 'surge') { withRuleCache(() => botExtraMove(s, u)); continue; }
        const foes = boardUnits(s, other(u.owner)).sort((a, b) => unitDistance(u, a) - unitDistance(u, b));
        if (u.extraMove.kind !== 'surge' || !foes.length) continue;
        let near: Pt = alive(foes[0]).reduce((a, m) => (dist(m, centre(u)) < dist(a, centre(u)) ? m : a));
        // Purge and Sanctify: the closest objective instead, when it isn't ours yet
        if (unitFlags(s, u).surgeObjective) {
          const o = [...s.objectives].sort((a, b) => dist(a, centre(u)) - dist(b, centre(u)))[0];
          if (o && o.controller !== u.owner) near = { x: o.x, y: o.y };
        }
        const [paths] = movesTowards(s, u, 'surge', u.extraMove.max - 0.05, near, { count: 1 });
        if (paths) commitMove(s, u, 'surge', paths);
      }
      closeOffers(s);
      continue;
    }
    if (w.kind === 'stratReaction') { answerReaction(s, null); continue; } // bots decide their reactions as they happen
    if (w.kind === 'rapidIngress') { botRapidIngress(s, w.player); closeWindow(s); continue; }
    if (w.kind === 'smokescreen') { botSmokescreen(s, w.player); closeWindow(s); continue; }
    if (w.kind === 'heroicIntervention') { botHeroic(s, w.player); closeWindow(s); continue; }
    if (w.kind === 'counteroffensive') { if (!botCounteroffensive(s, w.player)) closeWindow(s); continue; }
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
}

/** Pre-battle Scouts moves: each unit takes the move the planner likes best (forward onto objectives, into cover), or stays. */
export function botScouts(s: GameState, p: PlayerId) {
  for (const u of scoutUnits(s, p)) {
    // a Scout move comes before the first turn: if the enemy shoots first, running out in front of its guns gets the
    // unit killed before it does anything — then only cover and safe spots are worth the move
    const ctx = ctxFor(s, u);
    if (s.firstPlayer !== p && !botOff('scoutSafe')) ctx.risk = (ctx.risk ?? 1) * 1.8;
    const plan = withRuleCache(() => bestMove(s, u, 'scout', scoutsOf(s, u) - 0.05, ctx));
    if (plan.paths && validateMove(s, u, 'scout', plan.paths).ok) commitMove(s, u, 'scout', plan.paths);
    u.scoutDone = true;
  }
  endScouts(s);
}

// ---------- drivers ----------

/** Play the active player's whole phase (or deployment step). */
export function botAct(s: GameState) {
  if (s.window) { botWindow(s); return; }
  switch (s.phase) {
    case 'deploy': botDeploy(s); return;
    case 'scouts': botScouts(s, s.deployTurn); return;
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
  if (s.phase === 'scouts') { if (s.deployTurn !== bot) return false; botScouts(s, bot); return true; }
  if (s.phase === 'fight') {
    if (botFightStep(s, bot)) return true;
    if (s.fight && s.fight.step === 'fight' && !fightCandidates(s).units.length) {
      startConsolidate(s);
      return true;
    }
    return false;
  }
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
