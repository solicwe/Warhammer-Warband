// Rules-legal bot. Used for full-game simulation tests and as the single-player opponent.
// It plays one unit per step so the UI can animate each action.
import { buildFightPools, buildShootPools, expectedDamage, finishAttack, resolveAll, shootingModes, startAttack, woundNeed } from './attack';
import { RULES } from './config';
import { exprAverage } from './dice';
import { circleTouchesPoly, dist, polyCentroid } from './geometry';
import { detChoices, pickDetChoice } from './detachments';
import {
  autoApproach, callWaaagh, canIngress, chargeEligibility, chargeTargetOptions, closeWindow, commitCharge, commitMove, consolidateEligible, consolidateMode,
  declareCharge, deployUnit, endConsolidateStep, endPhase, endPileInStep, endScouts, fightCandidates, findPlacement, ingressUnit, levelOfControl, markFought,
  objectiveTerrain, openCounteroffensive, overwatchCandidates, pileInEligible, remainStationary, rerollCharge, rollAdvance, rollBattleShock, scoutUnits,
  sendToReserves, setOathTarget, validateMove, validatePlacement, chooseFixedSecondaries, settleMove, canDetReroll, detReroll, beginMove, hasDeepStrike, setOathBackup,
} from './game';
import { abilityChoices, botUseActs, closeOffers, pickAbilities, unitSelected } from './activations';
import { abilityRule, unitFlags } from './effects';
import { alive, boardUnits, canUseStratagem, engagedEnemies, isEngaged, log, onBoard, other, spendStratagem, unitById, unitDistance } from './state';
import { isMelee } from './weapons';
import { applyDetachmentStratagem, planStratagem, stratagemBlock } from './stratagems';
import { actionOptions, startAction } from './missions';
import type { GameState, MoveKind, ObjectiveState, PlayerId, Pt, UnitState, WeaponProfileData } from './types';

const stay = (u: UnitState) => new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y }]]));
const centre = (u: UnitState) => polyCentroid(alive(u));

// ---------- evaluation helpers ----------

/** Points value of what is left of a unit. */
const unitValue = (u: UnitState) => (u.pts * alive(u).length) / Math.max(1, u.startingStrength);
const perModel = (u: UnitState) => u.pts / Math.max(1, u.startingStrength);

/** Average models killed by one profile against a target (no modifiers; for planning only). */
function roughKills(p: WeaponProfileData, target: UnitState): number {
  const m = alive(target)[0];
  if (!m) return 0;
  const a = exprAverage(p.A);
  const hit = p.skill === null ? 1 : Math.max(1, 7 - p.skill) / 6;
  const wound = (7 - woundNeed(p.S ?? 3, m.profile.T)) / 6;
  const sv = Math.min(m.profile.Sv - p.AP, m.profile.InSv ?? 7);
  const fail = Math.min(1, Math.max(1 / 6, (sv - 1) / 6));
  const dmg = Math.min(exprAverage(p.D), m.profile.W);
  return (a * hit * wound * fail * dmg) / m.profile.W;
}

function bestProfiles(u: UnitState, melee: boolean): WeaponProfileData[] {
  return alive(u).flatMap((m) => {
    const ps = m.weapons.flatMap((w) => w.profiles).filter((p) => isMelee(p) === melee);
    if (!ps.length) return [];
    if (melee) return [ps.sort((a, b) => exprAverage(b.A) * exprAverage(b.D) - exprAverage(a.A) * exprAverage(a.D))[0]]; // one melee weapon per model
    return ps.filter((p, i) => ps.findIndex((q) => q.name.split(' – ')[0] === p.name.split(' – ')[0]) === i); // one profile per ranged weapon
  });
}

const meleeKills = (u: UnitState, t: UnitState) => bestProfiles(u, true).reduce((a, p) => a + roughKills(p, t), 0);
const rangedKills = (u: UnitState, t: UnitState) => bestProfiles(u, false).reduce((a, p) => a + roughKills(p, t), 0);
const maxRange = (u: UnitState) => Math.max(0, ...bestProfiles(u, false).map((p) => (typeof p.range === 'number' ? p.range : 0)));

