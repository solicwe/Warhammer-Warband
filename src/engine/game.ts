// Battle flow: setup, deployment, the five phases, objectives and mission scoring.
import { initFavoured, noteTarget, pledgeRoundEnd, pledgeRoundStart, poisonTick, snapshotEngaged, thrillBlock } from './emperorsChildren';
import { buildUnits, forChapter, transportFit } from './army';
import { applyMortalWounds, hazardTest, killModel, onAttackFinished, onTransportDestroyed } from './attack';
import { deploymentById, dispositionById, dispositionId, LAYOUTS, layoutsFor, MISSIONS, primaryById, primaryFor, RULES, secondaryById, toPoly, type DispositionId } from './config';
import { mulberryPick, onMoveEnd, onTurnEnd, onTurnStart, scorePrimary, startOfBattle } from './missions';
import { bankSecondary, drawUpTo, scoreSecondaries } from './secondaries';
import { d6, nextRandom, rollExpr, rollN, rollOff } from './dice';
import { blessingsRoll, blessingsRoundStart } from './blessings';
import { circleInFlow } from './flow';
import { baseDist, circleTouchesPoly, circleWhollyInPoly, coherencyProblems, dist, EPS, pointInPoly, pointSegDist, polyCentroid } from './geometry';
import {
  alive, boardUnits, canUseStratagem, engagedEnemies, hasKw, isEngaged, lastRound, log, modelEngagedWith, pushFx, onBoard, other, spendStratagem, strength, unitById, unitDistance,
  emitReact, type ReactOn,
  heroFx, phaseKey,
} from './state';
import type { ArmyList, FactionData, GameState, MissionState, ModelState, MoveKind, ObjectiveState, Phase, PlayerId, Pt, Seg, TerrainPiece, TransportInfo, UnitState } from './types';
import { unitVisibleTo } from './visibility';
import { isMelee } from './weapons';
import { endSpotBlocked, isMV, OBJECTIVE_MARKER_R, pathBlocked, pathLength } from './pathing';
import { detOnCommandStart } from './detachments';
import { activeRules, addTimed, applyStaticEffects, canDo, cond, effectsFor, expireTimed, isRiled, modelOc, rollMods, unitFlags } from './effects';
import './rituals';
import { arrivalShock, fire, fireAll, fireFor, initAbilityChoices, initSagas, ldTest, offerDone, offerReactions, resolveRevivals, sagaBoasts, setEmbarkNear, setZoneCheck } from './activations';

const W = RULES.battlefield.width;
const H = RULES.battlefield.height;

// ---------- setup ----------

/** A light terrain strip traced with nothing on it (the layouts' ~1" x 3.5" barricade sections): give it its
 *  barricade, a low obstacle along its length, so it doesn't show as an empty plate. */
export function stripBarricade(poly: number[][]): Seg[] {
  if (poly.length !== 4) return [];
  const P = poly.map(([x, y]) => ({ x, y }));
  const e = [0, 1, 2, 3].map((k) => dist(P[k], P[(k + 1) % 4]));
  const k = e[0] + e[2] >= e[1] + e[3] ? 0 : 1; // the long sides are k and k+2
  const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  // the centre line runs between the middles of the two short sides
  const a = mid(P[(k + 1) % 4], P[(k + 2) % 4]), b = mid(P[(k + 3) % 4], P[k]);
  const L = dist(a, b);
  if (L < 1.5) return [];
  const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, inset = 0.35;
  return [{ a: { x: a.x + ux * inset, y: a.y + uy * inset }, b: { x: b.x - ux * inset, y: b.y - uy * inset } }];
}

