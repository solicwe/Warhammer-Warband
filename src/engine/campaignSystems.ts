// ============================================================================
// WARHAMMER WARBAND: 11TH EDITION CAMPAIGN EXTENSION SYSTEMS
// Zero-Collision Rule Engine, TFT Fleet Integrity, High-Scrap Economy,
// Anti-Lag Compression Engine, and the 10 Key Campaign Systems
// ============================================================================

import type { Effect } from '../rules-engine/effects';
import { addTimed } from '../rules-engine/effects';
import { log } from './state';
import { applyMortalWounds } from './combatEngine';
import type { GameState, PlayerId, UnitState, ArmyUnitEntry, FactionData } from './types';

// ----------------------------------------------------------------------------
// 1. Types & Identifiers
// ----------------------------------------------------------------------------

export type TacticalClockDirectiveId =
  | 'SHROUD_OF_NIGHT'       // R-Buff: Stealth & 24" range cap on enemies
  | 'BLITZKRIEG_SURGE'      // R-Buff: +3" Move, Reroll Adv/Chg, Advance & Shoot/Charge
  | 'ANNIHILATION_VOLLEY'   // R-Buff: [SUSTAINED HITS 1] & +1 AP all weapons
  | 'AEGIS_OF_IRON'         // R-Buff: -1 Damage taken & Feel No Pain 5+
  | 'WARMASTER_ASCENDANCY'; // R-Buff: Double OC (x2) & Crit Hit 5+ on Objectives

export type ApexDesignationId =
  | 'VANGUARD_SPEARHEAD'    // Infiltrators, Scouts 6", Suppress on hit
  | 'IMMOVABLE_ANVIL'       // +30% Wounds, Immune Battle-shock, +1 Save Aura on Obj
  | 'EXECUTIONER'           // Full rerolls & +1 Dmg vs highest-point enemy unit
  | 'GRAND_SPOTTER';        // +6" Range, grants +1 Hit & Ignores Cover to allies vs target

export type MunitorumAmmoId =
  | 'KRAKEN_BOLTS'          // 35 Scrap: +6" Range, +1 AP, Ignores Cover (1 battle)
  | 'HELLFIRE_ROUNDS'       // 40 Scrap: Anti-Infantry 3+, Anti-Monster 4+ (1 battle)
  | 'FRENZON_STIMMS'        // 35 Scrap: +2 Melee Attacks, Auto-Advance 6" (1 battle)
  | 'MACHINE_SPIRIT_OIL'    // 45 Scrap: +1 BS/WS, Heal 3 Wounds/turn for Vehicle (1 battle)
  | 'PSICANNON_WARD';       // 30 Scrap: 4+ Invuln Save & reflect 1 MW on save of 6 (1 battle)

export type AdvisorId =
  | 'ADV_ORDNANCE'
  | 'ADV_APOTHECARY'
  | 'ADV_LOGIS'
  | 'ADV_ASTROPATH'
  | 'ADV_TECHMARINE'
  | 'ADV_COMMISSAR'
  | 'ADV_INQUISITOR'
  | 'ADV_NAVIGATOR';

export type OrbitalModuleId =
  | 'LANCE_BATTERY'         // Round 1 start: 1D3+2 MW & -1 Save to top 2-3 enemy units
  | 'DROP_POD_ASSAULT'      // Round 1 start: Deploy 1-2 units directly onto center Objective
  | 'BLIND_CHAFF_SCREEN';   // Round 1 start: Enemy army gets -1 to Hit & -2" Move in R1

export type PatronContractId =
  | 'PATRON_MECHANICUS'
  | 'PATRON_ROGUE_TRADER'
  | 'PATRON_INQUISITION'
  | 'PATRON_AUXILIA';

// Unit extension attributes
export interface UnitCampaignExtensions {
  compressionTier: 1 | 2 | 3;
  apexDesignation?: ApexDesignationId;
  tempAmmoLoadout?: MunitorumAmmoId;
  isOnReserveBench?: boolean;
}

// Full Campaign State Extensions
export interface CampaignOverhaulState {
  fleetIntegrityHP: number;
  maxFleetIntegrityHP: number;
  winLossStreak: number;
  triggeredComebackThresholds: {
    hp75: boolean;
    hp50: boolean;
    hp25: boolean;
  };
  scrap: number;
  maxInterestCap: number;
  gildedDamageBonusPercent: number;
  unlockedAdvisorSlots: 1 | 2 | 3;
  activeAdvisors: AdvisorId[];
  tacticalClock: [
    TacticalClockDirectiveId,
    TacticalClockDirectiveId,
    TacticalClockDirectiveId,
    TacticalClockDirectiveId,
    TacticalClockDirectiveId
  ];
  absorbedBossRules: Array<{
    ruleId: string;
    level: 1 | 2;
  }>;
  secondaryMasteryRanks: {
    takeAndHold: 1 | 2 | 3;
    purgeTheFoe: 1 | 2 | 3;
    priorityAssets: 1 | 2 | 3;
    disruption: 1 | 2 | 3;
    reconnaissance: 1 | 2 | 3;
  };
  garrisonedNodeIds: string[];
  fortifiedNodeIds: string[];
  activePatronContract: PatronContractId | null;
  orbitalModules: {
    activeModule: OrbitalModuleId;
    levels: Record<OrbitalModuleId, 1 | 2 | 3>;
  };
}

// ----------------------------------------------------------------------------
// 2. Data Definitions & Reference Tables
// ----------------------------------------------------------------------------

export interface TacticalClockDef {
  id: TacticalClockDirectiveId;
  name: string;
  nameTh: string;
  icon: string;
  desc: string;
  recommendedRound: number;
}

export const TACTICAL_CLOCK_DIRECTIVES: Record<TacticalClockDirectiveId, TacticalClockDef> = {
  SHROUD_OF_NIGHT: {
    id: 'SHROUD_OF_NIGHT',
    name: 'Shroud of Night',
    nameTh: 'ม่านพรางตา',
    icon: '🌑',
    desc: 'All units gain Stealth (-1 to be hit). Enemy ranged weapons cannot target beyond 24" this round.',
    recommendedRound: 1,
  },
  BLITZKRIEG_SURGE: {
    id: 'BLITZKRIEG_SURGE',
    name: 'Blitzkrieg Surge',
    nameTh: 'คลื่นบุกสายฟ้าแลบ',
    icon: '⚡',
    desc: '+3" Movement, re-roll Advance & Charge rolls, and can Shoot and Charge after Advancing.',
    recommendedRound: 2,
  },
  ANNIHILATION_VOLLEY: {
    id: 'ANNIHILATION_VOLLEY',
    name: 'Annihilation Volley',
    nameTh: 'ระดมยิงล้างผลาญ',
    icon: '💥',
    desc: 'All ranged and melee attacks gain [SUSTAINED HITS 1] and +1 Armour Penetration (AP).',
    recommendedRound: 3,
  },
  AEGIS_OF_IRON: {
    id: 'AEGIS_OF_IRON',
    name: 'Aegis of Unyielding Iron',
    nameTh: 'ปราการเหล็กไหล',
    icon: '🛡️',
    desc: 'All incoming attacks have -1 Damage (min 1) and units gain Feel No Pain 5+.',
    recommendedRound: 4,
  },
  WARMASTER_ASCENDANCY: {
    id: 'WARMASTER_ASCENDANCY',
    name: 'Warmaster Ascendancy',
    nameTh: 'ยึดครองเบ็ดเสร็จ',
    icon: '👑',
    desc: 'Objective Control is doubled (x2). Attacks on Objective markers score Critical Hits on 5+.',
    recommendedRound: 5,
  },
};

