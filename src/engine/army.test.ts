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

describe('Epic Hero Enhancement Restrictions', () => {
  const SM = JSON.parse(fs.readFileSync('public/data/factions/SM.json', 'utf8')) as FactionData;
  const SIZE = { points: 2000, dp: 3, unitLimit: 3, enhancements: 3 };

  it('prohibits EPIC HERO from taking enhancements in validateList', () => {
    const list: ArmyList = {
      name: 't', factionId: 'SM', battleSize: 'strike', detachments: ['Gladius Task Force'],
      units: [
        { uid: 'g', datasheet: 'Roboute Guilliman', models: 1, pts: 350, warlord: true, enhancement: 'Adept of the Codex' },
      ],
    };
    const errs = validateList(list, SM, SIZE);
    expect(errs.some((e) => /Roboute Guilliman is an EPIC HERO and cannot take Enhancements/.test(e))).toBe(true);
  });

  it('enhancementOptions returns empty array for EPIC HERO unless allowed by detachment', async () => {
    const { enhancementOptions } = await import('./army');
    const list: ArmyList = {
      name: 't', factionId: 'SM', battleSize: 'strike', detachments: ['Gladius Task Force'],
      units: [],
    };
    const opts = enhancementOptions(list, SM, { uid: 'g', datasheet: 'Roboute Guilliman', models: 1, pts: 350 });
    expect(opts).toEqual([]);
  });
});

