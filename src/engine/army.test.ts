// Army builder rules: which enhancements a datasheet can take.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { attachOptions, buildUnits, defaultWargear, enhancementFits, syncWargear, validateList, wargearProblems, wargearSummary } from './army';
import type { ArmyList, FactionData } from './types';

describe('enhancement restrictions ("X model only")', () => {
  const captain = ['INFANTRY', 'CHARACTER', 'IMPERIUM', 'TACTICUS', 'CAPTAIN', 'ADEPTUS ASTARTES'];
  const gravisCaptain = ['INFANTRY', 'CHARACTER', 'IMPERIUM', 'GRAVIS', 'CAPTAIN', 'ADEPTUS ASTARTES'];

  it('reads the keyword the text asks for and checks it against the unit', () => {
    expect(enhancementFits('GRAVIS model only. The first time …', captain)).toEqual({ ok: false, need: 'GRAVIS' });
    expect(enhancementFits('GRAVIS model only. The first time …', gravisCaptain)?.ok).toBe(true);
    expect(enhancementFits('CAPTAIN model only. Once per battle …', captain)?.ok).toBe(true);
  });

  it('several keywords together, and "X or Y"', () => {
    expect(enhancementFits('ADEPTUS ASTARTES INFANTRY unit only. This unit …', captain)?.ok).toBe(true);
    expect(enhancementFits('ADEPTUS ASTARTES INFANTRY unit only. This unit …', ['VEHICLE', 'ADEPTUS ASTARTES'])?.ok).toBe(false);
    expect(enhancementFits('THOUSAND SONS or LORD OF CHANGE model only. After …', ['LORD OF CHANGE', 'DAEMON'])?.ok).toBe(true);
  });

  it('no restriction it can read: no verdict', () => {
    expect(enhancementFits('The bearer has the Deep Strike ability.', captain)).toBeNull();
  });
});

describe('leader + support (24.34)', () => {
  const SM = JSON.parse(fs.readFileSync('public/data/factions/SM.json', 'utf8')) as FactionData;
  const SIZE = { points: 2000, dp: 3, unitLimit: 3, enhancements: 3 };
  const mk = (units: [string, number, number, string?][]): ArmyList => ({
    name: 't', factionId: 'SM', battleSize: 'strike', detachments: [],
    units: units.map(([d, n, pts, to], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts, attachTo: to, warlord: i === 1 })),
  });

  it('a Captain (leader) and an Apothecary Biologis (support) join the same Heavy Intercessor Squad', () => {
    const list = mk([['Heavy Intercessor Squad', 5, 100], ['Captain In Gravis Armour', 1, 80, 'x0'], ['Apothecary Biologis', 1, 75, 'x0']]);
    expect(validateList(list, SM, SIZE).filter((e) => /Leader|Support|attached/.test(e))).toEqual([]);
    const units = buildUnits(list, SM, 0);
    expect(units).toHaveLength(1);
    expect(units[0].sources.sort()).toEqual(['Apothecary Biologis', 'Captain In Gravis Armour', 'Heavy Intercessor Squad']);
    // the Biologis can still join although the squad has its leader; a second leader cannot
    expect(attachOptions(mk([['Heavy Intercessor Squad', 5, 100], ['Captain In Gravis Armour', 1, 80, 'x0'], ['Apothecary Biologis', 1, 75]]), SM, { uid: 'x2', datasheet: 'Apothecary Biologis', models: 1, pts: 75 }).map((b) => b.uid)).toEqual(['x0']);
  });

  it('two leaders (or two supports) in one bodyguard unit are flagged', () => {
    const list = mk([['Heavy Intercessor Squad', 5, 100], ['Captain In Gravis Armour', 1, 80, 'x0'], ['Captain In Gravis Armour', 1, 80, 'x0']]);
    expect(validateList(list, SM, SIZE).some((e) => /only one Leader/.test(e))).toBe(true);
    expect(attachOptions(mk([['Heavy Intercessor Squad', 5, 100], ['Captain In Gravis Armour', 1, 80, 'x0'], ['Captain In Gravis Armour', 1, 80]]), SM, { uid: 'x2', datasheet: 'Captain In Gravis Armour', models: 1, pts: 80 })).toEqual([]);
  });
});

