// Battle flow: setup, deployment, the five phases, objectives and mission scoring.
import { buildUnits } from './army';
import { applyMortalWounds, killModel, onTransportDestroyed } from './attack';
import { deploymentById, MISSIONS, primaryById, RULES, secondaryById, toPoly, type ScoringRule } from './config';
import { d6, nextRandom, rollN, rollOff } from './dice';
import { baseDist, circleTouchesPoly, circleWhollyInPoly, coherencyProblems, dist, EPS, pointInPoly, pointSegDist, polyCentroid, segSegDist } from './geometry';
import {
  alive, boardUnits, canUseStratagem, engagedEnemies, hasKw, isEngaged, log, modelEngagedWith, pushFx, onBoard, other, spendStratagem, strength, unitById, unitDistance,
} from './state';
import type { ArmyList, FactionData, GameState, ModelState, MoveKind, ObjectiveState, PlayerId, Pt, Seg, TerrainPiece, TransportInfo, UnitState } from './types';
import { unitVisibleTo } from './visibility';
import { isMelee } from './weapons';

const W = RULES.battlefield.width;
const H = RULES.battlefield.height;

// ---------- setup ----------

function buildTerrain(depId: string): { terrain: TerrainPiece[]; objectives: ObjectiveState[] } {
  const dep = deploymentById(depId);
  const terrain: TerrainPiece[] = [];
  const make = (id: string, kind: string, x: number, y: number, w: number, h: number, mirror: boolean): TerrainPiece => {
    const k = MISSIONS.terrainKinds[kind];
    const tf = (p: Pt): Pt => (mirror ? { x: W - p.x, y: H - p.y } : p);
    const x0 = x - w / 2, y0 = y - h / 2;
    const poly = [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }].map(tf);
    const corners = [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }];
    const walls: Seg[] = k.walls === 'L'
      ? [
          { a: { x: x0, y: y0 }, b: { x: x0 + w * 0.7, y: y0 } },
          { a: { x: x0, y: y0 }, b: { x: x0, y: y0 + h * 0.7 } },
        ].map((s) => ({ a: tf(s.a), b: tf(s.b) }))
      : k.walls === 'box' ? corners.map((c, i) => ({ a: tf(c), b: tf(corners[(i + 1) % 4]) })) : [];
    return { id, kind, label: k.label, category: k.category, height: k.height, poly, walls };
  };
  const objectives: ObjectiveState[] = dep.objectives.map((o, i) => {
    const ot = MISSIONS.objectiveTerrain;
    // rotate home objective ruins so their walls face the owner differently on each side
    const mirror = o.owner === 'defender' || (!o.owner && o.y > H / 2) || (!o.owner && o.y === H / 2 && o.x > W / 2);
    const t = make(`obj-t${i}`, ot.kind, o.x, o.y, ot.w, ot.h, false);
    if (mirror) {
      const c = { x: o.x, y: o.y };
      const rot = (p: Pt) => ({ x: 2 * c.x - p.x, y: 2 * c.y - p.y });
      t.walls = t.walls.map((s) => ({ a: rot(s.a), b: rot(s.b) }));
    }
    t.objectiveId = o.id;
    terrain.push(t);
    return { id: o.id, type: o.type, owner: undefined, x: o.x, y: o.y, terrainId: t.id, controller: null, ownerRole: o.owner } as ObjectiveState & { ownerRole?: string };
  });
  dep.terrain.forEach((t, i) => {
    terrain.push(make(`t${i}`, t.kind, t.x, t.y, t.w, t.h, false));
    if (t.mirror) terrain.push(make(`t${i}m`, t.kind, t.x, t.y, t.w, t.h, true));
  });
  return { terrain, objectives };
}

export interface NewGameOptions {
  lists: [ArmyList, ArmyList];
  factions: [FactionData, FactionData];
  names: [string, string];
  deploymentId: string;
  primaryId: string;
  seed?: number;
  secondaryMode?: 'none' | 'tactical' | 'fixed';
}

export function createGame(o: NewGameOptions): GameState {
  const { terrain, objectives } = buildTerrain(o.deploymentId);
  const s: GameState = {
    version: 2,
    rng: (o.seed ?? Date.now()) >>> 0,
    round: 0,
    turn: -1,
    firstPlayer: 0,
    active: 0,
    phase: 'deploy',
    deployTurn: 0,
    players: [0, 1].map((i) => ({
      name: o.names[i], factionId: o.factions[i].id, factionName: o.factions[i].name,
      cp: RULES.startingCP, vp: 0, vpByRound: [0, 0, 0, 0, 0, 0], role: 'attacker', stratagemsUsed: [], insaneBraveryUsed: false,
      oathTarget: null, oathWoundBonus: false, waaaghUsed: false, riledUntilTurn: -10,
      secMode: o.secondaryMode ?? 'none', secDeck: [], secActive: [], secVp: 0, secByRound: [0, 0, 0, 0, 0, 0], secFixedVp: {}, secSwapUsed: false,
      armyRules: o.factions[i].armyRules,
      detachments: o.factions[i].detachments.filter((d) => o.lists[i].detachments.includes(d.name)),
    })) as unknown as GameState['players'],
    units: [...buildUnits(o.lists[0], o.factions[0], 0), ...buildUnits(o.lists[1], o.factions[1], 1)],
    terrain, objectives,
    deploymentId: o.deploymentId,
    primaryId: o.primaryId,
    attackerPlayer: 0,
    window: null, attack: null, fight: null, shockTests: [],
    destroyedByTurn: [], controlAtTurnStart: [], log: [], winner: null,
  };
  const ro = rollOff(s);
  log(s, `Roll-off เลือก Attacker/Defender: ${o.names[0]} ${ro.a} – ${o.names[1]} ${ro.b} → ${o.names[ro.winner]} เป็น Attacker`, 'roll', null);
  s.attackerPlayer = ro.winner;
  pushFx(s, { kind: 'rolloff', title: 'Roll-off: ใคร Attacker?', a: ro.a, b: ro.b, winner: ro.winner, result: `${o.names[ro.winner]} เป็น Attacker · ${o.names[other(ro.winner)]} (Defender) วางทัพก่อน` });
  s.players[ro.winner].role = 'attacker';
  s.players[other(ro.winner)].role = 'defender';
  for (const ob of s.objectives as (ObjectiveState & { ownerRole?: string })[]) {
    if (ob.ownerRole) ob.owner = ob.ownerRole === 'attacker' ? s.attackerPlayer : other(s.attackerPlayer);
  }
  for (const u of s.units) if (hasKw(u, 'AIRCRAFT')) { u.status = 'reserves'; }
  const CHAPTERS = ['BLACK TEMPLARS', 'BLOOD ANGELS', 'DARK ANGELS', 'DEATHWATCH', 'SPACE WOLVES'];
  for (const p of [0, 1] as PlayerId[]) {
    s.players[p].oathWoundBonus = !CHAPTERS.includes(o.lists[p].subfaction ?? '') && !s.units.some((u) => u.owner === p && u.factionKeywords.some((k) => CHAPTERS.includes(k)));
  }
  s.deployTurn = other(s.attackerPlayer); // Defender deploys first
  for (const p of [0, 1] as PlayerId[]) if (s.players[p].secMode === 'tactical') s.players[p].secDeck = shuffle(s, MISSIONS.secondaries.map((x) => x.id));
  log(s, `Mission: ${primaryById(o.primaryId).name} (Mirrored World) · Deployment: ${deploymentById(o.deploymentId).name}`, 'info', null);
  return s;
}

export const zoneOf = (s: GameState, p: PlayerId) => toPoly(deploymentById(s.deploymentId).zones[s.players[p].role]);
export const territoryOf = (s: GameState, p: PlayerId) => toPoly(deploymentById(s.deploymentId).territory[s.players[p].role]);

// ---------- placement / movement validation ----------

export interface MoveCheck { ok: boolean; errors: string[]; bad: string[] }

const canCrossDense = (m: ModelState) => ['INFANTRY', 'BEASTS', 'SWARM', 'MOBILE'].some((k) => m.keywords.includes(k));
const isMV = (m: ModelState) => m.keywords.includes('MONSTER') || m.keywords.includes('VEHICLE');

function pathLength(path: Pt[]) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += dist(path[i - 1], path[i]);
  return d;
}