/** Convex hull (counter-clockwise) of a set of points. */
function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let k = p.length - 1; k >= 0; k--) { const q = p[k]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

function buildTerrain(layoutId: string): { terrain: TerrainPiece[]; objectives: ObjectiveState[] } {
  const L = deploymentById(layoutId);
  const seg = (w: number[]): Seg => ({ a: { x: w[0], y: w[1] }, b: { x: w[2], y: w[3] } });
  // Some layouts trace a plate with a solid block in its middle as three pieces: two plates and a small piece whose
  // rough walls outline the block. That small piece becomes the block itself (its four true edges), and the
  // plates' walls that only mark the block's ends go.
  const blocks: Pt[][] = [];
  const raw = L.terrain.map((t) => {
    if (t.box || t.obstacles.length || t.walls.length < 3 || t.poly.length !== 4) return t;
    const P = t.poly.map(([x, y]) => ({ x, y }));
    if (Math.max(...P.map((p, k) => dist(p, P[(k + 1) % 4]))) > 3.5) return t;
    const ux = (P[1].x - P[0].x) / (dist(P[0], P[1]) || 1), uy = (P[1].y - P[0].y) / (dist(P[0], P[1]) || 1);
    const ends = t.walls.flatMap(([x0, y0, x1, y1]) => [{ x: x0, y: y0 }, { x: x1, y: y1 }]);
    const us = ends.map((p) => (p.x - P[0].x) * ux + (p.y - P[0].y) * uy), vs = ends.map((p) => -(p.x - P[0].x) * uy + (p.y - P[0].y) * ux);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const at = (u: number, v: number) => ({ x: P[0].x + ux * u - uy * v, y: P[0].y + uy * u + ux * v });
    const box = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
    blocks.push(box);
    return { ...t, poly: box.map((p) => [p.x, p.y]), walls: [], box: box.map((p) => [p.x, p.y]) };
  });
  const nearBlock = (w: number[]) => blocks.some((b) => [{ x: w[0], y: w[1] }, { x: w[2], y: w[3] }].every((p) => b.some((q, k) => pointSegDist(p, { a: q, b: b[(k + 1) % 4] }) < 0.7)));
  const terrain: TerrainPiece[] = raw.map((t0, i) => {
    const t = blocks.length && !t0.box ? { ...t0, walls: t0.walls.filter((w) => !nearBlock(w)) } : t0;
    const box = t.box?.map(([x, y]) => ({ x, y }));
    let walls = t.walls.map(seg);
    if (box) {
      // a solid block (container) on the plate: its outline was traced as several rough, overlapping segments;
      // its four true edges replace them, and walls elsewhere on the plate stay
      const edges = box.map((a, k) => ({ a, b: box[(k + 1) % box.length] }));
      const onBox = (w: Seg) => [w.a, w.b].every((p) => edges.some((e) => pointSegDist(p, e) < 0.6));
      walls = [...edges, ...walls.filter((w) => !onBox(w))];
    }
    return {
      id: `t${i}`,
      kind: 'ruin',
      label: walls.length ? 'Ruins (Dense)' : 'Terrain area (Light)',
      // a baseplate with ruin walls is dense (walls block sight); a bare baseplate with obstacles only is light
      category: walls.length ? 'dense' : 'light',
      height: walls.length ? 5 : 1.5,
      poly: t.poly.map(([x, y]) => ({ x, y })),
      walls,
      obstacles: t.obstacles.length || walls.length ? t.obstacles.map(seg) : stripBarricade(t.poly),
      ...(box ? { box } : {}),
    };
  });
  const objectives: ObjectiveState[] = L.objectives.map((o, i) => {
    const id = o.type === 'home' ? `home-${o.owner === 'attacker' ? 'a' : 'd'}` : `${o.type}-${i}`;
    // every piece the 40mm marker sits on or touches: a centre ruin built of two halves is one objective
    const at = { x: o.x, y: o.y };
    // (the marker on the seam of a split ruin: the piece it stands on and the piece across the seam, within 1.6")
    const under = terrain.filter((t) => t.kind !== 'objective-area' && (pointInPoly(at, t.poly) || t.poly.some((q, k) => pointSegDist(at, { a: q, b: t.poly[(k + 1) % t.poly.length] }) <= 1.6)));
    let tp = under.length === 1 ? under[0] : undefined;
    if (under.length > 1) {
      // the objective covers them all: one area around the pieces (it doesn't block sight; the pieces still do)
      tp = { id: `obj-t${i}`, kind: 'objective-area', label: 'Objective (terrain)', category: 'exposed', height: 0, walls: [], obstacles: [], poly: convexHull(under.flatMap((t) => t.poly)) };
      terrain.push(tp);
      for (const t of under) t.objectiveId = `${o.type === 'home' ? `home-${o.owner === 'attacker' ? 'a' : 'd'}` : `${o.type}-${i}`}`;
    }
    if (!tp) {
      // objective in the open (no terrain on it): a 40mm marker, in range within 3" of it (14) — a circle of
      // 3" + the marker's radius around its centre, so control works the same way as for terrain objectives
      const R = 3 + 20 / 25.4;
      tp = { id: `obj-t${i}`, kind: 'objective-area', label: 'Objective (40mm marker, range 3")', category: 'exposed', height: 0, walls: [], obstacles: [],
        poly: Array.from({ length: 32 }, (_, k) => ({ x: o.x + R * Math.cos((k / 32) * Math.PI * 2), y: o.y + R * Math.sin((k / 32) * Math.PI * 2) })) };
      terrain.push(tp);
    }
    tp.objectiveId = id;
    return { id, type: o.type, owner: undefined, x: o.x, y: o.y, terrainId: tp.id, controller: null, ownerRole: o.owner ?? undefined } as ObjectiveState & { ownerRole?: string };
  });
  return { terrain, objectives };
}

export interface NewGameOptions {
  lists: [ArmyList, ArmyList];
  factions: [FactionData, FactionData];
  names: [string, string];
  /** terrain layout id; when omitted a random official layout for the two dispositions is used */
  deploymentId?: string;
  /** each player's Force Disposition (from one of their detachments) */
  dispositions?: [DispositionId, DispositionId];
  seed?: number;
  secondaryMode?: 'none' | 'tactical' | 'fixed';
  /** a short game: battle rounds before it ends (default 5) */
  maxRounds?: number;
}

export const emptyMission = (): MissionState => ({ trapped: [], decoyed: [], consecrated: [], triangulated: [], condemned: [], consecrationUnits: [], surveilled: [], done: [] });

/** Disposition a list brings: the first detachment's, else Take and Hold. */
/** Every Force Disposition the list's detachments give it (a detachment can count as more than one). */
export function listDispositionOptions(list: ArmyList, faction: FactionData): DispositionId[] {
  const out: DispositionId[] = [];
  for (const n of list.detachments) {
    const d = faction.detachments.find((x) => x.name === n);
    for (const name of d?.forceDispositions ?? (d?.forceDisposition ? [d.forceDisposition] : [])) {
      const id = dispositionId(name);
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

export function listDisposition(list: ArmyList, faction: FactionData): DispositionId {
  const picked = dispositionId(list.disposition);
  if (picked && listDispositionOptions(list, faction).includes(picked)) return picked;
  for (const n of list.detachments) {
    const d = dispositionId(faction.detachments.find((x) => x.name === n)?.forceDisposition);
    if (d) return d;
  }
  return 'take-and-hold';
}

export function createGame(o: NewGameOptions): GameState {
  // a Chapter's own version of a datasheet replaces the generic one of the same name
  o = { ...o, factions: [forChapter(o.factions[0], o.lists[0].subfaction), forChapter(o.factions[1], o.lists[1].subfaction)] };
  const disp: [DispositionId, DispositionId] = o.dispositions ?? [listDisposition(o.lists[0], o.factions[0]), listDisposition(o.lists[1], o.factions[1])];
  let layoutId = o.deploymentId;
  if (!layoutId || !LAYOUTS.some((l) => l.id === layoutId)) {
    const opts = layoutsFor(disp[0], disp[1]);
    const r = mulberryPick((o.seed ?? Date.now()) >>> 0, opts.length);
    layoutId = (opts[r] ?? LAYOUTS[0]).id;
  }
  const { terrain, objectives } = buildTerrain(layoutId);
  const s: GameState = {
    version: 3,
    rng: (o.seed ?? Date.now()) >>> 0,
    round: 0,
    ...(o.maxRounds && o.maxRounds < RULES.battleRounds ? { maxRounds: o.maxRounds } : {}),
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
      disposition: disp[i], primaryId: primaryFor(disp[i], disp[1 - i]).id, mission: emptyMission(), sec: { guards: [], cleansed: [], plundered: [] },
      subfaction: o.lists[i].subfaction,
      battleSize: o.lists[i].battleSize,
    })) as unknown as GameState['players'],
    units: [...buildUnits(o.lists[0], o.factions[0], 0), ...buildUnits(o.lists[1], o.factions[1], 1)],
    terrain, objectives,
    deploymentId: layoutId,
    attackerPlayer: 0,
    window: null, attack: null, fight: null, shockTests: [],
    destroyedByTurn: [], controlAtTurnStart: [], log: [], winner: null,
    markers: [], pendingActions: [], turnStart: null, modelDeaths: [],
  };
  for (const i of [0, 1] as const) {
    if (!s.players[i].detachments.some((d) => d.stratagems.some((st) => /Tzeentch Chaos Spawn/i.test(st.text)))) continue;
    s.players[i].spawnTemplate = buildUnits({ ...o.lists[i], units: [{ uid: 'gift-spawn', datasheet: 'Chaos Spawn', models: 1, pts: 0 }] }, o.factions[i], i)[0];
  }
  const ro = rollOff(s);
  log(s, `Roll-off for Attacker / Defender: ${o.names[0]} ${ro.a} – ${o.names[1]} ${ro.b} → ${o.names[ro.winner]} is the Attacker`, 'roll', null);
  s.attackerPlayer = ro.winner;
  pushFx(s, { kind: 'rolloff', title: 'Roll-off: who is the Attacker?', a: ro.a, b: ro.b, winner: ro.winner, result: `${o.names[ro.winner]} is the Attacker · ${o.names[other(ro.winner)]} (Defender) deploys first` });
  s.players[ro.winner].role = 'attacker';
  s.players[other(ro.winner)].role = 'defender';
  pushFx(s, { kind: 'primary' });
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
  const L = deploymentById(layoutId);
  log(s, `Force Disposition: ${s.players[0].name} ${dispositionById(disp[0]).name} vs ${s.players[1].name} ${dispositionById(disp[1]).name}`, 'info', null);
  for (const p of [0, 1] as PlayerId[]) log(s, `${s.players[p].name}'s Primary Mission: ${primaryById(s.players[p].primaryId).name}`, 'info', p);
  log(s, `Layout: ${L.name} · ${L.matchup.map((m) => dispositionById(m).name).join(' vs ')} #${L.number} (${s.objectives.length} objectives)`, 'info', null);
  // Heirs of Sigismund: Black Templars swap Oath of Moment for Templar Vows
  for (const p of [0, 1] as PlayerId[]) {
    const P = s.players[p];
    if (P.subfaction !== 'BLACK TEMPLARS' && !s.units.some((u) => u.owner === p && u.factionKeywords.includes('BLACK TEMPLARS'))) continue;
    if (!P.armyRules.some((r) => r.name === 'Templar Vows')) continue;
    P.armyRules = P.armyRules.filter((r) => r.name !== 'Oath of Moment');
    for (const u of s.units) if (u.owner === p) u.abilities = u.abilities.filter((a) => a.name !== 'Oath of Moment');
  }
  // Declare Battle Formations: units that start the battle embarked (chosen in the army builder)
  for (const p of [0, 1] as PlayerId[]) {
    for (const e of o.lists[p].units) {
      if (!e.embarkIn || e.attachTo) continue;
      const t = s.units.find((x) => x.id === `p${p}-${e.embarkIn}`);
      if (!t) continue;
      for (const u of s.units.filter((x) => x.id === `p${p}-${e.uid}` || x.id === `p${p}-${e.uid}-b`)) {
        const why = canEmbarkIn(s, u, t);
        if (why) { log(s, `${u.name} cannot embark in ${t.name}: ${why}`, 'info', p); continue; }
        u.status = 'embarked';
        u.embarkedIn = t.id;
        log(s, `${u.name} starts the battle embarked in ${t.name}`, 'info', p);
      }
    }
  }
  // Declare Battle Formations: abilities fixed for the battle, "choose two of these", Master of the Fleet …
  applyStaticEffects(s);
  initAbilityChoices(s);
  fireAll(s, 'formation', 'both');
  // abilities that give a core rule at deployment (Blackwing Shroud, Masters of Misdirection: Infiltrators)
  for (const u of s.units) if (!u.core.infiltrators && unitFlags(s, u).infiltrators) u.core.infiltrators = true;
  startOfBattle(s);
  return s;
}

export const zoneOf = (s: GameState, p: PlayerId) => toPoly(deploymentById(s.deploymentId).zones[s.players[p].role]);
setZoneCheck((s, u, owner) => alive(u).length > 0 && alive(u).every((m) => circleWhollyInPoly(m, m.r, zoneOf(s, owner))));
export const territoryOf = (s: GameState, p: PlayerId) => toPoly(deploymentById(s.deploymentId).territory[s.players[p].role]);

// ---------- placement / movement validation ----------

export interface MoveCheck { ok: boolean; errors: string[]; bad: string[] }

export { canCrossDense, isMV, pathLength, settleMove, routeAround } from './pathing';

function endChecks(s: GameState, u: UnitState, pos: Map<string, Pt>, errors: string[], bad: Set<string>) {
  const models = alive(u);
  const all = s.units.filter((x) => onBoard(x) || x.id === u.id).flatMap((x) => alive(x).map((m) => ({ m, owner: x.owner, unit: x.id })));
  for (const m of models) {
    const p = pos.get(m.id) ?? m;
    if (p.x - m.r < -EPS || p.y - m.r < -EPS || p.x + m.r > W + EPS || p.y + m.r > H + EPS) { errors.push(`${m.name} is off the battlefield`); bad.add(m.id); }
    for (const o of all) {
      if (o.m.id === m.id) continue;
      const op = o.unit === u.id ? pos.get(o.m.id) ?? o.m : o.m;
      if (dist(p, op) < m.r + o.m.r - 0.02) { errors.push(`${m.name} overlaps another model`); bad.add(m.id); break; }
    }
    const spot = endSpotBlocked(s, m, p);
    if (spot === 'wall') { errors.push(`${m.name} ends on a wall`); bad.add(m.id); }
    if (spot === 'objective') { errors.push(`${m.name} cannot end on top of an objective marker`); bad.add(m.id); }
    for (const t of s.terrain) {
      if (t.kind === 'container' && pointInPoly(p, t.poly) && !['INFANTRY', 'BEASTS', 'SWARM', 'FLY', 'MONSTER'].some((k) => m.keywords.includes(k))) {
        errors.push(`${m.name} cannot end on top of a container (13.06)`); bad.add(m.id);
      }
      // a sealed container: nothing stands inside it or half over its side; some models can end on its roof
      if (t.box && circleTouchesPoly(p, m.r - 0.05, t.box)) {
        const roof = circleWhollyInPoly(p, m.r, t.box) && ['INFANTRY', 'BEASTS', 'SWARM', 'FLY', 'MONSTER'].some((k) => m.keywords.includes(k));
        if (!roof) { errors.push(`${m.name} cannot overlap a container (place it beside the container or wholly on its roof)`); bad.add(m.id); }
      }
    }
  }
  if (models.length > 1) {
    const pts = models.map((m) => pos.get(m.id) ?? m);
    const probs = coherencyProblems(pts, RULES.coherency.near, RULES.coherency.max, models.map((m) => m.r));
    if (probs.length) { errors.push(`Out of Unit Coherency (each model within ${RULES.coherency.near}" of another, all within ${RULES.coherency.max}")`); probs.forEach((i) => bad.add(models[i].id)); }
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

/** The charge distance against these targets: Siegecraft takes 2 off when one of them has it (not on top of other
 *  negative modifiers to the roll). */
export function chargeReach(s: GameState, u: UnitState, targets: (string | UnitState)[] = []): number {
  const ts = targets.map((t) => (typeof t === 'string' ? unitById(s, t) : t));
  const f = unitFlags(s, u);
  // Eager for Vengeance: +X when the focus of hatred is one of the targets
  const roll = (u.chargeRoll ?? 0) + (f.chargeBonusVsOath && ts.some((t) => s.players[u.owner].oathTarget === t.id) ? f.chargeBonusVsOath : 0);
  const pen = Math.max(0, ...ts.map((t) => unitFlags(s, t).chargedMinus));
  return pen && rollMods(s, u).chargeBonus >= 0 && !f.ignoreMoveMods && !f.ignoreMods ? Math.max(0, roll - pen) : roll;
}

/** How far a Pile-in / Consolidation move may go (3", or more with stratagems such as Shock Onslaught). */
export function pileDistance(s: GameState, u: UnitState, kind: 'pileIn' | 'consolidate'): number {
  const f = unitFlags(s, u);
  const base = kind === 'pileIn' ? Math.max(RULES.pileIn.distance, f.pileIn) : Math.max(RULES.consolidate.distance, f.consolidate);
  // Dacatarai (Dread Host): enemy units engaged with that unit move less
  const minus = Math.max(0, ...engagedEnemies(s, u).map((e) => unitFlags(s, e).enemyPileMinus));
  return Math.max(0, base - minus);
}

export function maxMoveDistance(s: GameState, u: UnitState, kind: MoveKind, m: ModelState, opt: MoveOptions = {}): number {
  if (opt.maxOverride !== undefined) return opt.maxOverride;
  const fl = unitFlags(s, u);
  const M = (fl.moveSet || (m.profile.M ?? 0)) + fl.move;
  let max = 0;
  if (kind === 'normal' || kind === 'fallback') max = M;
  else if (kind === 'advance') max = M + (u.advanceRoll ?? 0);
  else if (kind === 'charge') max = chargeReach(s, u, opt.targets);
  else if (kind === 'pileIn' || kind === 'consolidate') max = pileDistance(s, u, kind);
  else if (kind === 'scout') max = Math.max(u.core.scouts ?? 0, unitFlags(s, u).scouts);
  else if (kind === 'extra' || kind === 'surge') max = u.extraMove?.max ?? 0;
  if (opt.fly && ['normal', 'advance', 'fallback', 'charge'].includes(kind) && !u.core.hover) max -= RULES.flyTakeToSkiesPenalty;
  return Math.max(0, max);
}

export function validateMove(s: GameState, u: UnitState, kind: MoveKind, paths: Map<string, Pt[]>, opt: MoveOptions = {}): MoveCheck {
  const errors: string[] = [];
  const bad = new Set<string>();
  const pos = new Map<string, Pt>();
  for (const [id, path] of paths) pos.set(id, path[path.length - 1]);
  const enemyModels = boardUnits(s, other(u.owner)).filter((e) => !hasKw(e, 'AIRCRAFT')).flatMap(alive);

  for (const m of alive(u)) {
    const path = paths.get(m.id);
    if (!path || path.length < 2) continue;
    const len = pathLength(path);
    const max = maxMoveDistance(s, u, kind, m, opt);
    if (len > max + 0.02) { errors.push(`${m.name} moved ${len.toFixed(1)}", more than ${max.toFixed(1)}"`); bad.add(m.id); }
    const why = pathBlocked(s, u, kind, m, path, opt);
    if (why === 'enemy') { errors.push(`${m.name} cannot move through enemy models`); bad.add(m.id); }
    if (why === 'wall') { errors.push(`${m.name} cannot move through a terrain wall — release and a way around will be found`); bad.add(m.id); }
  }
  endChecks(s, u, pos, errors, bad);
  const eng = engagedAt(s, u, pos);
  if (kind === 'scout') {
    const enemiesNear = boardUnits(s, other(u.owner)).some((e) => alive(u).some((m) => { const p = pos.get(m.id) ?? m; return alive(e).some((n) => dist(p, n) - m.r - n.r <= RULES.reserves.enemyDistance); }));
    if (enemiesNear) errors.push(`A Scout move must end more than ${RULES.reserves.enemyDistance}" from all enemy units`);
  }
  if (['normal', 'advance', 'fallback', 'ingress', 'extra', 'surge'].includes(kind) && eng.length) { errors.push(`Cannot end within Engagement Range (${RULES.engagementRange}") of an enemy`); }
  // Rigid Discipline: the move must end wholly in the deployment zone or within range of an objective
  if (kind === 'extra' && u.extraMove?.endIn) {
    const at = alive(u).map((m) => { const pth = paths.get(m.id); return { ...m, ...(pth ? pth[pth.length - 1] : {}) }; });
    const inDz = u.extraMove.endIn === 'dzOrObjective' && at.every((m) => circleWhollyInPoly(m, m.r, zoneOf(s, u.owner)));
    const onObj = s.objectives.some((o) => at.some((m) => dist(m, o) <= 3 + m.r + 1e-6));
    if (!inDz && !onObj) errors.push(u.extraMove.endIn === 'objective' ? 'Must end within range of an objective' : 'Must end wholly within your deployment zone or within range of an objective');
  }
  if (kind === 'charge' || kind === 'heroic' as MoveKind) {
    const targets = (opt.targets ?? []).map((id) => unitById(s, id));
    for (const t of targets) if (!eng.includes(t)) errors.push(`Must end engaged with the target ${t.name}`);
    if (kind === 'charge' && u.chargeMust?.turn === s.turn && !targets.some((t) => t.id === u.chargeMust!.id)) errors.push(`Must charge ${unitById(s, u.chargeMust.id).name} too (it must end engaged with it)`);
    if (kind === 'charge' && unitFlags(s, u).chargeMustEngaged && !targets.some((t) => engagedEnemies(s, t).some((f) => f.id !== u.id))) errors.push('Refusal to be Outdone: must charge an enemy unit that is already engaged');
    for (const e of eng) if (!targets.includes(e)) errors.push(`Cannot end engaged with a unit that was not a target (${e.name})`);
    for (const m of alive(u)) {
      const path = paths.get(m.id);
      if (!path || path.length < 2 || pathLength(path) < 0.01) continue;
      const before = Math.min(...targets.flatMap((t) => alive(t).map((n) => baseDist(m, n))));
      const after = Math.min(...targets.flatMap((t) => alive(t).map((n) => dist(path[path.length - 1], n) - m.r - n.r)));
      if (after > before + 1e-6) { errors.push(`${m.name} must end closer to the target`); bad.add(m.id); }
    }
  }
  if (kind === 'pileIn' || kind === 'consolidate') {
    const engagedBefore = engagedEnemies(s, u);
    for (const m of alive(u)) {
      const path = paths.get(m.id);
      if (!path || path.length < 2 || pathLength(path) < 0.01) continue;
      if (enemyModels.some((e) => baseDist(m, e) <= 0.05)) { errors.push(`${m.name} is in base contact with an enemy and cannot move`); bad.add(m.id); }
      for (const e of engagedBefore) if (modelEngagedWith(m, e)) {
        const p = path[path.length - 1];
        if (!alive(e).some((n) => dist(p, n) - m.r - n.r <= RULES.engagementRange + 1e-6)) { errors.push(`${m.name} must stay engaged with ${e.name}`); bad.add(m.id); }
      }
    }
    if (kind === 'pileIn' && !eng.length) errors.push('After a pile-in move the unit must be engaged');
    if (kind === 'consolidate' && !eng.length && unitFlags(s, u).consolidateEngage && alive(u).some((m) => pathLength(paths.get(m.id) ?? []) > 3 + 1e-6)) errors.push('Incessant Violence: a Consolidation of more than 3" must end engaged');
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], bad: [...bad] };
}

export function validatePlacement(s: GameState, u: UnitState, pos: Map<string, Pt>, how: 'deploy' | 'ingress' | 'deepStrike' | 'infiltrate'): MoveCheck {
  const errors: string[] = [];
  const bad = new Set<string>();
  endChecks(s, u, pos, errors, bad);
  const enemies = boardUnits(s, other(u.owner));
  const enemyZone = zoneOf(s, other(u.owner));
  const fl = how === 'deploy' ? null : unitFlags(s, u); // worked out once, not per model
  const omnis = how === 'ingress' || how === 'deepStrike' ? enemies.map((e) => ({ e, omni: unitFlags(s, e).omniScrambler })).filter((x) => x.omni) : [];
  for (const m of alive(u)) {
    const p = pos.get(m.id) ?? m;
    if (how === 'deploy' && !circleWhollyInPoly(p, m.r, zoneOf(s, u.owner))) { errors.push('Must be set up wholly within your deployment zone'); bad.add(m.id); }
    // Teleport Homer: arriving in the opponent's turn (Rapid Ingress, 0CP) is within 3" of its token, and 8" is enough
    const homer = u.homer && how !== 'deploy' && how !== 'infiltrate' && s.active !== u.owner ? u.homer : undefined;
    if (homer && dist(p, homer) - m.r > 3 + EPS) { errors.push('Teleport Homer: must be set up within 3" of the token'); bad.add(m.id); }
    if (how !== 'deploy') {
      const keep = homer ? 8 : how === 'deepStrike' ? fl!.deepStrikeRange : RULES.reserves.enemyDistance;
      if (enemies.some((e) => alive(e).some((n) => dist(p, n) - m.r - n.r <= keep))) { errors.push(`Must be more than ${keep}" from all enemy units`); bad.add(m.id); }
    }
    const dsNear = how === 'deepStrike' ? fl!.deepStrikeNear : undefined;
    if (dsNear && !boardUnits(s, u.owner).some((f) => f.id !== u.id && (hasKw(f, dsNear.kw) || f.factionKeywords.includes(dsNear.kw)) && alive(f).some((n) => dist(p, n) + m.r - n.r <= dsNear.range + 1e-6))) { errors.push(`Must be set up wholly within ${dsNear.range}" of a friendly ${dsNear.kw} unit`); bad.add(m.id); }
    if (how === 'deepStrike' && fl!.deepStrikeInFlow && !circleInFlow(s, u.owner, p, m.r)) { errors.push('Through the Veil: must be set up wholly within your Flow of Magic'); bad.add(m.id); }
    if (how === 'ingress' || how === 'deepStrike') {
      for (const { e, omni } of omnis) {
        if (alive(e).some((n) => dist(p, n) - m.r - n.r <= omni)) { errors.push(`Cannot be set up within ${omni}" of ${e.name} (Omni-scramblers)`); bad.add(m.id); }
      }
    }
    if (how === 'infiltrate' && circleTouchesPoly(p, m.r + RULES.reserves.enemyDistance, enemyZone)) { errors.push(`Infiltrators must be more than ${RULES.reserves.enemyDistance}" from the enemy deployment zone`); bad.add(m.id); }
    if (how === 'ingress') {
      const edge = Math.min(p.x + m.r, p.y + m.r, W - p.x + m.r, H - p.y + m.r);
      if (Math.min(p.x, p.y, W - p.x, H - p.y) + m.r > RULES.reserves.edgeDistance + EPS || edge < 0) { errors.push(`An ingress move must end within ${RULES.reserves.edgeDistance}" of a battlefield edge`); bad.add(m.id); }
      if (s.round < RULES.reserves.noEnemyZoneBeforeRound && circleTouchesPoly(p, m.r, enemyZone)) { errors.push('Cannot be set up in the enemy deployment zone before battle round 3'); bad.add(m.id); }
    }
  }
  if (engagedAt(s, u, pos).length) errors.push('Must be set up unengaged');
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

/** Models hugging a transport's hull on the side facing `angle`: up to two rings, so a whole squad fits wholly within
 *  3" (a grid of 10 would stick out too far). Characters take the middle of the arc. */
/**
 * The unit set up next to a hull (getting out of a transport), on the side `angle` points to, every model wholly
 * within `within`" of the hull: a compact block, two rows deep where the bases fit inside the distance, filled from
 * the middle of that side outwards — not a ring round the whole vehicle. Falls back to arcs when the block can't fit.
 */
export function ringFormation(u: UnitState, tm: ModelState, angle: number, maxArc = 2 * Math.PI, within = 3): Map<string, Pt> {
  return packFormation(u, tm, angle, within) ?? arcFormation(u, tm, angle, maxArc);
}

/**
 * Getting out next to a hull with something in the way (walls, objective markers, other units, the enemy): the same
 * packing as ringFormation, but each model only takes a spot it may end on. Null when the unit doesn't fit that side.
 */
export function fitFormation(s: GameState, u: UnitState, tm: ModelState, angle: number, within = 3, engage = false): Map<string, Pt> | null {
  const reach = tm.r + within + 2;
  const others = s.units.filter((x) => x.id !== u.id && onBoard(x)).flatMap((x) => alive(x).map((m) => ({ m, foe: x.owner !== u.owner && !hasKw(x, 'AIRCRAFT') })))
    .filter(({ m }) => dist(m, tm) - m.r <= reach + 1);
  const walls = s.terrain.flatMap((t) => t.walls).filter((w) => pointSegDist(tm, w) <= reach + 1);
  const objectives = s.objectives.filter((o) => dist(o, tm) <= reach + 3);
  const boxes = s.terrain.filter((t) => (t.box || t.kind === 'container') && t.poly.some((q) => dist(q, tm) <= reach + 12));
  const free = (m: ModelState, p: Pt) => {
    if (p.x - m.r < 0 || p.y - m.r < 0 || p.x + m.r > W || p.y + m.r > H) return false;
    for (const o of others) {
      const gap = dist(p, o.m) - m.r - o.m.r;
      if (gap < 0.02 || (o.foe && !engage && gap <= RULES.engagementRange + 0.02)) return false;
    }
    if (walls.some((w) => pointSegDist(p, w) < m.r * 0.85 + 0.02)) return false;
    if (objectives.some((o) => dist(p, o) < m.r + OBJECTIVE_MARKER_R)) return false;
    const walker = ['INFANTRY', 'BEASTS', 'SWARM', 'FLY', 'MONSTER'].some((k) => m.keywords.includes(k));
    for (const t of boxes) {
      if (t.kind === 'container' && pointInPoly(p, t.poly) && !walker) return false;
      if (t.box && circleTouchesPoly(p, m.r - 0.05, t.box) && !(walker && circleWhollyInPoly(p, m.r, t.box))) return false;
    }
    return true;
  };
  return packFormation(u, tm, angle, within, free);
}

/** Ways to set a unit up round a hull, the side facing `angle` first: the plain packings, then packings round
 *  whatever is in the way (each tried only when the earlier ones were turned down). */
export function* hullSpots(s: GameState, u: UnitState, tm: ModelState, angle: number, within = 3, engage = false): Generator<Map<string, Pt>> {
  const turns = Array.from({ length: 16 }, (_, k) => angle + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8));
  for (const arc of [Math.PI * 0.8, 2 * Math.PI]) for (const a of turns) yield ringFormation(u, tm, a, arc, within);
  for (const a of turns) { const pos = fitFormation(s, u, tm, a, within, engage); if (pos) yield pos; }
}

function packFormation(u: UnitState, tm: ModelState, angle: number, within: number, free?: (m: ModelState, p: Pt) => boolean): Map<string, Pt> | null {
  const ms = [...alive(u)].sort((a, b) => Number(b.isCharacter) - Number(a.isCharacter) || b.r - a.r);
  const placed: { x: number; y: number; r: number }[] = [];
  const out = new Map<string, Pt>();
  const ax = { x: Math.cos(angle), y: Math.sin(angle) };
  for (const m of ms) {
    const rIn = tm.r + m.r + 0.08, rOut = tm.r + within - m.r - 0.03;
    if (rOut < rIn) return null;
    let best: { p: Pt; score: number } | null = null;
    for (let R = rIn; R <= rOut + 1e-9; R += 0.12) {
      const step = 0.05 / Math.max(1, R / 3);
      for (let k = 0; k * step <= Math.PI; k++) {
        for (const sgn of k ? [1, -1] : [1]) {
          const a = angle + sgn * k * step;
          const p = { x: tm.x + Math.cos(a) * R, y: tm.y + Math.sin(a) * R };
          if (placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < q.r + m.r + 0.06)) continue;
          if (free && !free(m, p)) continue;
          // stay in coherency with the models already out (within 2" of one of them)
          if (placed.length && !placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) - q.r - m.r <= 1.9)) continue;
          // the middle of the chosen side first, then outwards; a model further from the hull only when it packs tighter
          const side = Math.abs(((a - angle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * R;
          const toward = (p.x - tm.x) * ax.x + (p.y - tm.y) * ax.y;
          const score = side * 1.0 - toward * 0.15 + (placed.length ? Math.min(...placed.map((q) => Math.hypot(q.x - p.x, q.y - p.y))) * 0.3 : 0);
          if (!best || score < best.score) best = { p, score };
        }
      }
    }
    if (!best) return null;
    placed.push({ ...best.p, r: m.r });
    out.set(m.id, best.p);
  }
  return out;
}

/** Fallback: rings round the hull, each ring's arc at most `maxArc` radians wide. */
function arcFormation(u: UnitState, tm: ModelState, angle: number, maxArc: number): Map<string, Pt> {
  const ms = [...alive(u)].sort((a, b) => Number(b.isCharacter) - Number(a.isCharacter) || b.r - a.r);
  const rMax = Math.max(...ms.map((m) => m.r));
  const out = new Map<string, Pt>();
  let placed = 0;
  // each ring hugs the hull with every base at its own size (a Lieutenant's 40mm next to Intercessors' 32mm); as many as
  // fit go on the inner ring (the one inside 3" of the hull): coherency only needs one friend within 2" and the whole
  // unit within 9" (between bases), so one arc is fine while its ends stay that close
  for (let ring = 0; placed < ms.length && ring < 4; ring++) {
    const gap = 0.12 + ring * (2 * rMax + 0.08);
    const rad = (m: ModelState) => tm.r + m.r + gap;
    const width = (m: ModelState) => 2 * Math.asin(Math.min(1, (m.r + 0.06) / rad(m)));
    const R = tm.r + rMax + gap;
    const spanMax = (RULES.coherency.max + 2 * rMax) / (2 * R) >= 1 ? 2 * Math.PI : 2 * Math.asin((RULES.coherency.max + 2 * rMax) / (2 * R));
    const take: ModelState[] = [];
    let total = 0;
    for (const m of ms.slice(placed)) {
      const w = width(m);
      if (take.length && (total + w > Math.min(2 * Math.PI, maxArc) + 1e-6 || total + w / 2 > spanMax + width(take[0]) / 2)) break;
      take.push(m); total += w;
    }
    // the first in the middle of the arc, then alternately to each side
    let left = -width(take[0]) / 2, right = width(take[0]) / 2;
    take.forEach((m, k) => {
      const w = width(m);
      let a = 0;
      if (k > 0 && k % 2) { a = right + w / 2; right += w; } else if (k > 0) { a = left - w / 2; left -= w; }
      out.set(m.id, { x: tm.x + Math.cos(angle + a) * rad(m), y: tm.y + Math.sin(angle + a) * rad(m) });
    });
    placed += take.length;
  }
  return out;
}

export function placeUnit(s: GameState, u: UnitState, pos: Map<string, Pt>) {
  for (const m of alive(u)) { const p = pos.get(m.id)!; m.x = p.x; m.y = p.y; }
  u.status = 'board';
  u.setUpTurn = s.turn;
  if (s.phase !== 'deploy' && s.phase !== 'scouts') { arrivalShock(s, u); unleashWrathHook?.(s, u); }
  // Seeker of the Unfound: the first time it is set up, it picks an objective (the nearest one out in the field)
  if (!u.seekerObjective && unitHasAbility(u, 'Seeker of the Unfound') && s.objectives.length) {
    const c = polyCentroid(alive(u));
    const field = s.objectives.filter((o) => o.type !== 'home');
    const o = (field.length ? field : s.objectives).reduce((a, b) => (dist(b, c) < dist(a, c) ? b : a));
    u.seekerObjective = o.id;
    log(s, `Seeker of the Unfound: ${u.name} picks objective ${s.objectives.indexOf(o) + 1}`, 'info', u.owner);
  }
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
  log(s, `Deployed ${u.name}`, 'info', u.owner);
  nextDeployer(s);
  return chk;
}

export function sendToReserves(s: GameState, unitId: string): string | null {
  const u = unitById(s, unitId);
  if (reservesPoints(s, u.owner) + u.pts > armyPoints(s, u.owner) * RULES.reserves.maxPointsFraction) return `Strategic Reserves cannot exceed ${RULES.reserves.maxPointsFraction * 100}% of the army's points`;
  u.status = 'reserves';
  log(s, `${u.name} is in Strategic Reserves${hasDeepStrike(s, u) ? ' (Deep Strike)' : ''}`, 'info', u.owner);
  nextDeployer(s);
  return null;
}

function nextDeployer(s: GameState) {
  const pending = (p: PlayerId) => s.units.some((u) => u.owner === p && u.status === 'pending');
  if (s.redeploy) return; // re-deploying: the player says when they are done
  const o = other(s.deployTurn);
  if (pending(o)) s.deployTurn = o;
  else if (!pending(s.deployTurn)) finishDeployment(s);
}

// the army's own units (Space Marines, Adeptus Custodes) — not allies
const isAstartes = (u: UnitState) => ['ADEPTUS ASTARTES', 'ADEPTUS CUSTODES', 'THOUSAND SONS', 'WORLD EATERS', 'HERETIC ASTARTES', 'EMPEROR’S CHILDREN'].some((k) => u.factionKeywords.includes(k) || hasKw(u, k));

/** Abilities that let a player redeploy units once both armies are deployed: how many, and of which kind. */
/** Unleash Wrath (stratagems.ts registers it: it shoots or charges, which lives there). */
let unleashWrathHook: ((s: GameState, u: UnitState) => void) | null = null;
export const setUnleashWrath = (fn: (s: GameState, u: UnitState) => void) => { unleashWrathHook = fn; };

const REDEPLOY: { name: string; n: number; infantryOnly: boolean; units?: string[] }[] = [
  { name: 'Strategic Slaughter', n: 3, infantryOnly: false, units: ['JAKHALS', 'GOREMONGERS'] }, // World Eaters: Cult of Blood
  { name: 'Tactical Perfection', n: 2, infantryOnly: false, units: ['EMPEROR’S CHILDREN'] }, // Emperor's Children: Mercurial Host
  { name: 'Master of Deceit', n: 3, infantryOnly: true },
  { name: 'Strategium Command', n: 3, infantryOnly: false },
  // Enhancements that redeploy (2026 Codex)
  { name: 'Cyber-familiar', n: 3, infantryOnly: true },
  { name: 'Defensive Mastery', n: 3, infantryOnly: true },
  { name: 'Hunter’s Guile', n: 3, infantryOnly: false },
  { name: "Hunter's Guile", n: 3, infantryOnly: false },
  { name: 'Chariots of the Storm', n: 3, infantryOnly: false },
  { name: "Castellan's Mark", n: 3, infantryOnly: false }, // Adeptus Custodes
  { name: 'Scryer of Fates (Psychic)', n: 3, infantryOnly: false }, // Thousand Sons: Ahriman
  { name: 'Duplicitous Malediction', n: 3, infantryOnly: false },
  { name: 'Fleet Command', n: 3, infantryOnly: false }, // Chaos Space Marines: Masters of the Maelstrom
  { name: "Kaptin's Hat", n: 3, infantryOnly: true }, // Orks: Wreckas enhancement
];

function redeployFor(s: GameState, p: PlayerId) {
  const mine = s.units.filter((u) => u.owner === p && (u.status === 'board' || u.status === 'embarked'));
  return REDEPLOY.filter((r) => mine.some((u) => unitHasAbility(u, r.name))).sort((a, b) => b.n - a.n)[0];
}

/** Units a player may pick up to redeploy now. */
export function redeployCandidates(s: GameState): UnitState[] {
  const r = s.redeploy;
  if (!r) return [];
  return s.units.filter((u) => u.owner === r.player && (u.status === 'board' || u.status === 'reserves') && isAstartes(u) && (!r.infantryOnly || hasKw(u, 'INFANTRY')) && (!r.units || r.units.some((k) => hasKw(u, k))) && !u.transport);
}

/** Pick a unit up: it is placed again (deployment rules) or, with toReserves, goes into Strategic Reserves (no limit). */
export function redeployUnit(s: GameState, unitId: string, toReserves: boolean): string | null {
  const r = s.redeploy;
  const u = unitById(s, unitId);
  if (!r || r.left <= 0 || !redeployCandidates(s).includes(u)) return 'This unit cannot be redeployed';
  r.left--;
  u.status = toReserves ? 'reserves' : 'pending';
  log(s, `${r.source}: ${u.name} ${toReserves ? 'moved into Strategic Reserves' : 'picked up to be set up again'}`, 'info', u.owner);
  return null;
}

/** The re-deploying player is done (every unit picked up has been placed again). */
export function endRedeploy(s: GameState): string | null {
  const r = s.redeploy;
  if (!r) return null;
  if (s.units.some((u) => u.owner === r.player && u.status === 'pending')) return 'Set up the units you picked up first';
  s.redeploy = { ...r, left: 0, done: [...r.done, r.player] };
  finishDeployment(s);
  return null;
}

function finishDeployment(s: GameState) {
  // redeploy abilities, the attacker first; each player once
  const doneP = s.redeploy?.done ?? [];
  const order: PlayerId[] = s.attackerPlayer != null ? [s.attackerPlayer, other(s.attackerPlayer)] : [0, 1];
  for (const p of order) {
    if (doneP.includes(p)) continue;
    const r = redeployFor(s, p);
    if (!r) continue;
    s.redeploy = { player: p, left: r.n, infantryOnly: r.infantryOnly, source: r.name, done: doneP, units: r.units };
    s.deployTurn = p;
    log(s, `${r.name}: ${s.players[p].name} can redeploy ${r.n} unit(s)${r.infantryOnly ? ' (INFANTRY)' : ''}: set up again or move into Strategic Reserves`, 'info', p);
    return;
  }
  s.redeploy = undefined;
  // a DEDICATED TRANSPORT with nobody inside at the start of the battle is not deployed: it counts as destroyed (18)
  for (const t of s.units) {
    if (!t.transport || !hasKw(t, 'DEDICATED TRANSPORT') || t.status === 'destroyed' || !alive(t).length) continue;
    if (s.units.some((u) => u.embarkedIn === t.id && u.status === 'embarked')) continue;
    t.status = 'destroyed';
    for (const m of t.models) { m.dead = true; m.wounds = 0; }
    log(s, `${t.name} (Dedicated Transport) has no unit embarked → not set up, counts as destroyed`, 'kill', t.owner);
  }
  const ro = rollOff(s);
  s.firstPlayer = ro.winner;
  pushFx(s, { kind: 'rolloff', title: 'Roll-off: who goes first?', a: ro.a, b: ro.b, winner: ro.winner, result: `${s.players[ro.winner].name} goes first` });
  log(s, `Roll-off for first turn: ${s.players[0].name} ${ro.a} – ${s.players[1].name} ${ro.b} → ${s.players[ro.winner].name} goes first`, 'roll', null);
  s.round = 1;
  s.turn = -1;
  if (s.units.some((u) => u.status === 'board' && scoutsOf(s, u))) {
    s.phase = 'scouts';
    s.deployTurn = ro.winner;
    log(s, 'Pre-battle: Scout moves (first player first)', 'info', null);
    return;
  }
  startTurn(s, ro.winner);
}

export const scoutsOf = (s: GameState, u: UnitState) => Math.max(u.core.scouts ?? 0, unitFlags(s, u).scouts);
export const hasDeepStrike = (s: GameState, u: UnitState) => !!u.core.deepStrike || unitFlags(s, u).deepStrike;
export const scoutUnits = (s: GameState, p: PlayerId) => s.units.filter((u) => u.owner === p && u.status === 'board' && scoutsOf(s, u) > 0 && !u.scoutDone);

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
  expireTimed(s, 'turnStart', p);
  resetTurnFlags(s);
  snapshotEngaged(s);
  s.controlAtTurnStart = s.objectives.map((o) => o.controller);
  onTurnStart(s);
  log(s, `Battle Round ${s.round} · ${s.players[p].name}'s turn`, 'info', p);
  detOnCommandStart(s, p, p === s.firstPlayer);
  if (s.turn === 0) { initSagas(s); initFavoured(s); fireAll(s, 'battleStart', 'both'); }
  if (p === s.firstPlayer) { blessingsRoundStart(s); pledgeRoundStart(s); fireAll(s, 'roundStart', 'both'); }
  startCommand(s);
}

function startCommand(s: GameState) {
  s.phase = 'command';
  expireTimed(s, 'commandStart', s.active);
  // Instant of Grace / Birth of a Saga end
  for (const t of (s.tempCharacters ?? []).filter((x) => x.by === s.active)) {
    const m = s.units.find((u) => u.id === t.unitId)?.models.find((x) => x.id === t.modelId);
    if (m) { m.isCharacter = false; m.keywords = m.keywords.filter((k) => k !== 'CHARACTER'); }
  }
  if (s.tempCharacters) s.tempCharacters = s.tempCharacters.filter((x) => x.by !== s.active);
  for (const p of [0, 1] as PlayerId[]) s.players[p].cp += RULES.cpPerCommandPhase;
  log(s, `+${RULES.cpPerCommandPhase}CP to both players (${s.players[0].cp} / ${s.players[1].cp})`, 'cp', null);
  poisonTick(s);
  fireFor(s, 'commandStart', s.active);
  fireFor(s, 'eachCommandStart', 'both');
  drawUpTo(s, s.active);
  emitReact(s, other(s.active), 'enemyCommandStart', {});
  // Terrifying Proficiency: enemy units near the marked unit must test too (−1 when Below Half-strength)
  const terrors = boardUnits(s, other(s.active)).filter((e) => unitFlags(s, e).forceShockAura > 0);
  const forced = (u: UnitState) => terrors.some((e) => unitDistance(u, e) <= unitFlags(s, e).forceShockAura + 1e-6);
  // Creeping Dread (Null Maiden Vigil): enemy PSYKER units and units below starting strength near it test at -1
  const dreads = boardUnits(s, other(s.active)).filter((e) => unitFlags(s, e).creepingDread > 0);
  const dreaded = (u: UnitState) => onBoard(u) && (hasKw(u, 'PSYKER') || alive(u).length < u.startingStrength)
    && dreads.some((e) => unitDistance(u, e) <= unitFlags(s, e).creepingDread + 1e-6);
  // Terror Descends / Terror Made Manifest: enemy units below Starting Strength near them must test
  const terrorSrc = boardUnits(s, other(s.active)).filter((e) => unitFlags(s, e).terrorBelow > 0);
  const terror = (u: UnitState) => onBoard(u) && alive(u).length < u.startingStrength ? terrorSrc.filter((e) => unitDistance(u, e) <= unitFlags(s, e).terrorBelow + 1e-6) : [];
  const terrorMod = (u: UnitState) => Math.min(0, ...terror(u).map((e) => unitFlags(s, e).terrorBelowMod));
  s.shockTests = s.units
    .filter((u) => u.owner === s.active && u.status !== 'destroyed' && u.status !== 'pending' && alive(u).length)
    .filter((u) => u.battleShocked || strength(u) === 'half' || strength(u) === 'belowHalf' || (onBoard(u) && forced(u)) || dreaded(u) || terror(u).length > 0)
    .map((u) => ({ unitId: u.id, result: null, passed: null, ...((forced(u) && strength(u) === 'belowHalf') || dreaded(u) ? { mod: -1 } : terrorMod(u) ? { mod: terrorMod(u) } : {}) }));
}

export function bestLd(u: UnitState, s?: GameState) {
  const base = Math.min(...alive(u).map((m) => m.profile.Ld));
  if (!s) return base;
  const f = unitFlags(s, u);
  return Math.min(base, f.ldSet) - f.ld;
}

export function rollBattleShock(s: GameState, unitId: string, insaneBravery = false) {
  const t = s.shockTests.find((x) => x.unitId === unitId)!;
  const u = unitById(s, unitId);
  if (insaneBravery) {
    spendStratagem(s, u.owner, 'insane-bravery', u);
    t.result = 0; t.passed = true; t.auto = true;
  } else {
    const ld = bestLd(u, s);
    const mod = unitFlags(s, u).ignoreMods ? 0 : t.mod ?? 0;
    if (unitFlags(s, u).autoPassShock) { t.result = 12; t.passed = true; t.auto = true; log(s, `${u.name}: Battle-shock test passed automatically`, 'info', u.owner); return; }
    let r = rollN(s, 2);
    t.result = r[0] + r[1] + mod;
    t.passed = t.result >= ld;
    if (!t.passed && rollMods(s, u).rerollShock) {
      log(s, `${u.name}: re-roll Battle-shock (ability)`, 'info', u.owner);
      r = rollN(s, 2);
      t.result = r[0] + r[1] + mod;
      t.passed = t.result >= ld;
    }
    pushFx(s, { kind: 'roll', owner: u.owner, title: `Battle-shock · ${u.name}`, dice: r, result: `${t.result} vs Ld ${ld}+ → ${t.passed ? 'passed' : 'failed!'}`, good: t.passed });
    log(s, `Battle-shock ${u.name}: 2D6 [${r.join('+')}] = ${t.result} vs Ld ${ld}+ → ${t.passed ? 'passed' : 'failed'}`, 'roll', u.owner);
  }
  const was = u.battleShocked;
  u.battleShocked = !t.passed;
  if (was && t.passed) log(s, `${u.name} is no longer Battle-shocked`, 'info', u.owner);
  if (!was && !t.passed) fire(s, 'becameShocked', [u]);
}

/** The bot's decisions at the end of a phase of the other player (Echo of the Ravenspire …), set by botPlus.ts. */
let phaseEndHook: ((s: GameState, phase: Phase) => void) | null = null;
export const setPhaseEndHook = (h: (s: GameState, phase: Phase) => void) => { phaseEndHook = h; };

export function endPhase(s: GameState) {
  updateControl(s);
  if (s.phase === 'movement') {
    fireFor(s, 'movementEnd', s.active);
    updateControl(s);
    // Uphold the Honour of the Emperor (Vow-sworn Crusaders): objectives INFANTRY control now are secured
    for (const u of boardUnits(s, s.active)) {
      if (!unitFlags(s, u).secureAtMovementEnd || !hasKw(u, 'INFANTRY')) continue;
      for (const o of s.objectives) if (o.controller === s.active && alive(u).some((m) => dist(m, o) <= 3 + m.r + 1e-6)) o.secured = s.active;
    }
  }
  resolveRevivals(s);
  if (s.window?.kind === 'abilityMove') s.window = null;
  expireTimed(s, 'phaseEnd', s.active);
  if (s.phase === 'command') {
    fireFor(s, 'commandEnd', s.active);
    // Uphold the Honour of the Emperor (Templar Vows): objectives held now stay yours
    for (const u of boardUnits(s, s.active)) {
      if (!unitFlags(s, u).secureAtCommandEnd || !hasKw(u, 'INFANTRY')) continue;
      for (const o of s.objectives) if (o.controller === s.active && alive(u).some((m) => dist(m, o) <= 3 + m.r + 1e-6)) o.secured = s.active;
    }
    sagaBoasts(s, 'commandEnd');
    scoreTiming(s, 'endOfYourCommandPhase');
    s.phase = 'movement';
    expireTimed(s, 'movementStart', s.active);
    fireFor(s, 'movementStart', s.active);
    // Falsehood: the hidden Chaos Lord in Reserves can take a Legionary's place now
    fire(s, 'movementStart', s.units.filter((u) => u.owner === s.active && u.status === 'reserves' && u.enhancements.some((e) => e.name === 'Falsehood')));
  } else if (s.phase === 'movement') {
    for (const u of boardUnits(s, s.active)) if (!u.move) { u.move = 'stationary'; u.lastStationaryTurn = s.turn; }
    s.phase = 'shooting';
    // "at the start of your (opponent's) Shooting phase" (Marked by Fate, Treason of Tzeentch …)
    fireFor(s, 'shootingStart', s.active);
    fireFor(s, 'oppShootingStart', other(s.active));
    openWindow(s, 'endOfMovement');
    if (!s.window) openWindow(s, 'startOfShooting');
  } else if (s.phase === 'shooting') {
    s.phase = 'charge';
    fireFor(s, 'chargeStart', s.active);
    emitReact(s, other(s.active), 'enemyChargePhaseStart', {});
  } else if (s.phase === 'charge') {
    if (phaseEndReactions(s, 'enemyChargePhaseEnd', [other(s.active)])) return;
    miraculousSaviour(s);
    fireFor(s, 'chargeEnd', s.active);
    s.phase = 'fight';
    startFight(s);
    openWindow(s, 'endOfCharge');
  } else if (s.phase === 'fight') {
    if (phaseEndReactions(s, 'fightPhaseEnd', [other(s.active), s.active])) return;
    fireFor(s, 'fightEnd', 'both');
    // Rise to the Challenge: a unit gets to fight once more before the phase ends
    if (s.fight?.forcedNext && s.fight.eligible.includes(s.fight.forcedNext)) return;
    phaseEndHook?.(s, 'fight');
    fireFor(s, 'opponentFightEnd', other(s.active));
    s.fight = null;
    endTurn(s);
  }
  s.units.forEach((u) => { u.buffs = u.buffs.filter((b) => b.until !== 'phase'); u.weaponsFired = []; });
}

/** Stratagems used "at the end of the … phase": offered once, before the phase actually ends. True = wait for a prompt. */
function phaseEndReactions(s: GameState, on: ReactOn, players: PlayerId[]): boolean {
  const key = `${s.turn}:${s.phase}:${on}`;
  const done = (s.reactDone ??= []);
  if (done.includes(key)) return false;
  done.push(key);
  if (done.length > 12) done.splice(0, done.length - 12);
  for (const [i, p] of players.entries()) {
    emitReact(s, p, on, {});
    if (s.window) {
      for (const q of players.slice(i + 1)) (s.reactQueue ??= []).push({ player: q, on, ctx: {}, turn: s.turn, phase: s.phase });
      if (s.window.kind === 'stratReaction') s.window.resume = 'endPhase';
      return true;
    }
  }
  return false;
}

function endTurn(s: GameState) {
  expireTimed(s, 'turnEnd', s.active);
  // Regaining coherency (03.03)
  for (const u of boardUnits(s)) {
    let models = alive(u);
    let probs = coherencyProblems(models, RULES.coherency.near, RULES.coherency.max, models.map((m) => m.r));
    while (probs.length && models.length > 1) {
      const c = polyCentroid(models);
      // controlling player's choice: drop ordinary, low-wound models first, furthest from the group
      const worst = probs.map((i) => models[i]).sort((a, b) => Number(a.isCharacter) - Number(b.isCharacter) || a.profile.W - b.profile.W || dist(b, c) - dist(a, c))[0];
      killModel(s, u, worst);
      log(s, `${u.name}: ${worst.name} removed (out of Unit Coherency)`, 'info', u.owner);
      models = alive(u);
      probs = coherencyProblems(models, RULES.coherency.near, RULES.coherency.max, models.map((m) => m.r));
    }
  }
  // Aircraft return to reserves at the end of the opponent's turn
  for (const u of boardUnits(s, other(s.active))) if (hasKw(u, 'AIRCRAFT')) u.status = 'reserves';
  updateControl(s);
  sagaBoasts(s, 'turnEnd');
  onTurnEnd(s);
  scoreTiming(s, 'endOfYourTurn');
  for (const p of [0, 1] as PlayerId[]) scorePrimary(s, 'endOfAnyTurn', p);
  scoreSecondaries(s, s.round === lastRound(s) && s.active !== s.firstPlayer);
  const second = s.active !== s.firstPlayer;
  if (!second) { s.phase = 'command'; startTurn(s, other(s.active)); return; }
  // end of battle round
  pledgeRoundEnd(s);
  if (s.round === RULES.reserves.destroyedAfterRound) {
    for (const u of s.units) if (u.status === 'reserves' && !hasKw(u, 'AIRCRAFT')) {
      u.status = 'destroyed';
      log(s, `${u.name} did not arrive from Reserves by battle round ${s.round} → destroyed`, 'kill', u.owner);
    }
  }
  if (s.round >= lastRound(s)) { endBattle(s); return; }
  s.round += 1;
  startTurn(s, s.firstPlayer);
}

function endBattle(s: GameState) {
  for (const p of [s.firstPlayer, other(s.firstPlayer)] as PlayerId[]) scoreTiming(s, 'endOfBattle', p);
  s.phase = 'gameover';
  const [a, b] = [s.players[0].vp + s.players[0].secVp, s.players[1].vp + s.players[1].secVp];
  s.winner = a === b ? 'draw' : a > b ? 0 : 1;
  log(s, `Battle over: ${s.players[0].name} ${a} VP – ${s.players[1].name} ${b} VP → ${s.winner === 'draw' ? 'draw' : s.players[s.winner].name + ' wins!'}`, 'vp', null);
}

// ---------- movement phase actions ----------

export function rollAdvance(s: GameState, u: UnitState) {
  const det = rollMods(s, u);
  if (det.advanceFixed) {
    // Full Throttle / Target Sighted: no Advance roll, a fixed bonus instead
    u.advanceRoll = det.advanceFixed;
    log(s, `${u.name} Advance: no roll, +${det.advanceFixed}"`, 'info', u.owner);
    return;
  }
  const raw = det.advanceSix ? 6 : d6(s);
  const bonus = (u.buffs.some((b) => b.kind === 'advanceCharge+1') ? 1 : 0) + det.advanceBonus;
  u.advanceRoll = raw + bonus;
  pushFx(s, { kind: 'roll', owner: u.owner, title: `Advance · ${u.name}`, dice: [raw], result: `M + ${u.advanceRoll}"${bonus ? ` (+${bonus})` : ''}${det.advanceSix ? ' (Detachment: 6)' : ''}`, good: u.advanceRoll >= 4 });
  log(s, `${u.name} Advance: rolled ${u.advanceRoll}${det.advanceSix ? ' (Detachment rule: counts as 6)' : ''}`, 'roll', u.owner);
  if (det.advanceSelfMortals && !u.detAdvanceHurt?.startsWith(`${s.turn}:`)) {
    u.detAdvanceHurt = `${s.turn}:advance`;
    const mw = rollExpr(s, det.advanceSelfMortals).total;
    applyMortalWounds(s, u, mw, 'Detachment rule (Advance)');
  }
}

/** Free re-roll of an Advance or Charge roll from a detachment rule (once per roll). */
export function canDetReroll(s: GameState, u: UnitState, what: 'advance' | 'charge'): boolean {
  const r = rollMods(s, u);
  return (what === 'advance' ? r.rerollAdvance && !r.advanceSix : r.rerollCharge) && u.detRerolled !== `${s.turn}:${what}`;
}
export function detReroll(s: GameState, u: UnitState, what: 'advance' | 'charge', fly = false, cap?: number) {
  u.detRerolled = `${s.turn}:${what}`;
  log(s, `${u.name}: re-roll ${what === 'advance' ? 'Advance' : 'Charge'} for free (Detachment rule)`, 'info', u.owner);
  if (what === 'advance') rollAdvance(s, u);
  else {
    // Snarling Protector: that re-roll means ending engaged with an enemy unit engaged with the friendly PSYKER
    if (u.abilities.some((a) => a.name === 'Snarling Protector')) {
      const psy = boardUnits(s, u.owner).filter((f) => f.id !== u.id && hasKw(f, 'PSYKER') && unitDistance(u, f) <= 12 + 1e-6);
      u.chargeOnly = { turn: s.turn, ids: psy.flatMap((f) => engagedEnemies(s, f).map((e) => e.id)) };
    }
    u.declaredCharge = false; declareCharge(s, u, fly, cap);
  }
}

/** Blackstar Cluster Launcher: after a Normal move, one enemy unit it flew over takes 6D6, a mortal wound per 5+
 *  (always worth it, so it happens by itself, on the enemy unit worth the most). */
/** Enemy units the unit's models passed over during this move. */
function movedOverUnits(s: GameState, u: UnitState, paths: Map<string, Pt[]>): UnitState[] {
  const segs = alive(u).flatMap((m) => { const p = paths.get(m.id) ?? []; return p.slice(1).map((q, i) => ({ a: p[i], b: q, r: m.r })); });
  if (!segs.length) return [];
  return s.units.filter((e) => e.owner !== u.owner && onBoard(e) && alive(e).some((n) => segs.some((g) => pointSegDist(n, g) <= n.r + g.r)));
}

function blackstarLaunch(s: GameState, u: UnitState, paths: Map<string, Pt[]>) {
  if (!u.abilities.some((a) => a.name === 'Blackstar Cluster Launcher')) return;
  const over = movedOverUnits(s, u, paths);
  const t = over.sort((a, b) => b.pts * alive(b).length / Math.max(1, b.startingStrength) - a.pts * alive(a).length / Math.max(1, a.startingStrength))[0];
  if (!t) return;
  const r = rollN(s, 6);
  const n = r.filter((x) => x >= 5).length;
  log(s, `Blackstar Cluster Launcher: ${u.name} flies over ${t.name} [${r.join(' ')}] = ${n} MW`, 'roll', u.owner);
  if (n) applyMortalWounds(s, t, n, 'Blackstar Cluster Launcher');
}

export function commitMove(s: GameState, u: UnitState, kind: MoveKind, given: Map<string, Pt[]>) {
  // copy the points first: a path may start at the model object itself, which is about to move
  const paths = new Map([...given].map(([id, p]) => [id, p.map((q) => ({ x: q.x, y: q.y }))]));
  let maxMoved = 0;
  const engagedBefore = kind === 'fallback' ? engagedEnemies(s, u) : [];
  // Savage Frenzy / Judgement of the Weak / Cut Off Their Escape: falling back from these units forces Desperate Escape
  const forced = kind === 'fallback' && !alive(u).every(isMV)
    ? engagedEnemies(s, u).filter((e) => effectsFor(s, e).some((a) => a.e.forceDesperate)) : [];
  for (const m of alive(u)) {
    const path = paths.get(m.id);
    if (!path || path.length < 2) continue;
    maxMoved = Math.max(maxMoved, pathLength(path));
    const end = path[path.length - 1];
    m.x = end.x; m.y = end.y;
  }
  if (['normal', 'advance', 'fallback', 'stationary', 'ingress'].includes(kind)) u.move = kind;
  if (['normal', 'advance', 'fallback'].includes(kind)) s.lastAct = { unitId: u.id, owner: u.owner, kind: 'move', turn: s.turn, phase: s.phase, targets: [], lost: [], halved: [] };
  const reactAfterMove = ['normal', 'advance', 'fallback'].includes(kind) && u.owner === s.active && s.phase === 'movement';
  if (kind === 'extra' && u.extraMove?.asMove) u.move = 'normal';
  if (kind === 'extra' || kind === 'surge') { u.extraMove = undefined; offerDone(s, u.id); }
  if (kind === 'scout') u.scoutDone = true;
  u.maxMoved = Math.max(u.maxMoved, maxMoved);
  if (kind === 'fallback' && (u.battleShocked || forced.length)) {
    // Desperate Escape: hazard roll per model, made before moving (resolved here for simplicity)
    // forced by an ability while also battle-shocked: −1 to each test; Repulsed by Weakness (Favoured Champions): −1 more
    const worse = (forced.length && u.battleShocked ? 1 : 0) + Math.max(0, ...forced.flatMap((e) => effectsFor(s, e).filter((a) => a.e.desperateMinus && (a.e.if ?? []).every((c) => cond(c, { s, A: e, T: u, holder: a.holder }))).map((a) => a.e.desperateMinus!)));
    const { fails } = hazardTest(s, u, alive(u).length, `Desperate Escape${forced.length ? ` (forced by ${forced.map((f) => f.name).join(', ')})` : ''}`, worse);
    if (fails) applyMortalWounds(s, u, fails * (alive(u).every(isMV) ? RULES.hazard.mortalWoundsMonsterVehicle : RULES.hazard.mortalWounds), 'Desperate Escape');
  }
  const moved = alive(u).filter((m) => (paths.get(m.id)?.length ?? 0) > 1 && pathLength(paths.get(m.id)!) > 0.01);
  if (moved.length) pushFx(s, { kind: 'move', unitId: u.id, owner: u.owner, moveKind: kind, paths: moved.map((m) => [m.id, paths.get(m.id)!.map((q) => ({ x: q.x, y: q.y }))]) });
  const label: Record<string, string> = { scout: 'Scout move', normal: 'Normal move', advance: 'Advance', fallback: 'Fall back', charge: 'Charge move', pileIn: 'Pile-in', consolidate: 'Consolidate', ingress: 'Ingress' };
  if (kind === 'normal') {
    blackstarLaunch(s, u, paths);
    // "each time this model ends a Normal move, select one enemy unit it moved over" (Flame-wreathed, Slashing Dive)
    u.movedOver = { key: phaseKey(s), ids: movedOverUnits(s, u, paths).map((e) => e.id) };
    if (u.movedOver.ids.length) fire(s, 'endOfNormalMove', [u]);
  }
  onMoveEnd(s, u, kind);
  if (label[kind]) log(s, `${u.name}: ${label[kind]}${maxMoved ? ` (${maxMoved.toFixed(1)}")` : ''}`, 'info', u.owner);
  // Shokk-boosta: a hazard roll for each model after the Advance
  if (kind === 'advance' && unitFlags(s, u).advanceHazard) {
    const { fails } = hazardTest(s, u, alive(u).length, 'After Advancing');
    if (fails) applyMortalWounds(s, u, fails * (alive(u).every(isMV) ? RULES.hazard.mortalWoundsMonsterVehicle : RULES.hazard.mortalWounds), 'Hazard');
  }
  // reactions of the other player: "if an enemy unit ends a move within 8" of this unit …", "… Falls Back, this unit can make a Normal move"
  if (u.owner === s.active && s.phase === 'movement' && ['normal', 'advance', 'fallback', 'ingress'].includes(kind)) {
    offerReactions(s, 'enemyMovedNear', u);
    if (kind === 'fallback' && engagedBefore.length) offerReactions(s, 'enemyFellBack', u, engagedBefore.filter((e) => !isEngaged(s, e)));
  }
  // remember whom it fell back from ("an enemy unit that was engaged with your unit ends a Fall Back move")
  if (kind === 'fallback' && s.lastAct?.unitId === u.id) s.lastAct.fellBackFrom = engagedBefore.map((e) => e.id);
  if (['normal', 'advance', 'fallback', 'charge'].includes(kind)) sabotageCheck(s, u);
  // stratagems: "just after an enemy unit ends a Normal, Advance or Fall Back move" (Squad Tactics …)
  if (reactAfterMove) emitReact(s, other(u.owner), 'enemyMoved', { unitId: u.id });
}

/** A Deadly Prize: an enemy unit ending a move on a Sabotaged objective rolls a D6, on 2+ it suffers D3 mortal wounds. */
function sabotageCheck(s: GameState, u: UnitState) {
  for (const o of s.objectives) {
    // Mortis Snares: one trap, sprung by the first enemy unit that ends a move in range
    if (o.snared !== undefined && o.snared !== null && o.snared !== u.owner && alive(u).some((m) => dist(m, o) <= 3 + m.r + 1e-6)) {
      const by = o.snared;
      o.snared = null;
      const r = d6(s);
      const mw = r >= 2 ? rollExpr(s, 'D6').total : 0;
      log(s, `Mortis Snares: ${u.name} moved onto the snared objective — rolled ${r}${mw ? ` → ${mw} mortal wounds` : ', no effect'}`, 'roll', by);
      if (mw) applyMortalWounds(s, u, mw, 'Mortis Snares');
      if (!onBoard(u)) return;
    }
    if (o.mutated !== undefined && o.mutated !== null && o.mutated !== u.owner && o.controller === o.mutated && alive(u).some((m) => dist(m, o) <= 3 + m.r + 1e-6)) {
      const r = d6(s);
      const mw = r >= 4 ? rollExpr(s, 'D3').total : 0;
      log(s, `Mutate Landscape: ${u.name} ended a move on the mutated objective — rolled ${r}${mw ? ` → ${mw} mortal wounds` : ''}`, 'roll', o.mutated);
      if (mw) applyMortalWounds(s, u, mw, 'Mutate Landscape');
      if (!onBoard(u)) return;
    }
    if (o.sabotaged === undefined || o.sabotaged === null || o.sabotaged === u.owner || o.controller !== o.sabotaged) continue;
    if (!alive(u).some((m) => dist(m, o) <= 3 + m.r + 1e-6)) continue;
    const r = d6(s);
    const mw = r >= 2 ? rollExpr(s, 'D3').total : 0;
    log(s, `A Deadly Prize: ${u.name} ended a move on the sabotaged objective — rolled ${r}${mw ? ` → ${mw} mortal wounds` : ''}`, 'roll', o.sabotaged);
    if (mw) applyMortalWounds(s, u, mw, 'A Deadly Prize');
  }
}

/** A unit is selected to make a Normal / Advance / Fall Back move: rules that happen at that moment
 *  (Transfixing Gaze's Leadership test, Stasis Bomb's slowed roll). Returns false if it must Remain Stationary instead. */
export function beginMove(s: GameState, u: UnitState, kind: 'normal' | 'advance' | 'fallback'): boolean {
  if (kind === 'fallback' && u.owner === s.active) {
    s.lastAct = { unitId: u.id, owner: u.owner, kind: 'move', turn: s.turn, phase: s.phase, targets: [], lost: [], halved: [] };
    emitReact(s, other(u.owner), 'enemyFallBack', { unitId: u.id });
  }
  const f = unitFlags(s, u);
  if (f.mustStay) { log(s, `${u.name} must Remain Stationary this turn`, 'info', u.owner); remainStationary(s, u); return false; }
  if (kind === 'fallback' && f.fallBackLdTest && !ldTest(s, u, 'Transfixing Gaze')) { remainStationary(s, u); return false; }
  if (f.slowed && (u.used ??= {}).slowed !== String(s.turn)) {
    u.used.slowed = String(s.turn);
    const r = d6(s);
    const mw = rollExpr(s, r <= 4 ? 'D3' : '2D3').total;
    addTimed(s, u, { e: { move: r <= 4 ? -2 : -3 }, label: 'Slowed', until: 'turn', by: other(u.owner) });
    log(s, `Slowed: ${u.name} rolled ${r} → −${r <= 4 ? 2 : 3}"`, 'roll', u.owner);
    applyMortalWounds(s, u, mw, 'Slowed (Stasis Bomb)');
  }
  return onBoard(u);
}

export function remainStationary(s: GameState, u: UnitState) {
  u.move = 'stationary';
  u.lastStationaryTurn = s.turn;
  log(s, `${u.name}: Remain stationary`, 'info', u.owner);
}

export function ingressUnit(s: GameState, u: UnitState, pos: Map<string, Pt>): MoveCheck {
  const how = hasDeepStrike(s, u) ? 'deepStrike' : 'ingress';
  const chk = validatePlacement(s, u, pos, how);
  if (!chk.ok) return chk;
  // Meteoric Descent: set up closer than usual, then no charge this turn
  const closest = Math.min(99, ...boardUnits(s, other(u.owner)).flatMap((e) => alive(e).flatMap((n) => alive(u).map((m) => { const p = pos.get(m.id) ?? m; return dist(p, n) - m.r - n.r; }))));
  u.move = 'ingress'; // before placing: rules on arrival (Dread Reputation) read it
  placeUnit(s, u, pos);
  pushFx(s, { kind: 'place', unitId: u.id, owner: u.owner });
  if (closest <= RULES.reserves.enemyDistance || (how === 'deepStrike' && unitFlags(s, u).deepStrikeInFlow)) u.noChargeTurn = s.turn;
  log(s, `${u.name} arrives (${how === 'deepStrike' ? 'Deep Strike' : 'Ingress'})${closest <= RULES.reserves.enemyDistance ? ' within 9" of the enemy → cannot charge this turn' : ''}`, 'info', u.owner);
  if (u.owner === s.active && s.phase === 'movement') offerReactions(s, 'enemyMovedNear', u);
  if (unitHasAbility(u, 'Drop Pod Assault')) dropPodAssault(s, u);
  if (u.homer && s.active !== u.owner) { log(s, `Teleport Homer: ${u.name} arrives at the token (token removed)`, 'info', u.owner); u.homer = undefined; }
  return chk;
}

/** Drop Pod Assault: the units inside get out at once, more than 8" from every enemy model (done by itself: they
 *  must). Tried all round the pod; the side away from the enemy first. */
function dropPodAssault(s: GameState, pod: UnitState) {
  const hull = alive(pod)[0];
  if (!hull) return;
  const enemies = boardUnits(s, other(pod.owner)).flatMap(alive);
  const ec = enemies.length ? polyCentroid(enemies) : { x: W / 2, y: H / 2 };
  const away = Math.atan2(hull.y - ec.y, hull.x - ec.x);
  for (const p of s.units.filter((x) => x.status === 'embarked' && x.embarkedIn === pod.id)) {
    let done = false;
    for (const pos of hullSpots(s, p, hull, away)) {
      const far = alive(p).every((m) => { const q = pos.get(m.id)!; return enemies.every((n) => dist(q, n) - m.r - n.r > 8); });
      if (far && validateDisembark(s, p, pod, pos).ok) { disembarkUnit(s, p, pod, pos); done = true; break; }
    }
    log(s, done ? `Drop Pod Assault: ${p.name} disembarks from ${pod.name} (more than 8" from enemies)` : `Drop Pod Assault: no room for ${p.name} more than 8" from enemies — it stays in the pod`, 'info', pod.owner);
  }
}

/** Reserves can arrive from battle round 2, earlier with abilities (Drop Pod Assault, High King of Fenris, Da Jump …). */
export const arrivalRound = (s: GameState, u: UnitState) => Math.min(RULES.reserves.firstRound, unitFlags(s, u).arriveFromRound, u.arriveEarly ?? 99);
export const canIngress = (s: GameState, u: UnitState) => u.status === 'reserves' && s.round >= arrivalRound(s, u) && !u.move;

// ---------- charge phase ----------

// ---------- army rules: Oath of Moment / Waaagh! ----------

export const hasArmyRule = (s: GameState, p: PlayerId, name: string) => s.players[p].armyRules.some((r) => r.name === name);
/** The rule that has the player pick one enemy unit in their Command phase (kept in `oathTarget`): Oath of Moment, or the
 *  Chaos Space Marines' focus of hatred (Veterans of the Long War) / Vendetta target (Renegade Warband). */
export function markRuleName(s: GameState, p: PlayerId): string | null {
  if (hasArmyRule(s, p, 'Oath of Moment')) return 'Oath of Moment';
  const r = activeRules(s, p);
  return r.includes('Veterans of the Long War') ? 'Focus of Hatred' : r.includes('Renegade Warband') ? 'Vendetta' : null;
}
export const unitHasAbility = (u: UnitState, name: string) => u.abilities.some((a) => a.name === name);
export const isRiledUp = (s: GameState, u: UnitState) => isRiled(s, u);

export function setOathTarget(s: GameState, p: PlayerId, targetId: string) {
  s.players[p].oathTarget = targetId;
  log(s, `${markRuleName(s, p) ?? 'Oath of Moment'}: ${unitById(s, targetId).name}`, 'info', p);
}

/** Master of Battle: the second enemy unit that becomes the Oath of Moment target if the first one is destroyed. */
export function setOathBackup(s: GameState, p: PlayerId, targetId: string) {
  s.players[p].oathBackup = targetId;
  log(s, `Master of Battle: backup target ${unitById(s, targetId).name}`, 'info', p);
}

export function callWaaagh(s: GameState, p: PlayerId) {
  s.players[p].waaaghUsed = true;
  s.players[p].riledUntilTurn = s.turn + 1;
  log(s, `WAAAGH! Every Ork unit is riled up: 5+ invulnerable save, ranged weapons have [ASSAULT], can charge after advancing (until the end of the next turn)`, 'info', p);
  const boss = boardUnits(s, p).find((u) => u.isWarlordUnit) ?? boardUnits(s, p).find((u) => alive(u).some((m) => m.isCharacter));
  if (boss) heroFx(s, boss, 'WAAAGH!', false, undefined, true); // once per battle
}

export function chargeEligibility(s: GameState, u: UnitState): string | null {
  if (!onBoard(u)) return 'Not on the battlefield';
  if (u.declaredCharge) return 'Already declared a charge';
  if (hasKw(u, 'AIRCRAFT')) return 'AIRCRAFT cannot charge';
  if (isEngaged(s, u)) return 'Engaged';
  if (u.move === 'fallback' && !canDo(s, u, 'chargeAfterFallBack')) return 'Fell Back this turn';
  if (u.cantCharge) return 'Disembarked (Rapid / Combat) or used an ability that prevents charging this turn';
  if (u.noChargeTurn === s.turn) return 'Arrived closer to the enemy than normal (Meteoric Descent): cannot charge this turn';
  if (u.move === 'advance' && !isRiledUp(s, u) && !canDo(s, u, 'chargeAfterAdvance')) return 'Advanced this turn';
  if (!boardUnits(s, other(u.owner)).some((e) => !hasKw(e, 'AIRCRAFT') && unitDistance(u, e) <= RULES.charge.declareRange)) return `No enemy within ${RULES.charge.declareRange}"`;
  return null;
}

export function declareCharge(s: GameState, u: UnitState, fly = false, cap?: number) {
  u.declaredCharge = true;
  s.lastAct = { unitId: u.id, owner: u.owner, kind: 'charge', turn: s.turn, phase: s.phase, targets: [], lost: [], halved: [] };
  const declaredInOwnTurn = u.owner === s.active && s.phase === 'charge';
  const r = rollN(s, 2);
  let total = r[0] + r[1];
  if (cap !== undefined) total = Math.min(total, cap);
  if (u.buffs.some((b) => b.kind === 'advanceCharge+1')) total += 1;
  total += rollMods(s, u).chargeBonus;
  u.chargeRoll = Math.max(0, total - (fly && !u.core.hover ? RULES.flyTakeToSkiesPenalty : 0));
  const near = Math.min(...boardUnits(s, other(u.owner)).map((e) => unitDistance(u, e)), 99);
  pushFx(s, { kind: 'roll', owner: u.owner, title: `Charge · ${u.name}`, dice: r, result: `Charge ${u.chargeRoll}"`, good: u.chargeRoll + 1e-6 >= near });
  log(s, `${u.name} declares a charge: 2D6 [${r.join('+')}] = ${r[0] + r[1]}${fly ? ' (Fly −2)' : ''}${cap !== undefined && r[0] + r[1] > cap ? ` → capped at ${cap}` : ''}`, 'roll', u.owner);
  if (declaredInOwnTurn) emitReact(s, other(u.owner), 'enemyChargeDeclared', { unitId: u.id });
  if (declaredInOwnTurn) emergencyEmbark(s, u);
  return r;
}

/**
 * Emergency Combat Embarkation (Repulsor, once per turn): an ADEPTUS ASTARTES unit the charge can reach, not in
 * combat, with every model within 3" of the Repulsor, gets in before the charge move. Done by itself when the charge
 * would cost it more than a quarter of what it is worth (approximation: every unit in reach counts as a target).
 */
function emergencyEmbark(s: GameState, charger: UnitState) {
  const p = other(charger.owner);
  for (const t of boardUnits(s, p).filter((x) => (unitHasAbility(x, 'Combat Embarkation') || unitHasAbility(x, 'Emergency Combat Embarkation')) && x.transport)) {
    const key = `${s.turn}:${t.id}`;
    if ((t.oncePerTurnUsed ??= []).includes(key)) continue;
    const cands = boardUnits(s, p).filter((x) => x.id !== t.id && isAstartes(x) && !isEngaged(s, x)
      && unitDistance(charger, x) <= (charger.chargeRoll ?? 0) + 1e-6
      && alive(x).every((m) => alive(t).some((n) => baseDist(m, n) <= 3 + 1e-6)) && !canEmbarkIn(s, x, t));
    const worth = (x: UnitState) => (x.pts * alive(x).length) / Math.max(1, x.startingStrength);
    const best = cands.sort((a, b) => worth(b) - worth(a))[0];
    if (!best) continue;
    t.oncePerTurnUsed.push(key);
    best.status = 'embarked';
    best.embarkedIn = t.id;
    log(s, `Emergency Combat Embarkation: ${best.name} embarks in ${t.name} before ${charger.name}'s charge`, 'info', p);
  }
}

/** Miraculous Saviour (the Sanguinor, once per battle): at the end of the opponent's Charge phase it drops in, engaged
 *  with the unit that charged and is worth the most. */
function miraculousSaviour(s: GameState) {
  const p = other(s.active);
  if (s.round <= 1) return;
  for (const u of s.units.filter((x) => x.owner === p && (unitHasAbility(x, 'Miraculous Savior') || unitHasAbility(x, 'Miraculous Saviour')) && (x.status === 'reserves' || (onBoard(x) && !isEngaged(s, x))))) {
    if ((u.onceUsed ??= []).includes('Miraculous Saviour')) continue;
    const chargers = boardUnits(s, s.active).filter((e) => e.chargedTurn === s.turn)
      .sort((a, b) => b.pts * alive(b).length / Math.max(1, b.startingStrength) - a.pts * alive(a).length / Math.max(1, a.startingStrength));
    const m = alive(u)[0];
    if (!m || !chargers.length) continue;
    for (const e of chargers) {
      let pos: Map<string, Pt> | null = null;
      for (const n of alive(e)) {
        for (let k = 0; k < 12 && !pos; k++) {
          const a = (k / 12) * Math.PI * 2, d = n.r + m.r + 0.4;
          const q = new Map([[m.id, { x: n.x + Math.cos(a) * d, y: n.y + Math.sin(a) * d }]]);
          const errors: string[] = [], bad = new Set<string>();
          endChecks(s, u, q, errors, bad);
          if (!errors.length) pos = q;
        }
        if (pos) break;
      }
      if (!pos) continue;
      u.onceUsed.push('Miraculous Saviour');
      placeUnit(s, u, pos);
      u.move = 'ingress';
      pushFx(s, { kind: 'place', unitId: u.id, owner: u.owner });
      log(s, `Miraculous Saviour: ${u.name} is set up engaged with ${e.name}`, 'info', p);
      break;
    }
  }
}

/** Stabilised Disembarkation (Repulsor): shot in the opponent's Shooting phase and down to half its wounds or less,
 *  it lets the units inside get out (within 6") before it is lost with them aboard. */
onAttackFinished((s, at) => {
  if (at.kind !== 'shoot' || s.phase !== 'shooting') return;
  const t = unitById(s, at.targetId);
  if (t.owner === s.active || !onBoard(t) || !unitHasAbility(t, 'Stabilised Disembarkation')) return;
  const hull = alive(t)[0];
  if (!hull || hull.wounds * 2 > hull.profile.W) return;
  const enemies = boardUnits(s, s.active).flatMap(alive);
  const ec = enemies.length ? polyCentroid(enemies) : { x: W / 2, y: H / 2 };
  const away = Math.atan2(hull.y - ec.y, hull.x - ec.x);
  for (const p of s.units.filter((x) => x.status === 'embarked' && x.embarkedIn === t.id)) {
    for (const pos of hullSpots(s, p, hull, away, 6)) {
      const errors: string[] = [], bad = new Set<string>();
      endChecks(s, p, pos, errors, bad);
      if (errors.length || engagedAt(s, p, pos).length) continue;
      placeUnit(s, p, pos);
      p.embarkedIn = null;
      p.disembarkedTurn = s.turn;
      log(s, `Stabilised Disembarkation: ${p.name} disembarks from the damaged ${t.name}`, 'info', t.owner);
      break;
    }
  }
});

export function rerollCharge(s: GameState, u: UnitState, fly = false, cap?: number) {
  spendStratagem(s, u.owner, 'command-reroll', u);
  u.declaredCharge = false;
  return declareCharge(s, u, fly, cap);
}

export function chargeTargetOptions(s: GameState, u: UnitState, opts: { onlyChargedThisPhase?: boolean; within?: number } = {}): UnitState[] {
  const out = boardUnits(s, other(u.owner)).filter((e) => {
    if (hasKw(e, 'AIRCRAFT') && !hasKw(u, 'FLY')) return false;
    const d = unitDistance(u, e);
    if (d > RULES.charge.declareRange || d > chargeReach(s, u, [e]) + 1e-6) return false;
    if (opts.within !== undefined && d > opts.within) return false;
    if (u.chargeOnly?.turn === s.turn && !u.chargeOnly.ids.includes(e.id)) return false;
    if (opts.onlyChargedThisPhase && e.chargedTurn !== s.turn) return false;
    const only = unitFlags(s, u).onlyTargetMarked;
    if (only && (u.move === 'advance' || u.move === 'fallback') && !(e.timed ?? []).some((t) => t.mark === only && t.by === u.owner)) return false;
    if (thrillBlock(s, u, e)) return false;
    const by = unitFlags(s, u).chargeNeedEngagedBy;
    if (by && (u.move === 'advance' || u.move === 'fallback') && !engagedEnemies(s, e).some((f) => hasKw(f, by) || f.factionKeywords.includes(by))) return false;
    return true;
  });
  // Lethal Obsession / Refusal to be Outdone: no charge at all when the unit it must reach is out of reach
  if (u.chargeMust?.turn === s.turn && !out.some((e) => e.id === u.chargeMust!.id)) return [];
  if (unitFlags(s, u).chargeMustEngaged && !out.some((e) => engagedEnemies(s, e).length > 0)) return [];
  return out;
}

export function commitCharge(s: GameState, u: UnitState, paths: Map<string, Pt[]>, targets: string[]) {
  commitMove(s, u, 'charge', paths);
  u.chargedTurn = s.turn;
  u.chargeTargets = targets;
  for (const t of targets) noteTarget(s, u.id, t);
  if (s.lastAct?.unitId === u.id && s.lastAct.kind === 'charge') s.lastAct.targets = [...targets];
  log(s, `${u.name} charges successfully → ${targets.map((t) => unitById(s, t).name).join(', ')} (Fights First)`, 'info', u.owner);
  fire(s, 'endOfCharge', [u], { targetId: targets[0] });
  if (u.owner === s.active && s.phase === 'charge') {
    emitReact(s, u.owner, 'chargeMoveEnd', { unitId: u.id });
    emitReact(s, other(u.owner), 'enemyChargeMoveEnd', { unitId: u.id });
  }
}

export function crushingImpact(s: GameState, u: UnitState, targetId: string) {
  spendStratagem(s, u.owner, 'crushing-impact', u);
  const t = unitById(s, targetId);
  const m = alive(u).find((x) => modelEngagedWith(x, t)) ?? alive(u)[0];
  const rolls = rollN(s, m.profile.T);
  const hits = Math.min(6, rolls.filter((r) => r >= 5).length);
  const self = rolls.filter((r) => r === 1).length;
  log(s, `Crushing Impact: ${m.profile.T}D6 [${rolls.join(' ')}] → enemy ${hits} MW, own unit ${self} MW`, 'roll', u.owner);
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
    && !endSpotBlocked(s, { r }, p) && clearOfOthers(p, r);
  const coherent = () => coherencyProblems(ms.map((m) => pos.get(m.id)!), RULES.coherency.near, RULES.coherency.max, ms.map((m) => m.r)).length === 0;
  const gapTo = (m: ModelState, p: Pt) => Math.min(...enemyModels.map((e) => dist(p, e) - e.r - m.r));
  // each model goes in a straight line from where it stands: that line must not pass through an enemy model
  const foesAll = boardUnits(s, other(u.owner)).filter((e) => !hasKw(e, 'AIRCRAFT')).flatMap(alive);
  const clearLine = (m: ModelState, p: Pt) => foesAll.every((e) => pointSegDist(e, { a: { x: m.x, y: m.y }, b: p }) >= e.r + m.r - 0.03);
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
          && !endSpotBlocked(s, m, p) && clearOfOthers(p, m.r) && clearLine(m, p);
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
          if (travel > maxDist + 1e-6 || !free(m.id, c, m.r) || !clearLine(m, c)) continue;
          if (travel < bestScore) { bestScore = travel; best = c; }
        }
      }
      if (best) {
        pos.set(m.id, best);
        if (coherent()) continue;
        pos.set(m.id, cur);
      }
      // no base contact within reach: get as close as it can (inside engagement range still fights)
      const near = enemyModels.reduce((a, e) => (dist(cur, e) - e.r < dist(cur, a) - a.r ? e : a));
      const L = dist(cur, near);
      if (L < 0.01) continue;
      const step = { x: (near.x - cur.x) / L, y: (near.y - cur.y) / L };
      const most = Math.min(maxDist - dist(m, cur), L - near.r - m.r - 0.02);
      for (let k = most; k > 0.1; k -= 0.25) {
        const c = { x: cur.x + step.x * k, y: cur.y + step.y * k };
        if (dist(m, c) > maxDist + 1e-6 || !free(m.id, c, m.r) || !clearLine(m, c)) continue;
        pos.set(m.id, c);
        if (coherent()) break;
        pos.set(m.id, cur);
      }
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
  // Adamantine Avalanche (Butchers of Khorne): an engaged Terminator Squad means one more Blessing for them this phase
  for (const p of [s.active, other(s.active)]) {
    if (activeRules(s, p).includes('Butchers of Khorne') && boardUnits(s, p).some((u) => u.keywords.includes('TERMINATOR SQUAD') && isEngaged(s, u))) blessingsRoll(s, p, { label: 'Adamantine Avalanche', kw: 'TERMINATOR SQUAD', until: 'phase' });
  }
  fireFor(s, 'fightStart', s.active);
  fireFor(s, 'fightStart', other(s.active));
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

export const isFightsFirst = (s: GameState, u: UnitState) => u.chargedTurn === s.turn || !!u.core.fightsFirst || u.foughtFirstUntilTurn === s.turn || u.buffs.some((b) => b.kind === 'fightsFirst') || unitFlags(s, u).fightsFirst;

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
  // Establish Supremacy: an objective consolidation even while engaged
  if (eng.length && unitFlags(s, u).objConsolidate) {
    const obj = s.objectives.find((o) => alive(u).some((m) => circleTouchesPoly(m, m.r + RULES.consolidate.range, objectiveTerrain(s, o).poly)));
    if (obj) return { mode: 'objective', enemies: [], objective: obj };
  }
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
  return boardUnits(s, p).filter((u) => !u.battleShocked && !isEngaged(s, u) && !hasKw(u, 'TITANIC') && u.stratagemPhase !== `${s.turn}:${s.phase}` && !unitFlags(s, u).noOverwatch
    && alive(u).some((m) => m.weapons.some((w) => !isMelee(w.profiles[0])))
    && boardUnits(s, other(p)).some((e) => unitDistance(u, e) <= RULES.snapShooting.range && alive(u).some((m) => unitVisibleTo(s, m, e))));
}

export function heroicCandidates(s: GameState, p: PlayerId): UnitState[] {
  return boardUnits(s, p).filter((u) => !canUseStratagem(s, p, 'heroic-intervention', u) && !isEngaged(s, u) && (!hasKw(u, 'VEHICLE') || hasKw(u, 'CHARACTER') || hasKw(u, 'WALKER'))
    && boardUnits(s, other(p)).some((e) => unitDistance(u, e) <= RULES.charge.declareRange));
}

/** Which Heroic Intervention a unit should use: Leap to Defend (1CP) when an enemy unit that just charged is in
 *  reach, else Into the Fray (2CP) when any enemy is within 6"; null when neither applies. */
export function heroicMode(s: GameState, p: PlayerId, u: UnitState): 'leap' | 'fray' | null {
  const foes = boardUnits(s, other(p));
  if (foes.some((e) => e.chargedTurn === s.turn && unitDistance(u, e) <= RULES.charge.declareRange)) return 'leap';
  if (!canUseStratagem(s, p, 'heroic-intervention', u, 2) && foes.some((e) => unitDistance(u, e) <= 6)) return 'fray';
  return null;
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
  // abilities such as Deff from the Shadows arrive at the end of the opponent's Movement phase for free
  const free = s.units.filter((u) => u.owner === p && u.status === 'reserves' && !u.move && unitFlags(s, u).oppMoveIngress && s.round >= arrivalRound(s, u));
  if (s.round < 2 || canUseStratagem(s, p, 'rapid-ingress')) return free;
  return [...new Set([...s.units.filter((u) => u.owner === p && u.status === 'reserves' && !hasKw(u, 'AIRCRAFT')), ...free])];
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
  if (w.kind === 'stratReaction') { afterReaction(s, w.resume); return; }
  if (w.kind === 'fireOverwatch' && rapidIngressCandidates(s, w.player).length) { s.window = { kind: 'rapidIngress', player: w.player }; return; }
  if (w.kind === 'fireOverwatch' || w.kind === 'rapidIngress') openWindow(s, 'startOfShooting');
  if (w.kind === 'heroicIntervention' && s.fight && s.fight.step === 'pileIn') {
    // nothing else: fight phase continues with pile-in
  }
}

/** A stratagem prompt was answered: show the next waiting one, else carry on (end the phase that was paused). */
export function afterReaction(s: GameState, resume?: 'endPhase') {
  if (s.window) return;
  while (s.reactQueue?.length) {
    const q = s.reactQueue.shift()!;
    if (q.turn !== s.turn || q.phase !== s.phase) continue;
    emitReact(s, q.player, q.on as ReactOn, q.ctx);
    const w = s.window as GameState['window'];
    if (w) { if (resume && w.kind === 'stratReaction') w.resume = resume; return; }
  }
  if (resume === 'endPhase') endPhase(s);
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
    for (const m of alive(u)) if (circleTouchesPoly(m, m.r, t.poly)) lv[u.owner] += modelOc(s, u, m);
  }
  return lv;
}

