import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { canLeaderAttach, supportIn, buildUnits } from './army';
import { effectsFor, ocOf, activeRules } from '../rules-engine/effects';
import type { ArmyList, FactionData, GameState, UnitState } from './types';

const loadFaction = (id: string): FactionData =>
  JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));

const AM = loadFaction('AM');
const ORK = loadFaction('ORK');

describe('Support / Leader Attachments and Detachment Buff Targets', () => {
  it('allows Support character attached to squad to identify available Leaders', () => {
    // E.g. Ork Nobz squad with Painboy (Support) attached
    const nobzSheet = ORK.datasheets.find((d) => d.name === 'Nobz')!;
    const painboySheet = ORK.datasheets.find((d) => d.name === 'Painboy')!;
    const warbossSheet = ORK.datasheets.find((d) => d.name === 'Warboss')!;

    expect(supportIn({ units: [], detachments: [] } as any, painboySheet)).toBe(true);
    expect(supportIn({ units: [], detachments: [] } as any, warbossSheet)).toBe(false);

    // Both can attach to Nobz
    expect(canLeaderAttach(painboySheet, nobzSheet)).toBe(true);
    expect(canLeaderAttach(warbossSheet, nobzSheet)).toBe(true);

    const list: ArmyList = {
      name: 'Ork Waaagh',
      factionId: 'ORK',
      battleSize: 'incursion',
      detachments: ['Bully Boyz'],
      units: [
        { uid: 'nobz1', datasheet: 'Nobz', models: 5, pts: 105 },
        { uid: 'painboy1', datasheet: 'Painboy', models: 1, pts: 70, attachTo: 'nobz1' },
      ],
    };

    // When clicking menu on Painboy (u = painboy1, body = nobz1):
    const u = list.units.find((x) => x.uid === 'painboy1')!;
    const body = list.units.find((x) => x.uid === u.attachTo);
    const bodySheet = nobzSheet;
    const sheet = painboySheet;

    // Body support should be false because painboy is support
    const bodySupport = body && bodySheet && !supportIn(list, sheet) && !list.units.some((c) => c.attachTo === body.uid && supportIn(list, ORK.datasheets.find(d => d.name === c.datasheet)))
      && ORK.datasheets.some((d) => supportIn(list, d) && canLeaderAttach(d, bodySheet));
    expect(bodySupport).toBeFalsy();

    // Body leader should be true because painboy is support, squad has no leader yet, and Warboss is available
    const bodyLeader = body && bodySheet && supportIn(list, sheet) && !list.units.some((c) => c.attachTo === body.uid && !supportIn(list, ORK.datasheets.find(d => d.name === c.datasheet)))
      && ORK.datasheets.some((d) => !supportIn(list, d) && canLeaderAttach(d, bodySheet));
    expect(bodyLeader).toBeTruthy();
  });

  it('Fire Zone Purge applies when Militarum Tempestus Officer is Warlord', () => {
    const listWithMTO: ArmyList = {
      name: 'Tempestus Force',
      factionId: 'AM',
      battleSize: 'incursion',
      detachments: ['Bridgehead Strike'],
      units: [
        { uid: 'u1', datasheet: 'Militarum Tempestus Command Squad', models: 5, pts: 70, warlord: true },
        { uid: 'u2', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
      ],
    };

    const unitsMTO = buildUnits(listWithMTO, AM, 0);
    const scionsMTO = unitsMTO.find((u) => u.name === 'Tempestus Scions')!;
    scionsMTO.setUpTurn = 1; // set up this turn

    const dummyGameMTO: GameState = {
      id: 'test',
      turn: 1,
      round: 1,
      active: 0,
      phase: 'shooting',
      players: [
        { id: 0, name: 'Player', cp: 3, vp: 0, secVp: 0, detachments: AM.detachments.filter(d => d.name === 'Bridgehead Strike'), armyRules: [] },
        { id: 1, name: 'Opponent', cp: 3, vp: 0, secVp: 0, detachments: [], armyRules: [] },
      ],
      units: unitsMTO,
    } as any;

    const fxMTO = effectsFor(dummyGameMTO, scionsMTO);
    // Should have Bridgehead Strike / Fire Zone Purge effects
    const detFx = fxMTO.filter((a) => a.label === 'Bridgehead Strike' || a.label === 'Fire Zone Purge');
    expect(detFx.length).toBeGreaterThan(0);

    // OC calculation should include +1 OC
    const ocCalcMTO = ocOf(dummyGameMTO, scionsMTO);
    expect(ocCalcMTO(scionsMTO.models[0])).toBe(2);

    // List without Militarum Tempestus Officer as Warlord (e.g. Cadian Castellan)
    const listWithoutMTO: ArmyList = {
      name: 'Regular Force',
      factionId: 'AM',
      battleSize: 'incursion',
      detachments: ['Bridgehead Strike'],
      units: [
        { uid: 'u1', datasheet: 'Cadian Castellan', models: 1, pts: 45, warlord: true },
        { uid: 'u2', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
      ],
    };

    const unitsNoMTO = buildUnits(listWithoutMTO, AM, 0);
    const scionsNoMTO = unitsNoMTO.find((u) => u.name === 'Tempestus Scions')!;
    scionsNoMTO.setUpTurn = 1;

    const dummyGameNoMTO: GameState = {
      id: 'test2',
      turn: 1,
      round: 1,
      active: 0,
      phase: 'shooting',
      players: [
        { id: 0, name: 'Player', cp: 3, vp: 0, secVp: 0, detachments: AM.detachments.filter(d => d.name === 'Bridgehead Strike'), armyRules: [] },
        { id: 1, name: 'Opponent', cp: 3, vp: 0, secVp: 0, detachments: [], armyRules: [] },
      ],
      units: unitsNoMTO,
    } as any;

    // OC calculation should NOT include +1 OC since Castellan is not Militarum Tempestus Officer
    const ocCalcNoMTO = ocOf(dummyGameNoMTO, scionsNoMTO);
    expect(ocCalcNoMTO(scionsNoMTO.models[0])).toBe(1);
  });

  it('detachment grants preserve target units/models on effects', () => {
    // Brute Bosses grants 'Ard as Nails to WARBOSS
    const list: ArmyList = {
      name: 'Ork Waaagh',
      factionId: 'ORK',
      battleSize: 'incursion',
      detachments: ['Brute Bosses'],
      units: [
        { uid: 'u1', datasheet: 'Warboss', models: 1, pts: 65, warlord: true },
      ],
    };

    const units = buildUnits(list, ORK, 0);
    const warboss = units.find((u) => u.name === 'Warboss')!;

    const dummyGame: GameState = {
      id: 'test3',
      turn: 1,
      round: 1,
      active: 0,
      phase: 'fight',
      players: [
        { id: 0, name: 'Player', cp: 3, vp: 0, secVp: 0, detachments: ORK.detachments.filter(d => d.name === 'Brute Bosses'), armyRules: [] },
        { id: 1, name: 'Opponent', cp: 3, vp: 0, secVp: 0, detachments: [], armyRules: [] },
      ],
      units,
    } as any;

    const fx = effectsFor(dummyGame, warboss);
    const ardAsNails = fx.find((a) => a.label === '’Ard as Nails' || a.label === "'Ard as Nails");
    expect(ardAsNails).toBeDefined();
    // The effect should carry the grant target units
    expect(ardAsNails?.e.units).toEqual(['WARBOSS']);
  });
});
