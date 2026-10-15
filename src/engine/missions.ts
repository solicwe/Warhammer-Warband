// Chapter Approved 2026-27 primary missions: Force Disposition matchups, objective actions,
// operation markers and the scoring conditions of all 25 primary cards.
import { deploymentById, MISSIONS, primaryById, RULES, toPoly, type ScoringRule } from './config';
import { bodyTouchesPoly, bodyWhollyInPoly, circleTouchesPoly, circleWhollyInPoly, dist, gap, pointInPoly, polyCentroid, ptGap } from './geometry';
import { alive, boardUnits, hasKw, isEngaged, lastRound, log, onBoard, other, pushFx, unitById } from './state';
import type { GameState, ObjectiveState, PlayerId, Pt, TerrainPiece, UnitState } from './types';
import { unitVisibleTo } from './visibility';

const W = RULES.battlefield.width;
const H = RULES.battlefield.height;

export const mulberryPick = (seed: number, n: number) => {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return n ? (((t ^ (t >>> 14)) >>> 0) % n) : 0;
};

// ---------- geometry helpers ----------

const objTerrain = (s: GameState, o: ObjectiveState) => s.terrain.find((t) => t.id === o.terrainId)!;
export const zonePoly = (s: GameState, p: PlayerId) => toPoly(deploymentById(s.deploymentId).zones[s.players[p].role]);
export const territoryPoly = (s: GameState, p: PlayerId) => toPoly(deploymentById(s.deploymentId).territory[s.players[p].role]);

function homerPoint(s: GameState, p: PlayerId): Pt {
  const zone = zonePoly(s, p);
  const centre = polyCentroid(zone);
  const edgeDistance = (q: Pt) => Math.min(q.x, q.y, RULES.battlefield.width - q.x, RULES.battlefield.height - q.y);
  const edge = zone.reduce((best, q) => edgeDistance(q) < edgeDistance(best) ? q : best);
  const length = dist(edge, centre) || 1;
  const inset = Math.min(4, length * 0.35);
  return { x: edge.x + (centre.x - edge.x) * inset / length, y: edge.y + (centre.y - edge.y) * inset / length };
}

/** Is any model of the unit within range of the objective (inside its terrain area or within 3" of the marker)? */
export const unitInRange = (s: GameState, u: UnitState, o: ObjectiveState) => {
  const t = objTerrain(s, o);
  const withinDist = alive(u).some((m) => dist(m, o) <= 3 + (m.r ?? 0.6));
  if (!t?.poly) return withinDist;
  return withinDist || alive(u).some((m) => bodyTouchesPoly(m, 0, t.poly));
};
const unitInTerrain = (u: UnitState, t: TerrainPiece) => alive(u).some((m) => bodyTouchesPoly(m, 0, t.poly));
const isOwnHome = (o: ObjectiveState, p: PlayerId) => o.type === 'home' && o.owner === p;
const isEnemyHome = (o: ObjectiveState, p: PlayerId) => o.type === 'home' && o.owner === other(p);
const objInTerritory = (s: GameState, o: ObjectiveState, p: PlayerId) => pointInPoly(o, territoryPoly(s, p));
const ocOf = (u: UnitState) => (u.battleShocked ? 0 : alive(u).reduce((a, m) => a + (m.profile.OC ?? 0), 0));

/** Does this player control the objective, and does this particular unit contribute? */
const unitControls = (s: GameState, u: UnitState, o: ObjectiveState) => o.controller === u.owner && unitInRange(s, u, o);

// ---------- bookkeeping hooks called by the game ----------