export function updateControl(s: GameState) {
  for (const o of s.objectives) {
    const [a, b] = levelOfControl(s, o);
    let c: PlayerId | null = a > b ? 0 : b > a ? 1 : null;
    // "secured" objectives (Objective Secured …) stay yours until the opponent controls them
    if (o.secured !== undefined && o.secured !== null) {
      const mine = o.secured === 0 ? a : b, theirs = o.secured === 0 ? b : a;
      if (theirs > mine) { o.secured = null; o.sabotaged = null; } else c = o.secured;
    }
    o.controller = c;
  }
}

export function scoreTiming(s: GameState, timing: 'endOfYourCommandPhase' | 'endOfYourTurn' | 'endOfBattle', player: PlayerId = s.active) {
  scorePrimary(s, timing, player);
}

export const terrainOfObjective = objectiveTerrain;

/** Find a legal spot for a whole unit (used by "auto place" during deployment / ingress). */
export function findPlacement(s: GameState, u: UnitState, how: 'deploy' | 'ingress' | 'deepStrike' | 'infiltrate', near?: Pt, accept?: (pos: Map<string, Pt>) => boolean): Map<string, Pt> | null {
  const zone = how === 'deploy' ? zoneOf(s, u.owner) : null;
  const cands: Pt[] = [];
  for (let y = 1; y < H; y += 1.5) for (let x = 1; x < W; x += 1.5) cands.push({ x, y });
  const enemyZone = zoneOf(s, other(u.owner));
  const ec = polyCentroid(enemyZone);
  const ref = near ?? (zone ? ec : polyCentroid(zoneOf(s, u.owner)));
  cands.sort((a, b) => dist(a, ref) - dist(b, ref));
  const up = s.players[u.owner].role === 'defender';
  // arriving: spots whose centre is already too close to an enemy model are skipped before the full check (the
  // formation is built around its centre, so that model would break the distance anyway)
  const keep = how === 'deploy' ? 0 : Math.min(u.homer ? 8 : 99, how === 'deepStrike' ? unitFlags(s, u).deepStrikeRange : RULES.reserves.enemyDistance);
  const foes = keep ? boardUnits(s, other(u.owner)).flatMap(alive) : [];
  const r0 = Math.min(...alive(u).map((m) => m.r));
  for (const c of cands) {
    if (zone && !circleTouchesPoly(c, 0, zone)) continue;
    if (keep && foes.some((n) => dist(c, n) - n.r - r0 <= keep)) continue;
    // a big unit arriving from Strategic Reserves has to fit within 6" of an edge: try it in two long rows too
    const tries = how === 'ingress' && alive(u).length > 5 ? [formationAt(u, c, up), wideFormation(u, c, true), wideFormation(u, c, false)] : [formationAt(u, c, up)];
    for (const pos of tries) if (validatePlacement(s, u, pos, how).ok && (!accept || accept(pos))) return pos;
  }
  return null;
}

