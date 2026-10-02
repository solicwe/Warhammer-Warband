// A simple rules-legal bot. Used for full-game simulation tests and for the single-player opponent.
import { buildFightPools, buildShootPools, finishAttack, resolveAll, shootingModes, startAttack } from './attack';
import { RULES } from './config';
import { dist } from './geometry';
import {
  autoApproach, chargeEligibility, chargeTargetOptions, closeWindow, commitCharge, commitMove, consolidateEligible, consolidateMode, declareCharge,
  deployUnit, endConsolidateStep, endPhase, endPileInStep, fightCandidates, findPlacement, ingressUnit, canIngress, markFought, objectiveTerrain,
  openCounteroffensive, pileInEligible, remainStationary, rollBattleShock, sendToReserves, validateMove, validatePlacement,
} from './game';
import { polyCentroid } from './geometry';
import { endScouts, scoutUnits } from './game';
import { alive, boardUnits, engagedEnemies, isEngaged, onBoard, other, unitById, unitDistance } from './state';
import type { GameState, PlayerId, Pt, UnitState } from './types';

const stay = (u: UnitState) => new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y }]]));

function nearestEnemy(s: GameState, u: UnitState): UnitState | undefined {
  return boardUnits(s, other(u.owner)).sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
}

function nearestObjective(s: GameState, u: UnitState): Pt {
  const c = polyCentroid(alive(u));
  const objs = s.objectives.map((o) => polyCentroid(objectiveTerrain(s, o).poly));
  return objs.sort((a, b) => dist(c, a) - dist(c, b))[0];
}

/** Move a unit straight towards a point, shortening the move until it is legal. */
function stepTowards(s: GameState, u: UnitState, goal: Pt, max: number, kind: 'normal' | 'advance' | 'fallback') {
  const c = polyCentroid(alive(u));
  const L = dist(c, goal);
  if (L < 0.5) return false;
  for (let k = Math.min(max, L); k > 0.4; k -= 0.75) {
    const d = { x: ((goal.x - c.x) / L) * k, y: ((goal.y - c.y) / L) * k };
    const paths = new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x + d.x, y: m.y + d.y }]]));
    if (validateMove(s, u, kind, paths).ok) { commitMove(s, u, kind, paths); return true; }
  }
  return false;
}

export function botDeploy(s: GameState) {
  const p = s.deployTurn;
  const u = s.units.find((x) => x.owner === p && x.status === 'pending');
  if (!u) return;
  const pos = findPlacement(s, u, 'deploy');
  if (pos && deployUnit(s, u.id, pos).ok) return;
  if (sendToReserves(s, u.id)) {
    // could not place or reserve: last resort, drop the unit
    u.status = 'destroyed';
    const o = other(p);
    if (s.units.some((x) => x.owner === o && x.status === 'pending')) s.deployTurn = o;
  }
}

export function botCommand(s: GameState) {
  for (const t of s.shockTests) if (t.passed === null) rollBattleShock(s, t.unitId);
  endPhase(s);
}

export function botMovement(s: GameState) {
  for (const u of s.units.filter((x) => x.owner === s.active)) {
    if (u.status === 'reserves') {
      if (!canIngress(s, u)) continue;
      const pos = findPlacement(s, u, u.core.deepStrike ? 'deepStrike' : 'ingress', nearestObjective(s, u));
      if (pos && validatePlacement(s, u, pos, u.core.deepStrike ? 'deepStrike' : 'ingress').ok) ingressUnit(s, u, pos);
      continue;
    }
    if (!onBoard(u) || u.move) continue;
    const M = alive(u)[0].profile.M ?? 0;
    if (!M || !Number.isFinite(M)) { remainStationary(s, u); continue; }
    if (isEngaged(s, u)) {
      const e = engagedEnemies(s, u)[0];
      const c = polyCentroid(alive(u)), ec = polyCentroid(alive(e));
      const away = { x: c.x + (c.x - ec.x), y: c.y + (c.y - ec.y) };
      if (!stepTowards(s, u, away, M, 'fallback')) remainStationary(s, u);
      continue;
    }
    const enemy = nearestEnemy(s, u);
    const goal = enemy && unitDistance(u, enemy) < 24 ? polyCentroid(alive(enemy)) : nearestObjective(s, u);
    if (!stepTowards(s, u, goal, Math.max(0, M - 0.1), 'normal')) remainStationary(s, u);
  }
  endPhase(s);
}

export function botShooting(s: GameState) {
  for (const u of boardUnits(s, s.active)) {
    const modes = shootingModes(s, u);
    if (!modes.length) continue;
    const mode = modes[0];
    const targets = boardUnits(s, other(u.owner)).sort((a, b) => unitDistance(u, a) - unitDistance(u, b));
    for (const t of targets) {
      const r = buildShootPools(s, u.id, t.id, { mode });
      if (r.error || !r.pools.length) continue;
      startAttack(s, 'shoot', u.id, t.id, r.pools);
      resolveAll(s);
      finishAttack(s);
      if (!u.selectedToShoot) continue; // split fire: remaining weapons try the next target
      break;
    }
    u.selectedToShoot = true;
  }
  endPhase(s);
}

export function botCharge(s: GameState) {
  for (const u of boardUnits(s, s.active)) {
    if (chargeEligibility(s, u)) continue;
    const enemy = nearestEnemy(s, u);
    if (!enemy || unitDistance(u, enemy) > 12) continue;
    declareCharge(s, u);
    const opts = chargeTargetOptions(s, u);
    if (!opts.length) continue;
    const target = opts.sort((a, b) => unitDistance(u, a) - unitDistance(u, b))[0];
    const paths = new Map([...stay(u), ...autoApproach(s, u, [target], u.chargeRoll ?? 0)]);
    if (validateMove(s, u, 'charge', paths, { targets: [target.id] }).ok) commitCharge(s, u, paths, [target.id]);
  }
  endPhase(s);
}

/** Resolve the whole fight phase for both sides (used when both players are bots, or the bot's part of it). */
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
  const u = c.units[0];
  const eng = engagedEnemies(s, u);
  if (eng.length) {
    const r = buildFightPools(s, u.id, eng[0].id);
    if (r.pools.length) {
      startAttack(s, 'fight', u.id, eng[0].id, r.pools);
      resolveAll(s);
      finishAttack(s);
    }
  }
  markFought(s, unitById(s, u.id));
  openCounteroffensive(s, u.owner);
  if (s.window) closeWindow(s);
  return true;
}

/** Decline any reaction window that belongs to the bot. */
export function botWindow(s: GameState) {
  if (s.window) closeWindow(s);
}

/** Play the active player's whole turn (or deployment step). Returns when it is no longer this player's action. */
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