function endChecks(s: GameState, u: UnitState, pos: Map<string, Pt>, errors: string[], bad: Set<string>) {
  const models = alive(u);
  const all = s.units.filter((x) => onBoard(x) || x.id === u.id).flatMap((x) => alive(x).map((m) => ({ m, owner: x.owner, unit: x.id })));
  for (const m of models) {
    const p = pos.get(m.id) ?? m;
    if (p.x - m.r < -EPS || p.y - m.r < -EPS || p.x + m.r > W + EPS || p.y + m.r > H + EPS) { errors.push(`${m.name} อยู่นอกขอบสนาม`); bad.add(m.id); }
    for (const o of all) {
      if (o.m.id === m.id) continue;
      const op = o.unit === u.id ? pos.get(o.m.id) ?? o.m : o.m;
      if (dist(p, op) < m.r + o.m.r - 0.02) { errors.push(`${m.name} ทับโมเดลอื่น`); bad.add(m.id); break; }
    }
    for (const t of s.terrain) for (const w of t.walls) if (pointSegDist(p, w) < m.r * 0.5) { errors.push(`${m.name} จบคาอยู่ในกำแพง`); bad.add(m.id); }
    for (const t of s.terrain) {
      if (t.kind === 'container' && pointInPoly(p, t.poly) && !['INFANTRY', 'BEASTS', 'SWARM', 'FLY', 'MONSTER'].some((k) => m.keywords.includes(k))) {
        errors.push(`${m.name} ขึ้นไปจบบนหลังคา container ไม่ได้ (13.06)`); bad.add(m.id);
      }
    }
  }
  if (models.length > 1) {
    const pts = models.map((m) => pos.get(m.id) ?? m);
    const probs = coherencyProblems(pts, RULES.coherency.near, RULES.coherency.max, models.map((m) => m.r));
    if (probs.length) { errors.push(`หลุด coherency (ต้องห่างเพื่อน ≤${RULES.coherency.near}" และทุกตัวอยู่ภายใน ${RULES.coherency.max}")`); probs.forEach((i) => bad.add(models[i].id)); }
  }
}

function engagedAt(s: GameState, u: UnitState, pos: Map<string, Pt>, enemy?: UnitState): UnitState[] {
  const enemies = enemy ? [enemy] : boardUnits(s, other(u.owner)).filter((e) => !hasKw(e, 'AIRCRAFT'));
  return enemies.filter((e) => alive(u).some((m) => {
    const p = pos.get(m.id) ?? m;
    return alive(e).some((n) => dist(p, n) - m.r - n.r <= RULES.engagementRange + 1e-6);
  }));
}

export interface MoveOptions { fly?: boolean; targets?: string[]; maxOverride?: number }

export function maxMoveDistance(s: GameState, u: UnitState, kind: MoveKind, m: ModelState, opt: MoveOptions = {}): number {
  if (opt.maxOverride !== undefined) return opt.maxOverride;
  const M = m.profile.M ?? 0;
  let max = 0;
  if (kind === 'normal' || kind === 'fallback') max = M;
  else if (kind === 'advance') max = M + (u.advanceRoll ?? 0);
  else if (kind === 'charge') max = u.chargeRoll ?? 0;
  else if (kind === 'pileIn') max = RULES.pileIn.distance;
  else if (kind === 'consolidate') max = RULES.consolidate.distance;
  else if (kind === 'scout') max = u.core.scouts ?? 0;
  if (opt.fly && ['normal', 'advance', 'fallback', 'charge'].includes(kind) && !u.core.hover) max -= RULES.flyTakeToSkiesPenalty;
  return Math.max(0, max);
}

export function validateMove(s: GameState, u: UnitState, kind: MoveKind, paths: Map<string, Pt[]>, opt: MoveOptions = {}): MoveCheck {
  const errors: string[] = [];
  const bad = new Set<string>();
  const pos = new Map<string, Pt>();
  for (const [id, path] of paths) pos.set(id, path[path.length - 1]);
  const enemyModels = boardUnits(s, other(u.owner)).filter((e) => !hasKw(e, 'AIRCRAFT')).flatMap(alive);
  const desperate = kind === 'fallback' && u.battleShocked;

  for (const m of alive(u)) {
    const path = paths.get(m.id);
    if (!path || path.length < 2) continue;
    const len = pathLength(path);
    const max = maxMoveDistance(s, u, kind, m, opt);
    if (len > max + 0.02) { errors.push(`${m.name} เดิน ${len.toFixed(1)}" เกินระยะ ${max.toFixed(1)}"`); bad.add(m.id); }
    for (let i = 1; i < path.length; i++) {
      const seg = { a: path[i - 1], b: path[i] };
      const throughEnemies = opt.fly || desperate || (isMV(m) && (kind === 'normal' || kind === 'advance'));
      for (const e of enemyModels) {
        if (throughEnemies && !(isMV(m) && isMV(e) && !opt.fly && !desperate)) continue;
        if (pointSegDist(e, seg) < e.r + m.r - 0.05) { errors.push(`${m.name} เดินทะลุโมเดลศัตรูไม่ได้`); bad.add(m.id); break; }
      }
      if (!opt.fly && !canCrossDense(m)) {
        for (const t of s.terrain) if (t.category === 'dense' && t.height > 2) for (const w of t.walls) if (segSegDist(seg, w) < m.r * 0.6) { errors.push(`${m.name} ผ่าน dense terrain ที่สูงเกิน 2" ไม่ได้ (ต้องเดินอ้อม)`); bad.add(m.id); }
      }
    }
  }
  endChecks(s, u, pos, errors, bad);
  const eng = engagedAt(s, u, pos);
  if (kind === 'scout') {
    const enemiesNear = boardUnits(s, other(u.owner)).some((e) => alive(u).some((m) => { const p = pos.get(m.id) ?? m; return alive(e).some((n) => dist(p, n) - m.r - n.r <= RULES.reserves.enemyDistance); }));
    if (enemiesNear) errors.push(`Scout move ต้องจบห่างศัตรูทุกหน่วยเกิน ${RULES.reserves.enemyDistance}"`);
  }
  if (['normal', 'advance', 'fallback', 'ingress'].includes(kind) && eng.length) { errors.push(`จบการเดินต้องไม่อยู่ใน engagement range (${RULES.engagementRange}") ของศัตรู`); }
  if (kind === 'charge' || kind === 'heroic' as MoveKind) {
    const targets = (opt.targets ?? []).map((id) => unitById(s, id));
    for (const t of targets) if (!eng.includes(t)) errors.push(`ต้องจบ engaged กับเป้า ${t.name}`);
    for (const e of eng) if (!targets.includes(e)) errors.push(`ห้าม engaged กับหน่วยที่ไม่ใช่เป้า (${e.name})`);
    for (const m of alive(u)) {
      const path = paths.get(m.id);
      if (!path || path.length < 2 || pathLength(path) < 0.01) continue;
      const before = Math.min(...targets.flatMap((t) => alive(t).map((n) => baseDist(m, n))));
      const after = Math.min(...targets.flatMap((t) => alive(t).map((n) => dist(path[path.length - 1], n) - m.r - n.r)));
      if (after > before + 1e-6) { errors.push(`${m.name} ต้องจบใกล้เป้ามากขึ้น`); bad.add(m.id); }
    }
  }
  if (kind === 'pileIn' || kind === 'consolidate') {
    const engagedBefore = engagedEnemies(s, u);
    for (const m of alive(u)) {
      const path = paths.get(m.id);
      if (!path || path.length < 2 || pathLength(path) < 0.01) continue;
      if (enemyModels.some((e) => baseDist(m, e) <= 0.05)) { errors.push(`${m.name} ติดฐานศัตรูอยู่ ขยับไม่ได้`); bad.add(m.id); }
      for (const e of engagedBefore) if (modelEngagedWith(m, e)) {
        const p = path[path.length - 1];
        if (!alive(e).some((n) => dist(p, n) - m.r - n.r <= RULES.engagementRange + 1e-6)) { errors.push(`${m.name} ต้องยัง engaged กับ ${e.name}`); bad.add(m.id); }
      }
    }
    if (kind === 'pileIn' && !eng.length) errors.push('หลัง pile-in หน่วยต้อง engaged');
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], bad: [...bad] };
}