/** Start of the battle: Locate and Deny places five operation markers in terrain areas outside the player's zone. */
export function startOfBattle(s: GameState) {
  // Teleport Homer: keep the marker on its owner's deployment edge, away from the enemy's approach.
  for (const u of s.units.filter((x) => x.abilities.some((a) => a.name.startsWith('Teleport Homer')) && x.status !== 'destroyed')) {
    u.homer = homerPoint(s, u.owner);
  }
  for (const p of [0, 1] as PlayerId[]) {
    if (s.players[p].primaryId !== 'locate-and-deny') continue;
    const zone = zonePoly(s, p);
    const cands = s.terrain.filter((t) => t.kind !== 'objective-area' && !pointInPoly(polyCentroid(t.poly), zone));
    // spread them out: farthest-point selection starting from the one nearest the enemy zone
    const enemyC = polyCentroid(zonePoly(s, other(p)));
    const picked: TerrainPiece[] = [];
    const rest = [...cands].sort((a, b) => dist(polyCentroid(a.poly), enemyC) - dist(polyCentroid(b.poly), enemyC));
    if (rest.length) picked.push(rest.shift()!);
    while (picked.length < 5 && rest.length) {
      rest.sort((a, b) => Math.min(...picked.map((q) => dist(polyCentroid(q.poly), polyCentroid(b.poly)))) - Math.min(...picked.map((q) => dist(polyCentroid(q.poly), polyCentroid(a.poly)))));
      picked.push(rest.shift()!);
    }
    for (const t of picked) addMarker(s, p, 'locate', { terrainId: t.id, at: polyCentroid(t.poly) });
    log(s, `Locate and Deny: ${s.players[p].name} places ${picked.length} operation markers in terrain areas outside the deployment zones`, 'info', p);
  }
}

let markerSeq = 0;
function addMarker(s: GameState, owner: PlayerId, kind: string, o: { objId?: string; terrainId?: string; at: Pt }) {
  markerSeq += 1;
  const n = s.markers.filter((m) => m.owner === owner).length;
  // nudge markers that share a spot so they stay readable
  const off = n % 3 === 0 ? 0 : (n % 3 === 1 ? 0.9 : -0.9);
  s.markers.push({ id: `mk${Date.now().toString(36)}${markerSeq}`, owner, kind, objId: o.objId, terrainId: o.terrainId, x: o.at.x + off, y: o.at.y + 1.2 });
}

/** Start of a player's turn: snapshot positions (for "started the turn within …" conditions) and Punishment's condemned units. */
export function onTurnStart(s: GameState) {
  const snap = { turn: s.turn, inRangeObj: [] as string[], inRangeCentral: [] as string[], inTerrain: {} as Record<string, string[]> };
  for (const u of boardUnits(s)) {
    if (s.objectives.some((o) => unitInRange(s, u, o))) snap.inRangeObj.push(u.id);
    if (s.objectives.some((o) => o.type === 'central' && unitInRange(s, u, o))) snap.inRangeCentral.push(u.id);
    snap.inTerrain[u.id] = s.terrain.filter((t) => t.kind !== 'objective-area' && unitInTerrain(u, t)).map((t) => t.id);
  }
  s.turnStart = snap;
  const p = s.active;
  const P = s.players[p];
  if (P.primaryId === 'punishment') {
    P.mission.condemned = condemnCandidates(s, p).slice(0, 3).map((u) => u.id);
    if (!P.mission.condemned.length) {
      const any = boardUnits(s, other(p))[0];
      if (any) P.mission.condemned = [any.id];
    }
    if (P.mission.condemned.length) log(s, `Punishment: ${P.mission.condemned.map((id) => unitById(s, id).name).join(', ')} condemned until the start of the next turn`, 'info', p);
  }
}

/** Punishment: enemy units on objectives and/or that destroyed our units last turn, most valuable first. */
export function condemnCandidates(s: GameState, p: PlayerId): UnitState[] {
  const killers = new Set(s.destroyedByTurn.filter((d) => d.turn === s.turn - 1 && d.owner === p && d.killerId).map((d) => d.killerId!));
  return boardUnits(s, other(p))
    .filter((u) => killers.has(u.id) || s.objectives.some((o) => unitInRange(s, u, o)))
    .sort((a, b) => b.pts - a.pts);
}

export function setCondemned(s: GameState, p: PlayerId, ids: string[]) {
  s.players[p].mission.condemned = ids.slice(0, 3);
}

/** Record who destroyed a unit (Consecrate, Purge and Secure). */
export function onUnitDestroyed(s: GameState, victim: UnitState, killerId?: string) {
  const rec = s.destroyedByTurn[s.destroyedByTurn.length - 1];
  if (!rec || rec.unitId !== victim.id || !killerId) return;
  const k = s.units.find((u) => u.id === killerId);
  if (!k || k.owner === victim.owner) return;
  rec.killerId = killerId;
  rec.killerNearObj = onBoard(k) && s.objectives.some((o) => unitInRange(s, k, o));
  const P = s.players[k.owner];
  if (P.primaryId === 'consecrate' && !P.mission.consecrationUnits.includes(k.id)) P.mission.consecrationUnits.push(k.id);
}