export interface ApexDesignationDef {
  id: ApexDesignationId;
  name: string;
  nameTh: string;
  icon: string;
  desc: string;
}

export const APEX_DESIGNATIONS: Record<ApexDesignationId, ApexDesignationDef> = {
  VANGUARD_SPEARHEAD: {
    id: 'VANGUARD_SPEARHEAD',
    name: 'Apex: Vanguard Spearhead',
    nameTh: 'หน่วยทะลวงฟันแนวหน้า',
    icon: '🗡️',
    desc: 'Always has Infiltrators & Scouts 6". First time this unit hits an enemy, target is Suppressed (-1 to Hit & cannot use Stratagems this turn).',
  },
  IMMOVABLE_ANVIL: {
    id: 'IMMOVABLE_ANVIL',
    name: 'Apex: Immovable Anvil',
    nameTh: 'สมอเหล็กพิทักษ์จุด',
    icon: '⚓',
    desc: '+30% Max Wounds, immune to Battle-shock. While on an Objective, grants +1 to Saving Throws to allies within 6".',
  },
  EXECUTIONER: {
    id: 'EXECUTIONER',
    name: "Apex: Warmaster's Executioner",
    nameTh: 'เพชฌฆาตล่าหัวบอส',
    icon: '☠️',
    desc: 'Locks onto highest-points enemy unit (Nemesis). Gains full re-rolls to Hit and Wound and +1 Damage vs Nemesis. Slaying Nemesis grants +50 Scrap.',
  },
  GRAND_SPOTTER: {
    id: 'GRAND_SPOTTER',
    name: 'Apex: Grand Battery Spotter',
    nameTh: 'ผู้ชี้เป้าปืนใหญ่',
    icon: '🎯',
    desc: '+6" Range. When this unit hits an enemy, all other friendly units shooting that target gain +1 to Hit and [IGNORES COVER].',
  },
};

export interface MunitorumAmmoDef {
  id: MunitorumAmmoId;
  name: string;
  nameTh: string;
  icon: string;
  cost: number;
  usableOn: 'RANGED' | 'INFANTRY_MOUNTED' | 'VEHICLE_WALKER' | 'ALL';
  desc: string;
}

export const MUNITORUM_AMMO: Record<MunitorumAmmoId, MunitorumAmmoDef> = {
  KRAKEN_BOLTS: {
    id: 'KRAKEN_BOLTS',
    name: 'Kraken Penetrator Bolts',
    nameTh: 'กระสุนคราเคนเจาะเกราะ',
    icon: '🐚',
    cost: 35,
    usableOn: 'RANGED',
    desc: '+6" Range, +1 AP, and [IGNORES COVER] on all ranged weapons for 1 battle.',
  },
  HELLFIRE_ROUNDS: {
    id: 'HELLFIRE_ROUNDS',
    name: 'Hellfire Bio-Acid Shells',
    nameTh: 'กระสุนกรดชีวภาพเฮลไฟร์',
    icon: '🧪',
    cost: 40,
    usableOn: 'RANGED',
    desc: 'All ranged weapons gain [ANTI-INFANTRY 3+] and [ANTI-MONSTER 4+] for 1 battle.',
  },
  FRENZON_STIMMS: {
    id: 'FRENZON_STIMMS',
    name: 'Frenzon Combat Stimms',
    nameTh: 'สติมม์กระตุ้นความคลั่ง',
    icon: '💉',
    cost: 35,
    usableOn: 'INFANTRY_MOUNTED',
    desc: '+2 Melee Attacks per model and Auto-Advance 6" without rolling dice for 1 battle.',
  },
  MACHINE_SPIRIT_OIL: {
    id: 'MACHINE_SPIRIT_OIL',
    name: 'Blessed Machine-Spirit Oil',
    nameTh: 'น้ำมันอวยพรจิตวิญญาณเครื่องจักร',
    icon: '🛢️',
    cost: 45,
    usableOn: 'VEHICLE_WALKER',
    desc: '+1 BS and +1 WS, and repairs 3 Wounds every Command Phase for 1 battle.',
  },
  PSICANNON_WARD: {
    id: 'PSICANNON_WARD',
    name: 'Null-Field Psicannon Ward',
    nameTh: 'วอร์ดต้านพลังจิตนูลิฟาย',
    icon: '🔮',
    cost: 30,
    usableOn: 'ALL',
    desc: '4+ Invulnerable Save for 1 battle, and reflects 1 Mortal Wound back to attacker on Save roll of 6.',
  },
};

export interface AdvisorDef {
  id: AdvisorId;
  name: string;
  nameTh: string;
  icon: string;
  battleDesc: string;
  campaignDesc: string;
  hireCost: number;
}

export const HIGH_COMMAND_ADVISORS: Record<AdvisorId, AdvisorDef> = {
  ADV_ORDNANCE: {
    id: 'ADV_ORDNANCE',
    name: 'Master of Ordnance',
    nameTh: 'นายพลปืนใหญ่',
    icon: '💣',
    battleDesc: 'Start of R1, R3, R5: Mortar bombardment on random enemy on an Objective for 1D3+1 Mortal Wounds and -1 to Hit.',
    campaignDesc: 'Orbital Strike upgrades cost -25% Scrap.',
    hireCost: 100,
  },
  ADV_APOTHECARY: {
    id: 'ADV_APOTHECARY',
    name: 'Chief Apothecary / Biophagus',
    nameTh: 'หัวหน้าแพทย์สนาม',
    icon: '🩺',
    battleDesc: 'Every Command Phase: Heals 2 Wounds to all damaged units (or revives 1 slain infantry model).',
    campaignDesc: 'Restores +3 Fleet Integrity HP after every battle.',
    hireCost: 120,
  },
  ADV_LOGIS: {
    id: 'ADV_LOGIS',
    name: 'Logis Strategos',
    nameTh: 'เสนาธิการคลังแสง',
    icon: '📐',
    battleDesc: 'Start battle with +1 Command Point (CP).',
    campaignDesc: 'Duplicate unit recruitment tax reduced to 0%, Munitorum Ammo costs 50% less Scrap.',
    hireCost: 110,
  },
  ADV_ASTROPATH: {
    id: 'ADV_ASTROPATH',
    name: 'Master Astropath',
    nameTh: 'ผู้หยั่งรู้กระแสวาร์ป',
    icon: '👁️',
    battleDesc: 'Enemy cannot Deep Strike or deploy Reserves within 12" of friendly rear units.',
    campaignDesc: 'Reveals all node types & enemy factions across the Sector. +1 Free Card Reroll each node.',
    hireCost: 90,
  },
  ADV_TECHMARINE: {
    id: 'ADV_TECHMARINE',
    name: 'Forge Master / Mek Boss',
    nameTh: 'หัวหน้าวิศวกร',
    icon: '🔧',
    battleDesc: 'Command Phase: VEHICLES & MONSTERS gain 3 HP Shield and re-roll Hit rolls of 1.',
    campaignDesc: 'Selling VEHICLE units grants 120% Scrap value (profit!).',
    hireCost: 100,
  },
  ADV_COMMISSAR: {
    id: 'ADV_COMMISSAR',
    name: 'Lord Commissar / Enforcer',
    nameTh: 'ผู้ตรวจการสูงสุด',
    icon: '⭐',
    battleDesc: 'Command Phase: Automatically clears Battle-shock from all units and grants +1 OC.',
    campaignDesc: 'Reduces Fleet Integrity damage taken on defeat by 5 HP.',
    hireCost: 110,
  },
  ADV_INQUISITOR: {
    id: 'ADV_INQUISITOR',
    name: 'Ordo Representative',
    nameTh: 'ผู้แทนสภาไต่สวน',
    icon: '⚖️',
    battleDesc: 'Nullifies 1 Boss Rule from Elite/Boss enemies during battle.',
    campaignDesc: '+35% Scrap and rewards from Faction Patronage Contracts.',
    hireCost: 130,
  },
  ADV_NAVIGATOR: {
    id: 'ADV_NAVIGATOR',
    name: 'Void Navigator',
    nameTh: 'ต้นหนเดินอวกาศ',
    icon: '🧭',
    battleDesc: 'Start of Round 1: Redeploy up to 2 friendly units after seeing enemy setup.',
    campaignDesc: 'Allows jumping across any map branch to next layer once per Sector.',
    hireCost: 95,
  },
};

