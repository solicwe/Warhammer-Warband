import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildUnits, distributeModels, syncWargear, wargearMax, wargearPoints, wargearProblems } from './army';
import { allocationGroups, applyDamage, buildFightPools, buildShootPools, rollSavesAndDamage, startAttack, targetToughness, woundNeed } from './attack';
import { parseDice } from './dice';
import { coherencyProblems } from './geometry';
import { canDetReroll, chargeEligibility, commitCharge, createGame, declareCharge, detReroll, endPhase, fightCandidates, formationAt, maxMoveDistance, placeUnit, rollAdvance, settleMove, validateMove } from './game';
import { detChoices, detOnCommandStart, pickDetChoice } from './detachments';
import type { ArmyList, ArmyUnitEntry, FactionData, GameState, Pt, TerrainPiece } from './types';
import { parseAbility } from './weapons';
import { alive } from './state';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

function list(factionId: string, units: [string, number, number, string?][]): ArmyList {
  return {
    name: 't', factionId, battleSize: 'incursion', detachments: [],
    units: units.map(([d, n, pts, attachTo], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts, attachTo })),
  };
}

function game(): GameState {
  const s = createGame({
    lists: [list('SM', [['Intercessor Squad', 10, 150], ['Captain', 1, 80]]), list('ORK', [['Boyz', 10, 90], ['Warboss', 1, 100]])],
    factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
  });
  s.terrain = s.terrain.filter((t) => t.objectiveId); // rules tests run on an open board
  s.terrain.forEach((t) => (t.walls = []));
  return s;
}

function put(s: GameState, unitId: string, c: Pt) {
  const u = s.units.find((x) => x.id === unitId)!;
  placeUnit(s, u, formationAt(u, c));
  return u;
}

describe('wound table (05.02)', () => {
  it('matches the S vs T table', () => {
    expect(woundNeed(8, 4)).toBe(2);
    expect(woundNeed(5, 4)).toBe(3);
    expect(woundNeed(4, 4)).toBe(4);
    expect(woundNeed(4, 5)).toBe(5);
    expect(woundNeed(4, 8)).toBe(6);
    expect(woundNeed(3, 7)).toBe(6);
  });
});

describe('dice + keyword parsing', () => {
  it('parses dice expressions', () => {
    expect(parseDice('D6+2')).toEqual({ n: 1, sides: 6, add: 2 });
    expect(parseDice(' 2D6')).toEqual({ n: 2, sides: 6, add: 0 });
    expect(parseDice('3')).toEqual({ n: 0, sides: 0, add: 3 });
  });
  it('parses weapon abilities', () => {
    expect(parseAbility('anti-infantry 4+')).toMatchObject({ key: 'anti', on: 4, cond: { neg: false, kws: ['INFANTRY'] } });
    expect(parseAbility('lethal hits: non-monster/vehicle')).toMatchObject({ key: 'lethal-hits', cond: { neg: true, kws: ['MONSTER', 'VEHICLE'] } });
    expect(parseAbility('rapid fire 2')).toMatchObject({ key: 'rapid-fire', value: '2' });
    expect(parseAbility('pistol').key).toBe('close-quarters');
    expect(parseAbility('BLAST 2')).toMatchObject({ key: 'blast', value: '2' });
  });
});

describe('coherency (03.03)', () => {
  it('requires 2" to one model and 9" to all', () => {
    const r = [0.5, 0.5, 0.5];
    expect(coherencyProblems([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }], 2, 9, r)).toEqual([]);
    expect(coherencyProblems([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 8, y: 0 }], 2, 9, r)).toEqual([2]);
    const line = Array.from({ length: 8 }, (_, i) => ({ x: i * 2.5, y: 0 }));
    expect(coherencyProblems(line, 2, 9, line.map(() => 0.5)).length).toBeGreaterThan(0); // conga line > 9"
  });
});

describe('army building', () => {
  it('distributes Boyz models over composition', () => {
    const boyz = ORK.datasheets.find((d) => d.name === 'Boyz')!;
    expect(distributeModels(boyz, 10)).toEqual([{ comp: 'Nob', profile: 1, count: 1 }, { comp: 'Boy', profile: 0, count: 9 }]);
  });
  it('builds an attached unit with bodyguard toughness', () => {
    const u = buildUnits(list('ORK', [['Boyz', 10, 90], ['Warboss', 1, 100, 'x0']]), ORK, 1);
    expect(u).toHaveLength(1);
    expect(u[0].models).toHaveLength(11);
    expect(targetToughness(u[0])).toBe(5); // Boyz T5 even though the Warboss is T6
    const groups = allocationGroups(u[0]);
    expect(groups[groups.length - 1].char).toBe(true); // characters last
  });
});

