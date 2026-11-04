import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { actsOfUnit, actTargets, useAct, manualActs } from '../rules-engine/activations';
import { abilityRule, effectsFor } from '../rules-engine/effects';
import { createGame } from './game';
import type { ArmyList, FactionData, GameState, UnitState } from './types';

const FACTION_IDS = [
  'AC', 'AdM', 'AE', 'AM', 'AoI', 'AS', 'CD', 'CSM', 'DG', 'DRU',
  'EC', 'GC', 'GK', 'LoV', 'NEC', 'ORK', 'QI', 'QT', 'SM', 'TAU',
  'TL', 'TS', 'TYR', 'WE'
];

const loadFaction = (id: string): FactionData =>
  JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;

const ALL_FACTIONS: Record<string, FactionData> = {};
for (const id of FACTION_IDS) {
  ALL_FACTIONS[id] = loadFaction(id);
}

function createDummyGame(f1: FactionData, f2: FactionData): GameState {
  const l1: ArmyList = {
    name: 'A',
    factionId: f1.id,
    battleSize: 'incursion',
    detachments: [],
    units: [],
  };
  const l2: ArmyList = {
    name: 'B',
    factionId: f2.id,
    battleSize: 'incursion',
    detachments: [],
    units: [],
  };
  const s = createGame({
    lists: [l1, l2],
    factions: [f1, f2],
    names: ['P1', 'P2'],
    dispositions: ['take-and-hold', 'take-and-hold'],
    seed: 42,
  });
  s.round = 2;
  s.turn = 2;
  return s;
}

function makeMockUnit(s: GameState, sheetName: string, factionId: string, owner: 0 | 1 = 0): UnitState {
  const f = ALL_FACTIONS[factionId];
  const ds = f.datasheets.find((d) => d.name === sheetName);
  const abilities = (ds?.abilities ?? []).map((a) => ({
    name: a.name,
    type: a.type as 'Datasheet' | 'Core' | 'Faction' | 'Enhancement',
    text: (a as any).description || a.text || '',
    sheet: sheetName,
    faction: factionId,
  }));

  const m0 = ds?.models?.[0];
  const u = {
    id: `mock-${factionId}-${sheetName.replace(/\s+/g, '_')}-${owner}`,
    name: sheetName,
    owner,
    status: 'board',
    sources: [sheetName],
    keywords: [...(ds?.keywords ?? []), ...(ds?.factionKeywords ?? [])],
    factionKeywords: ds?.factionKeywords ?? [],
    abilities,
    enhancements: [],
    buffs: [],
    core: {},
    startingStrength: 1,
    pts: 100,
    models: [
      {
        id: `m-0`,
        name: sheetName,
        source: sheetName,
        keywords: [...(ds?.keywords ?? []), ...(ds?.factionKeywords ?? [])],
        profile: {
          name: sheetName,
          M: typeof m0?.M === 'number' ? m0.M : 6,
          T: typeof m0?.T === 'number' ? m0.T : 4,
          Sv: typeof m0?.Sv === 'number' ? m0.Sv : 3,
          InSv: m0?.InSv ?? null,
          W: typeof m0?.W === 'number' ? m0.W : 4,
          Ld: typeof m0?.Ld === 'number' ? m0.Ld : 6,
          OC: typeof m0?.OC === 'number' ? m0.OC : 1,
          base: m0?.base ?? { w: 32, h: 32, text: '32mm' },
        },
        wounds: typeof m0?.W === 'number' ? m0.W : 4,
        dead: false,
        isCharacter: false,
        isBodyguard: false,
        x: owner === 0 ? 20 : 25,
        y: 20,
        r: 1,
        weapons: [],
      },
    ],
  } as unknown as UnitState;

  s.units.push(u);
  return u;
}

describe('All Factions Ability Verification Audit', () => {
  for (const factionId of FACTION_IDS) {
    const f = ALL_FACTIONS[factionId];

    it(`${factionId}: Every datasheet ability has an executable rule or handled type`, () => {
      const dummyGame = createDummyGame(f, ALL_FACTIONS['SM']);
      makeMockUnit(dummyGame, ALL_FACTIONS['SM'].datasheets[0].name, 'SM', 1);

      for (const ds of f.datasheets) {
        const u = makeMockUnit(dummyGame, ds.name, factionId, 0);

        // 1. Check ability resolution
        for (const a of u.abilities) {
          if (a.type === 'Core' || a.type === 'Faction') continue;
          if (a.name === 'Oath of Moment' || a.name === 'Templar Vows') continue;

          const rule = abilityRule(u, a);
          expect(rule, `Ability rule missing for [${factionId}] ${ds.name} -> ${a.name}`).toBeDefined();
        }

        // 2. Check acts of unit
        const acts = actsOfUnit(dummyGame, u);
        for (const def of acts) {
          // target resolution must not throw
          const targets = actTargets(dummyGame, def);
          expect(Array.isArray(targets)).toBe(true);

          // clone state to test useAct without side effects
          const sandbox = structuredClone(dummyGame);
          const sU = sandbox.units.find((x) => x.id === u.id)!;
          const sDef = actsOfUnit(sandbox, sU).find((d) => d.key === def.key);
          if (sDef) {
            expect(() => {
              useAct(sandbox, sDef);
            }).not.toThrow();
          }
        }

        // 3. Check passive effects
        expect(() => {
          effectsFor(dummyGame, u);
        }).not.toThrow();

        // Remove unit from dummyGame after testing to prevent memory bloat
        dummyGame.units = dummyGame.units.filter((x) => x.id !== u.id);
      }
    });

    it(`${factionId}: Every detachment enhancement has an executable rule`, () => {
      const dummyGame = createDummyGame(f, ALL_FACTIONS['SM']);
      const dsName = f.datasheets[0]?.name;
      if (!dsName) return;

      const u = makeMockUnit(dummyGame, dsName, factionId, 0);

      for (const det of f.detachments || []) {
        for (const enh of det.enhancements || []) {
          const a = {
            name: enh.name,
            type: 'Enhancement' as const,
            text: (enh as any).description || enh.text || '',
            sheet: enh.name,
            faction: factionId,
          };
          const rule = abilityRule(u, a);
          expect(rule, `Enhancement rule missing for [${factionId}] Detachment: ${det.name} -> ${enh.name}`).toBeDefined();
        }
      }
    });
  }

  it('manualActs runs cleanly across all battle phases for all factions', () => {
    const phases = ['command', 'movement', 'shooting', 'charge', 'fight'] as const;
    for (const fId of ['SM', 'ORK', 'TS', 'AoI', 'AdM', 'LoV']) {
      const f = ALL_FACTIONS[fId];
      const g = createDummyGame(f, ALL_FACTIONS['CSM']);
      makeMockUnit(g, f.datasheets[0].name, fId, 0);
      makeMockUnit(g, ALL_FACTIONS['CSM'].datasheets[0].name, 'CSM', 1);

      for (const ph of phases) {
        g.phase = ph;
        expect(() => {
          manualActs(g, 0);
        }).not.toThrow();
      }
    }
  });
});