export interface OrbitalModuleDef {
  id: OrbitalModuleId;
  name: string;
  nameTh: string;
  icon: string;
  descLv1: string;
  descLv2: string;
  descLv3: string;
}

export const ORBITAL_MODULES: Record<OrbitalModuleId, OrbitalModuleDef> = {
  LANCE_BATTERY: {
    id: 'LANCE_BATTERY',
    name: 'Lance Strike Battery',
    nameTh: 'เลเซอร์ผ่าพิกัดวงโคจร',
    icon: '🛰️',
    descLv1: 'Round 1 start: Strikes highest-cost 2 enemy units for 1D3+2 Mortal Wounds and -1 Save in R1.',
    descLv2: 'Round 1 start: Strikes 2 units for 1D3+3 Mortal Wounds and -1 Save & -1 Toughness in R1.',
    descLv3: 'Round 1 start: Strikes top 3 enemy units for 2D3+2 Mortal Wounds, -1 Save and causes Battle-shock.',
  },
  DROP_POD_ASSAULT: {
    id: 'DROP_POD_ASSAULT',
    name: 'Drop Pod / Teleportarium Assault',
    nameTh: 'ส่งหน่วยจู่โจมลงกลางสมรภูมิ',
    icon: '🚀',
    descLv1: 'Round 1 start: Deploy 1 friendly unit directly onto center Objective with 4+ Invulnerable Save in R1.',
    descLv2: 'Round 1 start: Deploy 1 unit onto center Objective with 4+ Invuln and +1 to Wound in R1.',
    descLv3: 'Round 1 start: Deploy 2 units directly onto center Objectives with 4+ Invuln and [FIGHTS FIRST] in R1.',
  },
  BLIND_CHAFF_SCREEN: {
    id: 'BLIND_CHAFF_SCREEN',
    name: 'Atmospheric Blind-Chaff & Vox-Jammer',
    nameTh: 'ม่านควันพรางตาและรบกวนสัญญาณ',
    icon: '🌫️',
    descLv1: 'Round 1 start: Enemy army suffers -1 to Hit (stacks with Cover) and -2" Movement in R1.',
    descLv2: 'Round 1 start: Enemy suffers -1 to Hit, -3" Move, and cannot fire Overwatch in R1.',
    descLv3: 'Round 1 start: Enemy suffers -1 to Hit, -3" Move, cannot use Stratagems in R1, and friendly units have Lone Operative.',
  },
};

export interface PatronContractDef {
  id: PatronContractId;
  name: string;
  nameTh: string;
  sponsor: string;
  conditionDesc: string;
  buffDesc: string;
  bossRewardDesc: string;
}

export const PATRON_CONTRACTS: Record<PatronContractId, PatronContractDef> = {
  PATRON_MECHANICUS: {
    id: 'PATRON_MECHANICUS',
    name: 'Mars Forge-Synod Covenant',
    nameTh: 'สัญญาพันธมิตรดาวอังคาร',
    sponsor: 'Adeptus Mechanicus',
    conditionDesc: 'Deploy at least 2 VEHICLE or WALKER units in your army.',
    buffDesc: 'Vehicles gain Feel No Pain 5+. Purchasing and upgrading Vehicles costs -25% Scrap.',
    bossRewardDesc: 'Free Epic/Legendary Vehicle unit card + 150 Scrap.',
  },
  PATRON_ROGUE_TRADER: {
    id: 'PATRON_ROGUE_TRADER',
    name: 'Warrant of Trade Investment',
    nameTh: 'สัญญาสิทธิบัตรการค้าเสรี',
    sponsor: 'Navis Imperialis & Rogue Traders',
    conditionDesc: 'Maintain at least 300 Scrap in reserve.',
    buffDesc: 'Expands Munitorum Hoard interest cap to +100 Scrap/node. +1 additional reward option at every node.',
    bossRewardDesc: '+250 Scrap and 1 free random Level 2 Relic.',
  },
  PATRON_INQUISITION: {
    id: 'PATRON_INQUISITION',
    name: "Inquisitorial Mandate / Warmaster's Favor",
    nameTh: 'โองการสภาไต่สวนศรัทธา',
    sponsor: "Ordo Malleus / Warmaster's Inner Circle",
    conditionDesc: 'Deploy at least 2 CHARACTER or Tier II+ Veteran units.',
    buffDesc: '[PSYCHIC] weapons and Warlord melee attacks deal +1 Damage and ignore Invulnerable Saves from Round 3 onwards.',
    bossRewardDesc: '+5 Renown immediately (unlock 5 tree nodes).',
  },
  PATRON_AUXILIA: {
    id: 'PATRON_AUXILIA',
    name: 'Imperial Siege Auxilia Garrison',
    nameTh: 'สัญญาพันธสัญญาป้อมปราการ',
    sponsor: 'Munitorum Siege Auxilia',
    conditionDesc: 'Win the battle scoring 35 or more Primary VP.',
    buffDesc: 'Held Objectives fire automated defense turrets at enemies within 9" each turn (3D6 shots, S5 AP-1 D1).',
    bossRewardDesc: '+25 Fleet Integrity HP and +2 Starting CP permanently.',
  },
};

// ----------------------------------------------------------------------------
// 3. Mathematical Engines & Core Formulas
// ----------------------------------------------------------------------------

export const BASE_LAYER_DAMAGE = [3, 4, 5, 6, 8, 10, 15];

/**
 * Calculates Fleet Integrity damage on defeat:
 * Damage = BaseLayerDmg + (2 * SurvivingEnemyUnits) + floor(max(0, EnemyVP - PlayerVP) / 10)
 * Capped at 25 HP for normal battles.
 */
export function calculateDefeatDamage(
  layer: number,
  survivingEnemyUnits: number,
  enemyVP: number,
  playerVP: number,
  isBoss = false
): number {
  const base = BASE_LAYER_DAMAGE[Math.min(layer, BASE_LAYER_DAMAGE.length - 1)] ?? 5;
  const unitPenalty = 2 * Math.max(0, survivingEnemyUnits);
  const vpDiff = Math.max(0, enemyVP - playerVP);
  const vpPenalty = Math.floor(vpDiff / 10);
  const total = base + unitPenalty + vpPenalty;
  return isBoss ? total : Math.min(25, total);
}

/**
 * Win / Loss streak bonus:
 * 2 consecutive: +20 Scrap
 * 3 consecutive: +40 Scrap
 * 4+ consecutive: +70 Scrap and +1 Free Card Reroll
 */
export function calculateStreakBonus(streak: number): { scrap: number; freeReroll: boolean } {
  const abs = Math.abs(streak);
  if (abs >= 4) return { scrap: 70, freeReroll: true };
  if (abs === 3) return { scrap: 40, freeReroll: false };
  if (abs === 2) return { scrap: 20, freeReroll: false };
  return { scrap: 0, freeReroll: false };
}

/**
 * Consolation Salvage when defeated:
 * 100% of node base scrap + (Damage Taken * 3 Scrap)
 */