/** Does this unit want to be in melee rather than shooting? */
function isBrawler(s: GameState, u: UnitState): boolean {
  const foes = boardUnits(s, other(u.owner));
  if (!foes.length) return false;
  const sample = foes.sort((a, b) => unitValue(b) - unitValue(a)).slice(0, 4);
  const mel = sample.reduce((a, t) => a + meleeKills(u, t) * perModel(t), 0);
  const rng = sample.reduce((a, t) => a + rangedKills(u, t) * perModel(t), 0);
  return mel > rng * 1.15;
}

/** Probability that 2D6 >= n. */
function p2d6(n: number): number {
  const need = Math.ceil(n - 1e-6);
  if (need <= 2) return 1;
  if (need > 12) return 0;
  let c = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= need) c++;
  return c / 36;
}

const onObjective = (s: GameState, u: UnitState, o: ObjectiveState) => {
  const t = objectiveTerrain(s, o);
  return alive(u).some((m) => circleTouchesPoly(m, m.r, t.poly));
};
const objPoint = (s: GameState, o: ObjectiveState) => polyCentroid(objectiveTerrain(s, o).poly);
const oc = (u: UnitState) => (u.battleShocked ? 0 : alive(u).reduce((a, m) => a + (m.profile.OC ?? 0), 0));

/** Has the bot already handled this unit in the current phase? */
function tried(s: GameState, u: UnitState): boolean {
  return (s.botTried ?? []).includes(`${s.turn}|${s.phase}|${u.id}`);
}
function markTried(s: GameState, u: UnitState) {
  const key = `${s.turn}|${s.phase}|${u.id}`;
  s.botTried = [...(s.botTried ?? []).filter((k) => k.startsWith(`${s.turn}|${s.phase}|`)), key];
}

/** Move a unit straight towards a point, stopping `short` inches away; shortens the move until it is legal. */
function stepTowards(s: GameState, u: UnitState, goal: Pt, max: number, kind: MoveKind, short = 0) {
  const c = centre(u);
  const L = dist(c, goal);
  const want = Math.min(max, L - short);
  if (want < 0.5) return false;
  for (let k = want; k > 0.4; k -= 0.75) {
    const d = { x: ((goal.x - c.x) / L) * k, y: ((goal.y - c.y) / L) * k };
    const paths = new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x + d.x, y: m.y + d.y }]]));
    if (validateMove(s, u, kind, paths).ok) { commitMove(s, u, kind, paths); return true; }
  }
  // a straight line is blocked (a wall a vehicle can't cross, enemy models): route each model around it
  const d = { x: ((goal.x - c.x) / L) * want, y: ((goal.y - c.y) / L) * want };
  const draft = new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x + d.x, y: m.y + d.y }]]));
  const routed = settleMove(s, u, kind, draft, { maxFor: () => max });
  const progress = Math.max(0, ...[...routed.values()].map((p) => p.length > 1 ? dist(p[0], goal) - dist(p[p.length - 1], goal) : 0));
  if (progress > 0.5 && validateMove(s, u, kind, routed).ok) { commitMove(s, u, kind, routed); return true; }
  return false;
}

// ---------- stratagems ----------

const ATTACK_BUFFS = ['hit+1', 'wound+1', 'rerollHits', 'rerollHits1', 'rerollWounds', 'rerollWounds1', 'ap+1', 'lethal', 'sustained1', 'devastating', 'ignoresCover'];

/** Before a big attack, spend CP on a detachment stratagem whose whole effect the engine applies (keeps 1 CP for re-rolls). */
function botAttackStratagem(s: GameState, u: UnitState) {
  if (unitValue(u) < 110) return;
  const p = u.owner;
  for (const d of s.players[p].detachments) {
    for (const st of d.stratagems) {
      const plan = planStratagem(st);
      if (!plan.full || plan.target !== 'own' || !plan.effects.every((k) => ATTACK_BUFFS.includes(k))) continue;
      if (s.players[p].cp < st.cp + 1 || stratagemBlock(s, p, st, u)) continue;
      applyDetachmentStratagem(s, p, st, u.id);
      return;
    }
  }
}

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
  const u = s.units.find((x) => x.owner === p && x.status === 'pending');
  if (!u) return;
  // deep strikers go to reserves when there is room, the rest deploy towards the most central objective
  if (hasDeepStrike(s, u) && sendToReserves(s, u.id) === null) return;
  const pos = findPlacement(s, u, 'deploy');
  if (pos && deployUnit(s, u.id, pos).ok) return;
  if (sendToReserves(s, u.id)) {
    // could not place or reserve: last resort, drop the unit
    u.status = 'destroyed';
    const o = other(p);
    if (s.units.some((x) => x.owner === o && x.status === 'pending')) s.deployTurn = o;
  }
}

