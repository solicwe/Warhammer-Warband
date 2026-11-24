import { describe, expect, it } from 'vitest';
import {
  buildUnits,
  effectiveKeywords,
  effectiveModelOc,
  isBattlelineUnit,
  validateList,
} from './army';
import { sectionOf, unitKind } from '../ui/ArmyBuilder';
import type { ArmyList, FactionData } from './types';
import fs from 'node:fs';

const loadFaction = (id: string): FactionData =>
  JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));

const AM = loadFaction('AM');
const AC = loadFaction('AC');
const ORK = loadFaction('ORK');
const AE = loadFaction('AE');
const QT = loadFaction('QT');

describe('Dynamic Detachment Battleline System', () => {
  it('Astra Militarum Bridgehead Strike: grants Tempestus Scions BATTLELINE and +1 OC', () => {
    const scions = AM.datasheets.find((d) => d.name === 'Tempestus Scions')!;

    // Base: not Battleline, OC 1
    expect(scions.keywords.includes('BATTLELINE')).toBe(false);
    expect(scions.models[0].OC).toBe(1);
    expect(isBattlelineUnit(scions, [])).toBe(false);

    // With Bridgehead Strike detachment:
    const list: ArmyList = {
      name: 'Tempestus Task Force',
      factionId: 'AM',
      battleSize: 'incursion',
      detachments: ['Bridgehead Strike'],
      units: [
        { uid: 'u1', datasheet: 'Militarum Tempestus Command Squad', models: 5, pts: 70, warlord: true },
        { uid: 'u2', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
        { uid: 'u3', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
        { uid: 'u4', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
        { uid: 'u5', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
      ],
    };

    // 1. isBattlelineUnit is true
    expect(isBattlelineUnit(scions, list, AM)).toBe(true);

    // 2. effectiveKeywords includes BATTLELINE
    const kws = effectiveKeywords(scions, list, AM);
    expect(kws).toContain('BATTLELINE');

    // 3. effectiveModelOc is 2 (1 base + 1 boost)
    expect(effectiveModelOc(scions, scions.models[0], list, AM)).toBe(2);

    // 4. sectionOf returns 'battleline'
    expect(sectionOf(scions, 'AM', list, AM)).toBe('battleline');

    // 5. unitKind returns 'Battleline'
    expect(unitKind(scions, list, AM)).toBe('Battleline');

    // 6. validateList allows 4 units (under limit 6 for Battleline at incursion 2*unitLimit=6)
    const size = { points: 1000, dp: 2, unitLimit: 3, enhancements: 2 };
    const errs = validateList(list, AM, size);
    expect(errs.filter((e) => e.includes('maximum'))).toEqual([]);

    // 7. buildUnits runtime creates unit and models with BATTLELINE and effectiveModelOc 2
    const runtimeUnits = buildUnits(list, AM, 0);
    const runtimeScion = runtimeUnits.find((u) => u.name === 'Tempestus Scions')!;
    expect(runtimeScion.keywords).toContain('BATTLELINE');
    expect(runtimeScion.models[0].keywords).toContain('BATTLELINE');
    expect(effectiveModelOc(scions, runtimeScion.models[0].profile, list, AM)).toBe(2);
  });

  it('Adeptus Custodes Null Maiden Vigil: grants Prosecutor Squad BATTLELINE', () => {
    const pros = AC.datasheets.find((d) => d.name === 'Prosecutor Squad')!;
    expect(isBattlelineUnit(pros, ['Null Maiden Vigil'], AC)).toBe(true);
    expect(sectionOf(pros, 'AC', ['Null Maiden Vigil'], AC)).toBe('battleline');
    expect(unitKind(pros, ['Null Maiden Vigil'], AC)).toBe('Battleline');
  });

  it('Orks Kult of Speed: grants Warbikers BATTLELINE', () => {
    const warbikers = ORK.datasheets.find((d) => d.name === 'Warbikers')!;
    expect(isBattlelineUnit(warbikers, ['Kult of Speed'], ORK)).toBe(true);
    expect(sectionOf(warbikers, 'ORK', ['Kult of Speed'], ORK)).toBe('battleline');
  });

  it('Aeldari Ghosts of the Webway: grants Troupe BATTLELINE and sets OC to 2', () => {
    const troupe = AE.datasheets.find((d) => d.name === 'Troupe')!;
    expect(isBattlelineUnit(troupe, ['Ghosts of the Webway'], AE)).toBe(true);
    expect(effectiveModelOc(troupe, troupe.models[0], ['Ghosts of the Webway'], AE)).toBe(2);
    expect(sectionOf(troupe, 'AE', ['Ghosts of the Webway'], AE)).toBe('battleline');
  });

  it('Chaos Knights Houndpack Lance: grants War Dog units BATTLELINE', () => {
    const brigand = QT.datasheets.find((d) => d.name === 'War Dog Brigand')!;
    expect(isBattlelineUnit(brigand, ['Houndpack Lance'], QT)).toBe(true);
    expect(sectionOf(brigand, 'QT', ['Houndpack Lance'], QT)).toBe('battleline');
  });

  it('validates 6 dynamic Battleline units allowed and flags 7 as over limit', () => {
    const list: ArmyList = {
      name: 'Max Scions',
      factionId: 'AM',
      battleSize: 'incursion',
      detachments: ['Bridgehead Strike'],
      units: [
        { uid: 'u0', datasheet: 'Militarum Tempestus Command Squad', models: 5, pts: 70, warlord: true },
        { uid: 'u1', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
        { uid: 'u2', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
        { uid: 'u3', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
        { uid: 'u4', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
        { uid: 'u5', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
        { uid: 'u6', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
      ],
    };
    const size = { points: 2000, dp: 3, unitLimit: 3, enhancements: 4 };

    // 6 Scions: perfectly legal
    const errs6 = validateList(list, AM, size);
    expect(errs6.filter((e) => e.includes('maximum'))).toEqual([]);

    // 7 Scions: maximum 6 per army error
    const list7: ArmyList = {
      ...list,
      units: [...list.units, { uid: 'u7', datasheet: 'Tempestus Scions', models: 10, pts: 100 }],
    };
    const errs7 = validateList(list7, AM, size);
    expect(errs7.some((e) => e === 'Tempestus Scions: maximum 6 per army')).toBe(true);
  });

  it('Bridgehead Strike: flags error if warlord is not a Militarum Tempestus Officer when taking >3 Scions', () => {
    const list: ArmyList = {
      name: 'Wrong Warlord',
      factionId: 'AM',
      battleSize: 'incursion',
      detachments: ['Bridgehead Strike'],
      units: [
        { uid: 'u0', datasheet: 'Cadian Castellan', models: 1, pts: 45, warlord: true },
        { uid: 'u1', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
        { uid: 'u2', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
        { uid: 'u3', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
        { uid: 'u4', datasheet: 'Tempestus Scions', models: 10, pts: 100 },
      ],
    };
    const size = { points: 2000, dp: 3, unitLimit: 3, enhancements: 4 };
    const errs = validateList(list, AM, size);
    expect(errs.some((e) => e.includes('MILITARUM TEMPESTUS OFFICER must be your Warlord'))).toBe(true);
  });

  it('Tyranids Warrior Bioform Onslaught: grants BATTLELINE to Ranged and Melee Warriors', () => {
    const TYR = loadFaction('TYR');
    const ranged = TYR.datasheets.find((d) => d.name === 'Tyranid Warriors With Ranged Bio-weapons')!;
    const melee = TYR.datasheets.find((d) => d.name === 'Tyranid Warriors With Melee Bio-weapons')!;

    expect(ranged).toBeDefined();
    expect(melee).toBeDefined();

    // Default: not Battleline
    expect(isBattlelineUnit(ranged, [])).toBe(false);
    expect(isBattlelineUnit(melee, [])).toBe(false);

    // With Warrior Bioform Onslaught detachment
    expect(isBattlelineUnit(ranged, ['Warrior Bioform Onslaught'], TYR)).toBe(true);
    expect(isBattlelineUnit(melee, ['Warrior Bioform Onslaught'], TYR)).toBe(true);
    expect(sectionOf(ranged, 'TYR', ['Warrior Bioform Onslaught'], TYR)).toBe('battleline');
    expect(sectionOf(melee, 'TYR', ['Warrior Bioform Onslaught'], TYR)).toBe('battleline');
    expect(unitKind(ranged, ['Warrior Bioform Onslaught'], TYR)).toBe('Battleline');
    expect(unitKind(melee, ['Warrior Bioform Onslaught'], TYR)).toBe('Battleline');
  });

  it('Wretched Thralls: DAMNED units for Chaos Knights with Iconoclast Fiefdom, up to 500 pts (Wahapedia 11e)', async () => {
    const { subPointsList } = await import('./allies');
    const QT = loadFaction('QT');
    expect(QT.datasheets.some((d) => d.keywords.includes('DAMNED'))).toBe(true);
    const qtList: ArmyList = { name: 'QT', factionId: 'QT', battleSize: 'strikeForce', detachments: ['Iconoclast Fiefdom'], units: [] };
    expect(subPointsList(qtList, QT, 2000).find((s) => s.id === 'wretched-thralls')?.cap).toBe(500);
    expect(subPointsList({ ...qtList, detachments: ['Traitoris Lance'] }, QT, 2000).some((s) => s.id === 'wretched-thralls')).toBe(false);
  });


  it('Wulfen and Wulfen Dreadnought wargear options work correctly', async () => {
    const { wargearMax, wargearProblems } = await import('./army');
    const SM = loadFaction('SM');
    const wulfen = SM.datasheets.find((d) => d.name === 'Wulfen')!;
    const wulfenShields = SM.datasheets.find((d) => d.name === 'Wulfen with Storm Shields')!;
    const dread = SM.datasheets.find((d) => d.name === 'Wulfen Dreadnought')!;

    expect(wulfen).toBeDefined();
    expect(wulfenShields).toBeDefined();
    expect(dread).toBeDefined();

    // Wulfen: can swap up to 5 Death totems for Stormfrag auto-launchers
    const optWulfen = wulfen.wargearOptions![0];
    expect(optWulfen.replace).toEqual(['Death totem']);
    expect(optWulfen.choices).toEqual([['Stormfrag auto-launcher']]);
    expect(wargearMax(wulfen, optWulfen, 5)).toBe(5);

    // Wulfen with Storm Shields: can swap up to 5 Stormfrag auto-launchers for Death totems
    const optShields = wulfenShields.wargearOptions![0];
    expect(optShields.replace).toEqual(['Stormfrag auto-launcher']);
    expect(optShields.choices).toEqual([['Death totem']]);
    expect(wargearMax(wulfenShields, optShields, 5)).toBe(5);

    // Wulfen Dreadnought:
    // Option 0: Storm Bolter -> Heavy Flamer (max 1)
    // Option 1: Fenrisian Great Axe -> Blizzard Shield (max 1)
    expect(dread.wargearOptions?.length).toBe(2);
    const [optFlamer, optBlizzard] = dread.wargearOptions!;
    expect(optFlamer.replace).toEqual(['Storm Bolter']);
    expect(optFlamer.choices).toEqual([['Heavy Flamer']]);
    expect(optBlizzard.replace).toEqual(['Fenrisian Great Axe']);
    expect(optBlizzard.choices).toEqual([['Blizzard Shield']]);

    expect(wargearMax(dread, optFlamer, 1)).toBe(1);
    expect(wargearMax(dread, optBlizzard, 1)).toBe(1);

    // Legal dreadnought with Heavy Flamer and Blizzard Shield
    const legalDread = {
      uid: 'wd1',
      datasheet: 'Wulfen Dreadnought',
      models: 1,
      pts: 140,
      wargear: [
        { opt: 0, choice: 0, count: 1 },
        { opt: 1, choice: 0, count: 1 },
      ],
    };
    expect(wargearProblems(dread, legalDread)).toEqual([]);
  });
});