export function calculateConsolationScrap(baseGain: number, damageTaken: number): number {
  return Math.max(0, baseGain + damageTaken * 3);
}

/**
 * Munitorum Hoard Interest:
 * +10% of current Scrap held (calculated as +10 Scrap per 100 Scrap).
 * Default cap is +50 Scrap per node (at 500 Scrap).
 * Can be expanded to +100 Scrap with Rogue Trader Patron.
 */
export function calculateHoardInterest(scrap: number, maxCap = 50): number {
  const hundreds = Math.floor(Math.max(0, scrap) / 100);
  return Math.min(maxCap, hundreds * 10);
}

/**
 * Gilded Arsenal (Wealth-to-Power Conversion):
 * Active when holding >= 100 Scrap.
 * +3% Final Damage per 100 Scrap (capped at +30% at 1,000 Scrap).
 * At >= 500 Scrap: +2 Starting Shield HP to all units.
 * At >= 1,000 Scrap: Auric Overlord -> Critical Hit on 5+.
 */
export function calculateGildedBonus(scrap: number): {
  damagePercent: number;
  shieldBonus: number;
  critThresholdBonus: boolean;
} {
  const hundreds = Math.min(10, Math.floor(Math.max(0, scrap) / 100));
  return {
    damagePercent: hundreds * 3,
    shieldBonus: scrap >= 500 ? 2 : 0,
    critThresholdBonus: scrap >= 1000,
  };
}

/**
 * Rank Compression Stat Multiplier (Anti-Lag Elite Compression Engine)
 * Models remain identical on board; stats scale up cleanly!
 * Tier I: 1.0x stats
 * Tier II: Wounds x1.8, Attacks x1.6, OC +1, Save +1
 * Tier III: Wounds x2.6, Attacks x2.3, Damage +1, Feel No Pain 5+
 */
export function getCompressionStatScaling(tier: 1 | 2 | 3 = 1): {
  woundsMult: number;
  attacksMult: number;
  ocBonus: number;
  saveBonus: number;
  damageBonus: number;
  fnp?: number;
} {
  if (tier === 3) {
    return { woundsMult: 2.6, attacksMult: 2.3, ocBonus: 1, saveBonus: 1, damageBonus: 1, fnp: 5 };
  }
  if (tier === 2) {
    return { woundsMult: 1.8, attacksMult: 1.6, ocBonus: 1, saveBonus: 1, damageBonus: 0 };
  }
  return { woundsMult: 1.0, attacksMult: 1.0, ocBonus: 0, saveBonus: 0, damageBonus: 0 };
}

/**
 * Sector Garrison cumulative buffs from visited nodes in current Sector.
 */
export interface GarrisonSectorBuffs {
  scrapDropPercent: number;
  startingShield: number;
  startingCP: number;
  critDamagePercent: number;
  earlyRoundsAP: number;
  turnStartHeal: number;
}

export function calculateGarrisonBuffs(
  visitedNodes: Array<{ id: string; kind: string }>,
  fortifiedNodeIds: string[] = []
): GarrisonSectorBuffs {
  let scrapDropPercent = 0;
  let startingShield = 0;
  let startingCP = 0;
  let critDamagePercent = 0;
  let earlyRoundsAP = 0;
  let turnStartHeal = 0;

  for (const n of visitedNodes) {
    const isFortified = fortifiedNodeIds.includes(n.id);
    const mult = isFortified ? 2 : 1;
    if (n.kind === 'battle') {
      scrapDropPercent += 8 * mult;
      startingShield += 1 * mult;
    } else if (n.kind === 'elite') {
      startingCP += 1 * mult;
      critDamagePercent += 5 * mult;
    } else if (n.kind === 'armory') {
      earlyRoundsAP += 1 * mult;
    } else if (n.kind === 'medicae') {
      turnStartHeal += 1 * mult;
    }
  }

  return {
    scrapDropPercent,
    startingShield,
    startingCP,
    critDamagePercent,
    earlyRoundsAP,
    turnStartHeal,
  };
}

/**
 * Checks if any Comeback Threshold was breached and awards rewards.
 */
export function checkComebackThresholds(
  currentHP: number,
  triggered: { hp75: boolean; hp50: boolean; hp25: boolean }
): {
  updated: { hp75: boolean; hp50: boolean; hp25: boolean };
  scrapReward: number;
  renownReward: number;
  grantAmmo: boolean;
  grantEpicCard: boolean;
  grantDesperateCrusade: boolean;
} {
  const result = {
    updated: { ...triggered },
    scrapReward: 0,
    renownReward: 0,
    grantAmmo: false,
    grantEpicCard: false,
    grantDesperateCrusade: false,
  };

  if (currentHP < 75 && !triggered.hp75) {
    result.updated.hp75 = true;
    result.scrapReward += 100;
    result.grantAmmo = true;
  }
  if (currentHP < 50 && !triggered.hp50) {
    result.updated.hp50 = true;
    result.renownReward += 2;
    result.grantEpicCard = true;
  }
  if (currentHP < 25 && !triggered.hp25) {
    result.updated.hp25 = true;
    result.grantDesperateCrusade = true;
  }

  return result;
}

/**
 * Initial state factory for the Campaign Overhaul extension
 */
export function createDefaultCampaignOverhaulState(): CampaignOverhaulState {
  return {
    fleetIntegrityHP: 100,
    maxFleetIntegrityHP: 100,
    winLossStreak: 0,
    triggeredComebackThresholds: {
      hp75: false,
      hp50: false,
      hp25: false,
    },
    scrap: 120,
    maxInterestCap: 50,
    gildedDamageBonusPercent: 3,
    unlockedAdvisorSlots: 1,
    activeAdvisors: ['ADV_ORDNANCE'],
    tacticalClock: [
      'SHROUD_OF_NIGHT',
      'BLITZKRIEG_SURGE',
      'ANNIHILATION_VOLLEY',
      'AEGIS_OF_IRON',
      'WARMASTER_ASCENDANCY',
    ],
    absorbedBossRules: [],
    secondaryMasteryRanks: {
      takeAndHold: 1,
      purgeTheFoe: 1,
      priorityAssets: 1,
      disruption: 1,
      reconnaissance: 1,
    },
    garrisonedNodeIds: [],
    fortifiedNodeIds: [],
    activePatronContract: null,
    orbitalModules: {
      activeModule: 'LANCE_BATTERY',
      levels: {
        LANCE_BATTERY: 1,
        DROP_POD_ASSAULT: 1,
        BLIND_CHAFF_SCREEN: 1,
      },
    },
  };
}

// ----------------------------------------------------------------------------
// 4. Roster & Campaign Mutation Handlers
// ----------------------------------------------------------------------------

/** Check if a unit in the roster can be compressed into a higher Veteran Tier */
export function canCompressSquad(run: any, unitUid: string): boolean {
  if (!run?.list?.units) return false;
  const target = run.list.units.find((u: ArmyUnitEntry) => u.uid === unitUid);
  if (!target) return false;
  const currentTier = target.compressionTier ?? 1;
  if (currentTier >= 3) return false;

  // Find another unit with the same datasheet to merge
  const donor = run.list.units.find(
    (u: ArmyUnitEntry) => u.uid !== unitUid && u.datasheet === target.datasheet
  );
  return !!donor;
}