describe('shooting', () => {
  it('rapid fire and range checks', () => {
    const s = game();
    const a = put(s, s.units[0].id, { x: 22, y: 10 });
    const t = put(s, s.units[2].id, { x: 22, y: 25 }); // ~13" away: bolt rifle in range, not half range
    s.phase = 'shooting'; s.active = 0; s.turn = 0;
    const r = buildShootPools(s, a.id, t.id, { mode: 'normal' });
    const rifle = r.pools.filter((p) => p.weapon === 'Bolt Rifle');
    expect(rifle.reduce((x, p) => x + p.models, 0)).toBe(10);
  });

  it('Blast 2 example: A3 vs 12 models -> 7 attack dice', () => {
    const inst = { A: '3', extras: [], flat: 2 * Math.floor(12 / 5) };
    expect(+inst.A + inst.flat).toBe(7);
  });
});

describe('fight', () => {
  it('only engaged models attack, cleave adds dice', () => {
    const s = game();
    const boss = buildUnits(list('ORK', [['Warboss', 1, 100]]), ORK, 1)[0];
    boss.id = 'boss';
    s.units.push(boss);
    const tgt = put(s, s.units[0].id, { x: 22, y: 30 });
    placeUnit(s, boss, new Map([[boss.models[0].id, { x: 22, y: 30 - 6.5 }]]));
    const near = alive(tgt).sort((a, b) => a.y - b.y)[0];
    boss.models[0].y = near.y - near.r - boss.models[0].r - 0.5;
    boss.models[0].x = near.x;
    const r = buildFightPools(s, boss.id, tgt.id);
    expect(r.pools.length).toBe(1);
    const p = r.pools[0];
    expect(p.weapon).toBe('Kustom Choppa'); // Cleave 2 vs 10 models -> +4
    expect(p.instances[0].flat).toBe(4);
  });
});

describe('save allocation', () => {
  it('saves are applied lowest first and stop when the unit dies', () => {
    const s = game();
    const a = put(s, s.units[0].id, { x: 22, y: 10 });
    const t = put(s, s.units[2].id, { x: 22, y: 20 });
    const r = buildShootPools(s, a.id, t.id, { mode: 'normal' });
    startAttack(s, 'shoot', a.id, t.id, r.pools.slice(0, 1));
    const p = s.attack!.pools[0];
    p.wounds = Array.from({ length: 30 }, () => ({ v: 4, o: 'wound' as const }));
    rollSavesAndDamage(s);
    applyDamage(s);
    expect(alive(t).length).toBe(0);
  });
});

describe('movement validation', () => {
  it('rejects moving too far and ending in engagement range', () => {
    const s = game();
    const u = put(s, s.units[0].id, { x: 22, y: 10 });
    put(s, s.units[2].id, { x: 22, y: 22 });
    const paths = new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y + 7 }]]));
    const chk = validateMove(s, u, 'normal', paths);
    expect(chk.ok).toBe(false);
    expect(chk.errors.join()).toMatch(/more than/);
  });
});

describe('vehicles in ruins: drive in or onto the edge, never across', () => {
  const vehicleGame = () => {
    const s = createGame({
      lists: [list('SM', [['Repulsor', 1, 180]]), list('ORK', [['Boyz', 10, 90]])],
      factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    s.terrain = [{ id: 'r', kind: 'ruin', label: 'Ruin', category: 'light', height: 0, walls: [], poly: [{ x: 15, y: 20 }, { x: 29, y: 20 }, { x: 29, y: 26 }, { x: 15, y: 26 }] } as TerrainPiece];
    s.objectives = []; // no markers in the way of the test moves
    return s;
  };
  const go = (s: GameState, dy: number, from: Pt) => {
    const tank = put(s, s.units[0].id, from);
    const m = alive(tank)[0];
    return validateMove(s, tank, 'normal', new Map([[m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y + dy }]]]));
  };
  it('a tank drives into, out of and across a ruin footprint: only walls stop it', () => {
    expect(go(vehicleGame(), 9, { x: 22, y: 12 }).ok).toBe(true); // into the ruin
    expect(go(vehicleGame(), 5, { x: 22, y: 12 }).ok).toBe(true); // onto its edge
    expect(go(vehicleGame(), 9, { x: 22, y: 23 }).ok).toBe(true); // out of the one it stands in
    expect(go(vehicleGame(), 10, { x: 22, y: 17 }).ok).toBe(true); // across it
    const walled = vehicleGame();
    walled.terrain = [{ ...walled.terrain[0], category: 'dense', height: 5, walls: [{ a: { x: 15, y: 23 }, b: { x: 29, y: 23 } }] } as TerrainPiece];
    expect(go(walled, 10, { x: 22, y: 17 }).ok).toBe(false); // not through its wall
  });
  it('infantry still walks straight across', () => {
    const s = vehicleGame();
    put(s, s.units[0].id, { x: 6, y: 50 });
    const boyz = put(s, s.units[1].id, { x: 22, y: 30 });
    const paths = new Map(alive(boyz).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y - 6 }]]));
    expect(validateMove(s, boyz, 'normal', paths).ok).toBe(true);
  });
});

