import type { ArmyList } from '../engine/types';

// Ready-to-play Incursion (1000 pts) lists, matching the Armageddon launch box factions.
export const PRESETS: Record<string, ArmyList> = {
  SM: {
    name: 'Space Marines (Quick)',
    factionId: 'SM',
    battleSize: 'incursion',
    detachments: ['Gladius Task Force'],
    units: [
      { uid: 'a1', datasheet: 'Intercessor Squad', models: 10, pts: 150 },
      { uid: 'a2', datasheet: 'Captain', models: 1, pts: 80, attachTo: 'a1', warlord: true, enhancement: 'Adept of the Codex', enhancementPts: 20 },
      { uid: 'a3', datasheet: 'Hellblaster Squad', models: 5, pts: 110 },
      { uid: 'a4', datasheet: 'Assault Intercessor Squad', models: 10, pts: 150 },
      { uid: 'a5', datasheet: 'Lieutenant', models: 1, pts: 45, attachTo: 'a4' },
      { uid: 'a6', datasheet: 'Intercessor Squad', models: 5, pts: 80 },
      { uid: 'a7', datasheet: 'Eliminator Squad', models: 3, pts: 75 },
      { uid: 'a8', datasheet: 'Redemptor Dreadnought', models: 1, pts: 195 },
      { uid: 'a9', datasheet: 'Infernus Squad', models: 5, pts: 85 },
    ],
  },
  ORK: {
    name: 'Orks (Quick)',
    factionId: 'ORK',
    battleSize: 'incursion',
    detachments: ['War Horde'],
    units: [
      { uid: 'b1', datasheet: 'Boyz', models: 20, pts: 180 },
      { uid: 'b2', datasheet: 'Warboss', models: 1, pts: 100, attachTo: 'b1', warlord: true, enhancement: "Headwoppa's Killchoppa", enhancementPts: 15 },
      { uid: 'b3', datasheet: 'Boyz', models: 10, pts: 90 },
      { uid: 'b4', datasheet: 'Big Mek', models: 1, pts: 85, attachTo: 'b3' },
      { uid: 'b5', datasheet: 'Boyz', models: 10, pts: 90 },
      { uid: 'b6', datasheet: 'Mek Gunz', models: 1, pts: 55 },
      { uid: 'b7', datasheet: 'Nobz', models: 5, pts: 125 },
      { uid: 'b8', datasheet: 'Deff Dread', models: 1, pts: 130 },
      { uid: 'b9', datasheet: 'Stormboyz', models: 5, pts: 70 },
      { uid: 'b10', datasheet: 'Gretchin', models: 10, pts: 45 },
    ],
  },
  AC: {
    name: 'Adeptus Custodes (Quick)',
    factionId: 'AC',
    battleSize: 'incursion',
    detachments: ['Guardians of the Throne'],
    units: [
      { uid: 'c1', datasheet: 'Custodian Guard', models: 3, pts: 240 },
      { uid: 'c2', datasheet: 'Shield-Captain', models: 1, pts: 180, attachTo: 'c1', warlord: true },
      { uid: 'c3', datasheet: 'Custodian Guard', models: 3, pts: 240 },
      { uid: 'c4', datasheet: 'Vertus Praetors', models: 2, pts: 220 },
      { uid: 'c5', datasheet: 'Prosecutors', models: 5, pts: 50 },
    ],
  },
  TS: {
    name: 'Thousand Sons (Quick)',
    factionId: 'TS',
    battleSize: 'incursion',
    detachments: ['Hexwarp Thrallband'],
    units: [
      { uid: 'd1', datasheet: 'Rubric Marines', models: 10, pts: 210 },
      { uid: 'd2', datasheet: 'Exalted Sorcerer', models: 1, pts: 100, attachTo: 'd1', warlord: true, enhancement: 'Arcane Might', enhancementPts: 20 },
      { uid: 'd3', datasheet: 'Rubric Marines', models: 5, pts: 115 },
      { uid: 'd4', datasheet: 'Sorcerer', models: 1, pts: 100, attachTo: 'd3' },
      { uid: 'd5', datasheet: 'Scarab Occult Terminators', models: 5, pts: 200 },
      { uid: 'd6', datasheet: 'Tzaangors', models: 10, pts: 75 },
      { uid: 'd8', datasheet: 'Daemon Prince of Tzeentch', models: 1, pts: 170 },
    ],
  },
};