// ---------- command ----------

export function botCommand(s: GameState) {
  for (const t of s.shockTests) if (t.passed === null) rollBattleShock(s, t.unitId);
  const p = s.active;
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

/** Objectives the bot wants: not held by us with spare OC. */
function objectiveNeeds(s: GameState, p: PlayerId) {
  return s.objectives.map((o) => {
    const [a, b] = levelOfControl(s, o);
    const ours = p === 0 ? a : b, theirs = p === 0 ? b : a;
    return { o, ours, theirs, need: ours <= theirs ? theirs - ours + 1 : 0 };
  });
}

function movementGoal(s: GameState, u: UnitState): { goal: Pt; short: number; advance: boolean } | 'hold' | null {
  const enemies = boardUnits(s, other(u.owner));
  const M = alive(u)[0].profile.M ?? 0;
  const needs = objectiveNeeds(s, u.owner);
  // hold an objective we are on when we are needed there
  for (const n of needs) {
    if (!onObjective(s, u, n.o) || !oc(u)) continue;
    const ours = n.ours - oc(u);
    if (ours <= n.theirs) return 'hold';
  }
  const brawler = isBrawler(s, u);
  if (brawler && enemies.length) {
    const score = (e: UnitState) => (meleeKills(u, e) * perModel(e) + (s.players[u.owner].oathTarget === e.id ? 10 : 0)) / (1 + unitDistance(u, e) / 8);
    const t = [...enemies].sort((a, b) => score(b) - score(a))[0];
    const d = unitDistance(u, t);
    const riled = s.players[u.owner].riledUntilTurn >= s.turn && u.abilities.some((a) => a.name === 'Waaagh!');
    // advancing rules out the charge (unless riled up), so only advance when the charge is out of reach anyway
    const advance = riled ? d > M + 2 : d > M + 9;
    return { goal: centre(t), short: 1.2, advance };
  }
  // shooters: take an objective that needs OC, else find a firing position at ~range-2
  const free = needs.filter((n) => n.need > 0 && oc(u) > 0).sort((a, b) => dist(centre(u), objPoint(s, a.o)) - dist(centre(u), objPoint(s, b.o)));
  const range = maxRange(u);
  const inRange = enemies.filter((e) => unitDistance(u, e) <= range);
  if (free.length && dist(centre(u), objPoint(s, free[0].o)) <= M + 12) {
    // don't walk into a dangerous melee unit for an objective
    const risky = enemies.some((e) => isBrawler(s, e) && dist(objPoint(s, free[0].o), centre(e)) < 9 && unitValue(e) > unitValue(u) * 0.7);
    if (!risky) return { goal: objPoint(s, free[0].o), short: 0, advance: !inRange.length && dist(centre(u), objPoint(s, free[0].o)) > M + 2 };
  }
  if (inRange.length) return 'hold'; // already shooting: stay still (Heavy) and keep any cover
  if (!enemies.length) return null;
  const t = [...enemies].sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
  return { goal: centre(t), short: Math.max(6, range - 2), advance: false };
}

/** Move (or bring in) one unit. Returns false when there is nothing left to do this phase. */
export function botMoveOne(s: GameState): boolean {
  botUseActs(s, s.active, ['movement']);
  for (const u of s.units.filter((x) => x.owner === s.active)) {
    if (tried(s, u)) continue;
    if (u.status === 'reserves') {
      if (!canIngress(s, u)) continue;
      markTried(s, u);
      const how = hasDeepStrike(s, u) ? 'deepStrike' : 'ingress';
      // deep strike near an objective that needs bodies, else the closest enemy
      const needs = objectiveNeeds(s, u.owner).filter((n) => n.need > 0);
      const near = needs.length ? objPoint(s, needs[0].o) : boardUnits(s, other(u.owner))[0] ? centre(boardUnits(s, other(u.owner))[0]) : undefined;
      const pos = findPlacement(s, u, how, near);
      if (pos && validatePlacement(s, u, pos, how).ok) { ingressUnit(s, u, pos); return true; }
      continue;
    }
    if (!onBoard(u) || u.move) continue;
    markTried(s, u);
    const M = alive(u)[0].profile.M ?? 0;
    if (!M || !Number.isFinite(M)) { remainStationary(s, u); return true; }
    if (isEngaged(s, u)) {
      const foes = engagedEnemies(s, u);
      const theirs = foes.reduce((a, e) => a + meleeKills(e, u), 0);
      // brawlers stay in combat; shooters (or units losing badly) fall back
      if (isBrawler(s, u) && meleeKills(u, foes[0]) * perModel(foes[0]) >= theirs * perModel(u) * 0.6) { remainStationary(s, u); return true; }
      const ec = polyCentroid(foes.flatMap(alive));
      const c = centre(u);
      const away = { x: c.x + (c.x - ec.x), y: c.y + (c.y - ec.y) };
      if (!beginMove(s, u, 'fallback')) return true;
      if (!stepTowards(s, u, away, M + unitFlags(s, u).move, 'fallback')) remainStationary(s, u);
      return true;
    }
    const g = movementGoal(s, u);
    if (!g || g === 'hold') { remainStationary(s, u); return true; }
    const MM = M + unitFlags(s, u).move;
    if (g.advance) {
      if (!beginMove(s, u, 'advance')) return true;
      rollAdvance(s, u);
      if (stepTowards(s, u, g.goal, Math.max(0, MM + (u.advanceRoll ?? 0) - 0.1), 'advance', g.short)) return true;
    } else if (!beginMove(s, u, 'normal')) return true;
    if (!stepTowards(s, u, g.goal, Math.max(0, MM - 0.1), 'normal', g.short)) remainStationary(s, u);
    else botUseActs(s, u.owner, ['endOfNormalMove'], u.id);
    return true;
  }
  return false;
}

export function botMovement(s: GameState) {
  while (botMoveOne(s)) { /* one unit at a time */ }
  endPhase(s);
}

// ---------- shooting ----------

function shotValue(s: GameState, u: UnitState, t: UnitState, ev: number): number {
  const left = alive(t).length;
  const kills = Math.min(ev, left);
  let v = kills * perModel(t);
  if (ev >= left * 0.9) v += unitValue(t) * 0.35; // finishing a unit denies its actions and scores
  if (s.players[u.owner].oathTarget === t.id) v *= 1.15;
  if (s.objectives.some((o) => onObjective(s, t, o))) v *= 1.25;
  if (isBrawler(s, t) && unitDistance(u, t) < 14) v *= 1.2; // threatens us next turn
  return v;
}

export function botShootOne(s: GameState): boolean {
  for (const u of boardUnits(s, s.active)) {
    if (tried(s, u)) continue;
    const modes = shootingModes(s, u);
    if (!modes.length) continue;
    markTried(s, u);
    unitSelected(s, u, 'shoot');
    botUseActs(s, u.owner, ['selectedToShoot', 'shooting'], u.id);
    const mode = modes[0];
    const ranked = boardUnits(s, other(u.owner)).map((t) => {
      const r = buildShootPools(s, u.id, t.id, { mode });
      if (r.error || !r.pools.length) return null;
      const ev = r.pools.reduce((a, p) => a + expectedDamage(s, p, t).models, 0);
      return { t, v: shotValue(s, u, t, ev) };
    }).filter((x): x is { t: UnitState; v: number } => !!x).sort((a, b) => b.v - a.v);
    // a mission action is worth roughly 8 points of damage per VP it brings
    const ACTION_VP: Record<string, number> = { cleanse: 3, plunder: 5, 'booby-trap': 3, decoy: 4, 'sensor-sweep': 4, triangulate: 5, surveil: 4, 'extract-intelligence': 7, 'secure-asset': 4, 'maintain-control': 3, 'vanguard-operation': 4, sabotage: 4 };
    const acts = actionOptions(s, u.owner).filter((o) => o.unitId === u.id);
    if (acts.length) {
      const P = s.players[u.owner];
      const already = (a: string) => P.mission.done.some((d) => d.action === a && d.turn === s.turn) || s.pendingActions.some((x) => x.action === a && x.player === u.owner && x.turn === s.turn);
      const pick = acts
        .filter((o) => !(o.action === 'surveil' && already('surveil')))
        .sort((a, b) => Number(b.objId?.startsWith('home') ?? 0) - Number(a.objId?.startsWith('home') ?? 0))[0];
      const best = ranked[0]?.v ?? 0;
      if (pick && (ACTION_VP[pick.action] ?? 3) * 8 >= best) {
        startAction(s, pick);
        return true;
      }
    }
    if (ranked.length) botAttackStratagem(s, u);
    for (const { t } of ranked) {
      if (!onBoard(t)) continue;
      const r = buildShootPools(s, u.id, t.id, { mode });
      if (r.error || !r.pools.length) continue;
      startAttack(s, 'shoot', u.id, t.id, r.pools);
      resolveAll(s);
      finishAttack(s);
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
      log(s, `บอทใช้ Command Re-roll ทอยชาร์จใหม่ (${u.name})`, 'cp', u.owner);
      rerollCharge(s, u);
      opts = chargeTargetOptions(s, u);
    }
    if (!opts.length) return true;
    const target = [...opts].sort((a, b) => value(b) - value(a))[0];
    const paths = new Map([...stay(u), ...autoApproach(s, u, [target], u.chargeRoll ?? 0)]);
    if (validateMove(s, u, 'charge', paths, { targets: [target.id] }).ok) { commitCharge(s, u, paths, [target.id]); return true; }
    // fall back to the nearest legal target
    const near = [...opts].sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
    const p2 = new Map([...stay(u), ...autoApproach(s, u, [near], u.chargeRoll ?? 0)]);
    if (validateMove(s, u, 'charge', p2, { targets: [near.id] }).ok) commitCharge(s, u, p2, [near.id]);
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
      const kind = f.step === 'pileIn' ? 'pileIn' : 'consolidate';
      const cm = kind === 'consolidate' ? consolidateMode(s, u) : null;
      const targets = isEngaged(s, u) ? engagedEnemies(s, u) : cm ? cm.enemies : boardUnits(s, other(u.owner)).filter((e) => unitDistance(u, e) <= RULES.pileIn.targetRange);
      const add = cm?.mode === 'objective' && cm.objective
        ? autoApproach(s, u, [], RULES.consolidate.distance, { objective: polyCentroid(objectiveTerrain(s, cm.objective).poly) })
        : autoApproach(s, u, targets, kind === 'pileIn' ? RULES.pileIn.distance : RULES.consolidate.distance);
      const paths = new Map([...stay(u), ...add]);
      if (validateMove(s, u, kind, paths).ok) commitMove(s, u, kind, paths);
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
      botAttackStratagem(s, u);
      const r = buildFightPools(s, u.id, scored[0].e.id);
      startAttack(s, 'fight', u.id, scored[0].e.id, r.pools.length ? r.pools : scored[0].r.pools);
      resolveAll(s);
      finishAttack(s);
    }
  }
  markFought(s, unitById(s, u.id));
  openCounteroffensive(s, u.owner);
  if (s.window) closeWindow(s);
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
      if (u.extraMove.kind === 'surge' && foes.length) stepTowards(s, u, centre(foes[0]), u.extraMove.max - 0.1, 'surge', 1.6);
    }
    closeOffers(s);
    return;
  }
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
      log(s, `บอทใช้ Fire Overwatch: ${best.u.name} → ${best.t.name}`, 'cp', w.player);
      startAttack(s, 'overwatch', best.u.id, best.t.id, r.pools);
      resolveAll(s);
      finishAttack(s);
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
