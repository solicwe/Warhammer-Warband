import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { canLeaderAttach, supportIn, buildUnits, isBattlelineUnit, validateList, chapterRules, effectiveKeywords, enhancementOptions, subPointsList } from './army';
import { sectionOf, unitKind } from '../ui/ArmyBuilder';
import { effectsFor, ocOf, activeRules } from '../rules-engine/effects';
import type { ArmyList, FactionData, GameState, UnitState } from './types';

const loadFaction = (id: string): FactionData =>
  JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));

const AM = loadFaction('AM');
const ORK = loadFaction('ORK');
const SM = loadFaction('SM');

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

  it('Space Marine Dedicated Transports (Rhino, Impulsor, Drop Pod) are in Dedicated Transports, not Battleline', () => {
    const rhino = SM.datasheets.find((d) => d.name === 'Rhino')!;
    const impulsor = SM.datasheets.find((d) => d.name === 'Impulsor')!;
    const dropPod = SM.datasheets.find((d) => d.name === 'Drop Pod')!;
    const intercessors = SM.datasheets.find((d) => d.name === 'Intercessor Squad')!;

    const list: ArmyList = {
      name: 'Gladius Task Force',
      factionId: 'SM',
      battleSize: 'incursion',
      detachments: ['Gladius Task Force'],
      units: [
        { uid: 'u1', datasheet: 'Captain', models: 1, pts: 80, warlord: true },
        { uid: 'u2', datasheet: 'Intercessor Squad', models: 5, pts: 80 },
        { uid: 't1', datasheet: 'Rhino', models: 1, pts: 75, embarkIn: undefined },
        { uid: 't2', datasheet: 'Impulsor', models: 1, pts: 80, embarkIn: undefined },
        { uid: 't3', datasheet: 'Drop Pod', models: 1, pts: 70, embarkIn: undefined },
      ],
    };

    // 1. isBattlelineUnit must be false for Dedicated Transports
    expect(isBattlelineUnit(rhino, list, SM)).toBe(false);
    expect(isBattlelineUnit(impulsor, list, SM)).toBe(false);
    expect(isBattlelineUnit(dropPod, list, SM)).toBe(false);

    // 2. Intercessors must be true
    expect(isBattlelineUnit(intercessors, list, SM)).toBe(true);

    // 3. sectionOf must return 'transports' for Dedicated Transports, and 'battleline' for Intercessors
    expect(sectionOf(rhino, 'SM', list, SM)).toBe('transports');
    expect(sectionOf(impulsor, 'SM', list, SM)).toBe('transports');
    expect(sectionOf(dropPod, 'SM', list, SM)).toBe('transports');
    expect(sectionOf(intercessors, 'SM', list, SM)).toBe('battleline');

    // 4. unitKind must return 'Vehicle' for Transports, and 'Battleline' for Intercessors
    expect(unitKind(rhino, list, SM)).toBe('Vehicle');
    expect(unitKind(impulsor, list, SM)).toBe('Vehicle');
    expect(unitKind(dropPod, list, SM)).toBe('Vehicle');
    expect(unitKind(intercessors, list, SM)).toBe('Battleline');

    // 5. validateList allows up to 6 Dedicated Transports per army (Rule of 6) without 'maximum 3 per army' error
    const size = { points: 2000, dp: 3, unitLimit: 3, enhancements: 3 };
    const listWith4Rhinos: ArmyList = {
      name: 'Rhino Rush',
      factionId: 'SM',
      battleSize: 'strike',
      detachments: ['Gladius Task Force'],
      units: [
        { uid: 'u1', datasheet: 'Captain', models: 1, pts: 80, warlord: true },
        { uid: 't1', datasheet: 'Rhino', models: 1, pts: 75 },
        { uid: 't2', datasheet: 'Rhino', models: 1, pts: 75 },
        { uid: 't3', datasheet: 'Rhino', models: 1, pts: 75 },
        { uid: 't4', datasheet: 'Rhino', models: 1, pts: 75 },
      ],
    };
    const errs = validateList(listWith4Rhinos, SM, size);
    expect(errs.filter((e) => e.includes('maximum'))).toEqual([]);
  });

  it('Dark Angels: The Deathwing and The Ravenwing rules and dynamic keywords', () => {
    // 1. Check army rules visibility via chapterRules
    const daRules = chapterRules(SM.armyRules, 'DARK ANGELS');
    const ultraRules = chapterRules(SM.armyRules, 'ULTRAMARINES');

    expect(daRules.some((r) => r.name === 'The Deathwing')).toBe(true);
    expect(daRules.some((r) => r.name === 'The Ravenwing')).toBe(true);
    expect(ultraRules.some((r) => r.name === 'The Deathwing')).toBe(false);
    expect(ultraRules.some((r) => r.name === 'The Ravenwing')).toBe(false);

    // 2. Check effectiveKeywords for Dark Angels army list
    const daList: ArmyList = {
      name: 'Unforgiven Hunt',
      factionId: 'SM',
      subfaction: 'DARK ANGELS',
      battleSize: 'incursion',
      detachments: ['Inner Circle Task Force'],
      units: [
        { uid: 'u1', datasheet: 'Captain In Terminator Armour', models: 1, pts: 95, warlord: true },
        { uid: 'u2', datasheet: 'Terminator Squad', models: 5, pts: 175 },
        { uid: 'u3', datasheet: 'Bladeguard Veteran Squad', models: 3, pts: 80 },
        { uid: 'u4', datasheet: 'Redemptor Dreadnought', models: 1, pts: 210 },
        { uid: 'u5', datasheet: 'Land Raider', models: 1, pts: 240 },
        { uid: 'u6', datasheet: 'Outrider Squad', models: 3, pts: 80 },
        { uid: 'u7', datasheet: 'Storm Speeder Hailstrike', models: 1, pts: 115 },
        { uid: 'u8', datasheet: 'Intercessor Squad', models: 5, pts: 80 },
      ],
    };

    const termCaptain = SM.datasheets.find((d) => d.name === 'Captain In Terminator Armour')!;
    const termSquad = SM.datasheets.find((d) => d.name === 'Terminator Squad')!;
    const bladeguard = SM.datasheets.find((d) => d.name === 'Bladeguard Veteran Squad')!;
    const dread = SM.datasheets.find((d) => d.name === 'Redemptor Dreadnought')!;
    const landRaider = SM.datasheets.find((d) => d.name === 'Land Raider')!;
    const outriders = SM.datasheets.find((d) => d.name === 'Outrider Squad')!;
    const stormSpeeder = SM.datasheets.find((d) => d.name === 'Storm Speeder Hailstrike')!;
    const intercessors = SM.datasheets.find((d) => d.name === 'Intercessor Squad')!;

    // Under Dark Angels:
    expect(effectiveKeywords(termCaptain, daList, SM)).toContain('DEATHWING');
    expect(effectiveKeywords(termSquad, daList, SM)).toContain('DEATHWING');
    expect(effectiveKeywords(bladeguard, daList, SM)).toContain('DEATHWING');
    expect(effectiveKeywords(dread, daList, SM)).toContain('DEATHWING');
    expect(effectiveKeywords(landRaider, daList, SM)).toContain('DEATHWING');

    expect(effectiveKeywords(outriders, daList, SM)).toContain('RAVENWING');
    expect(effectiveKeywords(stormSpeeder, daList, SM)).toContain('RAVENWING');

    // Intercessors do NOT gain Deathwing or Ravenwing
    expect(effectiveKeywords(intercessors, daList, SM)).not.toContain('DEATHWING');
    expect(effectiveKeywords(intercessors, daList, SM)).not.toContain('RAVENWING');

    // Under Ultramarines: none of them gain Deathwing or Ravenwing
    const ultraList: ArmyList = { ...daList, subfaction: 'ULTRAMARINES', detachments: ['Gladius Task Force'] };
    expect(effectiveKeywords(termCaptain, ultraList, SM)).not.toContain('DEATHWING');
    expect(effectiveKeywords(outriders, ultraList, SM)).not.toContain('RAVENWING');

    // 3. Check enhancement availability: Captain in Terminator Armour can take Champion of the Deathwing under Dark Angels
    const enhOpts = enhancementOptions(daList, SM, daList.units[0]);
    expect(enhOpts.some((e) => e.name === 'Champion of the Deathwing')).toBe(true);

    // 4. Check runtime buildUnits keyword propagation
    const runtimeUnits = buildUnits(daList, SM, 0);
    const rtTermCaptain = runtimeUnits.find((u) => u.name === 'Captain In Terminator Armour')!;
    const rtOutriders = runtimeUnits.find((u) => u.name === 'Outrider Squad')!;

    expect(rtTermCaptain.keywords).toContain('DEATHWING');
    expect(rtTermCaptain.models[0].keywords).toContain('DEATHWING');

    expect(rtOutriders.keywords).toContain('RAVENWING');
    expect(rtOutriders.models[0].keywords).toContain('RAVENWING');
  });

  it('tracks separate ally and detachment point caps across all factions and detachments', () => {
    const CSM = loadFaction('CSM');
    const DG = loadFaction('DG');
    const DRU = loadFaction('DRU');
    const GC = loadFaction('GC');
    const QI = loadFaction('QI');
    const QT = loadFaction('QT');
    const SM = loadFaction('SM');
    const TS = loadFaction('TS');
    const WE = loadFaction('WE');
    const EC = loadFaction('EC');
    const CD = loadFaction('CD');
    const NEC = loadFaction('NEC');

    // 1. CSM at 2000 pts (Strike Force)
    const csmList: ArmyList = { name: 'CSM', factionId: 'CSM', battleSize: 'strike_force', detachments: ['Veterans of the Long War'], units: [] };
    const csmSub = subPointsList(csmList, CSM, 2000);
    expect(csmSub.some((s) => s.id === 'daemonic-pact' && s.cap === 500 && s.spent === 0)).toBe(true);
    expect(csmSub.some((s) => s.id === 'cult-marines' && s.cap === 500 && s.spent === 0)).toBe(true);

    // CSM at 1000 pts (Incursion)
    const csmIncursionSub = subPointsList({ ...csmList, battleSize: 'incursion' }, CSM, 1000);
    expect(csmIncursionSub.find((s) => s.id === 'daemonic-pact')?.cap).toBe(250);
    expect(csmIncursionSub.find((s) => s.id === 'cult-marines')?.cap).toBe(250);

    // Adding Cult Marines: Rubric Marines (105 pts)
    const csmWithCult: ArmyList = {
      ...csmList,
      units: [{ uid: 'c1', datasheet: 'Rubric Marines', models: 5, pts: 105 }],
    };
    const csmWithCultSub = subPointsList(csmWithCult, CSM, 2000);
    const cultItem = csmWithCultSub.find((s) => s.id === 'cult-marines')!;
    expect(cultItem.spent).toBe(105);
    expect(cultItem.over).toBe(false);

    // 2. Death Guard with Tallyband Summoners (Plague Legions)
    const dgList: ArmyList = { name: 'DG', factionId: 'DG', battleSize: 'strike_force', detachments: ['Tallyband Summoners'], units: [] };
    const dgSub = subPointsList(dgList, DG, 2000);
    expect(dgSub.find((s) => s.id === 'plague-legions')?.cap).toBe(1000);
    expect(dgSub.find((s) => s.id === 'plague-legions')?.spent).toBe(0);

    const dgWithDaemons: ArmyList = {
      ...dgList,
      units: [{ uid: 'p1', datasheet: 'Plaguebearers', models: 10, pts: 110 }],
    };
    const dgWithDaemonsSub = subPointsList(dgWithDaemons, DG, 2000);
    expect(dgWithDaemonsSub.find((s) => s.id === 'plague-legions')?.spent).toBe(110);

    // 3. Drukhari: Travelling Players vs Reaper's Wager
    const druDefault: ArmyList = { name: 'DRU', factionId: 'DRU', battleSize: 'strike_force', detachments: ['Skysplinter Assassin'], units: [] };
    const druDefaultSub = subPointsList(druDefault, DRU, 2000);
    expect(druDefaultSub.find((s) => s.id === 'dru-travelling-players')?.cap).toBe(500);

    const druReaper: ArmyList = { name: 'DRU', factionId: 'DRU', battleSize: 'strike_force', detachments: ["Reaper’s Wager"], units: [] };
    const druReaperSub = subPointsList(druReaper, DRU, 2000);
    expect(druReaperSub.find((s) => s.id === 'dru-harlequins')?.cap).toBe(1000);

    // 4. Genestealer Cults: Brood Brother Auxilia & Final Day
    const gcBrood: ArmyList = { name: 'GC', factionId: 'GC', battleSize: 'strike_force', detachments: ['Brood Brother Auxilia'], units: [] };
    const gcBroodSub = subPointsList(gcBrood, GC, 2000);
    expect(gcBroodSub.find((s) => s.id === 'brood-brothers')?.cap).toBe(1000);

    const gcFinalDay: ArmyList = { name: 'GC', factionId: 'GC', battleSize: 'strike_force', detachments: ['Final Day'], units: [] };
    const gcFinalDaySub = subPointsList(gcFinalDay, GC, 2000);
    expect(gcFinalDaySub.find((s) => s.id === 'final-day-tyranids')?.cap).toBe(1000);

    // 5. Imperial Knights: Questor Forgepact
    const qiForgepact: ArmyList = { name: 'QI', factionId: 'QI', battleSize: 'strike_force', detachments: ['Questor Forgepact'], units: [] };
    const qiSub = subPointsList(qiForgepact, QI, 2000);
    expect(qiSub.find((s) => s.id === 'mechanicus-allies')?.cap).toBe(500);

    // 6. Chaos Knights: Iconoclast Fiefdom
    const qtFiefdom: ArmyList = { name: 'QT', factionId: 'QT', battleSize: 'strike_force', detachments: ['Iconoclast Fiefdom'], units: [] };
    const qtSub = subPointsList(qtFiefdom, QT, 2000);
    expect(qtSub.find((s) => s.id === 'daemonic-pact')?.cap).toBe(500);
    expect(qtSub.find((s) => s.id === 'wretched-thralls')?.cap).toBe(500);

    // 7. Space Marines: Deathwatch Support
    const smDW: ArmyList = { name: 'SM', factionId: 'SM', battleSize: 'strike_force', detachments: ['Deathwatch Support'], units: [] };
    const smDWSub = subPointsList(smDW, SM, 2000);
    expect(smDWSub.find((s) => s.id === 'deathwatch-allies')?.cap).toBe(500);

    // 8. Thousand Sons: Changehost of Deceit
    const tsChangehost: ArmyList = { name: 'TS', factionId: 'TS', battleSize: 'strike_force', detachments: ['Changehost of Deceit'], units: [] };
    const tsSub = subPointsList(tsChangehost, TS, 2000);
    expect(tsSub.find((s) => s.id === 'scintillating-legions')?.cap).toBe(1000);

    // 9. World Eaters: Khorne Daemonkin
    const weDaemonkin: ArmyList = { name: 'WE', factionId: 'WE', battleSize: 'strike_force', detachments: ['Khorne Daemonkin'], units: [] };
    const weSub = subPointsList(weDaemonkin, WE, 2000);
    expect(weSub.find((s) => s.id === 'blood-legions')?.cap).toBe(1000);

    // 10. Emperor's Children: Carnival of Excess
    const ecCarnival: ArmyList = { name: 'EC', factionId: 'EC', battleSize: 'strike_force', detachments: ['Carnival of Excess'], units: [] };
    const ecSub = subPointsList(ecCarnival, EC, 2000);
    expect(ecSub.find((s) => s.id === 'legions-of-excess')?.cap).toBe(1000);

    // 10b. Chaos factions have Daemonic Pact by default (even with 0 units)
    const qtList: ArmyList = { name: 'QT', factionId: 'QT', battleSize: 'strike_force', detachments: ['Traitoris Lance'], units: [] };
    expect(subPointsList(qtList, QT, 2000).some((s) => s.id === 'daemonic-pact' && s.cap === 500)).toBe(true);

    const tsDefault: ArmyList = { name: 'TS', factionId: 'TS', battleSize: 'strike_force', detachments: ['Cult of Magic'], units: [] };
    expect(subPointsList(tsDefault, TS, 2000).some((s) => s.id === 'daemonic-pact' && s.cap === 500)).toBe(true);

    const weDefault: ArmyList = { name: 'WE', factionId: 'WE', battleSize: 'strike_force', detachments: ['Berzerker Warband'], units: [] };
    expect(subPointsList(weDefault, WE, 2000).some((s) => s.id === 'daemonic-pact' && s.cap === 500)).toBe(true);

    const dgDefault: ArmyList = { name: 'DG', factionId: 'DG', battleSize: 'strike_force', detachments: ['Plague Company'], units: [] };
    expect(subPointsList(dgDefault, DG, 2000).some((s) => s.id === 'daemonic-pact' && s.cap === 500)).toBe(true);

    // 11. Chaos Daemons: Shadow Legion
    const cdShadow: ArmyList = { name: 'CD', factionId: 'CD', battleSize: 'strike_force', detachments: ['Shadow Legion'], units: [] };
    const cdSub = subPointsList(cdShadow, CD, 2000);
    expect(cdSub.find((s) => s.id === 'shadow-legion')?.cap).toBe(1000);

    // 12. Non-ally faction (Necrons Awakened Dynasty): returns empty array
    const necList: ArmyList = { name: 'NEC', factionId: 'NEC', battleSize: 'strike_force', detachments: ['Awakened Dynasty'], units: [] };
    const necSub = subPointsList(necList, NEC, 2000);
    expect(necSub).toHaveLength(0);
  });

  it('correctly filters enhancements for Great Unclean One vs Malignant Plaguecaster in Death Guard', () => {
    const DG = loadFaction('DG');
    const guo = DG.datasheets.find((d) => d.name === 'Great Unclean One')!;
    const plaguecaster = DG.datasheets.find((d) => d.name === 'Malignant Plaguecaster')!;
    expect(guo).toBeDefined();
    expect(plaguecaster).toBeDefined();

    const dgList: ArmyList = {
      name: 'DG Tallyband',
      factionId: 'DG',
      battleSize: 'strike_force',
      detachments: ['Tallyband Summoners'],
      units: [
        { uid: 'u1', datasheet: 'Great Unclean One', models: 1, pts: 230 },
        { uid: 'u2', datasheet: 'Malignant Plaguecaster', models: 1, pts: 65 },
      ],
    };

    const guoOpts = enhancementOptions(dgList, DG, dgList.units[0]);
    const plaguecasterOpts = enhancementOptions(dgList, DG, dgList.units[1]);

    // Great Unclean One should have Entropic Knell, NOT Tome of Bounteous Blessings
    expect(guoOpts.some((e) => e.name === 'Entropic Knell')).toBe(true);
    expect(guoOpts.some((e) => e.name === 'Tome of Bounteous Blessings')).toBe(false);

    // Malignant Plaguecaster should have Tome of Bounteous Blessings, NOT Entropic Knell
    expect(plaguecasterOpts.some((e) => e.name === 'Tome of Bounteous Blessings')).toBe(true);
    expect(plaguecasterOpts.some((e) => e.name === 'Entropic Knell')).toBe(false);
  });

  it('tracks reserves points and passes pre-declared reserve status into UnitState', () => {
    const list: ArmyList = {
      name: 'SM Strike',
      factionId: 'SM',
      battleSize: 'strike_force',
      detachments: ['Gladius Task Force'],
      units: [
        { uid: 'u1', datasheet: 'Terminator Squad', models: 5, pts: 175, reserve: 'deepstrike' },
        { uid: 'u2', datasheet: 'Intercessor Squad', models: 5, pts: 80, reserve: 'reserves' },
        { uid: 'u3', datasheet: 'Captain In Terminator Armour', models: 1, pts: 95 },
      ],
    };

    const sub = subPointsList(list, SM, 2000);
    const resTracker = sub.find((s) => s.id === 'army-reserves');
    expect(resTracker).toBeDefined();
    expect(resTracker?.spent).toBe(255); // 175 + 80
    expect(resTracker?.cap).toBe(1000); // 50% of 2000
    expect(resTracker?.over).toBe(false);
    expect(resTracker?.tinyLabel).toBe('Res');

    const built = buildUnits(list, SM, 0);
    const termies = built.find((u) => u.name === 'Terminator Squad');
    const intercessors = built.find((u) => u.name === 'Intercessor Squad');
    expect(termies?.reserve).toBe('deepstrike');
    expect(intercessors?.reserve).toBe('reserves');
  });

  it('prevents allied Daemonic Pact units from taking Enhancements or being Warlord', () => {
    const CSM = loadFaction('CSM');
    const csmListWithDaemon: ArmyList = {
      name: 'CSM Daemons',
      factionId: 'CSM',
      battleSize: 'strike_force',
      detachments: ['Veterans of the Long War'],
      units: [
        { uid: 'd1', datasheet: 'Bloodmaster', models: 1, pts: 65, warlord: true, enhancement: 'Warmaster’s Gift' },
        { uid: 'c1', datasheet: 'Chaos Lord', models: 1, pts: 90 },
      ],
    };

    // Bloodmaster (Legiones Daemonica) should have 0 enhancement options in CSM
    const enhOpts = enhancementOptions(csmListWithDaemon, CSM, csmListWithDaemon.units[0]);
    expect(enhOpts).toHaveLength(0);

    const errs = validateList(csmListWithDaemon, CSM, { points: 2000, dp: 200, unitLimit: 3, enhancements: 3 });
    expect(errs.some((e) => e.includes('cannot be your Warlord'))).toBe(true);
    expect(errs.some((e) => e.includes('cannot take Enhancements'))).toBe(true);
  });
});