export function validatePlacement(s: GameState, u: UnitState, pos: Map<string, Pt>, how: 'deploy' | 'ingress' | 'deepStrike' | 'infiltrate'): MoveCheck {
  const errors: string[] = [];
  const bad = new Set<string>();
  endChecks(s, u, pos, errors, bad);
  const enemies = boardUnits(s, other(u.owner));
  const enemyZone = zoneOf(s, other(u.owner));
  for (const m of alive(u)) {
    const p = pos.get(m.id) ?? m;
    if (how === 'deploy' && !circleWhollyInPoly(p, m.r, zoneOf(s, u.owner))) { errors.push('ต้องวางให้อยู่ใน deployment zone ทั้งตัว'); bad.add(m.id); }
    if (how !== 'deploy') {
      if (enemies.some((e) => alive(e).some((n) => dist(p, n) - m.r - n.r <= RULES.reserves.enemyDistance))) { errors.push(`ต้องห่างศัตรูทุกหน่วยเกิน ${RULES.reserves.enemyDistance}"`); bad.add(m.id); }
    }
    if (how === 'infiltrate' && circleTouchesPoly(p, m.r + RULES.reserves.enemyDistance, enemyZone)) { errors.push(`Infiltrators ต้องห่าง deployment zone ศัตรูเกิน ${RULES.reserves.enemyDistance}"`); bad.add(m.id); }
    if (how === 'ingress') {
      const edge = Math.min(p.x + m.r, p.y + m.r, W - p.x + m.r, H - p.y + m.r);
      if (Math.min(p.x, p.y, W - p.x, H - p.y) + m.r > RULES.reserves.edgeDistance + EPS || edge < 0) { errors.push(`Ingress ต้องวางภายใน ${RULES.reserves.edgeDistance}" จากขอบสนาม`); bad.add(m.id); }
      if (s.round < RULES.reserves.noEnemyZoneBeforeRound && circleTouchesPoly(p, m.r, enemyZone)) { errors.push('ก่อน battle round 3 ห้ามวางใน deployment zone ศัตรู'); bad.add(m.id); }
    }
  }
  if (engagedAt(s, u, pos).length) errors.push('ต้องวางแบบไม่ engaged');
  return { ok: !errors.length, errors: [...new Set(errors)], bad: [...bad] };
}

/** Formation helper: lay out a unit around a point in rows with 0.5" gaps. */
export function formationAt(u: UnitState, c: Pt, facingUp = true): Map<string, Pt> {
  const ms = alive(u);
  const maxR = Math.max(...ms.map((m) => m.r));
  const step = maxR * 2 + (ms.length > 12 ? 0.3 : 0.6);
  const perRow = Math.max(1, Math.ceil(Math.sqrt(ms.length)));
  const rows = Math.ceil(ms.length / perRow);
  const slots: Pt[] = ms.map((_, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const inRow = Math.min(perRow, ms.length - row * perRow);
    return { x: c.x + (col - (inRow - 1) / 2) * step, y: c.y + (row - (rows - 1) / 2) * step * (facingUp ? 1 : -1) };
  });
  // characters and big models take the central slots so casualties don't strand them
  const slotOrder = slots.map((p, i) => i).sort((a, b) => dist(slots[a], c) - dist(slots[b], c));
  const modelOrder = [...ms].sort((a, b) => Number(b.isCharacter) - Number(a.isCharacter) || b.profile.W - a.profile.W);
  const out = new Map<string, Pt>();
  modelOrder.forEach((m, i) => out.set(m.id, slots[slotOrder[i]]));
  return out;
}

export function placeUnit(s: GameState, u: UnitState, pos: Map<string, Pt>) {
  for (const m of alive(u)) { const p = pos.get(m.id)!; m.x = p.x; m.y = p.y; }
  u.status = 'board';
  u.setUpTurn = s.turn;
}

export function reservesPoints(s: GameState, p: PlayerId) {
  return s.units.filter((u) => u.owner === p && u.status === 'reserves' && !hasKw(u, 'AIRCRAFT')).reduce((a, u) => a + u.pts, 0);
}
export function armyPoints(s: GameState, p: PlayerId) {
  return s.units.filter((u) => u.owner === p).reduce((a, u) => a + u.pts, 0);
}

export function deployUnit(s: GameState, unitId: string, pos: Map<string, Pt>, how: 'deploy' | 'infiltrate' = 'deploy'): MoveCheck {
  const u = unitById(s, unitId);
  const chk = validatePlacement(s, u, pos, how);
  if (!chk.ok) return chk;
  placeUnit(s, u, pos);
  log(s, `วาง ${u.name}`, 'info', u.owner);
  nextDeployer(s);
  return chk;
}

export function sendToReserves(s: GameState, unitId: string): string | null {
  const u = unitById(s, unitId);
  if (reservesPoints(s, u.owner) + u.pts > armyPoints(s, u.owner) * RULES.reserves.maxPointsFraction) return `Strategic reserves รวมได้ไม่เกิน ${RULES.reserves.maxPointsFraction * 100}% ของแต้ม`;
  u.status = 'reserves';
  log(s, `${u.name} อยู่ใน Strategic Reserves${u.core.deepStrike ? ' (Deep Strike)' : ''}`, 'info', u.owner);
  nextDeployer(s);
  return null;
}

function nextDeployer(s: GameState) {
  const pending = (p: PlayerId) => s.units.some((u) => u.owner === p && u.status === 'pending');
  const o = other(s.deployTurn);
  if (pending(o)) s.deployTurn = o;
  else if (!pending(s.deployTurn)) finishDeployment(s);
}

function finishDeployment(s: GameState) {
  const ro = rollOff(s);
  s.firstPlayer = ro.winner;
  pushFx(s, { kind: 'rolloff', title: 'Roll-off: ใครเล่นก่อน?', a: ro.a, b: ro.b, winner: ro.winner, result: `${s.players[ro.winner].name} ได้เล่นก่อน` });
  log(s, `Roll-off เลือกคนเล่นก่อน: ${s.players[0].name} ${ro.a} – ${s.players[1].name} ${ro.b} → ${s.players[ro.winner].name} เล่นก่อน`, 'roll', null);
  s.round = 1;
  s.turn = -1;
  if (s.units.some((u) => u.status === 'board' && u.core.scouts)) {
    s.phase = 'scouts';
    s.deployTurn = ro.winner;
    log(s, 'Pre-battle: Scouts move (เริ่มจากคนที่ได้เล่นก่อน)', 'info', null);
    return;
  }
  startTurn(s, ro.winner);
}

export const scoutUnits = (s: GameState, p: PlayerId) => s.units.filter((u) => u.owner === p && u.status === 'board' && u.core.scouts && !u.scoutDone);

export function endScouts(s: GameState) {
  if (s.deployTurn === s.firstPlayer) { s.deployTurn = other(s.firstPlayer); if (scoutUnits(s, s.deployTurn).length) return; }
  startTurn(s, s.firstPlayer);
}

// ---------- turn structure ----------

function resetTurnFlags(s: GameState) {
  for (const u of s.units) {
    u.move = null; u.advanceRoll = null; u.maxMoved = 0; u.selectedToShoot = false; u.declaredCharge = false;
    u.chargeRoll = null; u.chargeTargets = []; u.fought = false; u.weaponsFired = []; u.cantCharge = false;
    u.buffs = u.buffs.filter((b) => b.until === 'battle');
  }
}

export function startTurn(s: GameState, p: PlayerId) {
  s.turn += 1;
  s.active = p;
  resetTurnFlags(s);
  s.controlAtTurnStart = s.objectives.map((o) => o.controller);
  log(s, `━━ Battle Round ${s.round} · เทิร์นของ ${s.players[p].name} ━━`, 'info', p);
  startCommand(s);
}

function startCommand(s: GameState) {
  s.phase = 'command';
  for (const p of [0, 1] as PlayerId[]) s.players[p].cp += RULES.cpPerCommandPhase;
  log(s, `+${RULES.cpPerCommandPhase} CP ทั้งสองฝ่าย (${s.players[0].cp} / ${s.players[1].cp})`, 'cp', null);
  drawSecondaries(s, s.active, 2);
  s.shockTests = s.units
    .filter((u) => u.owner === s.active && u.status !== 'destroyed' && u.status !== 'pending' && alive(u).length)
    .filter((u) => u.battleShocked || strength(u) === 'half' || strength(u) === 'belowHalf')
    .map((u) => ({ unitId: u.id, result: null, passed: null }));
}

export function bestLd(u: UnitState) {
  return Math.min(...alive(u).map((m) => m.profile.Ld));
}

