import { describe, expect, it } from 'vitest';
import {
  addBloodTithe,
  addCabalFlux,
  addWaaaghMomentum,
  castDoomboltCascade,
  castTemporalTwist,
  getWaaaghTier,
  processAscendancyTurnStart,
  spendBloodTithe,
  toggleDynasticGrid,
  WAAAGH_TIERS,
} from './ascendancy';
import { combatMods } from './combatMods';
import { initCombatState } from './combatEngine';
import type { GameState, ModelState, UnitState } from './types';

function createMockModel(name: string, wounds = 3, maxWounds = 3, x = 10, y = 10): ModelState {
  return {
    id: `m-${Math.random().toString(36).slice(2, 7)}`,
    name,
    wounds,
    profile: {
      name,
      M: 6,
      T: 4,
      Sv: 3,
      InSv: null,
      W: maxWounds,
      Ld: 7,
      OC: 1,
      base: { w: 32, h: 32, text: '32mm' },
    },
    weapons: [],
    keywords: ['INFANTRY'],
    x,
    y,
    r: 0.6,
    dead: false,
    source: 'mock',
    isCharacter: false,
    isBodyguard: false,
  };
}

function createMockUnit(name: string, owner: 0 | 1 = 0, keywords: string[] = ['INFANTRY'], x = 10, y = 10): UnitState {
  const m1 = createMockModel(`${name} 1`, 3, 3, x, y);
  const u = {
    id: `u-${Math.random().toString(36).slice(2, 7)}`,
    name,
    owner,
    sources: [name],
    status: 'board',
    models: [m1],
    abilities: [],
    keywords,
    combatRole: 'VANGUARD',
    combatState: initCombatState('VANGUARD'),
  } as unknown as UnitState;
  return u;
}

function createMockState(): GameState {
  return {
    players: [
      { id: 0, name: 'Player 1', cp: 2, vp: 0, secVp: 0, armyRules: [], stratagems: [] } as any,
      { id: 1, name: 'Player 2', cp: 2, vp: 0, secVp: 0, armyRules: [], stratagems: [] } as any,
    ],
    units: [],
    table: { width: 44, height: 30 },
    round: 1,
    turn: 1,
    active: 0,
    phase: 'movement',
    log: [],
    markers: [],
    objectives: [],
    terrain: [],
  } as unknown as GameState;
}