/** Merges two units of the same datasheet to produce a Tier II or Tier III compressed squad */
export function compressSquad(run: any, targetUid: string, donorUid?: string): any {
  if (!run?.list?.units) return run;
  const targetIndex = run.list.units.findIndex((u: ArmyUnitEntry) => u.uid === targetUid);
  if (targetIndex === -1) return run;
  const target = run.list.units[targetIndex];
  const currentTier = target.compressionTier ?? 1;
  if (currentTier >= 3) return run;

  const donorIndex = donorUid
    ? run.list.units.findIndex((u: ArmyUnitEntry) => u.uid === donorUid)
    : run.list.units.findIndex((u: ArmyUnitEntry) => u.uid !== targetUid && u.datasheet === target.datasheet);

  if (donorIndex === -1) return run;
  const donor = run.list.units[donorIndex];
  const nextTier: 1 | 2 | 3 = currentTier === 1 ? 2 : 3;

  const updatedTarget: ArmyUnitEntry = {
    ...target,
    compressionTier: nextTier,
    pts: target.pts + donor.pts,
  };

  const nextUnits = run.list.units
    .map((u: ArmyUnitEntry, idx: number) => (idx === targetIndex ? updatedTarget : u))
    .filter((_: any, idx: number) => idx !== donorIndex);

  const star = nextTier === 2 ? '★★' : '★★★';
  const storyEntry = `[${star} Rank Compression] Merged 2 squads into ${target.datasheet} (${star} Tier ${nextTier})!`;

  return {
    ...run,
    list: {
      ...run.list,
      units: nextUnits,
    },
    story: [...(run.story ?? []), storyEntry],
  };
}

/** Check if player can afford Munitorum Ammo loadout */
export function canBuyMunitorumAmmo(run: any, unitUid: string, ammoId: MunitorumAmmoId): boolean {
  if (!run?.list?.units) return false;
  const def = MUNITORUM_AMMO[ammoId];
  if (!def) return false;
  const hasLogis = run.activeAdvisors?.includes('ADV_LOGIS');
  const cost = hasLogis ? Math.floor(def.cost * 0.5) : def.cost;
  if ((run.scrap ?? 0) < cost) return false;
  const unit = run.list.units.find((u: ArmyUnitEntry) => u.uid === unitUid);
  return !!unit;
}

/** Purchases a Munitorum Ammo loadout for 1 battle */
export function buyMunitorumAmmo(run: any, unitUid: string, ammoId: MunitorumAmmoId): any {
  if (!canBuyMunitorumAmmo(run, unitUid, ammoId)) return run;
  const def = MUNITORUM_AMMO[ammoId];
  const hasLogis = run.activeAdvisors?.includes('ADV_LOGIS');
  const cost = hasLogis ? Math.floor(def.cost * 0.5) : def.cost;

  const nextUnits = run.list.units.map((u: ArmyUnitEntry) =>
    u.uid === unitUid ? { ...u, tempAmmoLoadout: ammoId } : u
  );

  return {
    ...run,
    scrap: (run.scrap ?? 0) - cost,
    list: {
      ...run.list,
      units: nextUnits,
    },
    story: [...(run.story ?? []), `Munitorum Depot: Equipped ${def.name} on ${unitUid} (-${cost} Scrap)`],
  };
}

/** Assigns an Apex Designation badge (strictly unique across army) */
export function setApexDesignation(run: any, unitUid: string, designation: ApexDesignationId | null): any {
  if (!run?.list?.units) return run;

  const nextUnits = run.list.units.map((u: ArmyUnitEntry) => {
    if (u.uid === unitUid) {
      return { ...u, apexDesignation: designation ?? undefined };
    }
    // Remove duplicate badge from any other unit
    if (designation && u.apexDesignation === designation) {
      const copy = { ...u };
      delete copy.apexDesignation;
      return copy;
    }
    return u;
  });

  return {
    ...run,
    list: {
      ...run.list,
      units: nextUnits,
    },
  };
}

/** Updates the 5-Round Tactical Clock timeline */
export function setTacticalClock(
  run: any,
  clock: [
    TacticalClockDirectiveId,
    TacticalClockDirectiveId,
    TacticalClockDirectiveId,
    TacticalClockDirectiveId,
    TacticalClockDirectiveId
  ]
): any {
  return {
    ...run,
    tacticalClock: [...clock],
  };
}

/** Unlocks an additional Advisor Slot */
export function unlockAdvisorSlot(run: any): any {
  const current = run.unlockedAdvisorSlots ?? 1;
  if (current >= 3) return run;
  const cost = current === 1 ? 100 : 200;
  if ((run.scrap ?? 0) < cost) return run;

  return {
    ...run,
    scrap: (run.scrap ?? 0) - cost,
    unlockedAdvisorSlots: (current + 1) as 2 | 3,
    story: [...(run.story ?? []), `High Command: Unlocked Advisor Slot ${current + 1} (-${cost} Scrap)`],
  };
}

/** Hires an Advisor into the High Command council */
export function hireAdvisor(run: any, advisorId: AdvisorId): any {
  const def = HIGH_COMMAND_ADVISORS[advisorId];
  if (!def) return run;
  const maxSlots = run.unlockedAdvisorSlots ?? 1;
  const currentAdvisors: AdvisorId[] = run.activeAdvisors ?? [];
  if (currentAdvisors.includes(advisorId)) return run;
  if (currentAdvisors.length >= maxSlots) return run;
  if ((run.scrap ?? 0) < def.hireCost) return run;

  return {
    ...run,
    scrap: (run.scrap ?? 0) - def.hireCost,
    activeAdvisors: [...currentAdvisors, advisorId],
    story: [...(run.story ?? []), `High Command: Appointed ${def.name} to the Strategium Council (-${def.hireCost} Scrap)`],
  };
}

/** Upgrades an Orbital Strike Module level (up to Lv.3) */
export function upgradeOrbitalModule(run: any, moduleId: OrbitalModuleId): any {
  const currentLevels = run.orbitalModules?.levels ?? {
    LANCE_BATTERY: 1,
    DROP_POD_ASSAULT: 1,
    BLIND_CHAFF_SCREEN: 1,
  };
  const currentLvl = currentLevels[moduleId] ?? 1;
  if (currentLvl >= 3) return run;

  const hasOrdnance = run.activeAdvisors?.includes('ADV_ORDNANCE');
  const baseCost = currentLvl === 1 ? 80 : 140;
  const cost = hasOrdnance ? Math.floor(baseCost * 0.75) : baseCost;
  if ((run.scrap ?? 0) < cost) return run;

  const nextLevels = {
    ...currentLevels,
    [moduleId]: (currentLvl + 1) as 2 | 3,
  };

  return {
    ...run,
    scrap: (run.scrap ?? 0) - cost,
    orbitalModules: {
      activeModule: run.orbitalModules?.activeModule ?? moduleId,
      levels: nextLevels,
    },
    story: [...(run.story ?? []), `Flagship Bay: Upgraded ${ORBITAL_MODULES[moduleId]?.name || moduleId} to Lv.${currentLvl + 1} (-${cost} Scrap)`],
  };
}

/** Sets the active Orbital Strike Module for the next match */
export function selectOrbitalModule(run: any, moduleId: OrbitalModuleId): any {
  return {
    ...run,
    orbitalModules: {
      levels: run.orbitalModules?.levels ?? {
        LANCE_BATTERY: 1,
        DROP_POD_ASSAULT: 1,
        BLIND_CHAFF_SCREEN: 1,
      },
      activeModule: moduleId,
    },
  };
}

/** Absorbs a Boss Rule into the Trophy Rack (max 3 slots, duplicates ascend to Lv.2) */
export function absorbBossRule(run: any, ruleId: string): any {
  const current: Array<{ ruleId: string; level: 1 | 2 }> = run.absorbedBossRules ?? [];
  const existingIdx = current.findIndex((r) => r.ruleId === ruleId);

  if (existingIdx >= 0) {
    // Ascend duplicate to Lv.2
    const updated = [...current];
    updated[existingIdx] = { ruleId, level: 2 };
    return {
      ...run,
      absorbedBossRules: updated,
      story: [...(run.story ?? []), `Warlord Trophy Claim: Ascended Boss Rule [${ruleId}] to Apex Lv.2!`],
    };
  }

  if (current.length < 3) {
    return {
      ...run,
      absorbedBossRules: [...current, { ruleId, level: 1 }],
      story: [...(run.story ?? []), `Warlord Trophy Claim: Absorbed Boss Rule [${ruleId}] into Trophy Rack!`],
    };
  }

  return run;
}