/** A unit finished a move: pending actions fail; Surveil the Foe removes the opponent's markers near the objective it reached. */
export function onMoveEnd(s: GameState, u: UnitState, kind: string) {
  if (kind !== 'pileIn' && kind !== 'consolidate') {
    const before = s.pendingActions.length;
    s.pendingActions = s.pendingActions.filter((a) => a.unitId !== u.id);
    if (s.pendingActions.length < before) log(s, `${u.name} moved: action failed`, 'info', u.owner);
  }
  if (s.players[u.owner].primaryId === 'surveil-the-foe') {
    for (const o of s.objectives) {
      if (!unitInRange(s, u, o)) continue;
      const t = objTerrain(s, o);
      const gone = s.markers.filter((m) => m.owner !== u.owner && circleTouchesPoly({ x: m.x, y: m.y }, 0.5, t.poly));
      if (gone.length) {
        s.markers = s.markers.filter((m) => !gone.includes(m));
        log(s, `Surveil the Foe: ${u.name} removes ${gone.length} enemy operation markers`, 'info', u.owner);
      }
    }
  }
}

// ---------- objective actions ----------

export interface ActionOption { action: string; name: string; unitId: string; objId?: string; terrainId?: string; targetId?: string; label: string }

/** Why this unit cannot start an action (core rules 16), or null. */
/** Abilities that let units start actions while engaged / after advancing, or shoot after starting one (registered by effects.ts). */
type EligHook = (s: GameState, u: UnitState, what: 'actionWhileEngaged' | 'actionWhileShocked' | 'actionAfterAdvance' | 'actionAfterFallBack' | 'shootAfterAction' | 'actionAfterShooting') => boolean;
let eligHook: EligHook | null = null;
export const setActionEligibilityHook = (fn: EligHook) => { eligHook = fn; };
const may = (s: GameState, u: UnitState, what: Parameters<EligHook>[2]) => !!eligHook?.(s, u, what);

export function actionBlock(s: GameState, u: UnitState): string | null {
  if (!onBoard(u)) return 'Not on the battlefield';
  if (hasKw(u, 'AIRCRAFT') || hasKw(u, 'FORTIFICATION')) return 'AIRCRAFT/FORTIFICATION';
  if (u.battleShocked && !may(s, u, 'actionWhileShocked')) return 'battle-shocked';
  if (!ocOf(u)) return 'OC is 0';
  if (isEngaged(s, u) && !hasKw(u, 'TITANIC') && !may(s, u, 'actionWhileEngaged')) return 'engaged';
  if (u.move === 'advance' && !may(s, u, 'actionAfterAdvance')) return 'Advanced';
  if (u.move === 'fallback' && !may(s, u, 'actionAfterFallBack')) return 'Fell Back';
  if (u.shotTurn === s.turn && !may(s, u, 'actionAfterShooting')) return 'Already shot this phase';
  if (s.pendingActions.some((a) => a.unitId === u.id) || s.players[u.owner].mission.done.some((d) => d.unitId === u.id && d.turn === s.turn)) return 'Already performed an action this turn';
  return null;
}

/** Actions the active player can start right now (their Shooting phase). */
export function actionOptions(s: GameState, p: PlayerId = s.active): ActionOption[] {
  if (s.phase !== 'shooting' || s.active !== p) return [];
  const P = s.players[p];
  const ids = [primaryById(P.primaryId).action, ...P.secActive.map((x) => MISSIONS.secondaries.find((d) => d.id === x)?.action)].filter((x): x is string => !!x && !!MISSIONS.actions[x]);
  return ids.flatMap((id) => actionOptionsFor(s, p, id));
}

