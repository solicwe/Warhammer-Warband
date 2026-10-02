import type { ArmyList } from '../engine/types';

// Ready-to-play Incursion (1000 pts) lists, matching the Armageddon launch box factions.
export const PRESETS: Record<string, ArmyList> = {
  SM: {
    name: 'Space Marines (Quick)',
    factionId: 'SM',
    battleSize: 'incursion',
    detachments: ['Anvil Siege Force'],
    units: [
      { uid: 'a1', datasheet: 'Intercessor Squad', models: 10, pts: 150 },
      { uid: 'a2', datasheet: 'Captain', models: 1, pts: 80, attachTo: 'a1', warlord: true, enhancement: 'Stoic Defender', enhancementPts: 15 },
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
};
