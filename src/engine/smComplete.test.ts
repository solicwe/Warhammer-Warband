// The last Space Marine rules made automatic: stratagems, enhancements and detachment rules that used to be
// "do it yourself" (Mortis Snares, In Sacrifice Victory, Coronal Susurrant, Laurels of Vigilance, Blackwing Shroud,
// Combined Deployment …), run in a game.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMortalWounds, buildShootPools, finishAttack, resolveAll, startAttack } from './attack';
import { createGame, formationAt, placeUnit } from './game';
import { applyDetachmentStratagem } from './stratagems';
import { manualActs, useAct } from './activations';
import { canUseStratagem, stratCost } from './state';
import { commitMove } from './game';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

type Row = [string, number, number, Partial<{ enhancement: string; attachTo: string }>?];
const list = (factionId: string, units: Row[]): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments: [],
  units: units.map(([d, n, pts, extra], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts, ...extra })),
});

function game(sm: Row[], ork: Row[], det?: string): GameState {
  const s = createGame({
    lists: [list('SM', sm), list('ORK', ork)], factions: [SM, ORK], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
  });
  s.terrain = s.terrain.filter((t) => t.objectiveId);
  s.terrain.forEach((t) => { t.walls = []; t.category = 'exposed'; });
  for (const u of s.units) u.status = 'reserves';
  s.round = 2; s.turn = 3; s.active = 0;
  if (det) s.players[0].detachments = [SM.detachments.find((d) => d.name === det)!];
  s.players[0].cp = 5;
  return s;
}

function put(s: GameState, unitId: string, c: Pt) {
  const u = s.units.find((x) => x.id === unitId)!;
  placeUnit(s, u, formationAt(u, c));
  u.setUpTurn = -10;
  return u;
}

const strat = (s: GameState, name: string) => s.players[0].detachments.flatMap((d) => d.stratagems).find((x) => x.name === name)!;

describe('Space Marines: the last manual rules now run by themselves', () => {
  it('Mortis Snares: the objective is snared and springs on the first enemy unit that ends a move on it', () => {
    let sprung = 0;
    for (let seed = 1; seed <= 6 && !sprung; seed++) {
      const s = game([['Infiltrator Squad', 5, 100]], [['Boyz', 10, 90]], 'Phobos Shadow Force');
      s.rng = seed * 7919;
      const o = s.objectives.find((x) => x.type === 'expansion')!;
      const inf = put(s, 'p0-x0', { x: o.x, y: o.y });
      o.controller = 0;
      s.phase = 'movement';
      applyDetachmentStratagem(s, 0, strat(s, 'MORTIS SNARES'), inf.id);
      expect(o.snared).toBe(0);
      // the enemy walks onto it
      s.active = 1;
      const boyz = put(s, 'p1-x0', { x: o.x + 8, y: o.y });
      const paths = new Map(boyz.models.map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x - 5.5, y: m.y }]]));
      commitMove(s, boyz, 'normal', paths);
      expect(o.snared).toBeNull();
      if (s.log.some((l) => /Mortis Snares: .* → \d+ mortal/.test(l.text))) sprung++;
    }
    expect(sprung).toBeGreaterThan(0);
  });

  it('In Sacrifice, Victory: a Deathwing unit destroyed on our objective leaves it secured', () => {
    const s = game([['Deathwing Terminator Squad', 5, 180]], [['Boyz', 10, 90]], 'Wrath of the Rock');
    s.bots = [0, 1];
    const o = s.objectives.find((x) => x.type === 'expansion')!;
    const dw = put(s, 'p0-x0', { x: o.x, y: o.y });
    o.controller = 0;
    s.active = 1; s.phase = 'shooting';
    applyMortalWounds(s, dw, 99, 'test');
    expect(o.secured).toBe(0);
  });

  it('Coronal Susurrant: an enemy unit engaged with the bearer cannot be the target of its own stratagems', () => {
    const s = game([['Captain In Phobos Armour', 1, 75, { enhancement: 'Coronal Susurrant' }]], [['Boyz', 10, 90]]);
    const cap = put(s, 'p0-x0', { x: 20, y: 20 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 21.8 });
    s.players[1].cp = 3;
    expect(alive2(boyz)).toBe(true);
    expect(canUseStratagem(s, 1, 'command-reroll', boyz)).toMatch(/Coronal Susurrant/);
    expect(cap).toBeTruthy();
  });

  it('Laurels of Vigilance: Fire Overwatch on BATTLELINE within 12" of the bearer costs 1CP less', () => {
    const s = game([['Captain', 1, 80, { enhancement: 'Laurels of Vigilance' }], ['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
    put(s, 'p0-x0', { x: 20, y: 20 });
    const ints = put(s, 'p0-x1', { x: 26, y: 20 });
    expect(stratCost(s, 'fire-overwatch', ints)).toBe(0);
    put(s, 'p0-x1', { x: 40, y: 50 });
    expect(stratCost(s, 'fire-overwatch', ints)).toBe(1);
  });

  it('Blackwing Shroud: the bearer\'s unit has Infiltrators', () => {
    const s = game([['Captain', 1, 80, { enhancement: 'Blackwing Shroud' }]], [['Boyz', 10, 90]]);
    expect(s.units.find((u) => u.owner === 0)!.core.infiltrators).toBe(true);
  });

  it('Combined Deployment: an enemy unit hit by a transport is assailed for units that got out this turn', () => {
    const s = game([['Impulsor', 1, 80]], [['Boyz', 10, 90]], 'Gauntlet Task Force');
    const imp = put(s, 'p0-x0', { x: 20, y: 20 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 30 });
    s.phase = 'shooting';
    for (let i = 0; i < 5 && !(boyz.timed ?? []).some((t) => t.mark === 'assailed'); i++) {
      const r = buildShootPools(s, imp.id, boyz.id, { mode: 'normal' });
      imp.weaponsFired = [];
      startAttack(s, 'shoot', imp.id, boyz.id, r.pools);
      resolveAll(s);
      finishAttack(s);
    }
    const mark = (boyz.timed ?? []).find((t) => t.mark === 'assailed');
    expect(mark?.e.incoming?.abilities).toEqual(['sustained hits 1']);
    expect(mark?.e.incoming?.disembarked).toBe(true);
  });
});

const alive2 = (u: { models: { dead?: boolean }[] }) => u.models.some((m) => !m.dead);

describe('Librarius: psyker level', () => {
  it('a psyker level 1 Librarian uses one level-1 psychic ability per battle round', () => {
    const s = game([['Librarian', 1, 65]], [['Boyz', 10, 90]]);
    put(s, 'p0-x0', { x: 22, y: 20 });
    s.phase = 'movement';
    const acts = () => manualActs(s, 0).filter((m) => /psychic level/i.test(m.def.name));
    expect(acts().map((m) => m.def.name).sort()).toEqual(['Force Dome (psychic level 1)', 'Veil of Time (psychic level 1)']);
    useAct(s, acts().find((m) => m.def.name.startsWith('Force Dome'))!.def);
    expect(acts()).toEqual([]);
    s.round++; s.turn += 2;
    expect(acts().length).toBe(2);
  });
});