describe('Munitorum Field Manual pricing', () => {
  it('the 4th and later copies of a unit pay the later price tier; a saved list follows a points update', async () => {
    const { listPoints, syncList } = await import('./army');
    const TS = JSON.parse(fs.readFileSync('public/data/factions/TS.json', 'utf8')) as FactionData;
    const rubric = (uid: string) => ({ uid, datasheet: 'Rubric Marines', models: 5, pts: 115 });
    const l: ArmyList = { name: 't', factionId: 'TS', battleSize: 'strike', detachments: [], units: [rubric('a'), rubric('b'), rubric('c'), rubric('d')] };
    expect(listPoints(l, TS)).toBe(115 * 3 + 125);
    const old: ArmyList = { ...l, units: [{ ...rubric('a'), pts: 100 }] };
    expect(syncList(old, TS).units[0].pts).toBe(115);
  });
});

describe('default wargear: the best free loadout', () => {
  it('free add-ons are taken, costed options and gear are left for the player, and the result is legal', () => {
    const fac = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
    const sheet = (f: string, n: string) => fac(f).datasheets.find((d) => d.name === n)!;
    const pick = (f: string, n: string, models?: number) => {
      const d = sheet(f, n);
      const o = d.points[0].options.find((x) => x.models === (models ?? x.models))!;
      const e = syncWargear(d, defaultWargear(d, { uid: 'x', datasheet: n, models: o.models, pts: o.pts }));
      expect(wargearProblems(d, e)).toEqual([]);
      return { e, text: wargearSummary(d, e) };
    };
    expect(pick('SM', 'Rhino').text).toMatch(/Hunter-killer/i);
    expect(pick('SM', 'Redemptor Dreadnought').text).toMatch(/Icarus Rocket Pod/i);
    const wagon = pick('ORK', 'Battlewagon');
    expect(wagon.e.wargearPts ?? 0).toBe(0);
    // the sergeant keeps the bolt rifle (a melee weapon is no better than a gun that shoots every turn)
    expect(pick('SM', 'Intercessor Squad', 10).text).not.toMatch(/Chainsword|Power Weapon/);
    // free additions like Icons and Drones are automatically equipped
    expect(pick('TS', 'Rubric Marines', 5).text).toMatch(/Icon of flame/i);
    expect(pick('TAU', 'Commander In Coldstar Battlesuit').text).toMatch(/drone/i);
  });
});

describe('3000, 4000, 5000 points battle sizes and scaling rules', () => {
  const SM = JSON.parse(fs.readFileSync('public/data/factions/SM.json', 'utf8')) as FactionData;
  const RULES = JSON.parse(fs.readFileSync('data/core-rules.json', 'utf8'));

  it('3000 points Onslaught allows 4 DP, 4 of the same datasheet (e.g. Drop Pod), and 6 enhancements', () => {
    const onslaught = RULES.battleSizes.find((b: any) => b.id === 'onslaught');
    expect(onslaught).toBeDefined();
    expect(onslaught.points).toBe(3000);
    expect(onslaught.dp).toBe(4);
    expect(onslaught.unitLimit).toBe(4);
    expect(onslaught.enhancements).toBe(6);

    const list: ArmyList = {
      name: 't', factionId: 'SM', battleSize: 'onslaught', detachments: ['Gladius Task Force'],
      units: [
        { uid: 'w', datasheet: 'Captain In Gravis Armour', models: 1, pts: 80, warlord: true },
        { uid: 'd1', datasheet: 'Redemptor Dreadnought', models: 1, pts: 210 },
        { uid: 'd2', datasheet: 'Redemptor Dreadnought', models: 1, pts: 210 },
        { uid: 'd3', datasheet: 'Redemptor Dreadnought', models: 1, pts: 210 },
        { uid: 'd4', datasheet: 'Redemptor Dreadnought', models: 1, pts: 210 },
      ],
    };
    expect(validateList(list, SM, onslaught)).toEqual([]);
    // A 5th Redemptor Dreadnought exceeds limit of 4
    const list5 = { ...list, units: [...list.units, { uid: 'd5', datasheet: 'Redemptor Dreadnought', models: 1, pts: 210 }] };
    expect(validateList(list5, SM, onslaught).some((e) => /Redemptor Dreadnought: maximum 4/.test(e))).toBe(true);
  });

  it('4000 and 5000 points scale DP and unitLimits up to 5 and 6', () => {
    const warZone = RULES.battleSizes.find((b: any) => b.id === 'war-zone');
    const apocalypse = RULES.battleSizes.find((b: any) => b.id === 'apocalypse');
    expect(warZone.points).toBe(4000);
    expect(warZone.dp).toBe(5);
    expect(warZone.unitLimit).toBe(5);
    expect(apocalypse.points).toBe(5000);
    expect(apocalypse.dp).toBe(6);
    expect(apocalypse.unitLimit).toBe(6);
  });
});

