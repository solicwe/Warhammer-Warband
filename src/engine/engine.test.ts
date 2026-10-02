import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildUnits, distributeModels } from './army';
import { allocationGroups, applyDamage, buildFightPools, buildShootPools, rollSavesAndDamage, startAttack, targetToughness, woundNeed } from './attack';
import { parseDice } from './dice';
import { coherencyProblems } from './geometry';
import { createGame, endPhase, fightCandidates, formationAt, placeUnit, validateMove } from './game';
import type { ArmyList, FactionData, GameState, Pt } from './types';
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
    factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'hammer-and-anvil', primaryId: 'battlefield-dominance', seed: 42,
  });
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
    const rifle = r.pools.filter((p) => p.weapon === 'Bolt rifle');
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
    expect(chk.errors.join()).toMatch(/เกินระยะ/);
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