export function rollBattleShock(s: GameState, unitId: string, insaneBravery = false) {
  const t = s.shockTests.find((x) => x.unitId === unitId)!;
  const u = unitById(s, unitId);
  if (insaneBravery) {
    spendStratagem(s, u.owner, 'insane-bravery', u);
    t.result = 0; t.passed = true; t.auto = true;
  } else {
    const r = rollN(s, 2);
    t.result = r[0] + r[1];
    t.passed = t.result >= bestLd(u);
    pushFx(s, { kind: 'roll', owner: u.owner, title: `Battle-shock · ${u.name}`, dice: r, result: `${t.result} vs Ld ${bestLd(u)}+ → ${t.passed ? 'ผ่าน' : 'ไม่ผ่าน!'}`, good: t.passed });
    log(s, `Battle-shock ${u.name}: 2D6 [${r.join('+')}] = ${t.result} vs Ld ${bestLd(u)}+ → ${t.passed ? 'ผ่าน' : 'ไม่ผ่าน ⚠'}`, 'roll', u.owner);
  }
  const was = u.battleShocked;
  u.battleShocked = !t.passed;
  if (was && t.passed) log(s, `${u.name} หายจาก battle-shocked`, 'info', u.owner);
}

export function endPhase(s: GameState) {
  updateControl(s);
  if (s.phase === 'command') {
    scoreTiming(s, 'endOfYourCommandPhase');
    s.phase = 'movement';
  } else if (s.phase === 'movement') {
    for (const u of boardUnits(s, s.active)) if (!u.move) u.move = 'stationary';
    s.phase = 'shooting';
    openWindow(s, 'endOfMovement');
    if (!s.window) openWindow(s, 'startOfShooting');
  } else if (s.phase === 'shooting') {
    s.phase = 'charge';
  } else if (s.phase === 'charge') {
    s.phase = 'fight';
    startFight(s);
    openWindow(s, 'endOfCharge');
  } else if (s.phase === 'fight') {
    s.fight = null;
    endTurn(s);
  }
  s.units.forEach((u) => { u.buffs = u.buffs.filter((b) => b.until !== 'phase'); u.weaponsFired = []; });
}

function endTurn(s: GameState) {
  // Regaining coherency (03.03)
  for (const u of boardUnits(s)) {
    let models = alive(u);
    let probs = coherencyProblems(models, RULES.coherency.near, RULES.coherency.max, models.map((m) => m.r));
    while (probs.length && models.length > 1) {
      const c = polyCentroid(models);
      // controlling player's choice: drop ordinary, low-wound models first, furthest from the group
      const worst = probs.map((i) => models[i]).sort((a, b) => Number(a.isCharacter) - Number(b.isCharacter) || a.profile.W - b.profile.W || dist(b, c) - dist(a, c))[0];
      killModel(s, u, worst);
      log(s, `${u.name}: ${worst.name} ถูกนำออกเพราะหลุด coherency`, 'info', u.owner);
      models = alive(u);
      probs = coherencyProblems(models, RULES.coherency.near, RULES.coherency.max, models.map((m) => m.r));
    }
  }
  // Aircraft return to reserves at the end of the opponent's turn
  for (const u of boardUnits(s, other(s.active))) if (hasKw(u, 'AIRCRAFT')) u.status = 'reserves';
  updateControl(s);
  scoreTiming(s, 'endOfYourTurn');
  const second = s.active !== s.firstPlayer;
  if (!second) { s.phase = 'command'; startTurn(s, other(s.active)); return; }
  // end of battle round
  if (s.round === RULES.reserves.destroyedAfterRound) {
    for (const u of s.units) if (u.status === 'reserves' && !hasKw(u, 'AIRCRAFT')) {
      u.status = 'destroyed';
      log(s, `${u.name} ไม่ได้ลงสนามจากกองหนุนภายใน round ${s.round} → ถูกทำลาย`, 'kill', u.owner);
    }
  }
  if (s.round >= RULES.battleRounds) { endBattle(s); return; }
  s.round += 1;
  startTurn(s, s.firstPlayer);
}

function endBattle(s: GameState) {
  for (const p of [s.firstPlayer, other(s.firstPlayer)] as PlayerId[]) scoreTiming(s, 'endOfBattle', p);
  s.phase = 'gameover';
  const [a, b] = [s.players[0].vp + s.players[0].secVp, s.players[1].vp + s.players[1].secVp];
  s.winner = a === b ? 'draw' : a > b ? 0 : 1;
  log(s, `🏁 จบเกม: ${s.players[0].name} ${a} VP – ${s.players[1].name} ${b} VP → ${s.winner === 'draw' ? 'เสมอ' : s.players[s.winner].name + ' ชนะ!'}`, 'vp', null);
}

// ---------- movement phase actions ----------

export function rollAdvance(s: GameState, u: UnitState) {
  u.advanceRoll = d6(s);
  pushFx(s, { kind: 'roll', owner: u.owner, title: `Advance · ${u.name}`, dice: [u.advanceRoll], result: `M + ${u.advanceRoll}"`, good: u.advanceRoll >= 4 });
  log(s, `${u.name} Advance: ทอยได้ ${u.advanceRoll}`, 'roll', u.owner);
}