function actionOptionsFor(s: GameState, p: PlayerId, id: string): ActionOption[] {
  const P = s.players[p];
  const def = MISSIONS.actions[id];
  if (s.round < def.fromRound) return [];
  const usedThisTurn = s.pendingActions.some((a) => a.player === p && a.action === id && a.turn === s.turn) || P.mission.done.some((d) => d.action === id && d.turn === s.turn);
  if (def.limit === 'oncePerTurn' && usedThisTurn) return [];
  const startedThisPhase = s.pendingActions.filter((a) => a.player === p && a.turn === s.turn);
  const doneThisTurn = P.mission.done.filter((d) => d.turn === s.turn);
  const out: ActionOption[] = [];
  for (const u of boardUnits(s, p)) {
    if (actionBlock(s, u) || u.selectedToShoot) continue;
    const nm = (x: string) => `${def.name}: ${u.name} → ${x}`;
    switch (id) {
      case 'booby-trap': {
        const trapped = new Set(P.mission.trapped.map((t) => t.terrainId));
        const usedAreas = new Set(doneThisTurn.filter((d) => d.terrainId).map((d) => d.terrainId));
        const zone = zonePoly(s, p);
        for (const o of s.objectives) {
          if (isOwnHome(o, p) || !unitInRange(s, u, o)) continue;
          const t = objTerrain(s, o);
          if (!trapped.has(t.id) && !usedAreas.has(t.id)) out.push({ action: id, name: def.name, unitId: u.id, terrainId: t.id, objId: o.id, label: nm(`objective ${objName(s, o)}`) });
        }
        for (const t of s.terrain) {
          if (t.kind === 'objective-area' || t.objectiveId || trapped.has(t.id) || usedAreas.has(t.id)) continue;
          if (pointInPoly(polyCentroid(t.poly), zone) || !unitInTerrain(u, t)) continue;
          out.push({ action: id, name: def.name, unitId: u.id, terrainId: t.id, label: nm('this terrain area') });
        }
        break;
      }
      case 'plunder': {
        const mine = territoryPoly(s, p);
        for (const t of s.terrain) {
          if (t.kind === 'objective-area' || pointInPoly(polyCentroid(t.poly), mine) || !alive(u).some((m) => pointInPoly(m, t.poly))) continue;
          out.push({ action: id, name: def.name, unitId: u.id, terrainId: t.id, label: nm('this terrain area') });
        }
        break;
      }
      case 'cleanse':
      case 'decoy':
      case 'triangulate':
      case 'extract-intelligence':
      case 'secure-asset':
      case 'sabotage': {
        for (const o of s.objectives) {
          if (isOwnHome(o, p) || !unitInRange(s, u, o)) continue;
          if (id === 'decoy' && P.mission.decoyed.includes(o.id)) continue;
          if (id === 'triangulate' && P.mission.triangulated.includes(o.id)) continue;
          if (id === 'extract-intelligence' && s.markers.some((m) => m.owner === p && circleTouchesPoly({ x: m.x, y: m.y }, 0.5, objTerrain(s, o).poly))) continue;
          if ((id === 'decoy' || id === 'extract-intelligence' || id === 'sabotage' || id === 'cleanse') && startedThisPhase.some((a) => a.action === id && a.objId === o.id)) continue;
          out.push({ action: id, name: def.name, unitId: u.id, objId: o.id, label: nm(`objective ${objName(s, o)}`) });
        }
        break;
      }
      case 'sensor-sweep':
      case 'maintain-control': {
        if (id === 'sensor-sweep' && s.markers.length <= 1) break;
        for (const o of s.objectives) {
          if (o.type !== 'central' || !unitInRange(s, u, o)) continue;
          out.push({ action: id, name: def.name, unitId: u.id, objId: o.id, label: nm(`central ${objName(s, o)}`) });
        }
        break;
      }
      case 'surveil': {
        const already = new Set(P.mission.surveilled.filter((x) => x.turn === s.turn).map((x) => x.unitId));
        for (const e of boardUnits(s, other(p))) {
          if (already.has(e.id)) continue;
          if (!alive(u).some((m) => alive(e).some((n) => gap(m, n) <= 18) && unitVisibleTo(s, m, e))) continue;
          out.push({ action: id, name: def.name, unitId: u.id, targetId: e.id, label: nm(e.name) });
        }
        break;
      }
      case 'vanguard-operation': {
        const terr = territoryPoly(s, other(p));
        for (const t of s.terrain) {
          if (t.kind === 'objective-area' || !pointInPoly(polyCentroid(t.poly), terr) || !alive(u).some((m) => pointInPoly(m, t.poly))) continue;
          out.push({ action: id, name: def.name, unitId: u.id, terrainId: t.id, label: nm('terrain area in the enemy deployment zone') });
        }
        break;
      }
    }
  }
  return out;
}