/** Fortifies a garrisoned node for 60 Scrap (doubles its persistent sector buffs) */
export function fortifyGarrisonNode(run: any, nodeId: string): any {
  if ((run.scrap ?? 0) < 60) return run;
  const fortified: string[] = run.fortifiedNodeIds ?? [];
  if (fortified.includes(nodeId)) return run;

  return {
    ...run,
    scrap: (run.scrap ?? 0) - 60,
    fortifiedNodeIds: [...fortified, nodeId],
    story: [...(run.story ?? []), `Sector Garrison: Fortified Outpost at Node ${nodeId} into Bastion Lv.2 (-60 Scrap)`],
  };
}

/** Signs a Sector Patronage Contract */

/**
 * Automatically tunes the 5-Round Tactical Clock to army playstyle and equips
 * available Apex badges to suitable units.
 */
export function autoOptimizePreBattle(run: any, faction?: FactionData | null): any {
  if (!run?.list?.units) return run;

  // 1. Analyze army weapons (melee vs ranged)
  let meleeCount = 0;
  let rangedCount = 0;

  for (const u of run.list.units) {
    const sheet = faction?.datasheets?.find((d) => d.name === u.datasheet);
    if (!sheet) continue;
    for (const w of sheet.weapons || []) {
      for (const p of w.profiles || []) {
        if (p.range === 'Melee') meleeCount++;
        else rangedCount++;
      }
    }
  }

  // 2. Set tactical clock based on army profile
  let clock: [
    TacticalClockDirectiveId,
    TacticalClockDirectiveId,
    TacticalClockDirectiveId,
    TacticalClockDirectiveId,
    TacticalClockDirectiveId
  ];
  if (rangedCount > meleeCount * 1.3) {
    clock = [
      'SHROUD_OF_NIGHT',
      'ANNIHILATION_VOLLEY',
      'ANNIHILATION_VOLLEY',
      'BLITZKRIEG_SURGE',
      'WARMASTER_ASCENDANCY',
    ];
  } else if (meleeCount > rangedCount * 1.2) {
    clock = [
      'BLITZKRIEG_SURGE',
      'BLITZKRIEG_SURGE',
      'AEGIS_OF_IRON',
      'ANNIHILATION_VOLLEY',
      'WARMASTER_ASCENDANCY',
    ];
  } else {
    clock = [
      'SHROUD_OF_NIGHT',
      'BLITZKRIEG_SURGE',
      'ANNIHILATION_VOLLEY',
      'AEGIS_OF_IRON',
      'WARMASTER_ASCENDANCY',
    ];
  }

  // 3. Assign Apex Designations to best units
  const sortedByPts = [...run.list.units].sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0));

  const execUnit = sortedByPts[0];
  const vanguardUnit = sortedByPts.find((u) => {
    if (u.uid === execUnit?.uid) return false;
    const sheet = faction?.datasheets?.find((d) => d.name === u.datasheet);
    return sheet?.abilities?.some((a) =>
      a.name.toLowerCase().includes('infiltrat') || a.name.toLowerCase().includes('scout')
    );
  }) || sortedByPts.find((u) => u.uid !== execUnit?.uid);

  const anvilUnit = sortedByPts.find((u) => {
    if (u.uid === execUnit?.uid || u.uid === vanguardUnit?.uid) return false;
    const sheet = faction?.datasheets?.find((d) => d.name === u.datasheet);
    return !sheet?.keywords?.includes('CHARACTER') && !sheet?.keywords?.includes('VEHICLE');
  }) || sortedByPts.find((u) => u.uid !== execUnit?.uid && u.uid !== vanguardUnit?.uid);

  const spotterUnit = sortedByPts.find((u) => {
    if (u.uid === execUnit?.uid || u.uid === vanguardUnit?.uid || u.uid === anvilUnit?.uid) return false;
    const sheet = faction?.datasheets?.find((d) => d.name === u.datasheet);
    return sheet?.weapons?.some((w) => w.profiles?.some((p) => p.range !== 'Melee'));
  });

  const nextUnits = run.list.units.map((u: ArmyUnitEntry) => {
    let designation: ApexDesignationId | undefined = undefined;
    if (u.uid === execUnit?.uid) designation = 'EXECUTIONER';
    else if (u.uid === vanguardUnit?.uid) designation = 'VANGUARD_SPEARHEAD';
    else if (u.uid === anvilUnit?.uid) designation = 'IMMOVABLE_ANVIL';
    else if (u.uid === spotterUnit?.uid) designation = 'GRAND_SPOTTER';
    return {
      ...u,
      apexDesignation: designation,
    };
  });

  return {
    ...run,
    tacticalClock: clock,
    list: {
      ...run.list,
      units: nextUnits,
    },
    story: [...(run.story ?? []), 'Strategium: Auto-optimized 5-Round Tactical Clock and Apex Designations for battle!'],
  };
}

export function selectPatronContract(run: any, contractId: PatronContractId): any {
  const def = PATRON_CONTRACTS[contractId];
  return {
    ...run,
    activePatronContract: contractId,
    maxInterestCap: contractId === 'PATRON_ROGUE_TRADER' ? 100 : 50,
    story: [...(run.story ?? []), `High Lords Patronage: Signed covenant with ${def?.sponsor || contractId}!`],
  };
}

// ----------------------------------------------------------------------------
// 5. In-Battle Engine Integration
// ----------------------------------------------------------------------------