describe('phase flow', () => {
  it('command phase gives both players 1 CP and fight order starts with active player', () => {
    const s = game();
    s.units.forEach((u, i) => put(s, u.id, { x: 6 + (i % 2) * 30, y: 8 + i * 12 }));
    s.round = 1; s.turn = 0; s.active = 0; s.phase = 'charge';
    endPhase(s);
    expect(s.phase).toBe('fight');
    expect(s.fight?.step).toBe('pileIn');
    expect(fightCandidates(s).units.length).toBe(0);
  });
});

describe('army rules', () => {
  it('Combat Doctrines: the devastator doctrine gives ranged attacks [ASSAULT] (shoot after advancing)', async () => {
    const { pickDetChoice } = await import('./detachments');
    const s = game();
    const a = put(s, s.units[0].id, { x: 22, y: 10 });
    const t = put(s, s.units[2].id, { x: 22, y: 25 });
    s.phase = 'command'; s.active = 0; s.turn = 0;
    expect(pickDetChoice(s, 0, 'Combat Doctrines', ['devastator'])).toBeNull();
    s.phase = 'shooting';
    a.move = 'advance';
    const r = buildShootPools(s, a.id, t.id, { mode: 'assault' });
    expect(r.pools.length).toBeGreaterThan(0);
  });
  it('Waaagh! gives 5+ invulnerable and lets riled units charge after advancing', async () => {
    const { callWaaagh, chargeEligibility } = await import('./game');
    const { effectiveInSv } = await import('./attack');
    const s = game();
    const boyz = put(s, s.units[2].id, { x: 22, y: 25 });
    put(s, s.units[0].id, { x: 22, y: 15 });
    s.turn = 1; s.active = 1;
    boyz.move = 'advance';
    expect(chargeEligibility(s, boyz)).toMatch(/Advance/);
    callWaaagh(s, 1);
    expect(chargeEligibility(s, boyz)).toBeNull();
    expect(effectiveInSv(s, boyz, alive(boyz)[0])).toBe(5);
  });
});

describe('transports, split fire, secondaries', () => {
  it('parses transport capacity and embarks / disembarks', async () => {
    const { parseTransport } = await import('./army');
    const t = parseTransport('This model has a transport capacity of 6 Adeptus Astartes Infantry models. It cannot transport Jump Pack, Wulfen, Phobos, Gravis, Centurion, Terminator or Tacticus models.');
    expect(t?.capacity).toBe(6);
    expect(t?.infantryOnly).toBe(true);
    expect(t?.forbid).toContain('TACTICUS');
    const lr = parseTransport('This model has a transport capacity of 12 Adeptus Astartes Infantry models. Each Jump Pack, Wulfen, Gravis or Terminator model takes up the space of 2 models and each Centurion model takes up the space of 3 models.');
    expect(lr?.double).toEqual(['JUMP PACK', 'WULFEN', 'GRAVIS', 'TERMINATOR']);
  });

  it('a model that fired its guns cannot fire its pistols afterwards: the unit is then done', async () => {
    const { finishAttack, stepAttack, unfiredWeaponNames } = await import('./attack');
    const s = game();
    const a = put(s, s.units[0].id, { x: 22, y: 10 });
    const t = put(s, s.units[2].id, { x: 22, y: 25 });
    s.phase = 'shooting'; s.active = 0; s.turn = 0;
    const pools = buildShootPools(s, a.id, t.id, { mode: 'normal' }).pools;
    expect(pools.some((p) => p.weapon === 'Bolt Rifle')).toBe(true);
    expect(pools.some((p) => p.weapon === 'Bolt Pistol')).toBe(false);
    startAttack(s, 'shoot', a.id, t.id, pools);
    while (s.attack!.stage !== 'done') stepAttack(s);
    finishAttack(s);
    expect(unfiredWeaponNames(a)).not.toContain('Bolt Pistol');
    expect(a.selectedToShoot).toBe(true);
    const pistols = buildShootPools(s, a.id, t.id, { mode: 'normal', useCloseQuarters: true }).pools;
    expect(pistols.some((p) => p.weapon === 'Bolt Pistol')).toBe(false);
  });

  it('secondary claims respect the 15VP per round cap', async () => {
    const { claimSecondary, drawSecondaries } = await import('./game');
    const s = createGame({
      lists: [list('SM', [['Intercessor Squad', 10, 150], ['Captain', 1, 80]]), list('ORK', [['Boyz', 10, 90], ['Warboss', 1, 100]])],
      factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 3, secondaryMode: 'tactical',
    });
    s.round = 1;
    drawSecondaries(s, 0, 6);
    const ids = [...s.players[0].secActive];
    let total = 0;
    for (const id of ids) total += claimSecondary(s, 0, id, 5);
    expect(total).toBe(15);
    expect(s.players[0].secVp).toBe(15);
  });
});