export const objName = (s: GameState, o: ObjectiveState) => `${s.objectives.indexOf(o) + 1} (${o.type === 'home' ? 'home' : o.type})`;

/** Start an action. Immediate ones resolve now; the rest complete at the end of the turn. */
export function startAction(s: GameState, opt: ActionOption) {
  const u = unitById(s, opt.unitId);
  const p = u.owner;
  const P = s.players[p];
  const def = MISSIONS.actions[opt.action];
  if (!may(s, u, 'shootAfterAction')) u.selectedToShoot = true; // cannot shoot (or charge) after starting an action
  u.cantCharge = true;
  // on screen as a card, like a roll: the player sees the action happen
  pushFx(s, { kind: 'roll', owner: p, title: `${def.name} · ${u.name}`, dice: [], result: def.completes === 'immediately' ? 'Action done' : 'Action started · completes at the end of the turn', good: true });
  if (def.completes === 'immediately') {
    P.mission.done.push({ action: opt.action, unitId: u.id, turn: s.turn, objId: opt.objId, terrainId: opt.terrainId });
    if (opt.action === 'booby-trap' && opt.terrainId) {
      P.mission.trapped.push({ terrainId: opt.terrainId, turn: s.turn });
      const t = s.terrain.find((x) => x.id === opt.terrainId)!;
      addMarker(s, p, 'trap', { terrainId: t.id, at: polyCentroid(t.poly) });
      log(s, `${u.name}: Booby Trap — the terrain area is trapped`, 'info', p);
    }
    if (opt.action === 'plunder' && opt.terrainId) {
      P.sec.plundered.push({ terrainId: opt.terrainId, turn: s.turn });
      log(s, `${u.name}: Plunder — the terrain area is plundered`, 'info', p);
    }
    if (opt.action === 'surveil' && opt.targetId) {
      P.mission.surveilled.push({ unitId: opt.targetId, turn: s.turn });
      log(s, `${u.name} surveils ${unitById(s, opt.targetId).name}`, 'info', p);
    }
    return;
  }
  s.pendingActions.push({ player: p, unitId: u.id, action: opt.action, turn: s.turn, objId: opt.objId, terrainId: opt.terrainId });
  log(s, `${u.name} starts the ${def.name} action (completes at the end of the turn if the conditions are met)`, 'info', p);
}