describe('Faction Ascendancy Engine (v2.0)', () => {
  describe('Orks WAAAGH! Momentum', () => {
    it('scales through Tiers 1 to 3 with appropriate buffs', () => {
      expect(getWaaaghTier(20).tier).toBe(1);
      expect(getWaaaghTier(20).name).toBe('Rowdy');

      expect(getWaaaghTier(50).tier).toBe(2);
      expect(getWaaaghTier(50).name).toBe('Proper Killy');

      expect(getWaaaghTier(85).tier).toBe(3);
      expect(getWaaaghTier(85).name).toBe('Da Biggest WAAAGH!');
    });

    it('addWaaaghMomentum increases momentum and clamps between 0 and 100', () => {
      const s = createMockState();
      addWaaaghMomentum(s, 0, 40);
      expect(s.players[0].waaaghMomentum).toBe(60); // 20 baseline + 40

      addWaaaghMomentum(s, 0, 100);
      expect(s.players[0].waaaghMomentum).toBe(100);

      addWaaaghMomentum(s, 0, -200);
      expect(s.players[0].waaaghMomentum).toBe(0);
    });

    it('confers melee bonuses during attack resolution based on active tier', () => {
      const s = createMockState();
      s.players[0].waaaghMomentum = 80; // Tier 3

      const orkUnit = createMockUnit('Boyz', 0, ['INFANTRY', 'ORK']);
      const foeUnit = createMockUnit('Space Marines', 1);
      s.units = [orkUnit, foeUnit];

      const mods = combatMods({
        s,
        A: orkUnit,
        T: foeUnit,
        m: orkUnit.models[0],
        psychic: false,
        mode: 'melee',
        d: 0,
        p: { name: 'Choppa', range: 'Melee', A: '2', skill: 3, S: 4, AP: 0, D: '1', abilities: [] },
        weapon: 'Choppa',
      });

      expect(mods.strengthBonus).toBe(1);
      expect(mods.attacksBonus).toBe(1);
      expect(mods.hitNotes.some((n) => n.includes('WAAAGH! Tier 3'))).toBe(true);
    });
  });

  describe('Thousand Sons Arcane Flux', () => {
    it('addCabalFlux clamps flux between 0 and 12', () => {
      const s = createMockState();
      addCabalFlux(s, 0, 5);
      expect(s.players[0].cabalFlux).toBe(9); // 4 baseline + 5

      addCabalFlux(s, 0, 10);
      expect(s.players[0].cabalFlux).toBe(12);
    });

    it('castDoomboltCascade: expends 6 flux and deals 1d3+3 mortal wounds to enemy', () => {
      const s = createMockState();
      s.players[0].cabalFlux = 8;

      const target = createMockUnit('Guardsmen', 1);
      s.units = [target];

      const initialHP = target.models[0].wounds;
      const res = castDoomboltCascade(s, 0, target.id);

      expect(res.success).toBe(true);
      expect(res.damage).toBeGreaterThanOrEqual(4);
      expect(s.players[0].cabalFlux).toBe(2);
      expect(target.models[0].wounds).toBeLessThan(initialHP);
    });

    it('castDoomboltCascade: fails if insufficient flux', () => {
      const s = createMockState();
      s.players[0].cabalFlux = 3;

      const target = createMockUnit('Guardsmen', 1);
      s.units = [target];

      const res = castDoomboltCascade(s, 0, target.id);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Not enough Arcane Flux');
    });

    it('castTemporalTwist: expends 4 flux and grants movement boost', () => {
      const s = createMockState();
      s.players[0].cabalFlux = 5;

      const ally = createMockUnit('Rubric Marines', 0);
      s.units = [ally];

      const res = castTemporalTwist(s, 0, ally.id);
      expect(res.success).toBe(true);
      expect(s.players[0].cabalFlux).toBe(1);
      expect(ally.timed?.some((t) => t.label.includes('Temporal Twist'))).toBe(true);
    });
  });

  describe('Necrons Dynastic Grid', () => {
    it('toggleDynasticGrid toggles between resurrection and detonation', () => {
      const s = createMockState();
      s.players[0].dynasticGridMode = 'resurrection';

      const mode1 = toggleDynasticGrid(s, 0);
      expect(mode1).toBe('detonation');
      expect(s.players[0].dynasticGridMode).toBe('detonation');

      const mode2 = toggleDynasticGrid(s, 0);
      expect(mode2).toBe('resurrection');
      expect(s.players[0].dynasticGridMode).toBe('resurrection');
    });

    it('Detonation mode grants Gauss weapons +1 AP and 5+ Critical Hits', () => {
      const s = createMockState();
      s.players[0].dynasticGridMode = 'detonation';

      const necronUnit = createMockUnit('Necron Immortals', 0, ['INFANTRY', 'NECRONS']);
      const foeUnit = createMockUnit('Space Marines', 1);
      s.units = [necronUnit, foeUnit];

      const mods = combatMods({
        s,
        A: necronUnit,
        T: foeUnit,
        m: necronUnit.models[0],
        psychic: false,
        mode: 'ranged',
        d: 12,
        p: { name: 'Gauss Blaster', range: 24, A: '2', skill: 3, S: 5, AP: -1, D: '1', abilities: [] },
        weapon: 'Gauss Blaster',
      });

      expect(mods.apBonus).toBe(1);
      expect(mods.critHitOn).toBe(5);
      expect(mods.hitNotes.some((n) => n.includes('Dynastic Detonation'))).toBe(true);
    });
  });

  describe('World Eaters Blood Tithe', () => {
    it('addBloodTithe increases points and caps at 8', () => {
      const s = createMockState();
      addBloodTithe(s, 0, 3);
      expect(s.players[0].tithe).toBe(3);

      addBloodTithe(s, 0, 10);
      expect(s.players[0].tithe).toBe(8);
    });

    it('spendBloodTithe: consumes tithe points when available', () => {
      const s = createMockState();
      s.players[0].tithe = 5;

      const success = spendBloodTithe(s, 0, 3, 'Total Carnage');
      expect(success).toBe(true);
      expect(s.players[0].tithe).toBe(2);

      const fail = spendBloodTithe(s, 0, 4, 'Warp Blades');
      expect(fail).toBe(false);
      expect(s.players[0].tithe).toBe(2);
    });
  });

  describe('Turn start ascendancy upkeep', () => {
    it('processAscendancyTurnStart replenishes flux for Thousand Sons and sets defaults', () => {
      const s = createMockState();
      const tsonsUnit = createMockUnit('Sorcerer', 0, ['INFANTRY', 'PSYKER', 'THOUSAND SONS']);
      s.units = [tsonsUnit];

      processAscendancyTurnStart(s, 0);
      expect(s.players[0].cabalFlux).toBeGreaterThanOrEqual(6); // 4 + 2
    });
  });
});