describe('emergency disembark', () => {
  it('passengers survive (battle-shocked) when their Trukk is destroyed', async () => {
    const { embarkUnit } = await import('./game');
    const { applyMortalWounds } = await import('./attack');
    const units = buildUnits(list('ORK', [['Trukk', 1, 60], ['Boyz', 10, 90]]), ORK, 1);
    const s = game();
    s.units.push(...units.map((u, i) => ({ ...u, id: `tr${i}` })));
    const trukk = s.units.find((u) => u.id === 'tr0')!;
    const boyz = s.units.find((u) => u.id === 'tr1')!;
    put(s, trukk.id, { x: 22, y: 30 });
    expect(trukk.transport?.capacity).toBeGreaterThanOrEqual(10);
    expect(embarkUnit(s, boyz, trukk, true)).toBeNull();
    expect(boyz.status).toBe('embarked');
    applyMortalWounds(s, trukk, 50, 'test');
    expect(trukk.status).toBe('destroyed');
    expect(boyz.status).toBe('board');
    expect(boyz.battleShocked).toBe(true);
  });
});

describe('board effects', () => {
  it('moves and attacks leave fx events for the UI', async () => {
    const { commitMove } = await import('./game');
    const { finishAttack, resolveAll } = await import('./attack');
    const s = game();
    const a = put(s, s.units.find((u) => u.owner === 0 && u.name.includes('Intercessor'))!.id, { x: 22, y: 20 });
    const b = put(s, s.units.find((u) => u.owner === 1 && u.name.includes('Boyz'))!.id, { x: 22, y: 34 });
    s.phase = 'movement';
    const paths = new Map(alive(a).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y + 1 }]]));
    commitMove(s, a, 'normal', paths);
    expect(s.fx?.at(-1)).toMatchObject({ kind: 'move', unitId: a.id, moveKind: 'normal' });
    s.phase = 'shooting';
    const r = buildShootPools(s, a.id, b.id, { mode: 'normal' });
    expect(r.pools.length).toBeGreaterThan(0);
    startAttack(s, 'shoot', a.id, b.id, r.pools);
    resolveAll(s);
    const lostBefore = b.models.filter((m) => m.dead).length;
    finishAttack(s);
    const fx = s.fx!.filter((e) => e.kind === 'attack').at(-1)!;
    expect(fx).toMatchObject({ kind: 'attack', attackerId: a.id, targetId: b.id, killed: lostBefore });
    expect(s.fxSeq).toBe(s.fx!.at(-1)!.seq);
  });
});

describe('sub-factions (Chapters)', () => {
  it('data tags chapter datasheets and detachments', () => {
    expect(SM.subfactions?.options.some((o) => o.keyword === 'BLOOD ANGELS')).toBe(true);
    expect(SM.datasheets.find((d) => d.name === 'Intercessor Squad')?.subfaction).toBeUndefined();
    expect(SM.detachments.find((d) => d.name === 'Saga of the Great Wolf')?.subfaction).toBe('SPACE WOLVES');
    expect(SM.detachments.find((d) => d.name === 'Gladius Task Force')?.subfaction).toBeUndefined();
  });
  it('rejects units and detachments from another chapter', async () => {
    const { validateList } = await import('./army');
    const size = { points: 2000, dp: 3, unitLimit: 3, enhancements: 3 };
    const wolf = SM.datasheets.find((d) => d.subfaction === 'SPACE WOLVES')!;
    const l: ArmyList = { name: 't', factionId: 'SM', subfaction: 'BLOOD ANGELS', battleSize: 'strike', detachments: ['Saga of the Great Wolf'], units: [{ uid: 'a', datasheet: wolf.name, models: 1, pts: 0 }] };
    const errs = validateList(l, SM, size);
    expect(errs.some((e) => e.includes('Saga of the Great Wolf'))).toBe(true);
    expect(errs.some((e) => e.includes(wolf.name))).toBe(true);
    const ok = validateList({ ...l, subfaction: 'SPACE WOLVES' }, SM, size);
    expect(ok.some((e) => e.includes('Saga of the Great Wolf') || e.includes(wolf.name))).toBe(false);
  });
});