/** End of the active player's turn: complete actions, consecrate objectives. Called before scoring. */
export function onTurnEnd(s: GameState) {
  const p = s.active;
  const P = s.players[p];
  for (const a of s.pendingActions.filter((x) => x.player === p)) {
    const u = s.units.find((x) => x.id === a.unitId);
    const def = MISSIONS.actions[a.action];
    if (!u || !onBoard(u) || u.battleShocked) { log(s, `${def.name}: failed`, 'info', p); continue; }
    const o = a.objId ? s.objectives.find((x) => x.id === a.objId) : undefined;
    let ok = false;
    if (def.completes === 'endOfTurnIfControl') ok = !!o && unitControls(s, u, o);
    if (def.completes === 'endOfTurnIfNoEnemyInArea') {
      const t = s.terrain.find((x) => x.id === a.terrainId);
      ok = !!t && !boardUnits(s, other(p)).some((e) => unitInTerrain(e, t));
    }
    if (!ok) { log(s, `${u.name}'s ${def.name}: failed (objective not controlled / enemies within range)`, 'info', p); continue; }
    P.mission.done.push({ action: a.action, unitId: u.id, turn: s.turn, objId: a.objId, terrainId: a.terrainId });
    if (o && a.action === 'cleanse') P.sec.cleansed.push({ objId: o.id, turn: s.turn });
    if (o && (a.action === 'decoy' || a.action === 'triangulate' || a.action === 'extract-intelligence' || a.action === 'maintain-control')) {
      if (a.action === 'decoy') P.mission.decoyed.push(o.id);
      if (a.action === 'triangulate') P.mission.triangulated.push(o.id);
      addMarker(s, p, a.action, { objId: o.id, at: o });
    }
    if (a.action === 'sensor-sweep') {
      // remove the marker that helps us most: an opponent's for Extract Relic, one of our own surplus for Locate and Deny
      const prefer = P.primaryId === 'extract-relic' ? s.markers.filter((m) => m.owner !== p) : s.markers.filter((m) => m.owner === p);
      const pool = prefer.length ? prefer : s.markers;
      const held = (m: typeof s.markers[number]) => {
        const t = m.terrainId ? s.terrain.find((x) => x.id === m.terrainId) : undefined;
        return t ? boardUnits(s, p).some((x) => unitInTerrain(x, t)) && !boardUnits(s, other(p)).some((x) => unitInTerrain(x, t)) : false;
      };
      const victim = [...pool].sort((a2, b2) => Number(held(a2)) - Number(held(b2)))[0];
      if (victim) { s.markers = s.markers.filter((m) => m !== victim); log(s, `${u.name}: Sensor Sweep removes an operation marker`, 'info', p); }
    } else log(s, `${u.name}: ${def.name} completed`, 'info', p);
  }
  s.pendingActions = s.pendingActions.filter((x) => x.player !== p);
  if (P.primaryId === 'consecrate') {
    for (const id of [...P.mission.consecrationUnits]) {
      const u = s.units.find((x) => x.id === id);
      if (!u || !onBoard(u)) continue;
      const o = s.objectives
        .filter((x) => !isOwnHome(x, p) && !P.mission.consecrated.includes(x.id) && unitInRange(s, u, x))
        .sort((a, b) => Number(isEnemyHome(b, p)) - Number(isEnemyHome(a, p)))[0];
      if (!o) continue;
      P.mission.consecrated.push(o.id);
      P.mission.consecrationUnits = P.mission.consecrationUnits.filter((x) => x !== id);
      addMarker(s, p, 'consecrate', { objId: o.id, at: o });
      log(s, `${u.name} consecrate objective ${objName(s, o)}`, 'info', p);
    }
  }
}

// ---------- scoring conditions ----------

function markerHeld(s: GameState, p: PlayerId, owner: PlayerId): boolean {
  const ms = s.markers.filter((m) => m.owner === owner);
  if (ms.length !== 1) return false;
  const m = ms[0];
  const t = (m.terrainId ? s.terrain.find((x) => x.id === m.terrainId) : undefined) ?? s.terrain.find((x) => pointInPoly(m, x.poly));
  if (!t) return false;
  return boardUnits(s, p).some((u) => unitInTerrain(u, t)) && !boardUnits(s, other(p)).some((u) => unitInTerrain(u, t));
}

function tableQuarters(s: GameState, p: PlayerId): number {
  const c = { x: W / 2, y: H / 2 };
  const quarters = new Set<number>();
  for (const u of boardUnits(s, p)) {
    const ms = alive(u);
    if (ms.some((m) => ptGap(m, c) <= 6)) continue;
    const q = (m: Pt) => (m.x < W / 2 ? 0 : 1) + (m.y < H / 2 ? 0 : 2);
    const q0 = q(ms[0]);
    if (ms.every((m) => q(m) === q0 && (Math.abs(m.x - W / 2) >= m.r) && (Math.abs(m.y - H / 2) >= m.r))) quarters.add(q0);
  }
  return quarters.size;
}