/** A tight block no deeper than 6" (as few rows as fit), centred on `c`, its rows along x (or along y): for setting up
 *  a big unit within 6" of a board edge. */
export function wideFormation(u: UnitState, c: Pt, alongX: boolean): Map<string, Pt> {
  const ms = [...alive(u)].sort((a, b) => Number(b.isCharacter) - Number(a.isCharacter));
  const r = Math.max(...ms.map((m) => m.r));
  // staggered rows (each half a base along): the rows sit closer, so more of them fit in 6"
  const step = r * 2 + 0.05, rowStep = step * 0.87;
  const rowsMax = Math.max(1, Math.floor((6 - 2 * r - 0.1) / rowStep) + 1);
  const perRow = Math.ceil(ms.length / rowsMax);
  const rows = Math.ceil(ms.length / perRow);
  // flush against the nearest edge across the rows
  const hd = ((rows - 1) / 2) * rowStep + r + 0.05;
  c = alongX ? { x: c.x, y: c.y < H / 2 ? hd : H - hd } : { x: c.x < W / 2 ? hd : W - hd, y: c.y };
  const out = new Map<string, Pt>();
  ms.forEach((m, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const inRow = Math.min(perRow, ms.length - row * perRow);
    const a = (col - (inRow - 1) / 2 + (row % 2 ? 0.25 : -0.25)) * step, b = (row - (rows - 1) / 2) * rowStep;
    out.set(m.id, alongX ? { x: c.x + a, y: c.y + b } : { x: c.x + b, y: c.y + a });
  });
  return out;
}