describe('conditional wargear rules (Helbrute fist sync, requiresNot)', () => {
  const WE = JSON.parse(fs.readFileSync('public/data/factions/WE.json', 'utf8')) as FactionData;
  const NEC = JSON.parse(fs.readFileSync('public/data/factions/NEC.json', 'utf8')) as FactionData;
  const CD = JSON.parse(fs.readFileSync('public/data/factions/CD.json', 'utf8')) as FactionData;

  const helbruteSheet = WE.datasheets.find((d) => d.name === 'Helbrute')!;
  const overlordSheet = NEC.datasheets.find((d) => d.name === 'Overlord')!;
  const horrorSheet = CD.datasheets.find((d) => d.name === 'Pink Horrors')!;

  it('Helbrute: cannot equip combi-bolter or heavy flamer with 0 fists', async () => {
    const { wargearMax } = await import('./army');
    const optFistWeapon = helbruteSheet.wargearOptions![2];
    expect(wargearMax(helbruteSheet, optFistWeapon, 1)).toBe(0);

    const illegal = { uid: 'h0', datasheet: 'Helbrute', models: 1, pts: 130, wargear: [{ opt: 2, choice: 0, count: 1 }] };
    const errs = wargearProblems(helbruteSheet, illegal);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((e) => /requires 1 more Helbrute fist|allows at most 0/i.test(e))).toBe(true);

    const synced = syncWargear(helbruteSheet, illegal);
    expect(synced.wargear ?? []).toEqual([]);
  });

  it('Helbrute: with 1 fist, can equip exactly 1 combi-bolter or heavy flamer', async () => {
    const { wargearMax } = await import('./army');
    const optFistWeapon = helbruteSheet.wargearOptions![2];
    // Option 0 choice 4 = Helbrute fist
    const picks1Fist = [{ opt: 0, choice: 4, count: 1 }];
    expect(wargearMax(helbruteSheet, optFistWeapon, 1, [], picks1Fist)).toBe(1);

    const legal1 = {
      uid: 'h1', datasheet: 'Helbrute', models: 1, pts: 130,
      wargear: [{ opt: 0, choice: 4, count: 1 }, { opt: 2, choice: 0, count: 1 }],
    };
    expect(wargearProblems(helbruteSheet, legal1)).toEqual([]);

    // Attempting 2 combi-bolters with only 1 fist is illegal
    const illegal2 = {
      uid: 'h1', datasheet: 'Helbrute', models: 1, pts: 130,
      wargear: [{ opt: 0, choice: 4, count: 1 }, { opt: 2, choice: 0, count: 2 }],
    };
    const errs = wargearProblems(helbruteSheet, illegal2);
    expect(errs.length).toBeGreaterThan(0);

    const synced = syncWargear(helbruteSheet, illegal2);
    expect(synced.wargear?.find((p) => p.opt === 2)?.count).toBe(1);
  });

  it('Helbrute: with 2 fists, can equip up to 2 fist weapons (duplicates or mixed)', async () => {
    const { wargearMax } = await import('./army');
    const optFistWeapon = helbruteSheet.wargearOptions![2];
    // Option 0 choice 4 = Helbrute fist, Option 1 choice 0 = Helbrute fist
    const picks2Fists = [{ opt: 0, choice: 4, count: 1 }, { opt: 1, choice: 0, count: 1 }];
    expect(wargearMax(helbruteSheet, optFistWeapon, 1, [], picks2Fists)).toBe(2);

    // 2 combi-bolters
    const legal2Bolters = {
      uid: 'h2', datasheet: 'Helbrute', models: 1, pts: 130,
      wargear: [{ opt: 0, choice: 4, count: 1 }, { opt: 1, choice: 0, count: 1 }, { opt: 2, choice: 0, count: 2 }],
    };
    expect(wargearProblems(helbruteSheet, legal2Bolters)).toEqual([]);

    // 1 combi-bolter + 1 heavy flamer
    const legalMixed = {
      uid: 'h2', datasheet: 'Helbrute', models: 1, pts: 130,
      wargear: [
        { opt: 0, choice: 4, count: 1 },
        { opt: 1, choice: 0, count: 1 },
        { opt: 2, choice: 0, count: 1 },
        { opt: 2, choice: 1, count: 1 },
      ],
    };
    expect(wargearProblems(helbruteSheet, legalMixed)).toEqual([]);

    // 3 combi-bolters is illegal
    const illegal3 = {
      uid: 'h2', datasheet: 'Helbrute', models: 1, pts: 130,
      wargear: [{ opt: 0, choice: 4, count: 1 }, { opt: 1, choice: 0, count: 1 }, { opt: 2, choice: 0, count: 3 }],
    };
    expect(wargearProblems(helbruteSheet, illegal3).length).toBeGreaterThan(0);
    expect(syncWargear(helbruteSheet, illegal3).wargear?.find((p) => p.opt === 2)?.count).toBe(2);
  });

  it('Necron Overlord: Resurrection orb requires NOT having tachyon arrow', async () => {
    const { wargearMax } = await import('./army');
    const optOrb = overlordSheet.wargearOptions![1];
    // Default Overlord has tachyon arrow
    expect(wargearMax(overlordSheet, optOrb, 1)).toBe(0);

    const illegal = { uid: 'o1', datasheet: 'Overlord', models: 1, pts: 85, wargear: [{ opt: 1, choice: 0, count: 1 }] };
    expect(wargearProblems(overlordSheet, illegal).length).toBeGreaterThan(0);
    expect(syncWargear(overlordSheet, illegal).wargear ?? []).toEqual([]);

    // Swap tachyon arrow away (Option 0 choice 0 = staff of light)
    const picksStaff = [{ opt: 0, choice: 0, count: 1 }];
    expect(wargearMax(overlordSheet, optOrb, 1, [], picksStaff)).toBe(1);

    const legal = { uid: 'o1', datasheet: 'Overlord', models: 1, pts: 85, wargear: [{ opt: 0, choice: 0, count: 1 }, { opt: 1, choice: 0, count: 1 }] };
    expect(wargearProblems(overlordSheet, legal)).toEqual([]);
  });

  it('Daemons Pink Horrors: Instrument and Icon can both be taken in squad on different models', () => {
    // 10 Pink Horrors: 1 Instrument of Chaos + 1 Daemonic icon
    const squad = {
      uid: 'p1', datasheet: 'Pink Horrors', models: 10, pts: 140,
      wargear: [{ opt: 0, choice: 0, count: 1 }, { opt: 1, choice: 0, count: 1 }],
    };
    expect(wargearProblems(horrorSheet, squad)).toEqual([]);
  });
});


describe('per-model loadouts when models share a profile name', () => {
  it('Dark Commune: each model gets its own kit, not the Cult Demagogue one', async () => {
    const CSM = JSON.parse(fs.readFileSync('public/data/factions/CSM.json', 'utf8')) as FactionData;
    const d = CSM.datasheets.find((x) => x.name === 'Dark Commune')!;
    const [u] = buildUnits({ name: 't', factionId: 'CSM', battleSize: 'strike', detachments: [], units: [{ uid: 'a', datasheet: d.name, models: d.models.length, pts: 0 }] }, CSM, 0);
    const kits = new Set(u.models.map((m) => m.weapons.map((w) => w.name).sort().join('+')));
    expect(kits.size).toBeGreaterThan(1);
    const { sectionOf } = await import('../ui/ArmyBuilder');
    expect(sectionOf(CSM.datasheets.find((x) => x.name === 'Masters of the Maelstrom'))).toBe('characters');
  });
});