export function evalCondition(s: GameState, p: PlayerId, c: string): number {
  const mine = s.objectives.filter((o) => o.controller === p);
  const theirs = s.objectives.filter((o) => o.controller === other(p));
  const M = s.players[p].mission;
  const killsThisTurn = s.destroyedByTurn.filter((d) => d.turn === s.turn && d.owner === other(p));
  const lossesLastTurn = s.destroyedByTurn.filter((d) => d.turn === s.turn - 1 && d.owner === p).length;
  const snap = s.turnStart && s.turnStart.turn === s.turn ? s.turnStart : null;
  const trappedIds = new Set(M.trapped.map((t) => t.terrainId));
  const doneNow = (a: string) => M.done.filter((d) => d.action === a && d.turn === s.turn);
  switch (c) {
    case 'controlMoreThanOpponent': return mine.length > theirs.length ? 1 : 0;
    case 'perObjectiveControlled': return mine.length;
    case 'perObjectiveControlledExclHome': return mine.filter((o) => !isOwnHome(o, p)).length;
    case 'perNonHomeIfHomeControlled': return mine.some((o) => isOwnHome(o, p)) ? mine.filter((o) => !isOwnHome(o, p)).length : 0;
    case 'controlCentral': return mine.some((o) => o.type === 'central') ? 1 : 0;
    case 'control2Plus': return mine.length >= 2 ? 1 : 0;
    case 'control3Plus': return mine.length >= 3 ? 1 : 0;
    case 'control4Plus': return mine.length >= 4 ? 1 : 0;
    case 'controlAnyExclHome': return mine.some((o) => !isOwnHome(o, p)) ? 1 : 0;
    case 'controlAnyExclHomes': return mine.some((o) => o.type !== 'home') ? 1 : 0;
    case 'controlEnemyHome': return mine.some((o) => isEnemyHome(o, p)) ? 1 : 0;
    case 'controlCentralAndExpansion': return mine.some((o) => o.type === 'central') && mine.some((o) => o.type === 'expansion') ? 1 : 0;
    case 'perControlledInEnemyTerritory': return mine.filter((o) => objInTerritory(s, o, other(p))).length;
    case 'newObjectiveThisTurnExclHome':
    case 'perNewObjectiveThisTurnExclHome': {
      const n = s.objectives.filter((o, i) => o.type !== 'home' && o.controller === p && s.controlAtTurnStart[i] !== p).length;
      return c.startsWith('per') ? n : n ? 1 : 0;
    }
    case 'enemyUnitDestroyedThisTurn': return killsThisTurn.length ? 1 : 0;
    case 'perEnemyDestroyedThisTurn': return killsThisTurn.length;
    case 'moreKillsThanLossesLastTurn': return killsThisTurn.length > lossesLastTurn ? 1 : 0;
    case 'killNearObjective': return killsThisTurn.some((d) => d.killerNearObj || snap?.inRangeObj.includes(d.unitId)) ? 1 : 0;
    case 'killStartedInRangeOfObjective': return killsThisTurn.some((d) => snap?.inRangeObj.includes(d.unitId)) ? 1 : 0;
    case 'killStartedInRangeOfCentral': return killsThisTurn.some((d) => snap?.inRangeCentral.includes(d.unitId)) ? 1 : 0;
    case 'killStartedInTerrain': return killsThisTurn.some((d) => (snap?.inTerrain[d.unitId] ?? []).length > 0) ? 1 : 0;
    case 'killStartedInTrapped': return killsThisTurn.some((d) => (snap?.inTerrain[d.unitId] ?? []).some((t) => trappedIds.has(t))) ? 1 : 0;
    case 'condemnedLeftThisTurn': return s.destroyedByTurn.some((d) => d.turn === s.turn && M.condemned.includes(d.unitId)) ? 1 : 0;
    case 'consecratedCount': return M.consecrated.length;
    case 'enemyHomeConsecrated': return M.consecrated.some((id) => { const o = s.objectives.find((x) => x.id === id); return !!o && isEnemyHome(o, p); }) ? 1 : 0;
    case 'perTrappedThisTurn': return M.trapped.filter((t) => t.turn === s.turn).length;
    case 'perTrappedThisTurnObjective': return M.trapped.filter((t) => t.turn === s.turn && s.terrain.find((x) => x.id === t.terrainId)?.objectiveId).length;
    case 'perDecoyed': return M.decoyed.length;
    case 'perDecoyedInEnemyTerritory': return M.decoyed.filter((id) => { const o = s.objectives.find((x) => x.id === id); return !!o && objInTerritory(s, o, other(p)); }).length;
    case 'decoyed4Plus': return M.decoyed.length >= 4 ? 1 : 0;
    case 'onlyOneOwnMarkerHeld': return markerHeld(s, p, p) ? 1 : 0;
    case 'onlyOneOpponentMarkerHeld': return markerHeld(s, p, other(p)) ? 1 : 0;
    case 'tableQuarters': return tableQuarters(s, p);
    case 'triangulatedCount': return M.triangulated.length;
    case 'surveilledUnprotected': {
      const sv = M.surveilled.filter((x) => x.turn === s.turn).map((x) => s.units.find((u) => u.id === x.unitId)).filter((u): u is UnitState => !!u);
      if (!sv.length) return 0;
      const protectedU = (u: UnitState) => onBoard(u) && s.objectives.some((o) => unitInRange(s, u, o) && s.markers.some((m) => circleTouchesPoly({ x: m.x, y: m.y }, 0.5, objTerrain(s, o).poly)));
      return sv.every(protectedU) ? 0 : 1;
    }
    case 'noOpponentMarkers': return s.markers.some((m) => m.owner === other(p)) ? 0 : 1;
    case 'perExtractThisTurn': return doneNow('extract-intelligence').length;
    case 'ownMarkers3Plus': return s.markers.filter((m) => m.owner === p).length >= 3 ? 1 : 0;
    case 'ownMarkerAtEnemyHome': return s.objectives.some((o) => isEnemyHome(o, p) && s.markers.some((m) => m.owner === p && circleTouchesPoly({ x: m.x, y: m.y }, 0.5, objTerrain(s, o).poly))) ? 1 : 0;
    case 'noEnemyInYourTerritory': { const terr = territoryPoly(s, p); return boardUnits(s, other(p)).some((u) => alive(u).every((m) => bodyWhollyInPoly(m, terr))) ? 0 : 1; }
    case 'securedAssetThisTurn': return doneNow('secure-asset').length ? 1 : 0;
    case 'ownMarkersAtControlledCentral': return s.markers.filter((m) => m.owner === p && mine.some((o) => o.type === 'central' && circleTouchesPoly({ x: m.x, y: m.y }, 0.5, objTerrain(s, o).poly))).length;
    case 'sensorSweepThisTurn': return doneNow('sensor-sweep').length ? 1 : 0;
    case 'vanguardThisTurn': return doneNow('vanguard-operation').length ? 1 : 0;
    case 'perSabotageThisTurn': return doneNow('sabotage').length;
    case 'perSabotageInEnemyTerritory': return doneNow('sabotage').filter((d) => { const o = s.objectives.find((x) => x.id === d.objId); return !!o && objInTerritory(s, o, other(p)); }).length;
    default: return 0;
  }
}