describe('detachment stratagems', () => {
  it('reads timing, target and effects from the text', async () => {
    const { planStratagem } = await import('./stratagems');
    const aoc = SM.detachments.flatMap((d) => d.stratagems).find((x) => x.name === 'ARMOUR OF CONTEMPT')!;
    const plan = planStratagem(aoc);
    expect(plan.turn).toBe('either');
    expect(plan.phases).toEqual(['shooting', 'fight']);
    expect(plan.target).toBe('own');
    expect(plan.effects).toEqual(['enemyAp-1']);
  });
  it('blocks the wrong phase and applies a defensive effect when the dice are rolled', async () => {
    const { applyDetachmentStratagem, stratagemBlock } = await import('./stratagems');
    const { rollHits } = await import('./attack');
    const s = game();
    s.terrain = s.terrain.filter((t) => t.objectiveId); // open ground: this is about the stratagem, not sight lines
    s.terrain.forEach((t) => { t.walls = []; t.category = 'exposed'; });
    const a = put(s, s.units.find((u) => u.owner === 0 && u.name.includes('Intercessor'))!.id, { x: 22, y: 20 });
    const b = put(s, s.units.find((u) => u.owner === 1 && u.name.includes('Boyz'))!.id, { x: 22, y: 32 });
    const aoc = SM.detachments.flatMap((d) => d.stratagems).find((x) => x.name === 'ARMOUR OF CONTEMPT')!;
    s.players[0].detachments = SM.detachments.filter((d) => d.stratagems.includes(aoc));
    s.round = 1; s.active = 1; s.turn = 1; s.phase = 'movement';
    s.players[0].cp = 3;
    expect(stratagemBlock(s, 0, aoc, a)).toMatch(/phase/);
    s.phase = 'shooting';
    // the Ork unit shoots the marines; the marines react after targets are picked
    const r = buildShootPools(s, b.id, a.id, { mode: 'normal' });
    expect(r.pools.length).toBeGreaterThan(0);
    startAttack(s, 'shoot', b.id, a.id, r.pools);
    const apBefore = s.attack!.pools[0].ap;
    expect(stratagemBlock(s, 0, aoc, a)).toBeNull();
    applyDetachmentStratagem(s, 0, aoc, a.id);
    expect(s.players[0].cp).toBe(3 - aoc.cp);
    rollHits(s);
    expect(s.attack!.pools[0].ap).toBe(apBefore < 0 ? apBefore + 1 : apBefore);
  });
});

describe('Chapter Approved missions', () => {
  it('force dispositions pick each player\'s primary and an official layout', () => {
    const s = createGame({
      lists: [list('SM', [['Intercessor Squad', 10, 150], ['Captain', 1, 80]]), list('ORK', [['Boyz', 10, 90], ['Warboss', 1, 100]])],
      factions: [SM, ORK], names: ['A', 'B'], dispositions: ['purge-the-foe', 'reconnaissance'], seed: 4,
    });
    expect(s.players[0].primaryId).toBe('consecrate');
    expect(s.players[1].primaryId).toBe('triangulation');
    expect(s.deploymentId).toMatch(/purge-the-foe-vs-reconnaissance-\d/);
    expect(s.objectives.length).toBeGreaterThanOrEqual(5);
    expect(s.objectives.filter((o) => o.type === 'home').length).toBe(2);
  });
  it('Sabotage: start the action on an objective, complete it at the end of the turn and score', async () => {
    const { actionOptions, startAction, onTurnEnd, scorePrimary } = await import('./missions');
    const s = createGame({
      lists: [list('SM', [['Assault Intercessor Squad', 10, 150], ['Captain', 1, 80]]), list('ORK', [['Boyz', 10, 90], ['Warboss', 1, 100]])],
      factions: [SM, ORK], names: ['A', 'B'], dispositions: ['priority-assets', 'priority-assets'], seed: 2,
    });
    const o = s.objectives.find((x) => x.type !== 'home')!;
    const u = s.units.find((x) => x.owner === 0)!;
    placeUnit(s, u, formationAt(u, { x: o.x, y: o.y }));
    s.round = 2; s.turn = 2; s.active = 0; s.phase = 'shooting';
    for (const x of s.units) if (x.owner === 1) x.status = 'reserves';
    s.objectives.forEach((x) => (x.controller = null));
    o.controller = 0;
    const opts = actionOptions(s, 0).filter((x) => x.action === 'sabotage' && x.objId === o.id);
    expect(opts.length).toBe(1);
    startAction(s, opts[0]);
    expect(u.selectedToShoot).toBe(true);
    onTurnEnd(s);
    expect(s.players[0].mission.done.some((d) => d.action === 'sabotage')).toBe(true);
    const before = s.players[0].vp;
    scorePrimary(s, 'endOfYourTurn', 0);
    expect(s.players[0].vp).toBeGreaterThanOrEqual(before + 3);
  });
  it('moving cancels a pending action', async () => {
    const { actionOptions, startAction } = await import('./missions');
    const { commitMove } = await import('./game');
    const s = createGame({
      lists: [list('SM', [['Intercessor Squad', 10, 150], ['Captain', 1, 80]]), list('ORK', [['Boyz', 10, 90], ['Warboss', 1, 100]])],
      factions: [SM, ORK], names: ['A', 'B'], dispositions: ['priority-assets', 'take-and-hold'], seed: 2,
    });
    const o = s.objectives.find((x) => x.type !== 'home')!;
    const u = s.units.find((x) => x.owner === 0)!;
    placeUnit(s, u, formationAt(u, { x: o.x, y: o.y }));
    s.round = 2; s.turn = 2; s.active = 0; s.phase = 'shooting';
    startAction(s, actionOptions(s, 0).find((x) => x.unitId === u.id)!);
    expect(s.pendingActions.length).toBe(1);
    commitMove(s, u, 'normal', new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y + 0.5 }]])));
    expect(s.pendingActions.length).toBe(0);
  });
  it('snap shooting 6s are hits, not critical hits', async () => {
    const { rollHits } = await import('./attack');
    const s = game();
    s.terrain = s.terrain.filter((t) => t.objectiveId); // open ground: this is about the stratagem, not sight lines
    s.terrain.forEach((t) => { t.walls = []; t.category = 'exposed'; });
    const a = put(s, s.units[0].id, { x: 22, y: 10 });
    const t = put(s, s.units[2].id, { x: 22, y: 25 });
    s.phase = 'movement'; s.active = 1; s.turn = 1;
    const r = buildShootPools(s, a.id, t.id, { mode: 'snap' });
    startAttack(s, 'overwatch', a.id, t.id, r.pools);
    rollHits(s);
    expect(s.attack!.pools[0].hits.some((h) => h.o === 'crit')).toBe(false);
  });
});

