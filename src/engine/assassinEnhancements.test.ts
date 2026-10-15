import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { enhancementOptions, validateList, buildUnits, listPoints } from './army';
import type { ArmyList, FactionData } from './types';

const AoI = JSON.parse(fs.readFileSync('public/data/factions/AoI.json', 'utf8')) as FactionData;
const TYR = JSON.parse(fs.readFileSync('public/data/factions/TYR.json', 'utf8')) as FactionData;
const SM = JSON.parse(fs.readFileSync('public/data/factions/SM.json', 'utf8')) as FactionData;
const TAU = JSON.parse(fs.readFileSync('public/data/factions/TAU.json', 'utf8')) as FactionData;
const WE = JSON.parse(fs.readFileSync('public/data/factions/WE.json', 'utf8')) as FactionData;

describe('Assassin and special unit Enhancements', () => {
  it('allows all 4 Assassins to take their Extremis enhancements in Veiled Blade Elimination Force', () => {
    const list: ArmyList = {
      name: 'Assassins',
      factionId: 'AoI',
      battleSize: 'incursion',
      detachments: ['Veiled Blade Elimination Force'],
      units: [
        { uid: 'u1', datasheet: 'Callidus Assassin', models: 1, pts: 100 },
        { uid: 'u2', datasheet: 'Culexus Assassin', models: 1, pts: 85 },
        { uid: 'u3', datasheet: 'Eversor Assassin', models: 1, pts: 110 },
        { uid: 'u4', datasheet: 'Vindicare Assassin', models: 1, pts: 100 },
      ],
    };

    const callidusOpts = enhancementOptions(list, AoI, list.units[0]);
    expect(callidusOpts.some((e) => e.name === 'Decoy Targets')).toBe(true);

    const culexusOpts = enhancementOptions(list, AoI, list.units[1]);
    expect(culexusOpts.some((e) => e.name === 'Esoteric Explosives')).toBe(true);

    const eversorOpts = enhancementOptions(list, AoI, list.units[2]);
    expect(eversorOpts.some((e) => e.name === 'Intraneural Biotech')).toBe(true);

    const vindicareOpts = enhancementOptions(list, AoI, list.units[3]);
    expect(vindicareOpts.some((e) => e.name === 'Micromelta Rounds')).toBe(true);
  });

  it('validates without EPIC HERO error when enhancements are equipped on Assassins', () => {
    const list: ArmyList = {
      name: 'Assassins',
      factionId: 'AoI',
      battleSize: 'incursion',
      detachments: ['Veiled Blade Elimination Force'],
      units: [
        { uid: 'u1', datasheet: 'Callidus Assassin', models: 1, pts: 100, enhancement: 'Decoy Targets', enhancementPts: 40, warlord: true },
        { uid: 'u2', datasheet: 'Culexus Assassin', models: 1, pts: 85, enhancement: 'Esoteric Explosives', enhancementPts: 40 },
        { uid: 'u3', datasheet: 'Eversor Assassin', models: 1, pts: 110, enhancement: 'Intraneural Biotech', enhancementPts: 35 },
        { uid: 'u4', datasheet: 'Vindicare Assassin', models: 1, pts: 100, enhancement: 'Micromelta Rounds', enhancementPts: 45 },
      ],
    };

    const errs = validateList(list, AoI, { points: 1000, dp: 3, unitLimit: 3, enhancements: 4 });
    const epicHeroErrs = errs.filter((e) => e.includes('EPIC HERO and cannot take Enhancements'));
    expect(epicHeroErrs).toEqual([]);

    // Check points calculation: 100+40 + 85+40 + 110+35 + 100+45 = 555 pts
    expect(listPoints(list, AoI)).toBe(555);

    // Check buildUnits has the enhancement abilities without duplicates
    const units = buildUnits(list, AoI, 0);
    const callidus = units.find((u) => u.name === 'Callidus Assassin')!;
    expect(callidus.enhancements.map((e) => e.name)).toEqual(['Decoy Targets']);
    expect(callidus.abilities.filter((a) => a.name === 'Decoy Targets').length).toBe(1);
    expect(callidus.pts).toBe(140);
  });

  it('allows Trygon to take Trygon Prime in Subterranean Assault', () => {
    const list: ArmyList = {
      name: 'Burrowers',
      factionId: 'TYR',
      battleSize: 'incursion',
      detachments: ['Subterranean Assault'],
      units: [
        { uid: 't1', datasheet: 'Trygon', models: 1, pts: 140 },
      ],
    };
    const opts = enhancementOptions(list, TYR, list.units[0]);
    expect(opts.some((e) => e.name === 'Trygon Prime')).toBe(true);
  });

  it('allows Wulfen to take Hunter’s Guile in Saga of the Beastslayer', () => {
    const list: ArmyList = {
      name: 'Wolves',
      factionId: 'SM',
      battleSize: 'incursion',
      detachments: ['Saga of the Beastslayer'],
      units: [
        { uid: 'w1', datasheet: 'Wulfen', models: 5, pts: 80 },
      ],
    };
    const opts = enhancementOptions(list, SM, list.units[0]);
    expect(opts.some((e) => e.name === "Hunter's Guile")).toBe(true);
  });

  it('allows Vespid Stingwings to take Admired Leader in Auxiliary Cadre', () => {
    const list: ArmyList = {
      name: 'Aux',
      factionId: 'TAU',
      battleSize: 'incursion',
      detachments: ['Auxiliary Cadre'],
      units: [
        { uid: 'v1', datasheet: 'Vespid Stingwings', models: 5, pts: 65 },
      ],
    };
    const opts = enhancementOptions(list, TAU, list.units[0]);
    expect(opts.some((e) => e.name === 'Admired Leader')).toBe(true);
  });

  it('allows Goremongers to take Strategic Slaughter in Cult of Blood', () => {
    const list: ArmyList = {
      name: 'Khorne',
      factionId: 'WE',
      battleSize: 'incursion',
      detachments: ['Cult of Blood'],
      units: [
        { uid: 'g1', datasheet: 'Goremongers', models: 10, pts: 85 },
      ],
    };
    const opts = enhancementOptions(list, WE, list.units[0]);
    expect(opts.some((e) => e.name === 'Strategic Slaughter')).toBe(true);
  });
});