export function ruleActive(r: ScoringRule, round: number, timing: string, last = 5): boolean {
  if (round < r.rounds[0] || round > r.rounds[1]) return false;
  if (timing === 'endOfBattle') return r.when === 'endOfBattle';
  if (r.when === 'endOfAnyTurn') return timing === 'endOfAnyTurn';
  if (round === last && r.round5When) return r.round5When === timing;
  return r.when === timing;
}

/** VP a rule is worth right now (before caps). */
export function ruleValue(s: GameState, p: PlayerId, r: ScoringRule): number {
  const n = evalCondition(s, p, r.condition);
  let vp = 0;
  if (r.tiers) {
    for (const [min, v] of r.tiers) if (n >= min) vp = v;
  } else vp = n * r.vp;
  if (vp && r.bonus) vp += evalCondition(s, p, r.bonus.condition) * r.bonus.vp;
  return vp;
}

export function scorePrimary(s: GameState, timing: 'endOfYourCommandPhase' | 'endOfYourTurn' | 'endOfBattle' | 'endOfAnyTurn', player: PlayerId) {
  const P = s.players[player];
  const prim = primaryById(P.primaryId);
  for (const r of prim.scoring) {
    if (!ruleActive(r, s.round, timing, lastRound(s))) continue;
    let vp = ruleValue(s, player, r);
    if (!vp) continue;
    const roundCap = timing === 'endOfBattle' ? Infinity : MISSIONS.vpCaps.primaryPerRound - P.vpByRound[s.round];
    vp = Math.max(0, Math.min(vp, roundCap, MISSIONS.vpCaps.primaryTotal - P.vp));
    if (!vp) continue;
    P.vp += vp;
    if (timing !== 'endOfBattle') P.vpByRound[s.round] += vp;
    log(s, `${P.name} +${vp} VP (${prim.name}: ${r.text})`, 'vp', player);
  }
}