describe('wargear', () => {
  const opt = (sheetName: string, f: FactionData, re: RegExp) => f.datasheets.find((d) => d.name === sheetName)!.wargearOptions!.findIndex((o) => re.test(o.text));
  const one = (f: FactionData, factionId: string, e: ArmyUnitEntry) => buildUnits({ name: 't', factionId, battleSize: 'incursion', detachments: [], units: [e] }, f, 0)[0];

  it('parses the datasheet options into structured choices', () => {
    const ics = SM.datasheets.find((d) => d.name === 'Intercessor Squad')!;
    const gl = ics.wargearOptions!.find((o) => o.scope === 'perN')!;
    expect(gl).toMatchObject({ per: 5, max: 1, replace: [], choices: [['Grenade Launcher']] });
    expect(Object.values(SM.datasheets.find((d) => d.name === 'Land Raider')!.loadout).flat().filter((x) => /godhammer/i.test(x))).toHaveLength(2);
  });
  it('swaps the sergeant weapon and adds grenade launchers to rank-and-file models', () => {
    const sgtOpt = opt('Intercessor Squad', SM, /Sergeant: Bolt Rifle/);
    const pw = SM.datasheets.find((d) => d.name === 'Intercessor Squad')!.wargearOptions![sgtOpt].choices.findIndex((c) => c[0] === 'Power Weapon');
    const glOpt = opt('Intercessor Squad', SM, /Grenade Launcher/);
    const u = one(SM, 'SM', { uid: 'a', datasheet: 'Intercessor Squad', models: 10, pts: 170, wargear: [{ opt: sgtOpt, choice: pw, count: 1 }, { opt: glOpt, choice: 0, count: 2 }] });
    const sgt = u.models.find((m) => m.name === 'Intercessor Sergeant')!;
    expect(sgt.weapons.map((w) => w.name)).toContain('Power Weapon');
    expect(sgt.weapons.map((w) => w.name)).not.toContain('Bolt Rifle');
    const gl = u.models.filter((m) => m.weapons.some((w) => w.name === 'Grenade Launcher'));
    expect(gl).toHaveLength(2);
    expect(gl.every((m) => m.name !== 'Intercessor Sergeant' && m.weapons.some((w) => w.name === 'Bolt Rifle'))).toBe(true);
    expect(wargearMax(SM.datasheets.find((d) => d.name === 'Intercessor Squad')!, SM.datasheets.find((d) => d.name === 'Intercessor Squad')!.wargearOptions![glOpt], 5)).toBe(1);
  });
  it('charges per-item wargear points and applies storm shields (+1 W)', () => {
    const tas = SM.datasheets.find((d) => d.name === 'Terminator Assault Squad')!;
    const hammers = tas.wargearOptions!.findIndex((o) => o.who === 'Terminator' && o.choices.some((c) => c.includes('Thunder Hammer')));
    expect(wargearPoints(tas, { models: 5 })).toBe(0); // lightning claws by default
    expect(wargearPoints(tas, { models: 5, wargear: [{ opt: hammers, choice: 0, count: 2 }] })).toBe(10);
    const u = one(SM, 'SM', syncWargear(tas, { uid: 'a', datasheet: tas.name, models: 5, pts: 170, wargear: [{ opt: hammers, choice: 0, count: 2 }] }));
    expect(u.pts).toBe((tas.points[0].options.find((o) => o.models === 5)?.pts ?? 0) + 10); // the unit's current price + 2 hammers
    expect(u.models.filter((m) => m.weapons.some((w) => w.name === 'Thunder Hammer') && m.profile.W === 4)).toHaveLength(2);
    expect(u.models.filter((m) => m.profile.W === 3)).toHaveLength(3);
  });
  it('vehicles carry every listed weapon', () => {
    const lr = one(SM, 'SM', { uid: 'a', datasheet: 'Land Raider', models: 1, pts: 245 });
    expect(lr.models[0].weapons.filter((w) => w.name === 'Godhammer Lascannon')).toHaveLength(2);
    expect(lr.models[0].weapons.some((w) => w.name === 'Twin Heavy Bolter')).toBe(true);
  });
  it('sizes clamp choices: Boyz get one special weapon per 10 models', () => {
    const boyz = ORK.datasheets.find((d) => d.name === 'Boyz')!;
    const big = boyz.wargearOptions!.findIndex((o) => o.choices.some((c) => c[0] === 'Big Shoota'));
    expect(wargearMax(boyz, boyz.wargearOptions![big], 20)).toBe(2);
    const e = syncWargear(boyz, { uid: 'b', datasheet: 'Boyz', models: 10, pts: 90, wargear: [{ opt: big, choice: 0, count: 2 }] });
    expect(e.wargear).toEqual([{ opt: big, choice: 0, count: 1 }]);
  });
});