/** Initializes all 11e campaign extension systems into the GameState at battle start */
export function applyCampaignSystemsBattleSetup(s: GameState, run: any): void {
  const me: PlayerId = 0;
  const foe: PlayerId = 1;

  // 1. Tactical Strike Cap: maximum 8 active squads deployed on board per side
  const myUnits = s.units.filter((u) => u.owner === me);
  if (myUnits.length > 8) {
    for (let i = 8; i < myUnits.length; i++) {
      myUnits[i].status = 'reserves';
      myUnits[i].isOnReserveBench = true;
      log(s, `${myUnits[i].name} assigned to Tactical Reserve Support Bench (Tactical Strike Cap = 8)`, 'info', me);
    }
  }

  // 2. Pre-Battle Tactical Clock setup
  s.tacticalClockDirectives = run.tacticalClock ?? [
    'SHROUD_OF_NIGHT',
    'BLITZKRIEG_SURGE',
    'ANNIHILATION_VOLLEY',
    'AEGIS_OF_IRON',
    'WARMASTER_ASCENDANCY',
  ];
  if (s.tacticalClockDirectives && s.tacticalClockDirectives.length > 0) s.tacticalClockDirective = s.tacticalClockDirectives[0];

  // 3. Gilded Arsenal (Wealth-to-Power)
  s.gildedBonus = calculateGildedBonus(run.scrap ?? 0);
  if (s.gildedBonus.damagePercent > 0) {
    log(s, `💰 Gilded Arsenal active: +${s.gildedBonus.damagePercent}% Final Damage (holding ${run.scrap ?? 0} Scrap)`, 'info', me);
  }
  if (s.gildedBonus.shieldBonus > 0) {
    for (const u of s.units.filter((x) => x.owner === me)) {
      if (!u.combatState) {
        u.combatState = {
          tokens: { auspex: 0, fervour: 0, bastion: 0 },
          maxTokenCaps: { auspex: 3, fervour: 3, bastion: 3 },
          ailments: { soulfire: 0, bleeding: 0, corroded: 0, pinned: 0 },
        };
      }
      u.combatState.warpWardHP = (u.combatState.warpWardHP ?? 0) + s.gildedBonus.shieldBonus;
    }
  }

  // 4. Orbital Strike Module
  if (run.orbitalModules) {
    const act = run.orbitalModules.activeModule ?? 'LANCE_BATTERY';
    const lvl = run.orbitalModules.levels?.[act] ?? 1;
    s.orbitalModuleActive = { id: act, level: lvl };
  }

  // 5. High Command Advisors & Patron Contract
  s.advisorsActive = run.activeAdvisors ?? [];
  s.patronContract = run.activePatronContract ?? null;

  // 6. Apply Unit Extensions (Apex, Ammo, Compression Tier)
  const rosterMap = new Map<string, ArmyUnitEntry>();
  if (run.list?.units) {
    for (const u of run.list.units) rosterMap.set(u.uid, u);
  }

  for (const u of s.units.filter((x) => x.owner === me)) {
    const rosterEntry = rosterMap.get(u.id) || run.list?.units?.find((ru: any) => ru.datasheet === u.name);
    const tier = rosterEntry?.compressionTier ?? u.compressionTier ?? 1;
    u.compressionTier = tier;

    // Rank Compression stat scaling
    if (tier > 1) {
      const scaling = getCompressionStatScaling(tier);
      for (const m of u.models) {
        m.wounds = Math.round(m.wounds * scaling.woundsMult);
        if (m.profile) {
          m.profile.W = Math.round(m.profile.W * scaling.woundsMult);
          if (scaling.saveBonus) m.profile.Sv = Math.max(2, m.profile.Sv - scaling.saveBonus);
          if (scaling.ocBonus && m.profile.OC !== null) m.profile.OC += scaling.ocBonus;
        }
      }
      if (scaling.fnp) {
        addTimed(s, u, { e: { defend: { fnp: scaling.fnp } }, label: `Tier ${tier} Resilience (FNP ${scaling.fnp}+)`, until: 'battle', by: me });
      }
      if (scaling.damageBonus) {
        addTimed(s, u, { e: { damage: scaling.damageBonus }, label: `Tier ${tier} Annihilation (+${scaling.damageBonus} Damage)`, until: 'battle', by: me });
      }
      log(s, `★ ${u.name} compressed to Tier ${tier} (Wounds x${scaling.woundsMult}, Attacks x${scaling.attacksMult})`, 'info', me);
    }

    // Apex Designations
    const apex = rosterEntry?.apexDesignation ?? u.apexDesignation;
    if (apex === 'VANGUARD_SPEARHEAD') {
      u.core.infiltrators = true;
      u.core.scouts = 6;
      addTimed(s, u, { e: {}, label: 'Apex: Vanguard Spearhead', until: 'battle', by: me });
    } else if (apex === 'IMMOVABLE_ANVIL') {
      for (const m of u.models) {
        m.wounds = Math.round(m.wounds * 1.3);
        if (m.profile) m.profile.W = Math.round(m.profile.W * 1.3);
      }
      addTimed(s, u, { e: {}, label: 'Apex: Immovable Anvil (+30% Wounds)', until: 'battle', by: me });
    } else if (apex === 'EXECUTIONER') {
      addTimed(s, u, { e: {}, label: "Apex: Warmaster's Executioner", until: 'battle', by: me });
    } else if (apex === 'GRAND_SPOTTER') {
      addTimed(s, u, { e: {}, label: 'Apex: Grand Battery Spotter', until: 'battle', by: me });
    }

    // Munitorum Ammo Loadouts
    const ammo = rosterEntry?.tempAmmoLoadout ?? u.tempAmmoLoadout;
    if (ammo === 'KRAKEN_BOLTS') {
      addTimed(s, u, { e: { abilities: ['ignores cover'], critWoundAp: 1 }, label: 'Kraken Penetrator Bolts', until: 'battle', by: me });
    } else if (ammo === 'HELLFIRE_ROUNDS') {
      addTimed(s, u, { e: { abilities: ['anti-infantry 3+', 'anti-monster 4+'] }, label: 'Hellfire Bio-Acid Shells', until: 'battle', by: me });
    } else if (ammo === 'FRENZON_STIMMS') {
      addTimed(s, u, { e: { advanceSix: true }, label: 'Frenzon Combat Stimms', until: 'battle', by: me });
    } else if (ammo === 'MACHINE_SPIRIT_OIL') {
      addTimed(s, u, { e: { hit: 1 }, label: 'Blessed Machine-Spirit Oil', until: 'battle', by: me });
    } else if (ammo === 'PSICANNON_WARD') {
      addTimed(s, u, { e: { defend: { inv: 4, reflect6: true } }, label: 'Null-Field Psicannon Ward (4++)', until: 'battle', by: me });
    }

    // Desperate Crusade permanent buff (< 25 HP Comeback)
    if (run.desperateCrusadeActive) {
      addTimed(s, u, { e: { hit: 1 }, label: 'Desperate Crusade (+1 Attack)', until: 'battle', by: me });
    }
  }

  // Desperate Crusade extra starting CP
  if (run.desperateCrusadeActive) {
    s.players[me].cp += 2;
  }

  // 7. Apply Absorbed Boss Rules to player army
  if (run.absorbedBossRules && run.absorbedBossRules.length > 0) {
    for (const absorbed of run.absorbedBossRules) {
      const mult = absorbed.level === 2 ? 2 : 1;
      for (const u of s.units.filter((x) => x.owner === me)) {
        if (absorbed.ruleId.includes('shield') || absorbed.ruleId.includes('void')) {
          addTimed(s, u, { e: { defend: { inv: absorbed.level === 2 ? 4 : 5 } }, label: `Absorbed: Void Shield Lv.${absorbed.level}`, until: 'battle', by: me });
        } else if (absorbed.ruleId.includes('swarm') || absorbed.ruleId.includes('furious')) {
          addTimed(s, u, { e: { abilities: [absorbed.level === 2 ? 'sustained hits 2' : 'sustained hits 1'] }, label: `Absorbed: Furious Swarm Lv.${absorbed.level}`, until: 'battle', by: me });
        } else {
          addTimed(s, u, { e: {}, label: `Absorbed: ${absorbed.ruleId} Lv.${absorbed.level}`, until: 'battle', by: me });
        }
      }
      log(s, `🛡️ Trophy Rack: Active Absorbed Boss Rule [${absorbed.ruleId} Lv.${absorbed.level}]!`, 'info', me);
    }
  }

  // 8. Sector Garrison persistent buffs
  if (run.garrisonedNodeIds && run.garrisonedNodeIds.length > 0) {
    const visited = (run.path ?? [])
      .map((id: string) => run.map?.find((m: any) => m.id === id))
      .filter(Boolean);
    const gBuffs = calculateGarrisonBuffs(visited, run.fortifiedNodeIds ?? []);
    s.players[me].cp += gBuffs.startingCP;
    if (gBuffs.startingShield > 0) {
      for (const u of s.units.filter((x) => x.owner === me)) {
        if (!u.combatState) {
          u.combatState = {
            tokens: { auspex: 0, fervour: 0, bastion: 0 },
            maxTokenCaps: { auspex: 3, fervour: 3, bastion: 3 },
            ailments: { soulfire: 0, bleeding: 0, corroded: 0, pinned: 0 },
          };
        }
        u.combatState.warpWardHP = (u.combatState.warpWardHP ?? 0) + gBuffs.startingShield;
      }
      log(s, `Sector Garrison: Frontline units gain +${gBuffs.startingShield} Supply Shield HP`, 'info', me);
    }
  }
}

