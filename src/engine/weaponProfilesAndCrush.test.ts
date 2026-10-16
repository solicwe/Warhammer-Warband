import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildShootPools } from './attack';
import { createGame, formationAt, placeUnit } from './game';
import { canUseStratagem } from './state';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

type Row = [string, number, number];
const list = (factionId: string, units: Row[], detachments: string[] = []): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments, units: units.map(([d, n, pts], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts })),
});

function setupGame(sm: Row[], det: string[], ork: Row[]): GameState {
  const s = createGame({
    lists: [list('SM', sm, det), list('ORK', ork)], factions: [SM, ORK], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 7,
  });
  s.terrain = [];
  s.round = 2; s.turn = 2; s.phase = 'shooting'; s.active = 0;
  s.players[0].cp = 10; s.players[1].cp = 10;
  return s;
}

const put = (s: GameState, id: string, c: Pt) => {
  const u = s.units.find((x) => x.id === id)!;
  placeUnit(s, u, formationAt(u, c));
  u.setUpTurn = -10;
  return u;
};

describe('Crushing Impact restrictions', () => {
  it('blocks infantry units from using Crushing Impact and allows MONSTER or VEHICLE', () => {
    const s = setupGame([['Intercessor Squad', 5, 80], ['Redemptor Dreadnought', 1, 200]], ['Gladius Task Force'], [['Boyz', 10, 90]]);
    const intercessors = s.units.find((u) => u.name === 'Intercessor Squad')!;
    const dreadnought = s.units.find((u) => u.name === 'Redemptor Dreadnought')!;

    // Intercessors are INFANTRY
    expect(canUseStratagem(s, 0, 'crushing-impact', intercessors)).toBe('Only MONSTER or VEHICLE units can use Crushing Impact');

    // Redemptor Dreadnought is a VEHICLE
    expect(canUseStratagem(s, 0, 'crushing-impact', dreadnought)).toBeNull();
  });
});

describe('Weapon profile selection and Close-Quarters (Pistol) function', () => {
  it('correctly resolves Bolt Rifle focused fire vs saturation, and Bolt Pistol close-quarters', () => {
    const s = setupGame([['Intercessor Squad', 5, 80]], ['Gladius Task Force'], [['Boyz', 10, 90]]);
    const intercessors = put(s, s.units.find((u) => u.name === 'Intercessor Squad')!.id, { x: 20, y: 20 });
    const boyz = put(s, s.units.find((u) => u.name === 'Boyz')!.id, { x: 20, y: 30 }); // 10" away

    // 1. Default / Profile 0: focused fire
    const resFocused = buildShootPools(s, intercessors.id, boyz.id, {
      mode: 'normal',
      profile: { 'Bolt Rifle': 0 },
      useCloseQuarters: false,
    });
    expect(resFocused.error).toBeUndefined();
    const focusedPool = resFocused.pools.find((p) => p.weapon === 'Bolt Rifle')!;
    expect(focusedPool).toBeDefined();
    expect(focusedPool.profile.name).toBe('focused fire');
    expect(focusedPool.profile.S).toBe(6);
    expect(focusedPool.profile.AP).toBe(-1);
    expect(focusedPool.profile.D).toBe('2');
    expect(focusedPool.profile.abilities).toContain('heavy');
    expect(focusedPool.profile.abilities).toContain('rapid fire 1');

    // 2. Profile 1: saturation
    const resSaturation = buildShootPools(s, intercessors.id, boyz.id, {
      mode: 'normal',
      profile: { 'Bolt Rifle': 1 },
      useCloseQuarters: false,
    });
    expect(resSaturation.error).toBeUndefined();
    const satPool = resSaturation.pools.find((p) => p.weapon === 'Bolt Rifle')!;
    expect(satPool).toBeDefined();
    expect(satPool.profile.name).toBe('saturation');
    expect(satPool.profile.S).toBe(5);
    expect(satPool.profile.AP).toBe(-1);
    expect(satPool.profile.D).toBe('1');
    expect(satPool.profile.abilities).toContain('assault');
    expect(satPool.profile.abilities).toContain('rapid fire 1');

    // 3. Pistols / Close-quarters: Bolt Pistol
    const resPistol = buildShootPools(s, intercessors.id, boyz.id, {
      mode: 'normal',
      useCloseQuarters: true,
    });
    expect(resPistol.error).toBeUndefined();
    const pistolPool = resPistol.pools.find((p) => p.weapon === 'Bolt Pistol')!;
    expect(pistolPool).toBeDefined();
    expect(pistolPool.profile.name).toBe('Bolt Pistol');
    expect(pistolPool.profile.S).toBe(5);
    expect(pistolPool.profile.AP).toBe(-1);
    expect(pistolPool.profile.D).toBe('1');
    expect(pistolPool.profile.abilities).toContain('close-quarters');
    // Bolt Rifle should NOT be in the pools when firing pistols
    expect(resPistol.pools.some((p) => p.weapon === 'Bolt Rifle')).toBe(false);
  });
});