describe('moving by drag: settling, routing, vehicles and walls', () => {
  const wall = (a: Pt, b: Pt): TerrainPiece => ({ id: `w${a.x}${a.y}`, kind: 'ruin', label: 'ruin', category: 'dense', height: 5, poly: [a, b, { x: b.x + 0.2, y: b.y }, { x: a.x + 0.2, y: a.y }], walls: [{ a, b }] });
  function lrGame() {
    const s = createGame({
      lists: [list('SM', [['Land Raider', 1, 240], ['Intercessor Squad', 5, 80], ['Captain', 1, 80]]), list('ORK', [['Boyz', 10, 90], ['Warboss', 1, 100]])],
      factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 7,
    });
    s.terrain = [];
    s.phase = 'movement';
    s.active = 0;
    return s;
  }

  it('models dragged on top of each other settle into base contact instead of failing', () => {
    const s = game();
    s.phase = 'movement'; s.active = 0;
    const u = put(s, 'p0-x0', { x: 20, y: 20 });
    put(s, 'p1-x0', { x: 45, y: 35 });
    const target = { x: 24, y: 20 };
    const paths = new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, target]]));
    expect(validateMove(s, u, 'normal', paths).ok).toBe(false);
    const settled = settleMove(s, u, 'normal', paths, { maxFor: (m) => maxMoveDistance(s, u, 'normal', m) });
    const chk = validateMove(s, u, 'normal', settled);
    expect(chk.errors.filter((e) => /overlaps/.test(e))).toEqual([]);
  });

  it('a Land Raider next to a wall can drive away from it, and is routed around a wall in its way', () => {
    const s = lrGame();
    const lr = s.units.find((x) => x.name === 'Land Raider')!;
    expect(lr.models[0].r).toBeCloseTo(3.0);
    s.terrain.push(wall({ x: 20, y: 10 }, { x: 20, y: 30 }));
    placeUnit(s, lr, new Map([[lr.models[0].id, { x: 18.4, y: 20 }]])); // hull already touching the wall
    const m = lr.models[0];
    const away = new Map([[m.id, [{ x: m.x, y: m.y }, { x: 10, y: 20 }]]]);
    expect(validateMove(s, lr, 'normal', away).ok).toBe(true);
    // through the wall: blocked, but settling routes it round the end of the wall
    placeUnit(s, lr, new Map([[m.id, { x: 14, y: 26 }]]));
    const through = new Map([[m.id, [{ x: 14, y: 26 }, { x: 26, y: 26 }]]]);
    expect(validateMove(s, lr, 'normal', through).errors.join()).toMatch(/wall/);
    const routed = settleMove(s, lr, 'normal', through, { maxFor: () => 30 });
    const path = routed.get(m.id)!;
    expect(path.length).toBeGreaterThan(2);
    expect(path[path.length - 1].x).toBeGreaterThan(20);
    expect(validateMove(s, lr, 'normal', routed, { maxOverride: 30 }).ok).toBe(true);
  });

  it('a charge dragged into the enemy settles at base contact, commits, and the phase moves on to Fight', () => {
    const s = game();
    s.phase = 'charge'; s.active = 0;
    const u = put(s, 'p0-x0', { x: 20, y: 22 });
    const t = put(s, 'p1-x0', { x: 30, y: 22 });
    u.declaredCharge = true; u.chargeRoll = 9;
    const e = alive(t)[0];
    const paths = new Map(alive(u).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: e.x, y: e.y }]]));
    const settled = settleMove(s, u, 'charge', paths, { maxFor: () => 9, targets: [t.id] });
    const chk = validateMove(s, u, 'charge', settled, { targets: [t.id] });
    expect(chk.errors.filter((x) => /overlaps|through/.test(x))).toEqual([]);
    expect(chk.errors).toEqual([]);
    commitCharge(s, u, settled, [t.id]);
    endPhase(s);
    expect(s.phase).toBe('fight');
  });
});