// ---------- secondary missions (Chapter Approved 2026-27) ----------

function shuffle<T>(s: GameState, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(nextRandom(s) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function drawSecondaries(s: GameState, p: PlayerId, n: number) {
  drawUpTo(s, p, Math.max(n, s.players[p].secActive.length + n));
}

export function chooseFixedSecondaries(s: GameState, p: PlayerId, ids: string[]) {
  s.players[p].secActive = ids.slice(0, 2);
  log(s, `${s.players[p].name} selects Fixed Missions: ${ids.map((x) => secondaryById(x).name).join(', ')}`, 'info', p);
}

/** Manual override: claim VP from an active secondary when the automatic check cannot see it. */
export function claimSecondary(s: GameState, p: PlayerId, id: string, vp: number): number {
  return bankSecondary(s, p, id, vp);
}

/** Tactical: discard an active card; at the end of your own turn this gains 1CP. */
export function discardSecondary(s: GameState, p: PlayerId, id: string) {
  const P = s.players[p];
  P.secActive = P.secActive.filter((x) => x !== id);
  if (s.active === p) { P.cp += 1; log(s, `${P.name} discards ${secondaryById(id).name} → +1CP`, 'cp', p); }
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

const modelKws = (u: UnitState, m: ModelState) => [...m.keywords, ...u.factionKeywords, m.source];
const modelSpace = (t: TransportInfo, u: UnitState, m: ModelState) => transportFit(t, modelKws(u, m)).space || 1;

/** Transport space a unit takes (Downtrodden: every 2 Gretchin take the space of 1 model). */
function unitSpace(t: TransportInfo, u: UnitState) {
  const ms = alive(u);
  if (!u.abilities.some((a) => a.name === 'Downtrodden')) return ms.reduce((b, m) => b + modelSpace(t, u, m), 0);
  const grots = ms.filter((m) => /gretchin/i.test(m.name)).length;
  return Math.ceil(grots / 2) + ms.filter((m) => !/gretchin/i.test(m.name)).reduce((b, m) => b + modelSpace(t, u, m), 0);
}

export function transportSpaceUsed(s: GameState, t: UnitState) {
  return s.units.filter((u) => u.embarkedIn === t.id && u.status === 'embarked').reduce((a, u) => a + unitSpace(t.transport!, u), 0);
}

export function canEmbarkIn(s: GameState, u: UnitState, t: UnitState): string | null {
  const T = t.transport;
  if (!T || t.owner !== u.owner || t.id === u.id) return 'Not a transport';
  if (hasKw(u, 'TRANSPORT')) return 'A TRANSPORT cannot embark';
  // every model has to fit the transport's rules (what it carries, what it can't, "excluding …")
  for (const m of alive(u)) {
    const why = transportFit(T, modelKws(u, m)).why;
    if (why) return `${m.name}: ${why}`;
  }
  if (u.factionKeywords.length && t.factionKeywords.length && !u.factionKeywords.some((k) => t.factionKeywords.includes(k))) return 'Different faction';
  const need = unitSpace(T, u);
  if (transportSpaceUsed(s, t) + need > T.capacity) return `Not enough room (${transportSpaceUsed(s, t)}+${need}/${T.capacity})`;
  return null;
}

/** Embark during deployment (Declare Battle Formations) or after a normal/advance/fall-back move (18.02). */
export function embarkUnit(s: GameState, u: UnitState, t: UnitState, duringDeploy = false, byRule = false): string | null {
  const why = canEmbarkIn(s, u, t);
  if (why) return why;
  if (!duringDeploy && !byRule) {
    if (unitFlags(s, t).noEmbark) return 'Cannot embark in this transport once the battle has begun';
    if (!['normal', 'advance', 'fallback'].includes(u.move ?? '')) return 'Must make a Normal / Advance / Fall Back move to embark';
    if (u.setUpTurn === s.turn) return 'A unit set up this turn cannot embark';
    if (!alive(u).every((m) => alive(t).some((n) => baseDist(m, n) <= 3 + 1e-6))) return 'Every model must be within 3" of the transport';
  }
  u.status = 'embarked';
  u.embarkedIn = t.id;
  log(s, `${u.name} embarks in ${t.name}`, 'info', u.owner);
  if (duringDeploy) nextDeployer(s);
  return null;
}

// a rule embarks a unit within a friendly transport it is wholly within X" of (Accomplished Tactician, Onto the Next)
setEmbarkNear((s, u, range, why) => {
  const t = boardUnits(s, u.owner).find((x) => x.transport && x.id !== u.id && alive(u).every((m) => alive(x).some((n) => baseDist(m, n) <= range + 1e-6)) && !canEmbarkIn(s, u, x));
  if (t && !embarkUnit(s, u, t, false, true)) log(s, `${why}: ${u.name} embarks within ${t.name}`, 'info', u.owner);
});

export const embarkedIn = (s: GameState, t: UnitState) => s.units.filter((u) => u.embarkedIn === t.id && u.status === 'embarked');

export function disembarkMode(s: GameState, t: UnitState): 'rapid' | 'tactical' | 'combat' | null {
  if (t.move === 'advance' && unitFlags(s, t).disembarkAfterAdvance) return 'rapid';
  if (t.move === 'advance' || t.move === 'fallback') return null;
  if (isEngaged(s, t)) return 'combat';
  if (t.move === 'normal' || t.move === 'ingress') return 'rapid';
  return 'tactical';
}

export function validateDisembark(s: GameState, u: UnitState, t: UnitState, pos: Map<string, Pt>): MoveCheck {
  const mode = disembarkMode(s, t);
  const errors: string[] = [];
  const bad = new Set<string>();
  if (!mode) return { ok: false, errors: ['The transport Advanced / Fell Back: no disembarking this phase'], bad: [] };
  const range = mode === 'combat' ? 6 : 3;
  endChecks(s, u, pos, errors, bad);
  // Aggressive Disembarkation: within the set-up distance is enough, not wholly within
  const loose = unitFlags(s, u).looseDisembark;
  for (const m of alive(u)) {
    const p = pos.get(m.id) ?? m;
    const tm = alive(t).reduce((a, b) => (dist(p, a) <= dist(p, b) ? a : b));
    if (dist(p, tm) - tm.r + (loose ? -m.r : m.r) > range + 0.02) { errors.push(loose ? `Must be set up within ${range}" of the transport` : `Must be set up wholly within ${range}" of the transport`); bad.add(m.id); }
  }
  if (mode !== 'combat' && engagedAt(s, u, pos).length) errors.push('Disembarking units must be set up unengaged');
  return { ok: !errors.length, errors: [...new Set(errors)], bad: [...bad] };
}

export function disembarkUnit(s: GameState, u: UnitState, t: UnitState, pos: Map<string, Pt>): MoveCheck {
  const chk = validateDisembark(s, u, t, pos);
  if (!chk.ok) return chk;
  const mode = disembarkMode(s, t)!;
  if (mode === 'combat') {
    const { fails } = hazardTest(s, u, alive(u).length, 'Combat Disembark');
    if (fails) applyMortalWounds(s, u, fails, 'Combat Disembark');
    u.battleShocked = true;
  }
  for (const m of alive(u)) { const p = pos.get(m.id)!; m.x = p.x; m.y = p.y; }
  u.status = 'board';
  u.embarkedIn = null;
  u.setUpTurn = s.turn;
  u.disembarkedTurn = s.turn;
  const assault = mode === 'rapid' && t.move !== 'advance' && (unitFlags(s, t).assaultDisembark || unitFlags(s, u).assaultDisembark); // Raid Leader: the passenger's own
  if (mode === 'tactical') u.move = null; // may still make a normal or advance move
  else { u.move = 'stationary'; u.cantCharge = !assault; }
  u.disembarkedFrom = t.id;
  log(s, `${u.name} disembarks (${assault ? 'Assault: can still charge' : mode === 'rapid' ? 'Rapid' : mode === 'tactical' ? 'Tactical' : 'Combat'} Disembark)`, 'info', u.owner);
  arrivalShock(s, u);
  unleashWrathHook?.(s, u);
  fire(s, 'passengerDisembarks', [t], { targetId: u.id });
  return chk;
}

/** Emergency disembark when a transport is destroyed (18.05). */
export function emergencyDisembark(s: GameState, t: UnitState, tm: ModelState) {
  for (const u of embarkedIn(s, t)) {
    const { fails } = hazardTest(s, u, alive(u).length, 'Emergency Disembark');
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
      log(s, `${u.name} could not escape the destroyed transport → destroyed`, 'kill', u.owner);
      continue;
    }
    for (const m of alive(u)) { const p = placed.get(m.id)!; m.x = p.x; m.y = p.y; }
    u.status = 'board';
    u.battleShocked = true;
    u.cantCharge = true;
    log(s, `Emergency Disembark ${u.name}: battle-shocked`, 'roll', u.owner);
    if (fails) applyMortalWounds(s, u, fails, 'Emergency Disembark');
  }
}

onTransportDestroyed((s, u, m) => { if (u.transport && embarkedIn(s, u).length) emergencyDisembark(s, u, m); });

// ---------- one-tap moves (the player's "go in" buttons and the bot share these) ----------

const stayPaths = (u: UnitState) => new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y }]]));

