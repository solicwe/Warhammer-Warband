import type { ArmyList } from '../engine/types';

// Ready-to-play Incursion (1000 pts) lists, matching tournament-competitive loadouts.
export const PRESETS: Record<string, ArmyList> = {
  SM: {
    name: 'Space Marines (Quick)',
    factionId: 'SM',
    battleSize: 'incursion',
    detachments: ['Gladius Task Force'],
    units: [
      {
        uid: 'a1', datasheet: 'Intercessor Squad', models: 10, pts: 175,
        wargear: [
          { opt: 2, choice: 0, count: 2 }, // 2x Astartes grenade launcher
          { opt: 1, choice: 1, count: 1 }, // Sergeant: Power Fist
          { opt: 0, choice: 2, count: 1 }, // Sergeant: Plasma Pistol
        ],
      },
      {
        uid: 'a2', datasheet: 'Captain', models: 1, pts: 90, attachTo: 'a1', warlord: true, enhancement: 'Adept of the Codex', enhancementPts: 20,
        wargear: [
          { opt: 0, choice: 1, count: 1 }, // Plasma Pistol
          { opt: 1, choice: 0, count: 1 }, // Power Fist
        ],
      },
      {
        uid: 'a3', datasheet: 'Hellblaster Squad', models: 5, pts: 115,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Plasma Pistol
        ],
      },
      {
        uid: 'a4', datasheet: 'Assault Intercessor Squad', models: 10, pts: 175,
        wargear: [
          { opt: 1, choice: 0, count: 1 }, // Sergeant: Power Fist
          { opt: 0, choice: 1, count: 1 }, // Sergeant: Plasma Pistol
        ],
      },
      {
        uid: 'a5', datasheet: 'Lieutenant', models: 1, pts: 50, attachTo: 'a4',
        wargear: [
          { opt: 0, choice: 26, count: 1 }, // Neo-volkite Pistol + Master-crafted Power Weapon + Power Fist + Storm Shield
        ],
      },
      {
        uid: 'a6', datasheet: 'Intercessor Squad', models: 5, pts: 95,
        wargear: [
          { opt: 2, choice: 0, count: 1 }, // 1x Astartes grenade launcher
          { opt: 1, choice: 1, count: 1 }, // Sergeant: Power Fist
          { opt: 0, choice: 2, count: 1 }, // Sergeant: Plasma Pistol
        ],
      },
      {
        uid: 'a7', datasheet: 'Eliminator Squad', models: 3, pts: 85,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Instigator Bolt Carbine
          { opt: 1, choice: 0, count: 2 }, // 2x Las Fusil
        ],
      },
      {
        uid: 'a8', datasheet: 'Redemptor Dreadnought', models: 1, pts: 180,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Macro Plasma Incinerator
          { opt: 1, choice: 0, count: 1 }, // Onslaught Gatling Cannon
          { opt: 2, choice: 0, count: 1 }, // Storm Bolters
          { opt: 3, choice: 0, count: 1 }, // Icarus Rocket Pod
        ],
      },
    ],
  },
  ORK: {
    name: 'Orks (Quick)',
    factionId: 'ORK',
    battleSize: 'incursion',
    detachments: ['War Horde'],
    units: [
      {
        uid: 'b1', datasheet: 'Boyz', models: 20, pts: 170,
        wargear: [
          { opt: 1, choice: 0, count: 1 }, // Nob: Power Klaw
          { opt: 4, choice: 0, count: 2 }, // 2x Rokkit Launcha
        ],
      },
      {
        uid: 'b2', datasheet: 'Warboss', models: 1, pts: 100, attachTo: 'b1', warlord: true, enhancement: "Headwoppa's Killchoppa", enhancementPts: 15,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Power Klaw
          { opt: 1, choice: 1, count: 1 }, // Kombi-skorcha
        ],
      },
      {
        uid: 'b3', datasheet: 'Boyz', models: 10, pts: 85,
        wargear: [
          { opt: 1, choice: 0, count: 1 }, // Nob: Power Klaw
          { opt: 4, choice: 0, count: 1 }, // 1x Rokkit Launcha
        ],
      },
      {
        uid: 'b4', datasheet: 'Big Mek', models: 1, pts: 100, attachTo: 'b3',
        wargear: [
          { opt: 1, choice: 0, count: 1 }, // Traktor Blasta
        ],
      },
      {
        uid: 'b5', datasheet: 'Boyz', models: 10, pts: 85,
        wargear: [
          { opt: 1, choice: 0, count: 1 }, // Nob: Power Klaw
          { opt: 4, choice: 0, count: 1 }, // 1x Rokkit Launcha
        ],
      },
      {
        uid: 'b6', datasheet: 'Mek Gunz', models: 1, pts: 55,
        wargear: [
          { opt: 0, choice: 1, count: 1 }, // Kustom Mega-kannon
        ],
      },
      {
        uid: 'b7', datasheet: 'Nobz', models: 5, pts: 115,
        wargear: [
          { opt: 4, choice: 0, count: 5 }, // 5x Kombi-rokkit
        ],
      },
      {
        uid: 'b8', datasheet: 'Deff Dread', models: 1, pts: 130,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Extra Klaw
          { opt: 1, choice: 0, count: 1 }, // Extra Klaw
        ],
      },
      {
        uid: 'b9', datasheet: 'Stormboyz', models: 5, pts: 70,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Nob: Power Klaw
        ],
      },
      { uid: 'b10', datasheet: 'Gretchin', models: 10, pts: 45 },
    ],
  },
  AC: {
    name: 'Adeptus Custodes (Quick)',
    factionId: 'AC',
    battleSize: 'incursion',
    detachments: ['Guardians of the Throne'],
    units: [
      { uid: 'c1', datasheet: 'Custodian Guard', models: 4, pts: 180 },
      {
        uid: 'c2', datasheet: 'Shield-Captain', models: 1, pts: 180, attachTo: 'c1', warlord: true,
        wargear: [
          { opt: 0, choice: 2, count: 1 }, // Guardian Spear
        ],
      },
      { uid: 'c3', datasheet: 'Custodian Guard', models: 4, pts: 180 },
      { uid: 'c4', datasheet: 'Vertus Praetors', models: 2, pts: 155 },
      { uid: 'c6', datasheet: 'Allarus Custodians', models: 3, pts: 180 },
      { uid: 'c5', datasheet: 'Prosecutors', models: 5, pts: 55 },
    ],
  },
  TS: {
    name: 'Thousand Sons (Quick)',
    factionId: 'TS',
    battleSize: 'incursion',
    detachments: ['Hexwarp Thrallband'],
    units: [
      {
        uid: 'd1', datasheet: 'Rubric Marines', models: 10, pts: 210,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Warpflame pistol
          { opt: 1, choice: 0, count: 1 }, // Soulreaper cannon
          { opt: 2, choice: 0, count: 8 }, // 8x Warpflamer
          { opt: 3, choice: 0, count: 1 }, // Icon of flame
        ],
      },
      {
        uid: 'd2', datasheet: 'Exalted Sorcerer', models: 1, pts: 100, attachTo: 'd1', warlord: true, enhancement: 'Arcane Might', enhancementPts: 20,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Prosperine khopesh
        ],
      },
      {
        uid: 'd3', datasheet: 'Rubric Marines', models: 5, pts: 115,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Warpflame pistol
          { opt: 1, choice: 0, count: 1 }, // Soulreaper cannon
          { opt: 2, choice: 0, count: 3 }, // 3x Warpflamer
          { opt: 3, choice: 0, count: 1 }, // Icon of flame
        ],
      },
      {
        uid: 'd4', datasheet: 'Sorcerer', models: 1, pts: 100, attachTo: 'd3',
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Prosperine khopesh
        ],
      },
      {
        uid: 'd5', datasheet: 'Scarab Occult Terminators', models: 5, pts: 200,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Prosperine khopesh
          { opt: 1, choice: 1, count: 1 }, // Soulreaper cannon
          { opt: 2, choice: 0, count: 1 }, // Hellfyre missile rack
        ],
      },
      {
        uid: 'd6', datasheet: 'Tzaangors', models: 10, pts: 75,
        wargear: [
          { opt: 1, choice: 0, count: 1 }, // Brayhorn
          { opt: 2, choice: 0, count: 1 }, // Herd banner
        ],
      },
      { uid: 'd8', datasheet: 'Daemon Prince of Tzeentch', models: 1, pts: 170 },
    ],
  },
  CSM: {
    name: 'Chaos Space Marines (Quick)',
    factionId: 'CSM',
    battleSize: 'incursion',
    detachments: ['Veterans of the Long War'],
    units: [
      {
        uid: 'e1', datasheet: 'Legionaries', models: 10, pts: 180,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Champion Plasma pistol
          { opt: 1, choice: 3, count: 1 }, // Champion Heavy melee weapon
          { opt: 2, choice: 0, count: 1 }, // Chaos icon
          { opt: 4, choice: 0, count: 1 }, // Heavy melee weapon
          { opt: 6, choice: 4, count: 1 }, // Lascannon
          { opt: 6, choice: 7, count: 1 }, // Plasma gun
          { opt: 3, choice: 0, count: 5 }, // 5x Astartes chainsword
        ],
      },
      {
        uid: 'e2', datasheet: 'Chaos Lord', models: 1, pts: 95, attachTo: 'e1', warlord: true, enhancement: 'Warmaster’s Gift', enhancementPts: 15,
        wargear: [
          { opt: 1, choice: 0, count: 1 }, // Power fist
        ],
      },
      {
        uid: 'e3', datasheet: 'Legionaries', models: 5, pts: 95,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Champion Plasma pistol
          { opt: 1, choice: 3, count: 1 }, // Champion Heavy melee weapon
          { opt: 2, choice: 0, count: 1 }, // Chaos icon
          { opt: 4, choice: 0, count: 1 }, // Heavy melee weapon
          { opt: 6, choice: 4, count: 1 }, // Lascannon
          { opt: 3, choice: 0, count: 1 }, // 1x Astartes chainsword
        ],
      },
      { uid: 'e4', datasheet: 'Sorcerer', models: 1, pts: 65, attachTo: 'e3' },
      {
        uid: 'e5', datasheet: 'Chaos Terminator Squad', models: 5, pts: 185,
        wargear: [
          { opt: 0, choice: 1, count: 1 }, // Reaper autocannon
          { opt: 3, choice: 0, count: 3 }, // 3x Power fist
          { opt: 4, choice: 0, count: 1 }, // 1x Chainfist
        ],
      },
      {
        uid: 'e6', datasheet: 'Havocs', models: 5, pts: 135,
        wargear: [
          { opt: 0, choice: 1, count: 1 }, // Champion Power fist
          { opt: 1, choice: 2, count: 1 }, // Champion Plasma gun
          { opt: 2, choice: 2, count: 4 }, // 4x Havoc lascannon
        ],
      },
      { uid: 'e7', datasheet: 'Cultist Mob', models: 10, pts: 50 },
      {
        uid: 'e8', datasheet: 'Helbrute', models: 1, pts: 125,
        wargear: [
          { opt: 0, choice: 3, count: 1 }, // Twin lascannon
          { opt: 1, choice: 0, count: 1 }, // Helbrute fist
          { opt: 2, choice: 1, count: 1 }, // Heavy flamer
        ],
      },
    ],
  },
  WE: {
    name: 'World Eaters (Quick)',
    factionId: 'WE',
    battleSize: 'incursion',
    detachments: ['Berzerker Warband'],
    units: [
      {
        uid: 'w1', datasheet: 'Khorne Berzerkers', models: 10, pts: 160,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Champion Plasma pistol
          { opt: 1, choice: 0, count: 2 }, // 2x Plasma pistol
          { opt: 2, choice: 0, count: 2 }, // 2x Khornate eviscerator
          { opt: 3, choice: 0, count: 1 }, // Icon of Khorne
        ],
      },
      { uid: 'w2', datasheet: 'Lord on Juggernaut', models: 1, pts: 95, attachTo: 'w1', warlord: true, enhancement: 'Battle-lust', enhancementPts: 20 },
      {
        uid: 'w3', datasheet: 'Khorne Berzerkers', models: 10, pts: 160,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Champion Plasma pistol
          { opt: 1, choice: 0, count: 2 }, // 2x Plasma pistol
          { opt: 2, choice: 0, count: 2 }, // 2x Khornate eviscerator
          { opt: 3, choice: 0, count: 1 }, // Icon of Khorne
        ],
      },
      { uid: 'w4', datasheet: 'Master of Executions', models: 1, pts: 60, attachTo: 'w3' },
      {
        uid: 'w5', datasheet: 'Jakhals', models: 10, pts: 65,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // 1x Mauler chainblade
          { opt: 1, choice: 0, count: 1 }, // Skullsmasher and mangler
          { opt: 2, choice: 0, count: 1 }, // Icon of Khorne
        ],
      },
      { uid: 'w6', datasheet: 'Eightbound', models: 3, pts: 125 },
      { uid: 'w7', datasheet: 'Maulerfiend', models: 1, pts: 140 },
      {
        uid: 'w8', datasheet: 'Chaos Rhino', models: 1, pts: 75,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Combi-bolter
          { opt: 1, choice: 0, count: 1 }, // Havoc launcher
        ],
      },
    ],
  },
  EC: {
    name: 'Emperor’s Children (Quick)',
    factionId: 'EC',
    battleSize: 'incursion',
    detachments: ['Mercurial Host'],
    units: [
      {
        uid: 'c1', datasheet: 'Tormentors', models: 10, pts: 170,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Plasma pistol
          { opt: 2, choice: 0, count: 2 }, // 2x Meltagun
          { opt: 3, choice: 0, count: 2 }, // 2x Plasma gun
          { opt: 4, choice: 0, count: 1 }, // Icon of excess
        ],
      },
      {
        uid: 'c2', datasheet: 'Lord Exultant', models: 1, pts: 95, attachTo: 'c1', warlord: true,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Power fist
        ],
      },
      {
        uid: 'c3', datasheet: 'Infractors', models: 10, pts: 175,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Plasma pistol
          { opt: 2, choice: 0, count: 1 }, // Icon of excess
        ],
      },
      { uid: 'c4', datasheet: 'Flawless Blades', models: 3, pts: 95 },
      { uid: 'c5', datasheet: 'Lucius the Eternal', models: 1, pts: 130, attachTo: 'c4' },
      {
        uid: 'c6', datasheet: 'Noise Marines', models: 6, pts: 160,
        wargear: [
          { opt: 1, choice: 0, count: 2 }, // 2x Blastmaster
        ],
      },
      { uid: 'c7', datasheet: 'Maulerfiend', models: 1, pts: 120 },
    ],
  },
  DG: {
    name: 'Death Guard (Quick)',
    factionId: 'DG',
    battleSize: 'incursion',
    detachments: ['Virulent Vectorium'],
    units: [
      {
        uid: 'd1', datasheet: 'Blightlord Terminators', models: 5, pts: 185,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Combi-weapon
          { opt: 1, choice: 0, count: 1 }, // Flail of corruption
          { opt: 2, choice: 0, count: 1 }, // Blight launcher
          { opt: 4, choice: 0, count: 1 }, // Plague spewer
        ],
      },
      { uid: 'd2', datasheet: 'Lord of Contagion', models: 1, pts: 110, attachTo: 'd1', warlord: true },
      {
        uid: 'd3', datasheet: 'Plague Marines', models: 10, pts: 175,
        wargear: [
          { opt: 0, choice: 1, count: 1 }, // Champion Plasma gun
          { opt: 1, choice: 1, count: 1 }, // Champion Power fist
          { opt: 2, choice: 0, count: 2 }, // 2x Blight launcher
          { opt: 3, choice: 0, count: 2 }, // 2x Plague spewer
          { opt: 4, choice: 2, count: 2 }, // 2x Plasma gun
          { opt: 6, choice: 0, count: 2 }, // 2x Heavy plague weapon
        ],
      },
      { uid: 'd4', datasheet: 'Biologus Putrifier', models: 1, pts: 60, attachTo: 'd3' },
      {
        uid: 'd5', datasheet: 'Plague Marines', models: 5, pts: 90,
        wargear: [
          { opt: 0, choice: 1, count: 1 }, // Champion Plasma gun
          { opt: 1, choice: 1, count: 1 }, // Champion Power fist
          { opt: 2, choice: 0, count: 1 }, // Blight launcher
          { opt: 3, choice: 0, count: 1 }, // Plague spewer
          { opt: 4, choice: 2, count: 1 }, // Plasma gun
        ],
      },
      { uid: 'd6', datasheet: 'Malignant Plaguecaster', models: 1, pts: 60, attachTo: 'd5' },
      { uid: 'd7', datasheet: 'Poxwalkers', models: 10, pts: 65 },
      {
        uid: 'd8', datasheet: 'Plagueburst Crawler', models: 1, pts: 170,
        wargear: [
          { opt: 1, choice: 0, count: 1 }, // Rothail volley gun
        ],
      },
    ],
  },
  QI: {
    name: 'Imperial Knights (Quick)',
    factionId: 'QI',
    battleSize: 'incursion',
    detachments: ['Spearhead-At-Arms'],
    units: [
      {
        uid: 'k1', datasheet: 'Knight Paladin', models: 1, pts: 375, warlord: true,
        wargear: [
          { opt: 2, choice: 1, count: 1 }, // Stormspear rocket pod
        ],
      },
      { uid: 'k2', datasheet: 'Knight Destrier', models: 1, pts: 265 },
      {
        uid: 'k3', datasheet: 'Armiger Warglaive', models: 1, pts: 140,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Meltagun
        ],
      },
      {
        uid: 'k4', datasheet: 'Armiger Helverin', models: 1, pts: 140,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Meltagun
        ],
      },
    ],
  },
  QT: {
    name: 'Chaos Knights (Quick)',
    factionId: 'QT',
    battleSize: 'incursion',
    detachments: ['Traitoris Lance'],
    units: [
      { uid: 'q1', datasheet: 'Knight Desecrator', models: 1, pts: 350, warlord: true },
      {
        uid: 'q2', datasheet: 'War Dog Karnivore', models: 1, pts: 145,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Havoc multi-launcher
        ],
      },
      {
        uid: 'q3', datasheet: 'War Dog Executioner', models: 1, pts: 130,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Daemonbreath meltagun
        ],
      },
      {
        uid: 'q4', datasheet: 'War Dog Stalker', models: 1, pts: 135,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Daemonbreath spear
          { opt: 1, choice: 0, count: 1 }, // Havoc multi-launcher
        ],
      },
      {
        uid: 'q5', datasheet: 'War Dog Brigand', models: 1, pts: 135,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Havoc multi-launcher
        ],
      },
    ],
  },
  AoI: {
    name: 'Imperial Agents (Quick)',
    factionId: 'AoI',
    battleSize: 'incursion',
    detachments: ['Ordo Malleus Daemon Hunters'],
    units: [
      { uid: 'i1', datasheet: 'Inquisitor Coteaz', models: 1, pts: 75, warlord: true },
      {
        uid: 'i2', datasheet: 'Inquisitorial Agents', models: 6, pts: 50, attachTo: 'i1',
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Tome-skull
          { opt: 1, choice: 0, count: 1 }, // Plasma pistol
          { opt: 2, choice: 0, count: 1 }, // Eviscerator
          { opt: 4, choice: 1, count: 1 }, // Gun Servitor Plasma cannon
        ],
      },
      {
        uid: 'i3', datasheet: 'Grey Knights Terminator Squad', models: 5, pts: 175,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Incinerator
          { opt: 1, choice: 0, count: 1 }, // Banner
          { opt: 2, choice: 0, count: 1 }, // Narthecium
        ],
      },
      {
        uid: 'i4', datasheet: 'Deathwatch Kill Team', models: 5, pts: 115,
        wargear: [
          { opt: 1, choice: 0, count: 2 }, // 2x Deathwatch thunder hammer
          { opt: 4, choice: 0, count: 1 }, // Frag cannon
          { opt: 5, choice: 0, count: 1 }, // Infernus heavy bolter
          { opt: 7, choice: 0, count: 1 }, // Xenophase blade
          { opt: 8, choice: 0, count: 1 }, // Combi-weapon
        ],
      },
      {
        uid: 'i5', datasheet: 'Imperial Navy Breachers', models: 10, pts: 90,
        wargear: [
          { opt: 0, choice: 1, count: 1 }, // Bolt pistol + Power weapon
          { opt: 1, choice: 1, count: 1 }, // Plasma gun
          { opt: 3, choice: 0, count: 1 }, // Autopistol + Chainfist
          { opt: 4, choice: 0, count: 1 }, // Demolition charge
        ],
      },
      {
        uid: 'i6', datasheet: 'Subductor Squad', models: 11, pts: 85,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Nuncio aquila
        ],
      },
      { uid: 'i7', datasheet: 'Vindicare Assassin', models: 1, pts: 110 },
      { uid: 'i8', datasheet: 'Callidus Assassin', models: 1, pts: 100 },
      {
        uid: 'i9', datasheet: 'Imperial Rhino', models: 1, pts: 65,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Hunter-killer missile
        ],
      },
      { uid: 'i10', datasheet: 'Ministorum Priest', models: 1, pts: 40 },
    ],
  },
  AM: {
    name: 'Astra Militarum (Quick)',
    factionId: 'AM',
    battleSize: 'incursion',
    detachments: ['Combined Arms'],
    units: [
      { uid: 'm1', datasheet: 'Lord Solar Leontus', models: 1, pts: 120, warlord: true },
      {
        uid: 'm2', datasheet: 'Cadian Command Squad', models: 5, pts: 60, enhancement: 'Grand Strategist', enhancementPts: 15,
        wargear: [
          { opt: 1, choice: 1, count: 1 }, // Plasma pistol
          { opt: 2, choice: 1, count: 1 }, // Plasma pistol
          { opt: 3, choice: 3, count: 1 }, // Plasma gun + close combat weapon
          { opt: 4, choice: 0, count: 1 }, // Commander Power fist
        ],
      },
      {
        uid: 'm3', datasheet: 'Cadian Shock Troops', models: 10, pts: 70,
        wargear: [
          { opt: 0, choice: 3, count: 1 }, // Plasma gun
          { opt: 0, choice: 2, count: 1 }, // Meltagun
          { opt: 1, choice: 0, count: 1 }, // Vox-caster
        ],
      },
      {
        uid: 'm4', datasheet: 'Catachan Jungle Fighters', models: 10, pts: 70,
        wargear: [
          { opt: 0, choice: 0, count: 2 }, // 2x Flamer
          { opt: 1, choice: 0, count: 1 }, // Vox-caster
        ],
      },
      {
        uid: 'm5', datasheet: 'Kasrkin', models: 10, pts: 105,
        wargear: [
          { opt: 0, choice: 4, count: 2 }, // 2x Plasma gun
          { opt: 0, choice: 2, count: 2 }, // 2x Hot-shot volley gun
          { opt: 1, choice: 0, count: 1 }, // Hot-shot marksman rifle
          { opt: 2, choice: 0, count: 1 }, // Melta mine
          { opt: 3, choice: 0, count: 1 }, // Vox-caster
          { opt: 4, choice: 0, count: 1 }, // Sergeant Power weapon
          { opt: 5, choice: 1, count: 1 }, // Sergeant Plasma pistol
        ],
      },
      {
        uid: 'm6', datasheet: 'Bullgryn Squad', models: 3, pts: 90,
        wargear: [
          { opt: 0, choice: 0, count: 3 }, // 3x Bullgryn maul
          { opt: 1, choice: 0, count: 1 }, // 1x Brute shield
        ],
      },
      {
        uid: 'm7', datasheet: 'Leman Russ Battle Tank', models: 1, pts: 160,
        wargear: [
          { opt: 1, choice: 3, count: 1 }, // 2x Plasma cannon
          { opt: 2, choice: 0, count: 1 }, // Heavy stubber
          { opt: 3, choice: 0, count: 1 }, // Hunter-killer missile
        ],
      },
      {
        uid: 'm8', datasheet: 'Basilisk', models: 1, pts: 115,
        wargear: [
          { opt: 1, choice: 0, count: 1 }, // Hunter-killer missile
        ],
      },
      {
        uid: 'm9', datasheet: 'Scout Sentinels', models: 1, pts: 55,
        wargear: [
          { opt: 0, choice: 2, count: 1 }, // Lascannon
          { opt: 1, choice: 0, count: 1 }, // Sentinel chainsaw
          { opt: 2, choice: 0, count: 1 }, // Hunter-killer missile
        ],
      },
      {
        uid: 'm10', datasheet: 'Chimera', models: 1, pts: 75,
        wargear: [
          { opt: 1, choice: 0, count: 1 }, // Heavy bolter
          { opt: 2, choice: 0, count: 1 }, // Heavy stubber
          { opt: 3, choice: 0, count: 1 }, // Hunter-killer missile
        ],
      },
    ],
  },
  TYR: {
    name: 'Tyranids (Quick)',
    factionId: 'TYR',
    battleSize: 'incursion',
    detachments: ['Invasion Fleet'],
    units: [
      {
        uid: 't1', datasheet: 'Hive Tyrant', models: 1, pts: 195, warlord: true, enhancement: 'Adaptive Biology', enhancementPts: 25,
        wargear: [
          { opt: 1, choice: 0, count: 1 }, // Heavy venom cannon
        ],
      },
      {
        uid: 't2', datasheet: 'Termagants', models: 20, pts: 110,
        wargear: [
          { opt: 1, choice: 0, count: 20 }, // 20x Termagant spinefists
        ],
      },
      { uid: 't3', datasheet: 'Hormagaunts', models: 10, pts: 70 },
      { uid: 't4', datasheet: 'Genestealers', models: 10, pts: 140 },
      { uid: 't5', datasheet: 'Broodlord', models: 1, pts: 80, attachTo: 't4' },
      { uid: 't6', datasheet: 'Zoanthropes', models: 3, pts: 90 },
      { uid: 't7', datasheet: 'Exocrine', models: 1, pts: 135 },
      { uid: 't8', datasheet: 'Tyranid Warriors with Melee Bio-weapons', models: 3, pts: 75 },
      { uid: 't9', datasheet: 'Von Ryan’s Leapers', models: 3, pts: 55 },
    ],
  },
  AS: {
    name: 'Adepta Sororitas (Quick)',
    factionId: 'AS',
    battleSize: 'incursion',
    detachments: ['Hallowed Martyrs'],
    units: [
      {
        uid: 's1', datasheet: 'Morvenn Vahl', models: 1, pts: 215, warlord: true,
      },
      {
        uid: 's2', datasheet: 'Paragon Warsuits', models: 3, pts: 165,
        wargear: [
          { opt: 0, choice: 0, count: 3 }, // Paragon grenade launchers
          { opt: 2, choice: 1, count: 3 }, // Multi-meltas
        ],
      },
      {
        uid: 's3', datasheet: 'Castigator', models: 1, pts: 165,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Castigator battle cannon
          { opt: 1, choice: 0, count: 1 }, // Hunter-killer missile
          { opt: 2, choice: 0, count: 1 }, // Storm bolter
        ],
      },
      {
        uid: 's4', datasheet: 'Battle Sisters Squad', models: 10, pts: 100,
        wargear: [
          { opt: 0, choice: 5, count: 1 }, // Superior: Plasma pistol
          { opt: 1, choice: 1, count: 1 }, // Superior: Power weapon
          { opt: 2, choice: 1, count: 1 }, // 1x Meltagun
          { opt: 3, choice: 5, count: 1 }, // 1x Multi-melta
          { opt: 4, choice: 0, count: 1 }, // 1x Simulacrum imperialis
        ],
      },
      {
        uid: 's5', datasheet: 'Palatine', models: 1, pts: 50, attachTo: 's4', enhancement: 'Saintly Example', enhancementPts: 10,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Plasma pistol
        ],
      },
      {
        uid: 's6', datasheet: 'Dialogus', models: 1, pts: 40, attachTo: 's4',
      },
      {
        uid: 's7', datasheet: 'Seraphim Squad', models: 5, pts: 75,
        wargear: [
          { opt: 0, choice: 1, count: 2 }, // 2 Seraphim with 2x Ministorum hand flamers
          { opt: 1, choice: 4, count: 1 }, // Superior: Plasma pistol + Power weapon
        ],
      },
      {
        uid: 's8', datasheet: 'Celestian Sacresants', models: 5, pts: 75,
        wargear: [
          { opt: 0, choice: 0, count: 4 }, // 4x Anointed halberd
          { opt: 1, choice: 2, count: 1 }, // Superior: Plasma pistol
          { opt: 2, choice: 0, count: 1 }, // Superior: Spear of the faithful
        ],
      },
      {
        uid: 's9', datasheet: 'Immolator', models: 1, pts: 100,
        wargear: [
          { opt: 0, choice: 0, count: 1 }, // Hunter-killer missile
          { opt: 1, choice: 1, count: 1 }, // Twin multi-melta
        ],
      },
    ],
  },
  TAU: {
    name: 'T’au Empire (Quick)',
    factionId: 'TAU',
    battleSize: 'incursion',
    detachments: ['Mont’ka'],
    units: [
      {
        uid: 't1', datasheet: 'Commander In Coldstar Battlesuit', models: 1, pts: 95, warlord: true, enhancement: 'Exemplar of the Mont’ka', enhancementPts: 10, attachTo: 't2',
      },
      {
        uid: 't2', datasheet: 'Crisis Sunforge Battlesuits', models: 3, pts: 125,
      },
      {
        uid: 't3', datasheet: 'Cadre Fireblade', models: 1, pts: 50, attachTo: 't4', enhancement: 'Strategic Conqueror', enhancementPts: 15,
      },
      {
        uid: 't4', datasheet: 'Breacher Team', models: 10, pts: 80,
      },
      {
        uid: 't5', datasheet: 'Devilfish', models: 1, pts: 75,
      },
      {
        uid: 't6', datasheet: 'Stealth Battlesuits', models: 5, pts: 100,
      },
      {
        uid: 't7', datasheet: 'Hammerhead Gunship', models: 1, pts: 150,
      },
      {
        uid: 't8', datasheet: 'Ghostkeel Battlesuit', models: 1, pts: 150,
      },
      {
        uid: 't9', datasheet: 'Pathfinder Team', models: 10, pts: 85,
      },
      {
        uid: 't10', datasheet: 'Kroot Carnivores', models: 10, pts: 65,
      },
    ],
  },
  AE: {
    name: 'Aeldari (Quick)',
    factionId: 'AE',
    battleSize: 'incursion',
    detachments: ['Warhost'],
    units: [
      {
        uid: 'ae1', datasheet: 'Farseer', models: 1, pts: 60, warlord: true,
        enhancement: 'Phoenix Gem', enhancementPts: 35, attachTo: 'ae2',
      },
      {
        uid: 'ae2', datasheet: 'Guardian Defenders', models: 11, pts: 90,
        wargear: [{ opt: 0, choice: 1, count: 1 }], // Bright lance
      },
      {
        uid: 'ae3', datasheet: 'Asurmen', models: 1, pts: 135, attachTo: 'ae4',
      },
      {
        uid: 'ae4', datasheet: 'Dire Avengers', models: 5, pts: 70,
      },
      {
        uid: 'ae5', datasheet: 'Fire Dragons', models: 5, pts: 110,
      },
      {
        uid: 'ae6', datasheet: 'Wave Serpent', models: 1, pts: 115,
        wargear: [
          { opt: 0, choice: 1, count: 1 }, // Twin bright lance
          { opt: 1, choice: 0, count: 1 }, // Shuriken cannon
        ],
      },
      {
        uid: 'ae7', datasheet: 'Wraithlord', models: 1, pts: 125,
        wargear: [
          { opt: 1, choice: 0, count: 1 }, // Ghostglaive
          { opt: 2, choice: 1, count: 2 }, // 2x Bright lance
        ],
      },
      {
        uid: 'ae8', datasheet: 'Swooping Hawks', models: 5, pts: 95,
      },
      {
        uid: 'ae9', datasheet: 'War Walkers', models: 1, pts: 80,
      },
      {
        uid: 'ae10', datasheet: 'Howling Banshees', models: 5, pts: 85,
      },
    ],
  },
  LoV: {
    name: 'Leagues of Votann (Quick)',
    factionId: 'LoV',
    battleSize: 'incursion',
    detachments: ['Hearthband'],
    units: [
      {
        uid: 'lov1', datasheet: 'Ûthar the Destined', models: 1, pts: 100, warlord: true, attachTo: 'lov2',
      },
      {
        uid: 'lov2', datasheet: 'Hearthkyn Warriors', models: 10, pts: 90,
      },
      {
        uid: 'lov3', datasheet: 'Einhyr Champion', models: 1, pts: 65, enhancement: 'Bastion Shield', enhancementPts: 25, attachTo: 'lov4',
      },
      {
        uid: 'lov4', datasheet: 'Einhyr Hearthguard', models: 5, pts: 130,
      },
      {
        uid: 'lov5', datasheet: 'Sagitaur', models: 1, pts: 85,
      },
      {
        uid: 'lov6', datasheet: 'Cthonian Beserks', models: 5, pts: 90, embarkIn: 'lov5',
      },
      {
        uid: 'lov7', datasheet: 'Hernkyn Pioneers', models: 3, pts: 85,
      },
      {
        uid: 'lov8', datasheet: 'Brôkhyr Thunderkyn', models: 3, pts: 80,
      },
      {
        uid: 'lov9', datasheet: 'Hekaton Land Fortress', models: 1, pts: 250,
      },
    ],
  },
  AdM: {
    name: 'Adeptus Mechanicus (Quick)',
    factionId: 'AdM',
    battleSize: 'incursion',
    detachments: ['Rad-Zone Corps'],
    units: [
      {
        uid: 'adm1', datasheet: 'Belisarius Cawl', models: 1, pts: 220, warlord: true,
      },
      {
        uid: 'adm2', datasheet: 'Skitarii Rangers', models: 10, pts: 85,
      },
      {
        uid: 'adm3', datasheet: 'Skitarii Vanguard', models: 10, pts: 85,
      },
      {
        uid: 'adm4', datasheet: 'Kataphron Breachers', models: 3, pts: 140,
      },
      {
        uid: 'adm5', datasheet: 'Onager Dunecrawler', models: 1, pts: 150,
      },
      {
        uid: 'adm6', datasheet: 'Ironstrider Ballistarii', models: 1, pts: 80,
      },
      {
        uid: 'adm7', datasheet: 'Sicarian Ruststalkers', models: 5, pts: 75,
      },
      {
        uid: 'adm8', datasheet: 'Serberys Raiders', models: 3, pts: 60,
      },
      {
        uid: 'adm9', datasheet: 'Pteraxii Skystalkers', models: 5, pts: 75,
      },
    ],
  },
};