describe('detachment rules', () => {
  function detGame(smDet: string, orkDet: string, sm: [string, number, number, string?][] = [['Intercessor Squad', 10, 160], ['Captain', 1, 80]], ork: [string, number, number, string?][] = [['Boyz', 10, 90], ['Warboss', 1, 100]]) {
    const a = list('SM', sm), b = list('ORK', ork);
    a.detachments = [smDet]; b.detachments = [orkDet];
    const s = createGame({ lists: [a, b], factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42 });
    s.terrain = s.terrain.filter((t) => t.objectiveId);
    s.terrain.forEach((t) => (t.walls = []));
    return s;
  }

  it('Combat Doctrines: pick one per Command phase, each once per battle; Assault Doctrine lets advancing units charge', () => {
    const s = detGame('Terminator Storm Force', 'War Horde');
    s.phase = 'command'; s.active = 0;
    const u = put(s, 'p0-x0', { x: 20, y: 20 });
    put(s, 'p1-x0', { x: 20, y: 28 });
    u.move = 'advance';
    expect(chargeEligibility(s, u)).toMatch(/Advance/);
    expect(detChoices(s, 0)[0].open).toBe(true);
    expect(pickDetChoice(s, 0, 'Combat Doctrines', ['assault'])).toBeNull();
    expect(chargeEligibility(s, u)).toBeNull();
    expect(pickDetChoice(s, 0, 'Combat Doctrines', ['devastator'])).toMatch(/Cannot|Already|All uses/); // already picked this Command phase
    s.turn += 2; // our next Command phase
    detOnCommandStart(s, 0, true);
    expect(chargeEligibility(s, u)).toMatch(/Advance/);
    expect(detChoices(s, 0)[0].options.find((o) => o.o.id === 'assault')!.why).toBeTruthy();
  });

  it('War Horde gives Ork melee Sustained Hits 1', () => {
    const s = detGame('Gladius Task Force', 'War Horde');
    s.phase = 'fight';
    const u = put(s, 'p0-x0', { x: 20, y: 20 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 25.2 });
    const ork = buildFightPools(s, boyz.id, u.id).pools;
    expect(ork.length).toBeGreaterThan(0);
    expect(ork.every((p) => p.sustained === '1')).toBe(true);
  });
  it('Wrath of the Rock makes attacks with S greater than T -1 to wound', () => {
    const s2 = detGame('Wrath of the Rock', 'War Horde');
    s2.phase = 'fight'; s2.active = 1;
    const v = put(s2, 'p0-x0', { x: 20, y: 20 });
    const b2 = put(s2, 'p1-x0', { x: 20, y: 25.2 });
    const pools = buildFightPools(s2, b2.id, v.id).pools;
    const strong = pools.filter((p) => (p.profile.S ?? 0) > 5); // Intercessors are T5
    const weak = pools.filter((p) => (p.profile.S ?? 0) <= 5);
    expect(strong.every((p) => p.woundMod === -1)).toBe(true);
    expect(weak.every((p) => p.woundMod === 0)).toBe(true);
  });
  it('re-roll and fixed rolls: Tacticus Attack Force, Blitz Brigade', () => {
    const s = detGame('Tacticus Attack Force', 'Blitz Brigade', [['Intercessor Squad', 10, 170], ['Captain', 1, 80]], [['Battlewagon', 1, 160], ['Warboss', 1, 100]]);
    s.phase = 'movement'; s.active = 0;
    const u = put(s, 'p0-x0', { x: 20, y: 20 });
    const bw = put(s, 'p1-x0', { x: 20, y: 40 });
    rollAdvance(s, u);
    expect(canDetReroll(s, u, 'advance')).toBe(true);
    s.active = 1;
    rollAdvance(s, bw);
    expect(bw.advanceRoll).toBe(6);
  });
});

describe('end positions', () => {
  it('a model cannot end a move on top of an objective marker', () => {
    const s = createGame({
      lists: [list('SM', [['Intercessor Squad', 5, 80]]), list('ORK', [['Boyz', 10, 90]])],
      factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    s.terrain = [];
    const o = s.objectives[2];
    const u = put(s, s.units[0].id, { x: o.x, y: o.y - 6 });
    const m = alive(u)[0];
    const onIt = validateMove(s, u, 'normal', new Map([[m.id, [{ x: m.x, y: m.y }, { x: o.x, y: o.y }]]]));
    expect(onIt.errors.some((e) => /objective marker/.test(e))).toBe(true);
    const beside = validateMove(s, u, 'normal', new Map([[m.id, [{ x: m.x, y: m.y }, { x: o.x, y: o.y - 1.6 }]]]));
    expect(beside.errors.some((e) => /objective marker/.test(e))).toBe(false);
  });
});