/** Charge `targetIds` with the distance rolled: every model is moved in by itself. False when no legal move was found. */
export function autoCharge(s: GameState, u: UnitState, targetIds: string[]): boolean {
  const targets = targetIds.map((id) => unitById(s, id));
  const paths = new Map([...stayPaths(u), ...autoApproach(s, u, targets, chargeReach(s, u, targets))]);
  if (!validateMove(s, u, 'charge', paths, { targets: targetIds }).ok) return false;
  commitCharge(s, u, paths, targetIds);
  return true;
}

/** Pile-in or consolidate a unit by itself (towards the enemy, or onto the objective when that is the mode). */
export function autoPileMove(s: GameState, u: UnitState, kind: 'pileIn' | 'consolidate'): boolean {
  const cm = kind === 'consolidate' ? consolidateMode(s, u) : null;
  if (cm && !cm.mode) return false;
  const targets = isEngaged(s, u) ? engagedEnemies(s, u) : cm ? cm.enemies : boardUnits(s, other(u.owner)).filter((e) => unitDistance(u, e) <= RULES.pileIn.targetRange);
  const add = cm?.mode === 'objective' && cm.objective
    ? autoApproach(s, u, [], pileDistance(s, u, 'consolidate'), { objective: polyCentroid(objectiveTerrain(s, cm.objective).poly) })
    : autoApproach(s, u, targets, pileDistance(s, u, kind));
  const paths = new Map([...stayPaths(u), ...add]);
  if (!validateMove(s, u, kind, paths).ok) return false;
  commitMove(s, u, kind, paths);
  if (s.fight && !s.fight.movedThisStep.includes(u.id)) s.fight.movedThisStep.push(u.id);
  return true;
}