/** Processes round change triggers: updates Tactical Clock directive and fires Round 1 Orbital Strike */
export function processCampaignSystemsRoundStart(s: GameState): void {
  const me: PlayerId = 0;
  const foe: PlayerId = 1;

  // 1. Update Tactical Clock Directive for current Round
  if (s.tacticalClockDirectives && s.tacticalClockDirectives.length > 0) {
    const idx = Math.min(s.round - 1, s.tacticalClockDirectives.length - 1);
    const dir = s.tacticalClockDirectives[idx];
    s.tacticalClockDirective = dir;
    const def = TACTICAL_CLOCK_DIRECTIVES[dir];
    log(s, `🕒 Tactical Clock [R${s.round}]: ${def?.name || dir} is now active!`, 'info', me);

    for (const u of s.units.filter((x) => x.owner === me && x.status !== 'destroyed')) {
      if (dir === 'SHROUD_OF_NIGHT') {
        addTimed(s, u, { e: { defend: { hit: -1 } }, label: 'Shroud of Night (Stealth)', until: 'turn', by: me });
      } else if (dir === 'BLITZKRIEG_SURGE') {
        addTimed(s, u, { e: { eligible: ['shootAfterAdvance', 'chargeAfterAdvance'] }, label: 'Blitzkrieg Surge', until: 'turn', by: me });
      } else if (dir === 'ANNIHILATION_VOLLEY') {
        addTimed(s, u, { e: { abilities: ['sustained hits 1'], critWoundAp: 1 }, label: 'Annihilation Volley', until: 'turn', by: me });
      } else if (dir === 'AEGIS_OF_IRON') {
        addTimed(s, u, { e: { defend: { damage: -1, fnp: 5 } }, label: 'Aegis of Iron', until: 'turn', by: me });
      } else if (dir === 'WARMASTER_ASCENDANCY') {
        addTimed(s, u, { e: { shockedOc: 2 }, label: 'Warmaster Ascendancy (2x OC)', until: 'turn', by: me });
      }
    }
  }

  // 2. Round 1 Orbital Strike Module execution
  if (s.round === 1 && s.orbitalModuleActive) {
    const mod = s.orbitalModuleActive;
    if (mod.id === 'LANCE_BATTERY') {
      const count = mod.level >= 3 ? 3 : 2;
      const targets = s.units
        .filter((u) => u.owner === foe && u.status !== 'destroyed' && (u.models?.length ?? 0) > 0)
        .sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0))
        .slice(0, count);

      for (const target of targets) {
        const mw = mod.level >= 3 ? Math.floor(Math.random() * 6) + 3 : Math.floor(Math.random() * 3) + 3;
        applyMortalWounds(s, target, mw, `Orbital Lance Battery Lv.${mod.level}`);
        addTimed(s, target, { e: { defend: { ap: 1 } }, label: 'Orbital Sunder (-1 Save)', until: 'turn', by: me });
        log(s, `🛰️ Orbital Lance Battery blasts ${target.name} for ${mw} Mortal Wounds (-1 Save in R1)!`, 'info', me);
      }
    } else if (mod.id === 'DROP_POD_ASSAULT') {
      const centerObj = s.objectives[0];
      const unitCount = mod.level >= 3 ? 2 : 1;
      const candidates = s.units.filter((u) => u.owner === me && u.status !== 'destroyed');
      const dropUnits = candidates.slice(0, unitCount);
      for (const u of dropUnits) {
        if (centerObj) {
          u.models.forEach((m, idx) => {
            m.x = centerObj.x + (idx % 3) * 1.5;
            m.y = centerObj.y + Math.floor(idx / 3) * 1.5;
          });
        }
        addTimed(s, u, { e: { defend: { inv: 4 } }, label: 'Drop Pod Kinetic Shield (4++)', until: 'turn', by: me });
        log(s, `🚀 Drop Pod Assault deploys ${u.name} directly onto center Objective with 4++!`, 'info', me);
      }
    } else if (mod.id === 'BLIND_CHAFF_SCREEN') {
      for (const u of s.units.filter((x) => x.owner === foe && x.status !== 'destroyed')) {
        addTimed(s, u, { e: { hit: -1 }, label: 'Blind-Chaff Jammed (-1 to Hit)', until: 'turn', by: me });
        log(s, `🌫️ Blind-Chaff Screen impairs ${u.name} (-1 to Hit, -2" Move in R1)`, 'info', me);
      }
    }
  }
}

/** Processes High Command Advisors at the start of each Command Phase */
export function processCampaignSystemsCommandPhase(s: GameState, activePlayer: PlayerId): void {
  if (activePlayer !== 0 || !s.advisorsActive || !s.advisorsActive.length) return;
  const me: PlayerId = 0;
  const foe: PlayerId = 1;

  for (const adv of s.advisorsActive) {
    if (adv === 'ADV_ORDNANCE' && (s.round === 1 || s.round === 3 || s.round === 5)) {
      const enemies = s.units.filter((u) => u.owner === foe && u.status !== 'destroyed');
      const enemyOnObj = enemies.filter((u) =>
        s.objectives.some((o) => Math.hypot(o.x - (u.models[0]?.x ?? 0), o.y - (u.models[0]?.y ?? 0)) <= 3)
      );
      const target = enemyOnObj.length ? enemyOnObj[Math.floor(Math.random() * enemyOnObj.length)] : enemies[0];
      if (target) {
        const mw = Math.floor(Math.random() * 3) + 2; // 1D3+1
        applyMortalWounds(s, target, mw, 'Master of Ordnance Mortar');
        addTimed(s, target, { e: { hit: -1 }, label: 'Ordnance Suppressed (-1 to Hit)', until: 'turn', by: me });
        log(s, `💣 Master of Ordnance mortar bombards ${target.name} (${mw} MW, -1 to Hit)!`, 'info', me);
      }
    } else if (adv === 'ADV_APOTHECARY') {
      for (const u of s.units.filter((x) => x.owner === me && x.status !== 'destroyed')) {
        let healed = false;
        for (const m of u.models) {
          if (!m.dead && m.wounds < (m.profile?.W ?? m.wounds)) {
            m.wounds = Math.min(m.profile?.W ?? m.wounds, m.wounds + 2);
            healed = true;
          }
        }
        if (healed) log(s, `🩺 Chief Apothecary restores 2 Wounds to ${u.name}`, 'info', me);
      }
    } else if (adv === 'ADV_COMMISSAR') {
      for (const u of s.units.filter((x) => x.owner === me && x.status !== 'destroyed')) {
        if (u.battleShocked) {
          u.battleShocked = false;
          log(s, `⭐ Lord Commissar summarily restores morale of ${u.name} (Battle-shock cleared)!`, 'info', me);
        }
      }
    } else if (adv === 'ADV_TECHMARINE') {
      for (const u of s.units.filter((x) => x.owner === me && x.status !== 'destroyed' && (x.keywords.includes('VEHICLE') || x.keywords.includes('MONSTER')))) {
        if (!u.combatState) {
          u.combatState = {
            tokens: { auspex: 0, fervour: 0, bastion: 0 },
            maxTokenCaps: { auspex: 3, fervour: 3, bastion: 3 },
            ailments: { soulfire: 0, bleeding: 0, corroded: 0, pinned: 0 },
          };
        }
        u.combatState.warpWardHP = Math.max(u.combatState.warpWardHP ?? 0, 3);
        log(s, `🔧 Forge Master blesses ${u.name} with 3 HP Machine Shield!`, 'info', me);
      }
    }
  }
}