export function commitMove(s: GameState, u: UnitState, kind: MoveKind, paths: Map<string, Pt[]>) {
  let maxMoved = 0;
  for (const m of alive(u)) {
    const path = paths.get(m.id);
    if (!path || path.length < 2) continue;
    maxMoved = Math.max(maxMoved, pathLength(path));
    const end = path[path.length - 1];
    m.x = end.x; m.y = end.y;
  }
  if (['normal', 'advance', 'fallback', 'stationary', 'ingress'].includes(kind)) u.move = kind;
  if (kind === 'scout') u.scoutDone = true;
  u.maxMoved = Math.max(u.maxMoved, maxMoved);
  if (kind === 'fallback' && u.battleShocked) {
    // Desperate Escape: hazard roll per model, made before moving (resolved here for simplicity)
    const rolls = rollN(s, alive(u).length);
    const fails = rolls.filter((r) => r <= RULES.hazard.failOn).length;
    log(s, `Desperate Escape ${u.name}: hazard [${rolls.join(' ')}]`, 'roll', u.owner);
    if (fails) applyMortalWounds(s, u, fails * (alive(u).every(isMV) ? RULES.hazard.mortalWoundsMonsterVehicle : RULES.hazard.mortalWounds), 'Desperate Escape');
  }
  const moved = alive(u).filter((m) => (paths.get(m.id)?.length ?? 0) > 1 && pathLength(paths.get(m.id)!) > 0.01);
  if (moved.length) pushFx(s, { kind: 'move', unitId: u.id, owner: u.owner, moveKind: kind, paths: moved.map((m) => [m.id, paths.get(m.id)!.map((q) => ({ x: q.x, y: q.y }))]) });
  const label: Record<string, string> = { scout: 'Scout move', normal: 'Normal move', advance: 'Advance', fallback: 'Fall back', charge: 'Charge move', pileIn: 'Pile-in', consolidate: 'Consolidate', ingress: 'Ingress' };
  if (label[kind]) log(s, `${u.name}: ${label[kind]}${maxMoved ? ` (${maxMoved.toFixed(1)}")` : ''}`, 'info', u.owner);
}

export function remainStationary(s: GameState, u: UnitState) {
  u.move = 'stationary';
  log(s, `${u.name}: Remain stationary`, 'info', u.owner);
}

export function ingressUnit(s: GameState, u: UnitState, pos: Map<string, Pt>): MoveCheck {
  const how = u.core.deepStrike ? 'deepStrike' : 'ingress';
  const chk = validatePlacement(s, u, pos, how);
  if (!chk.ok) return chk;
  placeUnit(s, u, pos);
  pushFx(s, { kind: 'place', unitId: u.id, owner: u.owner });
  u.move = 'ingress';
  log(s, `${u.name} ลงสนาม (${how === 'deepStrike' ? 'Deep Strike' : 'Ingress'})`, 'info', u.owner);
  return chk;
}

export const canIngress = (s: GameState, u: UnitState) => u.status === 'reserves' && s.round >= RULES.reserves.firstRound && !u.move;

// ---------- charge phase ----------

// ---------- army rules: Oath of Moment / Waaagh! ----------

export const hasArmyRule = (s: GameState, p: PlayerId, name: string) => s.players[p].armyRules.some((r) => r.name === name);
export const unitHasAbility = (u: UnitState, name: string) => u.abilities.some((a) => a.name === name);
export const isRiledUp = (s: GameState, u: UnitState) => unitHasAbility(u, 'Waaagh!') && s.players[u.owner].riledUntilTurn >= s.turn;

export function setOathTarget(s: GameState, p: PlayerId, targetId: string) {
  s.players[p].oathTarget = targetId;
  log(s, `⚜ Oath of Moment: ${unitById(s, targetId).name}`, 'info', p);
}

export function callWaaagh(s: GameState, p: PlayerId) {
  s.players[p].waaaghUsed = true;
  s.players[p].riledUntilTurn = s.turn + 1;
  log(s, `🟢 WAAAGH! หน่วย Ork ทุกหน่วย riled up: 5+ InSv, ยิงแบบ [ASSAULT], advance แล้วชาร์จได้ (จนจบเทิร์นถัดไป)`, 'info', p);
}

export function chargeEligibility(s: GameState, u: UnitState): string | null {
  if (!onBoard(u)) return 'ไม่อยู่บนสนาม';
  if (u.declaredCharge) return 'ประกาศชาร์จไปแล้ว';
  if (hasKw(u, 'AIRCRAFT')) return 'AIRCRAFT ชาร์จไม่ได้';
  if (isEngaged(s, u)) return 'engaged อยู่';
  if (u.move === 'fallback') return 'Fall back มาเทิร์นนี้';
  if (u.cantCharge) return 'ลงจากรถแบบ Rapid/Combat มา ชาร์จไม่ได้เทิร์นนี้';
  if (u.move === 'advance' && !isRiledUp(s, u)) return 'Advance มาเทิร์นนี้';
  if (!boardUnits(s, other(u.owner)).some((e) => !hasKw(e, 'AIRCRAFT') && unitDistance(u, e) <= RULES.charge.declareRange)) return `ไม่มีศัตรูภายใน ${RULES.charge.declareRange}"`;
  return null;
}

export function declareCharge(s: GameState, u: UnitState, fly = false, cap?: number) {
  u.declaredCharge = true;
  const r = rollN(s, 2);
  let total = r[0] + r[1];
  if (cap !== undefined) total = Math.min(total, cap);
  u.chargeRoll = Math.max(0, total - (fly && !u.core.hover ? RULES.flyTakeToSkiesPenalty : 0));
  const near = Math.min(...boardUnits(s, other(u.owner)).map((e) => unitDistance(u, e)), 99);
  pushFx(s, { kind: 'roll', owner: u.owner, title: `Charge · ${u.name}`, dice: r, result: `ชาร์จได้ ${u.chargeRoll}"`, good: u.chargeRoll + 1e-6 >= near });
  log(s, `${u.name} ประกาศชาร์จ: 2D6 [${r.join('+')}] = ${r[0] + r[1]}${fly ? ' (บิน −2)' : ''}${cap !== undefined && r[0] + r[1] > cap ? ` → สูงสุด ${cap}` : ''}`, 'roll', u.owner);
  return r;
}

export function rerollCharge(s: GameState, u: UnitState, fly = false, cap?: number) {
  spendStratagem(s, u.owner, 'command-reroll', u);
  u.declaredCharge = false;
  return declareCharge(s, u, fly, cap);
}

export function chargeTargetOptions(s: GameState, u: UnitState, opts: { onlyChargedThisPhase?: boolean; within?: number } = {}): UnitState[] {
  const roll = u.chargeRoll ?? 0;
  return boardUnits(s, other(u.owner)).filter((e) => {
    if (hasKw(e, 'AIRCRAFT') && !hasKw(u, 'FLY')) return false;
    const d = unitDistance(u, e);
    if (d > RULES.charge.declareRange || d > roll + 1e-6) return false;
    if (opts.within !== undefined && d > opts.within) return false;
    if (opts.onlyChargedThisPhase && e.chargedTurn !== s.turn) return false;
    return true;
  });
}

export function commitCharge(s: GameState, u: UnitState, paths: Map<string, Pt[]>, targets: string[]) {
  commitMove(s, u, 'charge', paths);
  u.chargedTurn = s.turn;
  u.chargeTargets = targets;
  log(s, `⚔ ${u.name} ชาร์จสำเร็จ → ${targets.map((t) => unitById(s, t).name).join(', ')} (ได้ Fights First)`, 'info', u.owner);
}

export function crushingImpact(s: GameState, u: UnitState, targetId: string) {
  spendStratagem(s, u.owner, 'crushing-impact', u);
  const t = unitById(s, targetId);
  const m = alive(u).find((x) => modelEngagedWith(x, t)) ?? alive(u)[0];
  const rolls = rollN(s, m.profile.T);
  const hits = Math.min(6, rolls.filter((r) => r >= 5).length);
  const self = rolls.filter((r) => r === 1).length;
  log(s, `Crushing Impact: ${m.profile.T}D6 [${rolls.join(' ')}] → ศัตรู ${hits} MW, ตัวเอง ${self} MW`, 'roll', u.owner);
  if (hits) applyMortalWounds(s, t, hits, 'Crushing Impact');
  if (self) applyMortalWounds(s, u, self, 'Crushing Impact');
  return rolls;
}

/** Auto-place models towards target units (charge / pile-in / consolidation helper).
 *  1) shift the whole unit as a block (keeps coherency), 2) pull individual models into base contact if the unit stays coherent. */
export function autoApproach(s: GameState, u: UnitState, targets: UnitState[], maxDist: number, opts: { objective?: Pt } = {}): Map<string, Pt[]> {
  const ms = alive(u);
  const others = s.units.filter((x) => x.id !== u.id && onBoard(x)).flatMap((x) => alive(x).map((m) => ({ x: m.x, y: m.y, r: m.r })));
  const enemyModels = targets.flatMap(alive);
  const avoid = boardUnits(s, other(u.owner)).filter((e) => !targets.includes(e) && !hasKw(e, 'AIRCRAFT')).flatMap(alive);
  const clearOfOthers = (p: Pt, r: number) => avoid.every((e) => dist(p, e) - e.r - r > RULES.engagementRange + 0.05);
  const pos = new Map<string, Pt>(ms.map((m) => [m.id, { x: m.x, y: m.y }]));
  const free = (id: string, p: Pt, r: number) => p.x - r >= 0 && p.y - r >= 0 && p.x + r <= W && p.y + r <= H
    && others.every((o) => dist(p, o) >= o.r + r - 0.01)
    && ms.every((m) => m.id === id || dist(p, pos.get(m.id)!) >= m.r + r - 0.01)
    && s.terrain.every((t) => t.walls.every((w) => pointSegDist(p, w) >= r * 0.6)) && clearOfOthers(p, r);
  const coherent = () => coherencyProblems(ms.map((m) => pos.get(m.id)!), RULES.coherency.near, RULES.coherency.max, ms.map((m) => m.r)).length === 0;
  const gapTo = (m: ModelState, p: Pt) => Math.min(...enemyModels.map((e) => dist(p, e) - e.r - m.r));
  const inContact = (m: ModelState) => enemyModels.some((e) => baseDist(m, e) <= 0.05);

  // 1) block shift
  let dir: Pt | null = null;
  let need = maxDist;
  if (enemyModels.length) {
    let best = { m: ms[0], e: enemyModels[0], d: Infinity };
    for (const m of ms) for (const e of enemyModels) { const d = baseDist(m, e); if (d < best.d) best = { m, e, d }; }
    const L = dist(best.m, best.e);
    dir = { x: (best.e.x - best.m.x) / L, y: (best.e.y - best.m.y) / L };
    need = Math.min(maxDist, Math.max(0, best.d - 0.02));
  } else if (opts.objective) {
    const c = polyCentroid(ms);
    const L = dist(c, opts.objective);
    if (L > 0.01) { dir = { x: (opts.objective.x - c.x) / L, y: (opts.objective.y - c.y) / L }; need = Math.min(maxDist, L); }
  }
  if (dir && !ms.some(inContact)) {
    for (let k = need; k > 0.05; k -= 0.25) {
      const trial = new Map(ms.map((m) => [m.id, { x: m.x + dir!.x * k, y: m.y + dir!.y * k }]));
      const ok = ms.every((m) => {
        const p = trial.get(m.id)!;
        return p.x - m.r >= 0 && p.y - m.r >= 0 && p.x + m.r <= W && p.y + m.r <= H && others.every((o) => dist(p, o) >= o.r + m.r - 0.01)
          && s.terrain.every((t) => t.walls.every((w) => pointSegDist(p, w) >= m.r * 0.6)) && clearOfOthers(p, m.r);
      });
      if (ok) { for (const [id, p] of trial) pos.set(id, p); break; }
    }
  }
  // 2) individual refinement into contact
  if (enemyModels.length) {
    const order = [...ms].sort((a, b) => gapTo(a, pos.get(a.id)!) - gapTo(b, pos.get(b.id)!));
    for (const m of order) {
      const cur = pos.get(m.id)!;
      if (gapTo(m, cur) <= 0.05) continue;
      const budget = maxDist - dist(m, cur);
      if (budget <= 0.05) continue;
      let best: Pt | null = null;
      let bestScore = Infinity;
      for (const e of enemyModels) {
        for (let a = 0; a < 24; a++) {
          const ang = Math.atan2(cur.y - e.y, cur.x - e.x) + (a % 2 ? 1 : -1) * Math.ceil(a / 2) * (Math.PI / 12);
          const c = { x: e.x + Math.cos(ang) * (e.r + m.r + 0.02), y: e.y + Math.sin(ang) * (e.r + m.r + 0.02) };
          const travel = dist(m, c);
          if (travel > maxDist + 1e-6 || !free(m.id, c, m.r)) continue;
          if (travel < bestScore) { bestScore = travel; best = c; }
        }
      }
      if (!best) continue;
      pos.set(m.id, best);
      if (!coherent()) pos.set(m.id, cur);
    }
  }
  const paths = new Map<string, Pt[]>();
  for (const m of ms) {
    const p = pos.get(m.id)!;
    if (dist(p, m) > 0.01) paths.set(m.id, [{ x: m.x, y: m.y }, p]);
  }
  return paths;
}

// ---------- fight phase ----------

function startFight(s: GameState) {
  s.fight = { step: 'pileIn', stepPlayer: s.active, chooser: s.active, eligible: [], fought: [], forcedNext: null, movedThisStep: [] };
}

export function pileInEligible(s: GameState, u: UnitState) {
  return onBoard(u) && (isEngaged(s, u) || u.chargedTurn === s.turn);
}

export function endPileInStep(s: GameState) {
  const f = s.fight!;
  if (f.stepPlayer === s.active) { f.stepPlayer = other(s.active); f.movedThisStep = []; return; }
  f.step = 'fight';
  f.eligible = boardUnits(s).filter((u) => isEngaged(s, u) || u.chargedTurn === s.turn).map((u) => u.id);
  f.chooser = s.active;
  f.movedThisStep = [];
  if (!fightCandidates(s).units.length) startConsolidate(s);
}

export const isFightsFirst = (s: GameState, u: UnitState) => u.chargedTurn === s.turn || !!u.core.fightsFirst || u.foughtFirstUntilTurn === s.turn;

export function fightEligibleNow(s: GameState, u: UnitState) {
  const f = s.fight!;
  return onBoard(u) && !f.fought.includes(u.id) && (f.eligible.includes(u.id) || isEngaged(s, u));
}

/** Who picks next and which units they may pick (12.04). */
export function fightCandidates(s: GameState): { player: PlayerId | null; units: UnitState[] } {
  const f = s.fight!;
  const elig = boardUnits(s).filter((u) => fightEligibleNow(s, u));
  if (!elig.length) return { player: null, units: [] };
  if (f.forcedNext) {
    const u = unitById(s, f.forcedNext);
    if (fightEligibleNow(s, u)) return { player: u.owner, units: [u] };
    f.forcedNext = null;
  }
  const ff = elig.filter((u) => isFightsFirst(s, u));
  const pool = ff.length ? ff : elig;
  const mine = pool.filter((u) => u.owner === f.chooser);
  if (mine.length) return { player: f.chooser, units: mine };
  return { player: other(f.chooser), units: pool.filter((u) => u.owner !== f.chooser) };
}

export function markFought(s: GameState, u: UnitState) {
  const f = s.fight!;
  f.fought.push(u.id);
  u.fought = true;
  if (f.forcedNext === u.id) f.forcedNext = null;
  f.chooser = other(u.owner);
  if (!fightCandidates(s).units.length) startConsolidate(s);
}

function startConsolidate(s: GameState) {
  const f = s.fight!;
  f.step = 'consolidate';
  f.stepPlayer = s.active;
  f.movedThisStep = [];
}

export function consolidateMode(s: GameState, u: UnitState): { mode: 'ongoing' | 'engaging' | 'objective' | null; enemies: UnitState[]; objective?: ObjectiveState } {
  const eng = engagedEnemies(s, u);
  if (eng.length) return { mode: 'ongoing', enemies: eng };
  const near = boardUnits(s, other(u.owner)).filter((e) => !hasKw(e, 'AIRCRAFT') && unitDistance(u, e) <= RULES.consolidate.range);
  if (near.length) return { mode: 'engaging', enemies: near };
  const obj = s.objectives.find((o) => {
    const t = s.terrain.find((x) => x.id === o.terrainId)!;
    return alive(u).some((m) => circleTouchesPoly(m, m.r + RULES.consolidate.range, t.poly));
  });
  if (obj) return { mode: 'objective', enemies: [], objective: obj };
  return { mode: null, enemies: [] };
}

export const consolidateEligible = (s: GameState, u: UnitState) => onBoard(u) && !!s.fight && (s.fight.fought.includes(u.id) || s.fight.eligible.includes(u.id));

export function endConsolidateStep(s: GameState) {
  const f = s.fight!;
  if (f.stepPlayer === s.active) { f.stepPlayer = other(s.active); f.movedThisStep = []; return; }
  endPhase(s);
}

// ---------- reaction windows ----------

export function overwatchCandidates(s: GameState, p: PlayerId): UnitState[] {
  if (canUseStratagem(s, p, 'fire-overwatch')) return [];
  return boardUnits(s, p).filter((u) => !u.battleShocked && !isEngaged(s, u) && !hasKw(u, 'TITANIC') && u.stratagemPhase !== `${s.turn}:${s.phase}`
    && alive(u).some((m) => m.weapons.some((w) => !isMelee(w.profiles[0])))
    && boardUnits(s, other(p)).some((e) => unitDistance(u, e) <= RULES.snapShooting.range && alive(u).some((m) => unitVisibleTo(s, m, e))));
}

export function heroicCandidates(s: GameState, p: PlayerId): UnitState[] {
  if (canUseStratagem(s, p, 'heroic-intervention')) return [];
  return boardUnits(s, p).filter((u) => !u.battleShocked && !isEngaged(s, u) && (!hasKw(u, 'VEHICLE') || hasKw(u, 'CHARACTER') || hasKw(u, 'WALKER'))
    && boardUnits(s, other(p)).some((e) => unitDistance(u, e) <= RULES.charge.declareRange));
}

export function counteroffensiveCandidates(s: GameState, p: PlayerId): UnitState[] {
  if (!s.fight || s.fight.step !== 'fight' || canUseStratagem(s, p, 'counteroffensive')) return [];
  return boardUnits(s, p).filter((u) => !u.battleShocked && fightEligibleNow(s, u));
}

export function smokescreenCandidates(s: GameState, p: PlayerId): UnitState[] {
  if (canUseStratagem(s, p, 'smokescreen')) return [];
  return boardUnits(s, p).filter((u) => hasKw(u, 'SMOKE') && !u.battleShocked);
}

export function rapidIngressCandidates(s: GameState, p: PlayerId): UnitState[] {
  if (s.round < 2 || canUseStratagem(s, p, 'rapid-ingress')) return [];
  return s.units.filter((u) => u.owner === p && u.status === 'reserves' && !hasKw(u, 'AIRCRAFT'));
}

function openWindow(s: GameState, at: 'endOfMovement' | 'startOfShooting' | 'endOfCharge') {
  const opp = other(s.active);
  if (at === 'endOfMovement') {
    // windows at the end of the opponent's movement phase; phase already set to shooting, keep it as "movement" for stratagem bookkeeping
    if (overwatchCandidates(s, opp).length) s.window = { kind: 'fireOverwatch', player: opp };
    else if (rapidIngressCandidates(s, opp).length) s.window = { kind: 'rapidIngress', player: opp };
  } else if (at === 'startOfShooting') {
    if (smokescreenCandidates(s, opp).length) s.window = { kind: 'smokescreen', player: opp };
  } else if (at === 'endOfCharge') {
    if (heroicCandidates(s, opp).length) s.window = { kind: 'heroicIntervention', player: opp };
  }
}

export function closeWindow(s: GameState) {
  const w = s.window;
  s.window = null;
  if (!w) return;
  if (w.kind === 'fireOverwatch' && rapidIngressCandidates(s, w.player).length) { s.window = { kind: 'rapidIngress', player: w.player }; return; }
  if (w.kind === 'fireOverwatch' || w.kind === 'rapidIngress') openWindow(s, 'startOfShooting');
  if (w.kind === 'heroicIntervention' && s.fight && s.fight.step === 'pileIn') {
    // nothing else: fight phase continues with pile-in
  }
}

export function openCounteroffensive(s: GameState, attackerOwner: PlayerId) {
  const p = other(attackerOwner);
  if (s.fight?.step === 'fight' && counteroffensiveCandidates(s, p).length) s.window = { kind: 'counteroffensive', player: p };
}

export function useCounteroffensive(s: GameState, u: UnitState) {
  spendStratagem(s, u.owner, 'counteroffensive', u);
  u.foughtFirstUntilTurn = s.turn;
  s.fight!.forcedNext = u.id;
  s.window = null;
}

// ---------- objectives & scoring ----------

export function objectiveTerrain(s: GameState, o: ObjectiveState) {
  return s.terrain.find((t) => t.id === o.terrainId)!;
}

export function levelOfControl(s: GameState, o: ObjectiveState): [number, number] {
  const t = objectiveTerrain(s, o);
  const lv: [number, number] = [0, 0];
  for (const u of boardUnits(s)) {
    if (u.battleShocked) continue;
    for (const m of alive(u)) if (circleTouchesPoly(m, m.r, t.poly)) lv[u.owner] += m.profile.OC ?? 0;
  }
  return lv;
}

export function updateControl(s: GameState) {
  for (const o of s.objectives) {
    const [a, b] = levelOfControl(s, o);
    o.controller = a > b ? 0 : b > a ? 1 : null;
  }
}

const controlled = (s: GameState, p: PlayerId) => s.objectives.filter((o) => o.controller === p);

function evalCondition(s: GameState, p: PlayerId, c: string): number {
  const mine = controlled(s, p);
  const theirs = controlled(s, other(p));
  const destroyedThisTurn = (owner: PlayerId, turn = s.turn) => s.destroyedByTurn.filter((d) => d.turn === turn && d.owner === owner).length;
  switch (c) {
    case 'controlMoreThanOpponent': return mine.length > theirs.length ? 1 : 0;
    case 'perObjectiveControlled': return mine.length;
    case 'perObjectiveControlledExclHome': return mine.filter((o) => o.type !== 'home').length;
    case 'perNonHomeIfHomeControlled': return mine.some((o) => o.type === 'home' && o.owner === p) ? mine.filter((o) => !(o.type === 'home' && o.owner === p)).length : 0;
    case 'controlCentral': return mine.some((o) => o.type === 'central') ? 1 : 0;
    case 'control3Plus': return mine.length >= 3 ? 1 : 0;
    case 'control2Plus': return mine.length >= 2 ? 1 : 0;
    case 'controlAnyExclHome': return mine.some((o) => o.type !== 'home') ? 1 : 0;
    case 'controlEnemyHome': return mine.some((o) => o.type === 'home' && o.owner === other(p)) ? 1 : 0;
    case 'enemyUnitDestroyedThisTurn': return destroyedThisTurn(other(p)) > 0 ? 1 : 0;
    case 'moreKillsThanLossesLastTurn': return destroyedThisTurn(other(p)) > destroyedThisTurn(p, s.turn - 1) ? 1 : 0;
    case 'newObjectiveThisTurnExclHome':
      return s.objectives.some((o, i) => o.type !== 'home' && o.controller === p && s.controlAtTurnStart[i] !== p) ? 1 : 0;
    default: return 0;
  }
}

function ruleActive(r: ScoringRule, round: number, timing: string): boolean {
  if (round < r.rounds[0] || round > r.rounds[1]) return false;
  if (timing === 'endOfBattle') return r.when === 'endOfBattle';
  if (round === 5 && r.round5When) return r.round5When === timing;
  return r.when === timing;
}

export function scoreTiming(s: GameState, timing: 'endOfYourCommandPhase' | 'endOfYourTurn' | 'endOfBattle', player: PlayerId = s.active) {
  const prim = primaryById(s.primaryId);
  const P = s.players[player];
  for (const r of prim.scoring) {
    if (!ruleActive(r, s.round, timing)) continue;
    const n = evalCondition(s, player, r.condition);
    let vp = n * r.vp;
    if (r.bonus) vp += evalCondition(s, player, r.bonus.condition) * r.bonus.vp;
    if (!vp) continue;
    const roundCap = timing === 'endOfBattle' ? Infinity : MISSIONS.vpCaps.primaryPerRound - P.vpByRound[s.round];
    vp = Math.max(0, Math.min(vp, roundCap, MISSIONS.vpCaps.primaryTotal - P.vp));
    if (!vp) continue;
    P.vp += vp;
    if (timing !== 'endOfBattle') P.vpByRound[s.round] += vp;
    log(s, `🏆 ${P.name} +${vp} VP (${prim.name}: ${r.text})`, 'vp', player);
  }
}

export const terrainOfObjective = objectiveTerrain;

/** Find a legal spot for a whole unit (used by "auto place" during deployment / ingress). */
export function findPlacement(s: GameState, u: UnitState, how: 'deploy' | 'ingress' | 'deepStrike' | 'infiltrate', near?: Pt): Map<string, Pt> | null {
  const zone = how === 'deploy' ? zoneOf(s, u.owner) : null;
  const cands: Pt[] = [];
  for (let y = 1; y < H; y += 1.5) for (let x = 1; x < W; x += 1.5) cands.push({ x, y });
  const enemyZone = zoneOf(s, other(u.owner));
  const ec = polyCentroid(enemyZone);
  const ref = near ?? (zone ? ec : polyCentroid(zoneOf(s, u.owner)));
  cands.sort((a, b) => dist(a, ref) - dist(b, ref));
  const up = s.players[u.owner].role === 'defender';
  for (const c of cands) {
    if (zone && !circleTouchesPoly(c, 0, zone)) continue;
    const pos = formationAt(u, c, up);
    if (validatePlacement(s, u, pos, how).ok) return pos;
  }
  return null;
}

// ---------- secondary missions (Chapter Approved 2026-27) ----------

function shuffle<T>(s: GameState, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(nextRandom(s) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function drawSecondaries(s: GameState, p: PlayerId, n: number) {
  const P = s.players[p];
  if (P.secMode !== 'tactical') return;
  for (let i = 0; i < n && P.secDeck.length; i++) {
    let id = P.secDeck.shift()!;
    const def = secondaryById(id);
    if ((def.round1Redraw && s.round === 1) || (def.redrawIf && P.secActive.includes(def.redrawIf))) {
      P.secDeck.push(id);
      if (!P.secDeck.length) break;
      id = P.secDeck.shift()!;
    }
    P.secActive.push(id);
    log(s, `${P.name} จั่ว Secondary: ${secondaryById(id).name}`, 'info', p);
  }
}

export function chooseFixedSecondaries(s: GameState, p: PlayerId, ids: string[]) {
  s.players[p].secActive = ids.slice(0, 2);
  log(s, `${s.players[p].name} เลือก Fixed Secondary: ${ids.map((x) => secondaryById(x).name).join(', ')}`, 'info', p);
}

/** Claim VP from an active secondary (players confirm the condition, like on the table). */
export function claimSecondary(s: GameState, p: PlayerId, id: string, vp: number): number {
  const P = s.players[p];
  const caps = MISSIONS.vpCaps;
  let gain = Math.min(vp, caps.secondaryPerRound - P.secByRound[s.round], caps.secondaryTotal - P.secVp);
  if (P.secMode === 'fixed') gain = Math.min(gain, caps.fixedPerCard - (P.secFixedVp[id] ?? 0));
  gain = Math.max(0, gain);
  P.secVp += gain;
  P.secByRound[s.round] += gain;
  if (P.secMode === 'fixed') P.secFixedVp[id] = (P.secFixedVp[id] ?? 0) + gain;
  else P.secActive = P.secActive.filter((x) => x !== id);
  log(s, `🎯 ${P.name} +${gain} VP (Secondary: ${secondaryById(id).name})`, 'vp', p);
  return gain;
}

/** Tactical: discard an active card; at the end of your own turn this gains 1CP. */
export function discardSecondary(s: GameState, p: PlayerId, id: string) {
  const P = s.players[p];
  P.secActive = P.secActive.filter((x) => x !== id);
  if (s.active === p) { P.cp += 1; log(s, `${P.name} ทิ้ง ${secondaryById(id).name} → +1CP`, 'cp', p); }
}

/** Once per battle, end of your Command phase: pay 1CP to replace one active card. */
export function swapSecondary(s: GameState, p: PlayerId, id: string) {
  const P = s.players[p];
  P.cp -= 1;
  P.secSwapUsed = true;
  P.secActive = P.secActive.filter((x) => x !== id);
  drawSecondaries(s, p, 1);
}

// ---------- transports ----------

const modelSpace = (t: TransportInfo, m: ModelState) => (t.double.some((k) => m.keywords.includes(k)) ? 2 : 1);

export function transportSpaceUsed(s: GameState, t: UnitState) {
  return s.units.filter((u) => u.embarkedIn === t.id && u.status === 'embarked').reduce((a, u) => a + alive(u).reduce((b, m) => b + modelSpace(t.transport!, m), 0), 0);
}

export function canEmbarkIn(s: GameState, u: UnitState, t: UnitState): string | null {
  const T = t.transport;
  if (!T || t.owner !== u.owner || t.id === u.id) return 'ไม่ใช่รถขนส่ง';
  if (hasKw(u, 'TRANSPORT')) return 'รถขึ้นรถไม่ได้';
  if (T.infantryOnly && !alive(u).every((m) => m.keywords.includes('INFANTRY'))) return 'ขนได้เฉพาะ INFANTRY';
  if (T.forbid.some((k) => u.keywords.includes(k))) return `ขน ${T.forbid.filter((k) => u.keywords.includes(k)).join(', ')} ไม่ได้`;
  if (T.only.length && !T.only.some((k) => u.sources.some((n) => n.toUpperCase().includes(k)) || u.keywords.includes(k))) return 'ขนได้เฉพาะหน่วยที่ระบุบนการ์ด';
  if (u.factionKeywords.length && t.factionKeywords.length && !u.factionKeywords.some((k) => t.factionKeywords.includes(k))) return 'คนละฝ่าย';
  const need = alive(u).reduce((a, m) => a + modelSpace(T, m), 0);
  if (transportSpaceUsed(s, t) + need > T.capacity) return `ที่ไม่พอ (${transportSpaceUsed(s, t)}+${need}/${T.capacity})`;
  return null;
}

/** Embark during deployment (Declare Battle Formations) or after a normal/advance/fall-back move (18.02). */
export function embarkUnit(s: GameState, u: UnitState, t: UnitState, duringDeploy = false): string | null {
  const why = canEmbarkIn(s, u, t);
  if (why) return why;
  if (!duringDeploy) {
    if (!['normal', 'advance', 'fallback'].includes(u.move ?? '')) return 'ต้องเดิน (Normal/Advance/Fall back) ก่อนขึ้นรถ';
    if (u.setUpTurn === s.turn) return 'หน่วยที่เพิ่งลงสนามเทิร์นนี้ขึ้นรถไม่ได้';
    if (!alive(u).every((m) => alive(t).some((n) => baseDist(m, n) <= 3 + 1e-6))) return 'ทุกโมเดลต้องอยู่ภายใน 3" ของรถ';
  }
  u.status = 'embarked';
  u.embarkedIn = t.id;
  log(s, `${u.name} ขึ้นรถ ${t.name}`, 'info', u.owner);
  if (duringDeploy) nextDeployer(s);
  return null;
}

export const embarkedIn = (s: GameState, t: UnitState) => s.units.filter((u) => u.embarkedIn === t.id && u.status === 'embarked');

export function disembarkMode(s: GameState, t: UnitState): 'rapid' | 'tactical' | 'combat' | null {
  if (t.move === 'advance' || t.move === 'fallback') return null;
  if (isEngaged(s, t)) return 'combat';
  if (t.move === 'normal' || t.move === 'ingress') return 'rapid';
  return 'tactical';
}

export function validateDisembark(s: GameState, u: UnitState, t: UnitState, pos: Map<string, Pt>): MoveCheck {
  const mode = disembarkMode(s, t);
  const errors: string[] = [];
  const bad = new Set<string>();
  if (!mode) return { ok: false, errors: ['รถ Advance/Fall back มาแล้ว ลงไม่ได้ phase นี้'], bad: [] };
  const range = mode === 'combat' ? 6 : 3;
  endChecks(s, u, pos, errors, bad);
  for (const m of alive(u)) {
    const p = pos.get(m.id) ?? m;
    const tm = alive(t).reduce((a, b) => (dist(p, a) <= dist(p, b) ? a : b));
    if (dist(p, tm) - tm.r + m.r > range + 0.02) { errors.push(`ต้องวางให้อยู่ภายใน ${range}" ของรถทั้งตัว`); bad.add(m.id); }
  }
  if (mode !== 'combat' && engagedAt(s, u, pos).length) errors.push('ลงจากรถต้องไม่ engaged');
  return { ok: !errors.length, errors: [...new Set(errors)], bad: [...bad] };
}

export function disembarkUnit(s: GameState, u: UnitState, t: UnitState, pos: Map<string, Pt>): MoveCheck {
  const chk = validateDisembark(s, u, t, pos);
  if (!chk.ok) return chk;
  const mode = disembarkMode(s, t)!;
  if (mode === 'combat') {
    const rolls = rollN(s, alive(u).length);
    const fails = rolls.filter((r) => r <= RULES.hazard.failOn).length;
    log(s, `Combat Disembark ${u.name}: hazard [${rolls.join(' ')}]`, 'roll', u.owner);
    if (fails) applyMortalWounds(s, u, fails, 'Combat Disembark');
    u.battleShocked = true;
  }
  for (const m of alive(u)) { const p = pos.get(m.id)!; m.x = p.x; m.y = p.y; }
  u.status = 'board';
  u.embarkedIn = null;
  u.setUpTurn = s.turn;
  if (mode === 'tactical') u.move = null; // may still make a normal or advance move
  else { u.move = 'stationary'; u.cantCharge = true; }
  log(s, `${u.name} ลงจากรถ (${mode === 'rapid' ? 'Rapid' : mode === 'tactical' ? 'Tactical' : 'Combat'} Disembark)`, 'info', u.owner);
  return chk;
}

/** Emergency disembark when a transport is destroyed (18.05). */
export function emergencyDisembark(s: GameState, t: UnitState, tm: ModelState) {
  for (const u of embarkedIn(s, t)) {
    const rolls = rollN(s, alive(u).length);
    const fails = rolls.filter((r) => r <= RULES.hazard.failOn).length;
    let placed: Map<string, Pt> | null = null;
    for (let ring = 0; ring < 5 && !placed; ring++) {
      for (let a = 0; a < 12 && !placed; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const c = { x: tm.x + Math.cos(ang) * (tm.r + 1.2 + ring), y: tm.y + Math.sin(ang) * (tm.r + 1.2 + ring) };
        const pos = formationAt(u, c);
        const errs: string[] = [];
        endChecks(s, u, pos, errs, new Set());
        const within = alive(u).every((m) => { const p = pos.get(m.id)!; return dist(p, tm) - tm.r + m.r <= 6 + 0.02; });
        if (!errs.length && within) placed = pos;
      }
    }
    u.embarkedIn = null;
    if (!placed) {
      for (const m of alive(u)) killModel(s, u, m);
      log(s, `${u.name} ออกจากรถที่ระเบิดไม่ได้ → ถูกทำลาย`, 'kill', u.owner);
      continue;
    }
    for (const m of alive(u)) { const p = placed.get(m.id)!; m.x = p.x; m.y = p.y; }
    u.status = 'board';
    u.battleShocked = true;
    u.cantCharge = true;
    log(s, `Emergency Disembark ${u.name}: hazard [${rolls.join(' ')}] · battle-shocked`, 'roll', u.owner);
    if (fails) applyMortalWounds(s, u, fails, 'Emergency Disembark');
  }
}

onTransportDestroyed((s, u, m) => { if (u.transport && embarkedIn(s, u).length) emergencyDisembark(s, u, m); });
