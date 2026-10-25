// A campaign: a run of short battles across a branching map, roguelite style. The player starts with a small army of
// one faction and picks a road through the map: battles, elite enemies with a special rule, supply drops, armories,
// medicae tents, and a boss at the end.
import { addTimed } from '../rules-engine/effects';
import type { Effect } from '../rules-engine/effects';
import { canLeaderAttach, defaultWargear, pointsOptions, syncWargear } from './army';
import { AUX_EXCLUSIONS } from './autoList';
import type { ArmyList, ArmyUnitEntry, BotLevel, DatasheetData, FactionData, GameState, PlayerId, UnitState, WargearPick } from './types';
import { hasRealPortrait } from '../ui/portraits';

export type NodeKind = 'battle' | 'elite' | 'supply' | 'armory' | 'medicae' | 'boss';

export interface MapNode {
  id: string;
  layer: number;
  kind: NodeKind;
  /** 0..1 across the map */
  x: number;
  /** ids of the nodes in the next layer this one leads to */
  next: string[];
  /** the enemy, decided when the map is made (the same seed gives the same campaign) */
  enemy?: { factionId: string; pts: number; level: BotLevel; rules: string[]; seed: number };
}

export type RewardRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type Reward =
  | { kind: 'unit'; datasheet: string; models: number; pts: number; rarity?: RewardRarity; bonusLeader?: { datasheet: string; models: number; pts: number } }
  | { kind: 'relic'; id: string }
  | { kind: 'cp' }
  | { kind: 'scrap'; amount: number }
  | { kind: 'fate'; amount: number }
  | { kind: 'detachment'; name: string };

export interface BattleHonor {
  id: string;
  name: string;
  tier?: 'veteran' | 'heroic' | 'legendary';
  minXp?: number;
  role?: 'universal' | 'ranged' | 'melee' | 'tank';
  tag: string;
  desc: string;
  cost: number;
  e: Effect;
}

export const BATTLE_HONORS: BattleHonor[] = [
  // Veteran Honors (Tier 1 - Min XP: 0 Recruit+)
  { id: 'hardened', name: '+1 Toughness', tier: 'veteran', minXp: 0, role: 'tank', tag: '+1 TOUGHNESS', desc: '+1 Toughness characteristic.', cost: 60, e: { toughness: 1 } },
  { id: 'weapon_master', name: '+1 BS / WS', tier: 'veteran', minXp: 0, role: 'universal', tag: '+1 BS / WS', desc: 'Improve Ballistic Skill & Weapon Skill by 1.', cost: 75, e: { skill: 1 } },
  { id: 'swift', name: '+2" Move · +1 Adv/Chg', tier: 'veteran', minXp: 0, role: 'universal', tag: '+2" MOVE · +1 ADV/CHG', desc: '+2" Move, and +1 to Advance & Charge rolls.', cost: 50, e: { move: 2, advanceBonus: 1, chargeBonus: 1 } },
  { id: 'iron_will', name: 'FNP 6+ · Re-roll Shock', tier: 'veteran', minXp: 0, role: 'tank', tag: 'FNP 6+ · RE-ROLL SHOCK', desc: 'Models have Feel No Pain 6+, and re-roll Battle-shock tests.', cost: 70, e: { defend: { fnp: 6 }, rerollShock: true } },
  { id: 'reinforced_save', name: '+1 Save', tier: 'veteran', minXp: 0, role: 'tank', tag: '+1 SAVE', desc: 'Add 1 to saving throws against all attacks.', cost: 85, e: { defend: { save: 1 } } },
  { id: 'heroic_strike', name: '+1 Attack (Melee)', tier: 'veteran', minXp: 0, role: 'melee', tag: '+1 ATTACK (MELEE)', desc: '+1 Attack characteristic on melee weapons.', cost: 65, e: { attacks: 1, attack: 'melee' } },
  { id: 'range_finders', name: '+4" Range · Ignores Cover', tier: 'veteran', minXp: 0, role: 'ranged', tag: '+4" RNG · IGNORES COVER', desc: 'Ranged weapons gain +4" range and ignore cover.', cost: 60, e: { rangeBonus: 4, abilities: ['ignores cover'], attack: 'ranged' } },

  // Heroic Honors (Tier 2 - Min XP: 1 Blooded+)
  { id: 'master_crafted', name: '+1 AP (All Weapons)', tier: 'heroic', minXp: 1, role: 'universal', tag: '+1 AP', desc: 'Improve the AP of all attacks by 1.', cost: 90, e: { ap: 1 } },
  { id: 'lethal_spec', name: '[Lethal Hits] Ranged', tier: 'heroic', minXp: 1, role: 'ranged', tag: '[LETHAL HITS] RANGED', desc: 'Ranged attacks gain [LETHAL HITS].', cost: 100, e: { abilities: ['lethal hits'], attack: 'ranged' } },
  { id: 'sustained_fury', name: '[Sustained Hits 1] Melee', tier: 'heroic', minXp: 1, role: 'melee', tag: '[SUSTAINED HITS 1] MELEE', desc: 'Melee attacks gain [SUSTAINED HITS 1].', cost: 100, e: { abilities: ['sustained hits 1'], attack: 'melee' } },
  { id: 'heavy_salvo', name: '+1 Attack / Shot (Ranged)', tier: 'heroic', minXp: 1, role: 'ranged', tag: '+1 SHOT RANGED', desc: '+1 Attack characteristic on ranged weapons.', cost: 110, e: { attacks: 1, attack: 'ranged' } },
  { id: 'crushing_might', name: '+2 Strength · +1 Damage (Melee)', tier: 'heroic', minXp: 1, role: 'melee', tag: '+2 STR · +1 DMG MELEE', desc: '+2 Strength and +1 Damage on melee weapons.', cost: 115, e: { strength: 2, damage: 1, attack: 'melee' } },
  { id: 'invulnerable_aegis', name: '4+ Invulnerable Save', tier: 'heroic', minXp: 1, role: 'tank', tag: '4++ INVULN', desc: 'Models gain a 4+ invulnerable save.', cost: 110, e: { defend: { inv: 4 } } },

  // Legendary Honors (Tier 3 - Min XP: 2 Veteran+)
  { id: 'devastating_wrath', name: '[Devastating Wounds]', tier: 'legendary', minXp: 2, role: 'universal', tag: '[DEVASTATING WOUNDS]', desc: 'All attacks gain [DEVASTATING WOUNDS].', cost: 150, e: { abilities: ['devastating wounds'] } },
  { id: 'undying_resilience', name: 'FNP 5+ · +1 Toughness', tier: 'legendary', minXp: 2, role: 'tank', tag: 'FNP 5+ · +1 TOUGHNESS', desc: 'Models have Feel No Pain 5+ and +1 Toughness.', cost: 150, e: { defend: { fnp: 5 }, toughness: 1 } },
  { id: 'apex_predator', name: 'Fights First · +1 to Wound', tier: 'legendary', minXp: 2, role: 'melee', tag: 'FIGHTS FIRST · +1 TO WOUND', desc: 'Unit has Fights First, and +1 to all Wound rolls.', cost: 160, e: { fightsFirst: true, wound: 1 } },
  { id: 'retaliation_core', name: 'Spiteful Deflection', tier: 'legendary', minXp: 2, role: 'tank', tag: 'REFLECT MORTALS ON 6', desc: 'Each saving roll of 6 reflects 1 mortal wound back to the attacker.', cost: 140, e: { retaliate: { on: 6, max: 6 } } },
];

const LEGACY_HONOR_ALIASES: Record<string, string> = {
  'HARDENED ARMOR': 'hardened',
  'WEAPON MASTERS': 'weapon_master',
  'SWIFT ASSAULT': 'swift',
  'MASTER-CRAFTED WEAPONS': 'master_crafted',
  'IRON WILL': 'iron_will',
  'DEADLY MARKSMEN': 'lethal_spec',
  'SAVAGE FRENZY': 'sustained_fury',
  'REINFORCED CARAPACE': 'reinforced_save',
  'HEROIC MIGHT': 'heroic_strike',
  'ADVANCED TARGETERS': 'range_finders',
};

export const battleHonorById = (id: unknown) => {
  const key = typeof id === 'string' ? id : (id && typeof id === 'object' ? String((id as any).id || (id as any).name || '') : String(id ?? ''));
  const upper = key.toUpperCase();
  const aliasId = LEGACY_HONOR_ALIASES[upper];
  return BATTLE_HONORS.find((h) => h.id === key || (aliasId && h.id === aliasId) || h.id.toUpperCase() === upper || h.name.toUpperCase() === upper || h.tag.toUpperCase() === upper);
};

export function honorMinXp(h: BattleHonor): number {
  if (h.minXp !== undefined) return h.minXp;
  if (h.tier === 'legendary') return 2;
  if (h.tier === 'heroic') return 1;
  return 0;
}

export function honorRequiredRank(minXp: number): string {
  if (minXp >= 3) return 'Legendary';
  if (minXp >= 2) return 'Veteran';
  if (minXp >= 1) return 'Blooded';
  return 'Recruit';
}

export const rankLabel = (xp = 0): string => {
  if (xp >= 4) return 'Legendary';
  if (xp >= 3) return 'Heroic';
  if (xp >= 2) return 'Battle-hardened';
  if (xp >= 1) return 'Blooded';
  return 'Recruit';
};

export interface RankCombatBonus {
  rank: string;
  effect: Effect;
  discountPct: number;
}

export function rankCombatBonus(xp = 0): RankCombatBonus {
  const rank = rankLabel(xp);
  if (xp >= 4) {
    return {
      rank,
      effect: { ld: 1, oc: 1, reroll: 'hits1', attacks: 1, wound: 1, critHitOn: 5 },
      discountPct: 0.25,
    };
  }
  if (xp >= 3) {
    return {
      rank,
      effect: { ld: 1, oc: 1, reroll: 'hits1', attacks: 1, wound: 1 },
      discountPct: 0.15,
    };
  }
  if (xp >= 2) {
    return {
      rank,
      effect: { ld: 1, oc: 1, reroll: 'hits1' },
      discountPct: 0.10,
    };
  }
  if (xp >= 1) {
    return {
      rank,
      effect: { ld: 1, oc: 1 },
      discountPct: 0.05,
    };
  }
  return { rank, effect: {}, discountPct: 0 };
}

export function canBuyDatasheetHonor(
  run: Run,
  datasheetName: string,
  honor: BattleHonor,
  unitUid?: string
): { ok: boolean; reason?: string; neededXp: number; currentXp: number; neededScrap: number; canAfford: boolean; isXpLocked: boolean } {
  const minXp = honorMinXp(honor);
  const squads = run.list.units.filter((u) => u.datasheet === datasheetName);
  const targetUnit = unitUid ? squads.find((u) => u.uid === unitUid) : undefined;
  const currentXp = targetUnit ? (targetUnit.xp ?? 0) : Math.max(0, ...squads.map((u) => u.xp ?? 0));
  const squadCount = Math.max(1, squads.length);
  const cost = datasheetHonorCost(honor.cost, squadCount);
  const canAfford = (run.scrap ?? 0) >= cost;
  const isXpLocked = currentXp < minXp;

  if (isXpLocked) {
    const rank = honorRequiredRank(minXp);
    return {
      ok: false,
      reason: `Requires ${minXp} XP (${rank})`,
      neededXp: minXp,
      currentXp,
      neededScrap: cost,
      canAfford,
      isXpLocked: true,
    };
  }

  if (!canAfford) {
    return {
      ok: false,
      reason: `Need ${cost} Scrap (${cost - (run.scrap ?? 0)} more)`,
      neededXp: minXp,
      currentXp,
      neededScrap: cost,
      canAfford: false,
      isXpLocked: false,
    };
  }

  return {
    ok: true,
    neededXp: minXp,
    currentXp,
    neededScrap: cost,
    canAfford: true,
    isXpLocked: false,
  };
}

export interface Run {
  version: 1;
  loop?: number;
  sector?: number;
  seed: number;
  factionId: string;
  list: ArmyList;
  map: MapNode[];
  /** nodes cleared, in order (the last one is where the player stands) */
  path: string[];
  relics: string[];
  relicLevels?: Record<string, number>;
  /** extra CP at the start of every battle */
  cp: number;
  fate: number;
  /** Requisition and Scrap currency for armory purchases, upgrades and recruitment */
  scrap: number;
  /** Datasheet-wide upgrades: datasheet name -> array of honor ids */
  datasheetHonors?: Record<string, string[]>;
  /** Purchased tech tree nodes */
  techTree?: string[];
  /** Idle auto-battle toggle */
  autoBattle?: boolean;
  /** Idle speed multiplier (1x, 2x, 4x) */
  autoSpeed?: 1 | 2 | 4;
  /** the battle being fought */
  fighting?: string;
  /** rewards to pick one from */
  offer?: Reward[];
  picksLeft?: number;
  freeRerolls?: number;
  rerollCount?: number;
  /** History of recent opponent factions faced in the campaign */
  recentOpponentFactions?: string[];
  /** what happened, newest last */
  story: string[];
  over?: 'won' | 'lost';
  wins: number;
  started: number;
}

/** Relics: rules on the player's whole army (or on units with a keyword), for every battle of the run. */
export interface Relic { id: string; name: string; text: string; units?: string; e: Effect; rare?: boolean; factionId?: string }
export const RELICS: Relic[] = [
  { id: 'litany', name: 'Litany of Hate', text: 'BATTLELINE units re-roll Hit rolls of 1.', units: 'BATTLELINE', e: { reroll: 'hits1' } },
  { id: 'stimms', name: 'Combat Stimms', text: 'INFANTRY units have Feel No Pain 6+.', units: 'INFANTRY', e: { defend: { fnp: 6 } } },
  { id: 'plating', name: 'Blessed Plating', text: 'VEHICLE units add 1 to their armour saves.', units: 'VEHICLE', e: { defend: { save: 1 } } },
  { id: 'smoke', name: 'Smoke Launchers', text: 'Ranged attacks against your VEHICLE units subtract 1 from the Hit roll.', units: 'VEHICLE', e: { defend: { hit: -1, vs: 'ranged' } } },
  { id: 'blade', name: 'Master-crafted Blade', text: 'CHARACTER units: +1 Damage in melee.', units: 'CHARACTER', e: { damage: 1, attack: 'melee' } },
  { id: 'overdrive', name: 'Machine Spirit Overdrive', text: 'VEHICLE units: ranged attacks improve AP by 1.', units: 'VEHICLE', e: { ap: 1, attack: 'ranged' } },
  { id: 'sandals', name: 'Fleet of Foot', text: 'Every unit: +1" Move.', e: { move: 1 } },
  { id: 'banner', name: 'Ancient Banner', text: 'INFANTRY units: +1 Objective Control.', units: 'INFANTRY', e: { oc: 1 } },
  { id: 'ledger', name: 'Grudge Ledger', text: 'Every unit re-rolls Wound rolls of 1.', e: { reroll: 'wounds1' } },
  { id: 'barrels', name: 'Extended Barrels', text: 'Ranged weapons: +3" Range.', e: { rangeBonus: 3 } },
  { id: 'zeal', name: 'Zealous Fervour', text: 'Every unit can re-roll its Charge roll.', e: { rerollCharge: true } },
  { id: 'relentless', name: 'Relentless Advance', text: 'Every unit can re-roll its Advance roll.', e: { rerollAdvance: true } },
  { id: 'lethal', name: 'Venom-tipped Rounds', text: 'Ranged attacks have [LETHAL HITS].', e: { abilities: ['lethal hits'], attack: 'ranged' }, rare: true },
  { id: 'fury', name: 'Blessed Blades', text: 'Melee attacks have [SUSTAINED HITS 1].', e: { abilities: ['sustained hits 1'], attack: 'melee' }, rare: true },
  { id: 'iron', name: 'Iron Halo', text: 'CHARACTER units have a 4+ invulnerable save.', units: 'CHARACTER', e: { defend: { inv: 4 } }, rare: true },
  { id: 'cache', name: 'Command Cache', text: '+1 CP at the start of every battle.', e: {} },
  { id: 'auspex', name: 'Targeting Auspex', text: 'Ranged attacks ignore cover.', e: { abilities: ['ignores cover'], attack: 'ranged' } },
  { id: 'chains', name: 'Chain-blade Teeth', text: 'Melee attacks: +1 Strength.', e: { strength: 1, attack: 'melee' } },
  { id: 'hymn', name: 'Battle Hymn', text: 'Every unit re-rolls Battle-shock tests.', e: { rerollShock: true } },
  { id: 'servo', name: 'Servo-arm Repairs', text: 'VEHICLE units: incoming Damage −1.', units: 'VEHICLE', e: { defend: { damage: 1 } } },
  { id: 'jump', name: 'Overcharged Thrusters', text: 'Every unit: +1 to Advance and Charge rolls.', e: { advanceBonus: 1, chargeBonus: 1 } },
  { id: 'bulwark', name: 'Bulwark Doctrine', text: 'BATTLELINE units: attacks against them are −1 to Wound.', units: 'BATTLELINE', e: { defend: { wound: -1 } } },
  { id: 'veterans', name: 'Veteran Marksmen', text: 'Ranged attacks re-roll Hit rolls of 1.', e: { reroll: 'hits1', attack: 'ranged' } },
  { id: 'brutes', name: 'Brute Strength', text: 'MONSTER and WALKER units: +1 Attack in melee.', units: 'MONSTER|WALKER', e: { attacks: 1, attack: 'melee' } },
  { id: 'mantle', name: 'Hero\'s Mantle', text: 'CHARACTER units: +1 Toughness and Feel No Pain 5+.', units: 'CHARACTER', e: { toughness: 1, defend: { fnp: 5 } } },
  { id: 'rounds', name: 'Hellfire Rounds', text: 'Ranged attacks: +1 to Wound.', e: { wound: 1, attack: 'ranged' }, rare: true },
  { id: 'firstblow', name: 'Lightning Reflexes', text: 'CHARACTER units have Fights First.', units: 'CHARACTER', e: { fightsFirst: true }, rare: true },
  { id: 'reaper', name: 'Reaper\'s Edge', text: 'Melee attacks: +1 AP.', e: { ap: 1, attack: 'melee' }, rare: true },
  { id: 'shield', name: 'Storm Shield Drills', text: 'INFANTRY units have a 5+ invulnerable save.', units: 'INFANTRY', e: { defend: { inv: 5 } }, rare: true },
  { id: 'devastate', name: 'Executioner Shells', text: 'Ranged attacks have [DEVASTATING WOUNDS].', e: { abilities: ['devastating wounds'], attack: 'ranged' }, rare: true },
  { id: 'grip', name: 'Iron Grip', text: 'Every unit: +1 Objective Control.', e: { oc: 1 }, rare: true },
  // Additional expanded relics
  { id: 'void_shield', name: 'Void Shield Generator', text: 'VEHICLE and MONSTER units have a 4+ invulnerable save.', units: 'VEHICLE|MONSTER', e: { defend: { inv: 4 } }, rare: true },
  { id: 'digi_weapons', name: 'Digital Weapons', text: 'CHARACTER units: melee attacks score Critical Hits on an unmodified 5+.', units: 'CHARACTER', e: { critHitOn: 5, attack: 'melee' }, rare: true },
  { id: 'plasma_coils', name: 'Supercharged Coils', text: 'Ranged weapons: +1 Strength and +1 Damage.', e: { strength: 1, damage: 1, attack: 'ranged' }, rare: true },
  { id: 'teleport_beacon', name: 'Teleport Transponder', text: 'Every unit gains Deep Strike and Infiltrators.', e: { abilities: ['deep strike', 'infiltrators'] }, rare: true },
  { id: 'shock_assault', name: 'Shock Assault Doctrine', text: 'Melee weapons: +1 Attack and +1 Strength on turns you charge.', e: { attacks: 1, strength: 1, attack: 'melee' } },
  { id: 'adamantine_will', name: 'Adamantine Will', text: 'Every model has Feel No Pain 5+ against mortal wounds.', e: { defend: { fnp: 5, fnpVs: 'mortal' } } },
  // Unique Faction Relics
  { id: 'sm_indomitus', factionId: 'SM', name: 'Armor of the Indomitus', text: 'Space Marines: +1 Save and +1 Toughness.', units: 'INFANTRY', e: { defend: { save: 1 }, toughness: 1 }, rare: true },
  { id: 'tyr_synaptic_chitin', factionId: 'TYR', name: 'Synaptic Chitin Weave', text: 'Tyranids: Melee attacks have [LETHAL HITS] and [SUSTAINED HITS 1].', e: { abilities: ['lethal hits', 'sustained hits 1'], attack: 'melee' }, rare: true },
  { id: 'ork_cybork', factionId: 'ORK', name: 'Super-Cybork Body', text: 'Orks: Feel No Pain 5+ and +1 Attack in melee.', e: { defend: { fnp: 5 }, attacks: 1, attack: 'melee' }, rare: true },
  { id: 'am_kurov_aquila', factionId: 'AM', name: 'Kurov\'s Aquila', text: 'Astra Militarum: +2 CP at start of battle and orders apply army-wide.', e: {}, rare: true },
  { id: 'csm_liber', factionId: 'CSM', name: 'Liber Hereticus', text: 'Chaos Space Marines: Melee weapons have +1 AP and +1 Damage.', e: { ap: 1, damage: 1, attack: 'melee' }, rare: true },
  { id: 'gc_ambush_banner', factionId: 'GC', name: 'Icon of the Cult Unveiled', text: 'Genestealer Cults: Every unit gains Infiltrators, +2" Move, and +1 to Wound on Charge.', e: { move: 2, abilities: ['infiltrators'], wound: 1 }, rare: true },
  { id: 'nec_veil', factionId: 'NEC', name: 'Veil of Darkness', text: 'Necrons: INFANTRY units gain a 4+ invulnerable save.', units: 'INFANTRY', e: { defend: { inv: 4 } }, rare: true },
  { id: 'tau_puretide', factionId: 'TAU', name: 'Puretide Engram Chip', text: 'T\'au Empire: Ranged weapons have +1 to Hit, [IGNORES COVER] and +6" Range.', e: { hit: 1, rangeBonus: 6, abilities: ['ignores cover'], attack: 'ranged' }, rare: true },
  { id: 'ac_auramite', factionId: 'AC', name: 'Auramite Bastion', text: 'Adeptus Custodes: Incoming Damage reduced by 1 and 4+ Feel No Pain vs mortals.', e: { defend: { damage: 1, fnp: 4, fnpVs: 'mortal' } }, rare: true },
  { id: 'gk_nemesis_soul', factionId: 'GK', name: 'Soul-warding Glaives', text: 'Grey Knights: Melee attacks have [DEVASTATING WOUNDS] and +1 Damage.', e: { abilities: ['devastating wounds'], damage: 1, attack: 'melee' }, rare: true },
  { id: 'dru_crucible', factionId: 'DRU', name: 'Crucible of Agonies', text: 'Drukhari: Melee and ranged weapons gain [LETHAL HITS] and +1 AP.', e: { abilities: ['lethal hits'], ap: 1 }, rare: true },
  { id: 'ae_phoenix_gem', factionId: 'AE', name: 'Phoenix Gem of Asuryan', text: 'Aeldari: Re-roll Hit rolls of 1 and units gain a 4+ invulnerable save.', e: { reroll: 'hits1', defend: { inv: 4 } }, rare: true },
  { id: 'dg_plague_skull', factionId: 'DG', name: 'Plague Skull of Glothila', text: 'Death Guard: +1 Toughness, Feel No Pain 5+, and +1 to Wound.', e: { toughness: 1, defend: { fnp: 5 }, wound: 1 }, rare: true },
  { id: 'ts_athanaean', factionId: 'TS', name: 'Athenaean Sorcery Scrolls', text: 'Thousand Sons: Ranged attacks have [DEVASTATING WOUNDS] and +2 AP.', e: { abilities: ['devastating wounds'], ap: 2, attack: 'ranged' }, rare: true },
  { id: 'we_brazen_glaive', factionId: 'WE', name: 'Berzerker Glaive of Khorne', text: 'World Eaters: +2 Attacks and +2 Strength in melee, and Fights First.', e: { attacks: 2, strength: 2, fightsFirst: true, attack: 'melee' }, rare: true },
  { id: 'lov_crest', factionId: 'LoV', name: 'Ancestral Hearth Crest', text: 'Leagues of Votann: +1 Toughness, +1 to Wound, and +1 Save.', e: { toughness: 1, wound: 1, defend: { save: 1 } }, rare: true },
  { id: 'adm_autocaduceus', factionId: 'AdM', name: 'Autocaduceus of Arkhan Land', text: 'Adeptus Mechanicus: VEHICLES have 4+ invulnerable save and +1 to Hit.', e: { defend: { inv: 4 }, hit: 1, attack: 'ranged' }, rare: true },
  { id: 'cd_argath', factionId: 'CD', name: 'A\'rgath, King of Blades', text: 'Chaos Daemons: Melee attacks score Critical Hits on 5+ and have +1 Damage.', e: { critHitOn: 5, damage: 1, attack: 'melee' }, rare: true },
  { id: 'as_saint_lucius', factionId: 'AS', name: 'Book of Saint Lucius', text: 'Adepta Sororitas: Units have +1 OC, +1 to Hit, and 5+ invulnerable save.', e: { oc: 1, hit: 1, defend: { inv: 5 } }, rare: true },
  { id: 'aoi_rosette', factionId: 'AoI', name: 'Rosette of the Inquisitor Lord', text: 'Imperial Agents: +2 CP, and ranged attacks have [LETHAL HITS] and [IGNORES COVER].', e: { abilities: ['lethal hits', 'ignores cover'], attack: 'ranged' }, rare: true },
  { id: 'qi_sanctuary', factionId: 'QI', name: 'Sanctuary Ion Shield', text: 'Imperial Knights: 4+ invulnerable save in melee and ranged.', e: { defend: { inv: 4 } }, rare: true },
  { id: 'qt_warpsight', factionId: 'QT', name: 'Helm of Warpsight', text: 'Chaos Knights: Ranged attacks ignore cover, +1 to Hit, and +1 AP.', e: { abilities: ['ignores cover'], hit: 1, ap: 1, attack: 'ranged' }, rare: true },
  // Wild & Faction Synergies
  { id: 'wild_phase_shift', name: 'Phase-Shift Distortion Drives', text: 'Every unit moves through terrain and models freely, and +3" Move.', e: { mobile: true, moveThroughModels: true, move: 3 }, rare: true },
  { id: 'wild_chain_lightning', name: 'Arcing Lightning Munitions', text: 'Ranged attacks score Critical Hits on 5+, and each wound inflicts 1 mortal wound.', e: { critHitOn: 5, mortalPerWound: 1, attack: 'ranged' }, rare: true },
  { id: 'wild_kinetic_deflector', name: 'Reactive Kinetic Deflectors', text: 'Every unit adds 1 to saving throws, and reflects 1 mortal wound on save rolls of 6.', e: { defend: { save: 1 }, retaliate: { on: 6, max: 6 } }, rare: true },
  { id: 'wild_death_burst', name: 'Spiteful Plasma Overload Core', text: 'Friendly models destroyed within 6" detonate with Deadly Demise automatically.', e: { demiseSure: { range: 6 } }, rare: true },
  { id: 'nec_hypercrypt', factionId: 'NEC', name: 'Hypercrypt Reanimation Matrix', text: 'Necrons: Every unit gains Feel No Pain 5+, +1 Toughness, and re-rolls Battle-shock tests.', e: { defend: { fnp: 5 }, toughness: 1, rerollShock: true }, rare: true },
  { id: 'am_overlapping_vox', factionId: 'AM', name: 'Tactical Vox Relay Grid', text: 'Astra Militarum: Ranged weapons have [LETHAL HITS], +1 BS skill, and +2" Move.', e: { abilities: ['lethal hits'], skill: 1, move: 2, attack: 'ranged' }, rare: true },
  { id: 'sm_artificer_plasma', factionId: 'SM', name: 'Artificer Plasma & Reflective Ceramite', text: 'Space Marines: Ranged weapons gain +1 Damage and [SUSTAINED HITS 1], and 4+ invulnerable save.', e: { damage: 1, abilities: ['sustained hits 1'], defend: { inv: 4 }, attack: 'ranged' }, rare: true },
  { id: 'ork_endless_waaagh', factionId: 'ORK', name: 'Endless WAAAGH! Frenzy', text: 'Orks: Melee attacks have [SUSTAINED HITS 2], +2 Attacks, and units can re-roll Advance and Charge.', e: { abilities: ['sustained hits 2'], attacks: 2, rerollCharge: true, rerollAdvance: true, attack: 'melee' }, rare: true },
  { id: 'csm_spiteful_daemon', factionId: 'CSM', name: 'Spiteful Daemonic Fury', text: 'Chaos Space Marines: Melee weapons have Critical Hits on 5+, +1 AP, and each wound deals 1 mortal wound.', e: { critHitOn: 5, ap: 1, mortalPerWound: 1, attack: 'melee' }, rare: true },
  { id: 'tyr_hyper_evolution', factionId: 'TYR', name: 'Hyper-Evolution Feeding Tendrils', text: 'Tyranids: +2" Move, moves ignore terrain, and melee attacks have [LETHAL HITS].', e: { move: 2, mobile: true, abilities: ['lethal hits'], attack: 'melee' }, rare: true },
];
export const relicById = (id: unknown) => {
  const key = typeof id === 'string' ? id : (id && typeof id === 'object' ? String((id as any).id || (id as any).name || '') : String(id ?? ''));
  const upper = key.toUpperCase();
  return RELICS.find((r) => r.id === key || r.id.toUpperCase() === upper || r.name.toUpperCase() === upper);
};

export function relicLevel(run: Run, id: string): number {
  return run.relicLevels?.[id] ?? (run.relics.includes(id) ? 1 : 0);
}

export function scaleRelicEffect(e: Effect, lvl: number): Effect {
  if (lvl <= 1) return { ...e };
  const out: Effect = { ...e };
  if (out.move) out.move = out.move * lvl;
  if (out.damage) out.damage = out.damage * lvl;
  if (out.ap) out.ap = out.ap * lvl;
  if (out.rangeBonus) out.rangeBonus = out.rangeBonus * lvl;
  if (out.oc) out.oc = out.oc * lvl;
  if (out.strength) out.strength = out.strength * lvl;
  if (out.toughness) out.toughness = out.toughness * lvl;
  if (out.attacks) out.attacks = out.attacks * lvl;
  if (out.wound) out.wound = out.wound * lvl;
  if (out.advanceBonus) out.advanceBonus = out.advanceBonus * lvl;
  if (out.chargeBonus) out.chargeBonus = out.chargeBonus * lvl;
  if (out.reroll === 'hits1' && lvl >= 2) out.reroll = 'hits';
  if (out.reroll === 'wounds1' && lvl >= 2) out.reroll = 'wounds';
  if (out.defend) {
    out.defend = { ...out.defend };
    if (out.defend.save) out.defend.save = out.defend.save * lvl;
    if (out.defend.fnp) out.defend.fnp = Math.max(3, out.defend.fnp - (lvl - 1));
    if (out.defend.inv) out.defend.inv = Math.max(3, out.defend.inv - (lvl - 1));
    if (out.defend.damage) out.defend.damage = out.defend.damage * lvl;
    if (out.defend.hit) out.defend.hit = out.defend.hit * lvl;
    if (out.defend.wound) out.defend.wound = out.defend.wound * lvl;
  }
  if (out.abilities?.length) {
    out.abilities = out.abilities.map((a) => {
      if (a === 'sustained hits 1') return `sustained hits ${lvl}`;
      return a;
    });
  }
  return out;
}

export function relicDesc(r: Relic, lvl = 1): string {
  if (lvl <= 1) return r.text;
  let t = r.text;
  if (r.e.move) t = t.replace(/\+1" Move/, `+${lvl}" Move`);
  if (r.e.damage) t = t.replace(/\+1 Damage/, `+${lvl} Damage`);
  if (r.e.ap) t = t.replace(/by 1/, `by ${lvl}`).replace(/\+1 AP/, `+${lvl} AP`);
  if (r.e.rangeBonus) t = t.replace(/\+3" Range/, `+${3 * lvl}" Range`);
  if (r.e.oc) t = t.replace(/\+1 Objective Control/, `+${lvl} Objective Control`);
  if (r.e.strength) t = t.replace(/\+1 Strength/, `+${lvl} Strength`);
  if (r.e.toughness) t = t.replace(/\+1 Toughness/, `+${lvl} Toughness`);
  if (r.e.attacks) t = t.replace(/\+1 Attack/, `+${lvl} Attacks`);
  if (r.e.wound) t = t.replace(/\+1 to Wound/, `+${lvl} to Wound`);
  if (r.e.advanceBonus) t = t.replace(/\+1 to Advance/, `+${lvl} to Advance`);
  if (r.e.defend?.fnp) t = t.replace(/Feel No Pain 6\+/, `Feel No Pain ${Math.max(3, 7 - lvl)}+`).replace(/Feel No Pain 5\+/, `Feel No Pain ${Math.max(3, 6 - lvl)}+`);
  if (r.e.defend?.inv) t = t.replace(/4\+ invulnerable/, `${Math.max(3, 5 - lvl)}+ invulnerable`).replace(/5\+ invulnerable/, `${Math.max(3, 6 - lvl)}+ invulnerable`);
  if (r.e.defend?.save) t = t.replace(/add 1 to/, `add ${lvl} to`);
  if (r.e.reroll === 'hits1' && lvl >= 2) t = t.replace(/re-roll Hit rolls of 1/, 're-roll ALL Hit rolls');
  if (r.e.reroll === 'wounds1' && lvl >= 2) t = t.replace(/re-roll Wound rolls of 1/, 're-roll ALL Wound rolls');
  if (r.id === 'fury' && lvl >= 2) t = t.replace(/SUSTAINED HITS 1/, `SUSTAINED HITS ${lvl}`);
  if (r.id === 'cache' && lvl >= 2) t = t.replace(/\+1 CP/, `+${lvl} CP`);
  return t;
}

/** The enemy's special rules (elite battles have one, the boss two). */
export interface BossRule { id: string; name: string; text: string; units?: string; e: Effect }
export const BOSS_RULES: BossRule[] = [
  { id: 'iron-will', name: 'Iron Will', text: 'Every enemy unit has Feel No Pain 6+.', e: { defend: { fnp: 6 } } },
  { id: 'deadeye', name: 'Deadeye Veterans', text: 'Enemy units re-roll Hit rolls of 1.', e: { reroll: 'hits1' } },
  { id: 'warlord', name: 'Mighty Warlord', text: 'Enemy CHARACTER units: +1 Attack in melee, and Feel No Pain 5+.', units: 'CHARACTER', e: { attacks: 1, attack: 'melee', defend: { fnp: 5 } } },
  { id: 'numbers', name: 'Overwhelming Numbers', text: 'Enemy units: +1 Objective Control.', e: { oc: 1 } },
  { id: 'armour', name: 'Ceramite Armour', text: 'Enemy VEHICLE and MONSTER units: +1 Toughness.', units: 'VEHICLE|MONSTER', e: { toughness: 1 } },
  { id: 'savage', name: 'Savage Charge', text: 'Enemy units re-roll Charge rolls and Wound rolls of 1 in melee.', e: { rerollCharge: true, reroll: 'wounds1', attack: 'melee' } },
  { id: 'void-shields', name: 'Void Shields', text: 'Enemy units have a 5+ Invulnerable save.', e: { defend: { inv: 5 } } },
  { id: 'toxic-munitions', name: 'Toxic Munitions', text: 'Enemy ranged attacks have [LETHAL HITS].', e: { abilities: ['lethal hits'], attack: 'ranged' } },
  { id: 'relentless-foe', name: 'Relentless Assault', text: 'Enemy units can re-roll Advance and Charge rolls.', e: { rerollAdvance: true, rerollCharge: true } },
  { id: 'furious-swarms', name: 'Furious Swarm', text: 'Enemy units have [SUSTAINED HITS 1] on melee attacks.', e: { abilities: ['sustained hits 1'], attack: 'melee' } },
];
export const safeUpper = (val: unknown): string => {
  if (typeof val === 'string') return val.toUpperCase();
  if (val && typeof val === 'object') {
    const o = val as { name?: unknown; id?: unknown; keyword?: unknown; title?: unknown; value?: unknown };
    const str = o.name || o.id || o.keyword || o.title || o.value || '';
    return typeof str === 'string' ? str.toUpperCase() : String(str).toUpperCase();
  }
  return String(val ?? '').toUpperCase();
};

export const bossRuleById = (id: unknown) => {
  const key = typeof id === 'string' ? id : (id && typeof id === 'object' ? String((id as any).id || (id as any).name || '') : String(id ?? ''));
  const upper = key.toUpperCase();
  return BOSS_RULES.find((r) => r.id === key || r.id.toUpperCase() === upper || r.name.toUpperCase() === upper);
};

export function rng(seed: number) {
  let x = (seed >>> 0) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
const pickN = <T,>(xs: T[], n: number, r: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};

export const START_POINTS = 500;
const LAYERS = [2, 3, 3, 3, 3, 2, 1];
const LEVEL_BY_LAYER: BotLevel[] = ['normal', 'normal', 'hard', 'hard', 'hard', 'hard', 'hard'];

export const ALL_PLAYABLE_FACTIONS = [
  'AS', 'AC', 'AdM', 'AE', 'AM', 'CD', 'QT', 'CSM', 'DG', 'DRU',
  'EC', 'GC', 'GK', 'AoI', 'QI', 'LoV', 'NEC', 'ORK', 'SM', 'TAU',
  'TS', 'TYR', 'WE'
];

/** The map: seven layers, each node leading to one or two nodes of the next; the last is the boss. */
export function makeMap(seed: number, enemies: string[], loop = 1, recentOpponents: string[] = []): MapNode[] {
  const r = rng(seed * 7919 + 13 + loop * 101);
  const nodes: MapNode[] = [];
  const assignedFactions: string[] = [...recentOpponents];
  const validEnemies = enemies.length ? enemies : ALL_PLAYABLE_FACTIONS;
  LAYERS.forEach((n, layer) => {
    let specialCount = 0;
    for (let i = 0; i < n; i++) {
      const last = layer === LAYERS.length - 1;
      const kind: NodeKind = last ? 'boss' : layer === 0 ? 'battle'
        : (() => {
          const x = r();
          if (layer >= 2 && x < 0.28 && !nodes.some((m) => m.layer === layer && m.kind === 'elite')) return 'elite';
          if (x < 0.52 && specialCount === 0) {
            specialCount++;
            if (layer === 1 || layer === 3) return 'medicae';
            if (layer === 2 || layer === 4) return 'armory';
            return 'supply';
          }
          if (x < 0.68 && specialCount === 0) { specialCount++; return 'supply'; }
          return 'battle';
        })();
      const node: MapNode = { id: `n${layer}-${i}`, layer, kind, x: (i + 0.5) / n, next: [] };
      if (['battle', 'elite', 'boss'].includes(kind)) {
        // Continuous roguelike point scaling:
        // Sector 1: 500 pts at layer 0 -> 2,000 pts at the boss!
        // Sector 2 (Endless restart): Starts at 2,000+ pts at layer 0 -> 4,000 pts at the boss!
        // Subsequent sectors continue scaling upward seamlessly (2,000++ pts, never dropping back).
        const loopBase = loop === 1 ? 500 : 2000 + (loop - 2) * 1500;
        const layerPts = layer * (loop === 1 ? 200 : 250);
        const elitePts = kind === 'elite' ? (loop === 1 ? 200 : 250) : 0;
        const bossPts = kind === 'boss' ? (loop === 1 ? 300 : 500) : 0;
        const pts = Math.round((loopBase + layerPts + elitePts + bossPts) / 10) * 10;
        const extraRules = loop > 1 ? Math.min(3, loop) : 0;
        const rules = kind === 'elite' ? pickN(BOSS_RULES, 1 + extraRules, r).map((b) => b.id) : kind === 'boss' ? pickN(BOSS_RULES, 2 + extraRules, r).map((b) => b.id) : (loop > 1 && layer >= 2 ? pickN(BOSS_RULES, 1, r).map((b) => b.id) : []);
        const level: BotLevel = loop > 1 ? 'expert' : kind === 'boss' ? 'hard' : kind === 'elite' ? 'hard' : LEVEL_BY_LAYER[layer];
        const recentWindow = assignedFactions.slice(-5);
        let pool = validEnemies.filter((e) => !recentWindow.includes(e));
        if (!pool.length) pool = validEnemies;
        const picked = pool[Math.floor(r() * pool.length)];
        assignedFactions.push(picked);
        node.enemy = { factionId: picked, pts, level, rules, seed: Math.floor(r() * 1e9) };
      }
      nodes.push(node);
    }
  });
  // roads: each node to the nodes of the next layer near it across the map; every node reachable and with a way on
  for (let layer = 0; layer < LAYERS.length - 1; layer++) {
    const here = nodes.filter((n) => n.layer === layer), there = nodes.filter((n) => n.layer === layer + 1);
    for (const a of here) {
      a.next = there.filter((b) => Math.abs(a.x - b.x) <= 0.34).map((b) => b.id);
      if (!a.next.length) a.next = [there.reduce((p, b) => (Math.abs(a.x - b.x) < Math.abs(a.x - p.x) ? b : p)).id];
    }
    for (const b of there) {
      if (here.some((a) => a.next.includes(b.id))) continue;
      here.reduce((p, a) => (Math.abs(a.x - b.x) < Math.abs(p.x - b.x) ? a : p)).next.push(b.id);
    }
  }
  return nodes;
}

export function newRun(faction: FactionData, list: ArmyList, enemies: string[], seed = Date.now()): Run {
  const pool = enemies.length ? enemies : ALL_PLAYABLE_FACTIONS;
  const filtered = pool.filter((e) => e !== faction.id && e !== 'TL');
  return {
    version: 1, seed: seed >>> 0, factionId: faction.id, list, map: makeMap(seed >>> 0, filtered, 1, []),
    path: [], relics: [], relicLevels: {}, freeRerolls: 1, cp: 0, fate: 3, scrap: 120, story: [`${faction.name}: the campaign begins.`], wins: 0, started: Date.now(),
    recentOpponentFactions: [],
  };
}

/** Where the player can go next: the first layer at the start, else the roads from where they stand. */
export function reachable(run: Run): MapNode[] {
  if (run.over || run.offer) return [];
  const at = run.path.length ? run.map.find((n) => n.id === run.path[run.path.length - 1]) : null;
  return at ? run.map.filter((n) => at.next.includes(n.id)) : run.map.filter((n) => n.layer === 0);
}

const usableCache = new Map<string, DatasheetData[]>();
const usable = (f: FactionData, main?: string) => {
  const key = `${f.id}:${main ?? ''}`;
  const hit = usableCache.get(key);
  if (hit) return hit;
  const excl = AUX_EXCLUSIONS[f.id] ?? [];
  const res = f.datasheets.filter((d) => !d.ally && !excl.some((k) => (d.factionKeywords || []).includes(k)) && d.points[0]?.options?.length && !d.subfaction && d.models.length && d.weapons.length
    && !d.keywords.includes('FORTIFICATION') && !d.keywords.includes('AIRCRAFT') && !d.keywords.includes('EPIC HERO') && !d.transport && (!main || d.factionKeywords.includes(main))
    && hasRealPortrait(d.name));
  usableCache.set(key, res);
  return res;
};
export const cheapest = (d: DatasheetData) => [...d.points[0].options].sort((a, b) => a.pts - b.pts)[0];

export function unitRarity(d: DatasheetData): RewardRarity {
  const pts = cheapest(d)?.pts ?? 0;
  const kws = d.keywords || [];
  if (kws.includes('TITANIC') || pts >= 220) return 'legendary';
  if (kws.includes('VEHICLE') || kws.includes('MONSTER') || kws.includes('TERMINATOR') || kws.includes('GRAVIS') || pts >= 140) return 'epic';
  if (kws.includes('ELITE') || kws.includes('JUMP PACK') || kws.includes('MOUNTED') || kws.includes('WALKER') || pts >= 85) return 'rare';
  return 'common';
}

const mainKeyword = (f: FactionData) => {
  const count = new Map<string, number>();
  for (const d of f.datasheets.filter((d) => !d.ally)) for (const k of d.factionKeywords) count.set(k, (count.get(k) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** Three rewards to pick one from after a win (an elite/boss battle offers relics; a supply drop a mix). */
export function makeOffer(run: Run, faction: FactionData, kind: NodeKind, salt = 0): Reward[] {
  const r = rng(run.seed + run.path.length * 101 + salt * 7 + 3);
  const maxLvl = 3;
  // Allow duplicate relics up to level 3 so they can level up (Vampire Survivors style)
  // Filter relics to only generic relics or relics of this faction
  const eligibleRelics = RELICS.filter((x) => {
    if (x.factionId && x.factionId !== faction.id) return false;
    return (run.relicLevels?.[x.id] ?? (run.relics.includes(x.id) ? 1 : 0)) < maxLvl;
  });
  const count = (kind === 'boss' || kind === 'elite') ? 5 : 3;
  const factionRelics = eligibleRelics.filter((x) => x.factionId === faction.id);
  const relics = (rare: boolean) => {
    const pool = eligibleRelics.filter((x) => rare || !x.rare);
    const chosen = pickN(pool, count, r).map((x): Reward => ({ kind: 'relic', id: x.id }));
    if (factionRelics.length && !chosen.some((c) => c.kind === 'relic' && factionRelics.some((fr) => fr.id === c.id)) && r() < 0.75) {
      const fpick = factionRelics[Math.floor(r() * factionRelics.length)];
      if (chosen.length) chosen[0] = { kind: 'relic', id: fpick.id };
    }
    return chosen;
  };

  const depth = (run.loop ?? 1) * 3 + run.path.length;
  const rollRarity = (): RewardRarity => {
    const val = r();
    if (depth >= 8) {
      if (val < 0.25) return 'legendary';
      if (val < 0.65) return 'epic';
      if (val < 0.90) return 'rare';
      return 'common';
    }
    if (depth >= 4) {
      if (val < 0.12) return 'legendary';
      if (val < 0.38) return 'epic';
      if (val < 0.75) return 'rare';
      return 'common';
    }
    if (val < 0.05) return 'legendary';
    if (val < 0.20) return 'epic';
    if (val < 0.55) return 'rare';
    return 'common';
  };

  const units = (n: number, cap: number): Reward[] => {
    const available = usable(faction, mainKeyword(faction)).filter((d) => {
      const o = cheapest(d);
      return o.pts >= 40 && o.pts <= cap;
    });
    if (!available.length) return [];

    const chosen: Reward[] = [];
    for (let i = 0; i < n; i++) {
      const targetRarity = rollRarity();
      const byRarity = available.filter((d) => unitRarity(d) === targetRarity);
      const pool = byRarity.length ? byRarity : available;
      const d = pool[Math.floor(r() * pool.length)];
      const o = cheapest(d);
      const rarity = unitRarity(d);

      let bonusLeader: { datasheet: string; models: number; pts: number } | undefined;
      if (rarity === 'legendary') {
        const leaderCand = faction.datasheets.find((ld) =>
          !ld.keywords.includes('FORTIFICATION') &&
          !ld.keywords.includes('EPIC HERO') &&
          hasRealPortrait(ld.name) &&
          canLeaderAttach(ld, d)
        );
        if (leaderCand) {
          const lo = cheapest(leaderCand);
          bonusLeader = { datasheet: leaderCand.name, models: lo.models, pts: lo.pts };
        }
      }

      chosen.push({
        kind: 'unit',
        datasheet: d.name,
        models: o.models,
        pts: o.pts,
        rarity,
        ...(bonusLeader ? { bonusLeader } : {}),
      });
    }
    return chosen;
  };
  const unpickedDets = (faction.detachments ?? []).filter((d) => !(run.list.detachments ?? []).includes(d.name));
  const detReward: Reward | null = unpickedDets.length ? { kind: 'detachment', name: unpickedDets[Math.floor(r() * unpickedDets.length)].name } : null;

  if (kind === 'elite' || kind === 'boss') {
    const list = relics(true);
    if (kind === 'boss' && detReward && list.length > 0) list[list.length - 1] = detReward;
    return list;
  }
  const cap = 140 + run.path.length * 25;
  const scrapReward: Reward = { kind: 'scrap', amount: Math.round(25 + r() * 25) };
  if (kind === 'supply') return [...units(1, cap), ...relics(false).slice(0, 1), detReward && r() < 0.5 ? detReward : scrapReward];
  // a won battle: one new unit, one relic, or scrap/detachment
  const thirdReward = detReward && r() < 0.45 ? detReward : scrapReward;
  return [...units(1, cap), ...relics(false).slice(0, 1), thirdReward];
}

export function rerollOffer(run: Run, faction: FactionData): Run {
  const spinCost = 30;
  const free = (run.freeRerolls ?? 0) > 0;
  if (!free && (run.scrap ?? 0) < spinCost) return run;
  const scrap = free ? run.scrap : (run.scrap ?? 0) - spinCost;
  const freeRerolls = free ? (run.freeRerolls ?? 0) - 1 : 0;
  const salt = (run.rerollCount ?? 0) + 1;
  const at = run.path.length ? run.map.find((n) => n.id === run.path[run.path.length - 1]) : null;
  const kind = at?.kind ?? 'battle';
  const offer = makeOffer(run, faction, kind, salt);
  return {
    ...run,
    scrap,
    freeRerolls,
    rerollCount: salt,
    offer,
    story: [...run.story, free ? 'Spin used (Free)' : `Spin used (-${spinCost} Scrap)`],
  };
}

export function takeReward(run: Run, rw: Reward, faction: FactionData): Run {
  const next: Run = { ...run, story: [...run.story] };
  if (rw.kind === 'relic') {
    const curLvl = run.relicLevels?.[rw.id] ?? (run.relics.includes(rw.id) ? 1 : 0);
    const newLvl = curLvl + 1;
    next.relicLevels = { ...(run.relicLevels ?? {}), [rw.id]: newLvl };
    if (!run.relics.includes(rw.id)) next.relics = [...run.relics, rw.id];
    next.story.push(curLvl > 0 ? `Upgraded: ${relicById(rw.id)?.name} to Lv.${newLvl}` : `Relic: ${relicById(rw.id)?.name}`);
    if (rw.id === 'cache') next.cp += 1;
  }
  if (rw.kind === 'cp') { next.cp = run.cp + 1; next.story.push('+1 CP every battle'); }
  if (rw.kind === 'scrap') { next.scrap = (run.scrap ?? 0) + rw.amount; next.story.push(`Salvaged +${rw.amount} Scrap`); }
  if (rw.kind === 'fate') { next.fate = Math.min(3, run.fate + rw.amount); next.story.push(`Gained +${rw.amount} Fate`); }
  if (rw.kind === 'unit') {
    const d = faction.datasheets.find((x) => x.name === rw.datasheet);
    const uid = `c${run.path.length}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const e: ArmyUnitEntry = syncWargear(d, defaultWargear(d, { uid, datasheet: rw.datasheet, models: rw.models, pts: rw.pts }));
    let newUnits = [...run.list.units, e];
    if (rw.bonusLeader) {
      const ld = faction.datasheets.find((x) => x.name === rw.bonusLeader!.datasheet);
      const lUid = `l${run.path.length}${Math.floor(Math.random() * 1e6).toString(36)}`;
      const lEntry: ArmyUnitEntry = syncWargear(ld, defaultWargear(ld, {
        uid: lUid,
        datasheet: rw.bonusLeader.datasheet,
        models: rw.bonusLeader.models,
        pts: rw.bonusLeader.pts,
        attachTo: uid,
      }));
      newUnits = [...newUnits, lEntry];
      next.story.push(`Reinforcements: ${rw.datasheet} with attached Leader ${rw.bonusLeader.datasheet}`);
    } else {
      next.story.push(`Reinforcements: ${rw.datasheet}`);
    }
    next.list = { ...run.list, units: newUnits };
  }
  if (rw.kind === 'detachment') {
    const cur = run.list.detachments ?? [];
    if (!cur.includes(rw.name)) {
      next.list = { ...run.list, detachments: [...cur, rw.name] };
    }
    next.story.push(`Tactical Doctrine: Adopted ${rw.name}`);
  }

  // Handle multiple picks (e.g. boss battles allow 2 picks!)
  const left = (run.picksLeft ?? 1) - 1;
  if (left > 0 && run.offer && run.offer.length > 1) {
    next.picksLeft = left;
    next.offer = run.offer.filter((o) => o !== rw);
  } else {
    next.picksLeft = undefined;
    next.offer = undefined;
    const at = run.path.length ? run.map.find((n) => n.id === run.path[run.path.length - 1]) : null;
    if (at?.kind === 'boss') next.over = 'won';
  }
  return next;
}

/** Walk to a node: peaceful nodes resolve their choices, battles wait to be fought. */
export function enter(run: Run, nodeId: string, faction: FactionData): Run {
  const node = run.map.find((n) => n.id === nodeId)!;
  if (node.kind === 'supply') return { ...run, path: [...run.path, nodeId], offer: makeOffer(run, faction, 'supply'), story: [...run.story, 'Supply drop'] };
  if (node.kind === 'armory') return { ...run, path: [...run.path, nodeId], scrap: (run.scrap ?? 0) + 25, story: [...run.story, 'Munitorum Armory reached (+25 Scrap)'] };
  if (node.kind === 'medicae') return { ...run, path: [...run.path, nodeId], story: [...run.story, 'Medicae Field Camp reached'] };
  const enemyFaction = typeof node.enemy?.factionId === 'string' ? node.enemy.factionId : (node.enemy?.factionId as any)?.id;
  const recent = enemyFaction ? [...(run.recentOpponentFactions ?? []), enemyFaction].slice(-10) : run.recentOpponentFactions;
  return { ...run, fighting: nodeId, recentOpponentFactions: recent };
}

/** The battle's result: a win moves the player on and offers rewards, a loss costs a Fate point (a draw counts as a win). */
export function afterBattle(run: Run, winner: PlayerId | 'draw' | null, faction: FactionData, enemyName: string, battleScrap = 0): Run {
  if (!run.fighting) return run;
  const node = run.map.find((n) => n.id === run.fighting)!;
  if (winner === 1) {
    const fate = run.fate - 1;
    const salvage = Math.floor((battleScrap || 0) * 0.5);
    return {
      ...run,
      fighting: undefined,
      fate,
      scrap: (run.scrap ?? 0) + salvage,
      over: fate <= 0 ? 'lost' : undefined,
      story: [...run.story, `Defeated by ${enemyName}${salvage > 0 ? ` (+${salvage} Scrap salvaged)` : ''}${fate > 0 ? ` · ${fate} Fate left` : ''}`],
    };
  }
  const baseGain = node.kind === 'boss' ? 120 : node.kind === 'elite' ? 70 : 45;
  const scrapTechBonus = (run.techTree?.includes('imp_logistics') ? 30 : 0)
    + (run.techTree?.includes('chaos_tribute') ? 30 : 0)
    + (run.techTree?.includes('nec_salvage') ? 30 : 0)
    + (run.techTree?.includes('ork_scrappers') ? 40 : 0)
    + (run.techTree?.includes('tyr_biomass') ? 30 : 0)
    + (run.techTree?.includes('xenos_trade') ? 30 : 0);
  const scrapGain = baseGain + (battleScrap || 0) + scrapTechBonus;
  // Units that took part gain +1 XP
  const updatedUnits = run.list.units.map((u) => ({ ...u, xp: (u.xp ?? 0) + 1 }));
  const next: Run = {
    ...run,
    fighting: undefined,
    path: [...run.path, node.id],
    wins: run.wins + 1,
    scrap: (run.scrap ?? 0) + scrapGain,
    freeRerolls: 1,
    list: { ...run.list, units: updatedUnits },
    story: [...run.story, `${winner === 'draw' ? 'Held off' : 'Victory over'} ${enemyName} (+${scrapGain} Scrap${battleScrap > 0 ? `: ${baseGain} victory + ${battleScrap} battle loot` : ''}${scrapTechBonus > 0 ? ` + ${scrapTechBonus} Tech Bonus` : ''})${node.kind === 'boss' ? ' — the Warlord is vanquished!' : ''}`],
  };
  next.picksLeft = node.kind === 'boss' ? 2 : 1;
  next.offer = makeOffer(next, faction, node.kind);
  return next;
}

const hasKwIn = (u: UnitState, units?: string) => !units || units.split('|').some((k) => (u.keywords || []).some((kw) => safeUpper(kw) === safeUpper(k)));

/** Put the run's relics on the player's army and the enemy's special rules on theirs, for the whole battle. */
export function applyCampaign(s: GameState, run: Run, rules: (string | { id?: string; name?: string })[]) {
  const me: PlayerId = 0, foe: PlayerId = 1;
  // Set Roguelike Annihilation primary mission for both players
  for (const p of [me, foe]) {
    s.players[p].primaryId = 'roguelike-annihilation';
    s.players[p].disposition = 'purge-the-foe';
  }

  // Set Boss & Elite Annihilation flag (requires 100% total wipeout to win)
  if (run.fighting) {
    const node = run.map.find((n) => n.id === run.fighting);
    if (node && (node.kind === 'boss' || node.kind === 'elite')) {
      s.isBossAnnihilation = true;
    }
  }

  for (const rawId of run.relics) {
    const r = relicById(rawId);
    const id = r?.id ?? (typeof rawId === 'string' ? rawId : String((rawId as any)?.id || ''));
    if (!r || id === 'cache') continue;
    const lvl = run.relicLevels?.[id] ?? 1;
    const eff = scaleRelicEffect(r.e, lvl);
    for (const u of s.units.filter((x) => x.owner === me && hasKwIn(x, r.units))) {
      addTimed(s, u, { e: eff, label: lvl > 1 ? `${r.name} Lv.${lvl}` : r.name, until: 'battle', by: me });
    }
  }
  // Apply per-unit Battle Honors from run.list.units!
  for (const entry of run.list.units) {
    if (!entry.honors?.length) continue;
    const matching = s.units.filter((u) => u.owner === me && (u.id.includes(entry.uid) || u.name === entry.datasheet));
    for (const u of matching) {
      for (const hid of entry.honors) {
        const h = battleHonorById(hid);
        if (h) addTimed(s, u, { e: { ...h.e }, label: h.name, until: 'battle', by: me });
      }
    }
  }

  // Apply Functional XP Rank Combat Bonuses to each unit
  for (const entry of run.list.units) {
    const rkb = rankCombatBonus(entry.xp ?? 0);
    if (rkb.effect && Object.keys(rkb.effect).length > 0) {
      const matching = s.units.filter((u) => u.owner === me && (u.id.includes(entry.uid) || u.name === entry.datasheet));
      for (const u of matching) {
        addTimed(s, u, { e: { ...rkb.effect }, label: `Rank: ${rkb.rank}`, until: 'battle', by: me });
      }
    }
  }

  // Category 8: Attached Unit Battle Honor Sync (Shared Movement, FNP, Stealth)
  for (const entry of run.list.units) {
    const joiners = run.list.units.filter((x) => x.attachTo === entry.uid);
    if (!joiners.length) continue;
    const attachedGroup = [entry, ...joiners];
    const groupHonors = new Set<string>();
    for (const m of attachedGroup) {
      for (const hid of (m.honors ?? [])) groupHonors.add(hid);
      for (const hid of (run.datasheetHonors?.[m.datasheet] ?? [])) groupHonors.add(hid);
    }
    const matching = s.units.filter((u) => u.owner === me && attachedGroup.some((g) => u.id.includes(g.uid) || u.name.includes(g.datasheet)));
    for (const u of matching) {
      for (const hid of groupHonors) {
        const h = battleHonorById(hid);
        if (!h) continue;
        const isShared = h.id === 'swift' || h.id === 'iron_will' || h.id === 'undying_resilience' ||
          h.e.move !== undefined || h.e.defend?.fnp !== undefined || h.e.stealth || h.e.rerollAdvance || h.e.rerollCharge;
        if (isShared && !u.timed?.some((t) => t.label === h.name)) {
          addTimed(s, u, { e: { ...h.e }, label: `${h.name} (Sync)`, until: 'battle', by: me });
        }
      }
    }
  }

  // Apply datasheet-wide honors
  if (run.datasheetHonors) {
    for (const [dsName, hids] of Object.entries(run.datasheetHonors)) {
      const matching = s.units.filter((u) => u.owner === me && u.name === dsName);
      for (const u of matching) {
        for (const hid of hids) {
          const h = battleHonorById(hid);
          if (h) addTimed(s, u, { e: { ...h.e }, label: h.name, until: 'battle', by: me });
        }
      }
    }
  }

  // Apply Tech Tree perks
  if (run.techTree?.length) {
    const family = getFactionFamily(run.factionId);
    const techNodes = FACTION_TECH_TREES[family] ?? FACTION_TECH_TREES.XENOS;
    for (const techId of run.techTree) {
      const node = techNodes.find((n) => n.id === techId);
      if (!node) continue;
      if (node.effect && Object.keys(node.effect).length > 0) {
        for (const u of s.units.filter((x) => x.owner === me)) {
          addTimed(s, u, { e: { ...node.effect }, label: node.name, until: 'battle', by: me });
        }
      }
      if (techId === 'imp_tactics') {
        s.players[me].cp += 1;
      }
      if (techId === 'xenos_shadow') {
        for (const u of s.units.filter((x) => x.owner === foe)) {
          addTimed(s, u, { e: { hit: -1 }, label: 'Shadow in the Warp', until: 'battle', by: foe });
        }
      }
      if (techId === 'imp_orbital') {
        const foeUnits = s.units.filter((x) => x.owner === foe && (x.models?.length ?? 0) > 0);
        if (foeUnits.length > 0) {
          const target = foeUnits[0];
          if (target.models && target.models.length > 0) {
            target.models[0].wounds = Math.max(0, target.models[0].wounds - 4);
          }
        }
      }
    }
  }
  const cleanRules: string[] = [];
  for (const rawId of rules) {
    const b = bossRuleById(rawId);
    if (!b) continue;
    cleanRules.push(b.id);
    for (const u of s.units.filter((x) => x.owner === foe && hasKwIn(x, b.units))) {
      addTimed(s, u, { e: { ...b.e }, label: b.name, until: 'battle', by: foe });
    }
  }
  const cacheLvl = run.relicLevels?.['cache'] ?? (run.relics.includes('cache') ? 1 : 0);
  s.players[me].cp += run.cp + (cacheLvl > 1 ? cacheLvl - 1 : 0);
  s.campaign = { node: run.fighting ?? '', relics: [...run.relics.map((r: any) => typeof r === 'string' ? r : String(r?.id || r?.name || ''))], rules: cleanRules, relicLevels: { ...(run.relicLevels ?? {}) } };
}

/** Purchase a Battle Honor for a unit using Scrap */
export function buyHonorForUnit(run: Run, unitUid: string, honorId: string): Run {
  const honor = battleHonorById(honorId);
  if (!honor || (run.scrap ?? 0) < honor.cost) return run;
  const units = run.list.units.map((u) => {
    if (u.uid !== unitUid) return u;
    const honors = [...(u.honors ?? []), honorId];
    return { ...u, honors };
  });
  return {
    ...run,
    scrap: (run.scrap ?? 0) - honor.cost,
    list: { ...run.list, units },
    story: [...run.story, `Battle Honor: ${honor.name} granted`],
  };
}

/** Calculate the Scrap cost of an Enhancement (points * 3, minimum 40), scaling +50% compounding per existing slot */
export const enhancementScrapCost = (pts: number, slotIndex = 0) => {
  const base = Math.max(40, pts * 3);
  return Math.round(base * Math.pow(1.5, Math.max(0, slotIndex)));
};

/** Check whether a character can purchase a specific detachment enhancement (blocks duplicates on the same model) */
export function canBuyEnhancementForUnit(
  run: Run,
  faction: FactionData,
  unitUid: string,
  enhancementName: string
): boolean {
  const u = run.list.units.find((x) => x.uid === unitUid);
  if (!u) return false;
  const existingEnhancements = (u.enhancements && u.enhancements.length > 0)
    ? u.enhancements
    : (u.enhancement ? [{ name: u.enhancement, pts: u.enhancementPts ?? 0 }] : []);
  if (existingEnhancements.some((e) => e.name === enhancementName)) return false;
  return true;
}

/** Purchase and equip a detachment enhancement on a character in the campaign roster using Scrap (repeatable & stackable) */
export function buyEnhancementForUnit(
  run: Run,
  faction: FactionData,
  unitUid: string,
  enhancementName: string,
  pts: number
): Run {
  const u = run.list.units.find((x) => x.uid === unitUid);
  if (!u) return run;

  const existingEnhancements = (u.enhancements && u.enhancements.length > 0)
    ? u.enhancements
    : (u.enhancement ? [{ name: u.enhancement, pts: u.enhancementPts ?? 0 }] : []);

  // Category 1: Cannot buy the exact same enhancement on the same model!
  if (existingEnhancements.some((e) => e.name === enhancementName)) return run;

  const slotIndex = existingEnhancements.length;
  const cost = enhancementScrapCost(pts, slotIndex);
  if ((run.scrap ?? 0) < cost) return run;

  const nextEnhancements = [...existingEnhancements, { name: enhancementName, pts }];
  const units = run.list.units.map((x) => (x.uid === unitUid ? {
    ...x,
    enhancement: nextEnhancements[0].name,
    enhancementPts: nextEnhancements.reduce((s, e) => s + e.pts, 0),
    enhancements: nextEnhancements,
  } : x));

  return {
    ...run,
    scrap: (run.scrap ?? 0) - cost,
    list: { ...run.list, units },
    story: [...run.story, `Armory: Equipped ${enhancementName} (Slot ${slotIndex + 1}) on ${u.datasheet} (-${cost} Scrap)`],
  };
}

/** Remove an equipped detachment enhancement and refund its Scrap */
export function removeEnhancementFromUnit(
  run: Run,
  unitUid: string,
  enhIndex?: number
): Run {
  const u = run.list.units.find((x) => x.uid === unitUid);
  const existingEnhancements = (u?.enhancements && u.enhancements.length > 0)
    ? u.enhancements
    : (u?.enhancement ? [{ name: u.enhancement, pts: u.enhancementPts ?? 0 }] : []);
  if (!u || !existingEnhancements.length) return run;

  const idx = enhIndex !== undefined && enhIndex >= 0 && enhIndex < existingEnhancements.length
    ? enhIndex
    : existingEnhancements.length - 1;
  const removed = existingEnhancements[idx];
  const refundSlot = existingEnhancements.length - 1;
  const refund = enhancementScrapCost(removed.pts, refundSlot);

  const nextEnhancements = existingEnhancements.filter((_, i) => i !== idx);
  const units = run.list.units.map((x) => (x.uid === unitUid ? {
    ...x,
    enhancement: nextEnhancements[0]?.name,
    enhancementPts: nextEnhancements.length ? nextEnhancements.reduce((s, e) => s + e.pts, 0) : undefined,
    enhancements: nextEnhancements.length ? nextEnhancements : undefined,
  } : x));

  return {
    ...run,
    scrap: (run.scrap ?? 0) + refund,
    list: { ...run.list, units },
    story: [...run.story, `Armory: Unequipped ${removed.name} from ${u.datasheet} (+${refund} Scrap refunded)`],
  };
}

/** Calculate escalating duplicate recruitment scrap cost */
export function recruitScrapCost(run: Run, datasheetName: string, basePts: number): number {
  const count = run.list.units.filter((u) => u.datasheet === datasheetName).length;
  if (count <= 1) return basePts;
  if (count === 2) return Math.round(basePts * 1.5);
  if (count === 3) return Math.round(basePts * 2.0);
  return Math.round(basePts * 3.0);
}

/** Buy and recruit a new unit into the campaign roster using Scrap */
export function recruitUnit(run: Run, faction: FactionData, datasheetName: string, chosenModels?: number): Run {
  const excl = AUX_EXCLUSIONS[faction.id] ?? [];
  const family = getFactionFamily(faction.id);
  const isAllowedAlly = (x: DatasheetData) =>
    !x.ally ||
    (family === 'IMPERIUM' && (x.ally === 'QI' || x.ally === 'TL')) ||
    (family === 'CHAOS' && (x.ally === 'QT' || x.ally === 'CD'));
  const d = faction.datasheets.find((x) => x.name === datasheetName && isAllowedAlly(x) && !excl.some((k) => (x.factionKeywords || []).includes(k)));
  if (!d) return run;
  if (!hasRealPortrait(d.name)) return run;
  if (!canRecruitTitanOrKnight(faction.id, d, run)) return run;
  if ((d.keywords || []).includes('EPIC HERO') && run.list.units.some((x) => x.datasheet === d.name)) return run;
  const opts = pointsOptions(d);
  const o = (chosenModels ? opts.find((x) => x.models === chosenModels) : undefined) ?? cheapest(d);
  if (!o) return run;
  const cost = recruitScrapCost(run, d.name, o.pts);
  if ((run.scrap ?? 0) < cost) return run;
  const uid = `c${run.path.length}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const existingHonors = run.datasheetHonors?.[d.name] ?? [];
  const e: ArmyUnitEntry = syncWargear(d, defaultWargear(d, {
    uid,
    datasheet: d.name,
    models: o.models,
    pts: o.pts,
    honors: existingHonors.length ? [...existingHonors] : undefined,
  }));
  return {
    ...run,
    scrap: (run.scrap ?? 0) - cost,
    list: { ...run.list, units: [...run.list.units, e] },
    story: [...run.story, `Recruited: ${d.name} (${o.models} models, -${cost} Scrap)`],
  };
}

/** Sell / disband a unit from the campaign roster. Returns 75% of total pts as scrap. Cannot sell the last unit. */
export function sellUnit(run: Run, unitUid: string): Run {
  const u = run.list.units.find((x) => x.uid === unitUid);
  if (!u) return run;
  // prevent selling the last unit
  const topLevel = run.list.units.filter((x) => !x.attachTo);
  if (topLevel.length <= 1 && !u.attachTo) return run;

  const totalPts = u.pts + (u.wargearPts ?? 0) + (u.enhancementPts ?? 0);
  const refund = Math.floor(totalPts * 0.75);

  // detach any units attached to this one
  let units = run.list.units.filter((x) => x.uid !== unitUid);
  units = units.map((x) => (x.attachTo === unitUid ? { ...x, attachTo: undefined } : x));

  // auto-transfer warlord
  if (u.warlord && units.length > 0) {
    const chars = units.filter((x) => !x.attachTo);
    if (chars.length > 0) units = units.map((x, i) => (x.uid === chars[0].uid ? { ...x, warlord: true } : x));
  }

  return {
    ...run,
    scrap: (run.scrap ?? 0) + refund,
    list: { ...run.list, units },
    story: [...run.story, `Sold: ${u.datasheet} (+${refund} Scrap)`],
  };
}

/** Calculate the scrap refund value for selling a unit (75% of total pts). */
export function sellValue(u: { pts: number; wargearPts?: number; enhancementPts?: number; enhancements?: { pts: number }[] }): number {
  const enhPts = (u.enhancements && u.enhancements.length > 0)
    ? u.enhancements.reduce((s, x) => s + x.pts, 0)
    : (u.enhancementPts ?? 0);
  return Math.floor((u.pts + (u.wargearPts ?? 0) + enhPts) * 0.75);
}

/** Change the model count / squad size of a unit in the campaign roster */
export function changeSquadSize(run: Run, faction: FactionData, unitUid: string, targetModels: number): Run {
  const u = run.list.units.find((x) => x.uid === unitUid);
  if (!u) return run;
  const d = faction.datasheets.find((x) => x.name === u.datasheet);
  if (!d) return run;
  const opts = pointsOptions(d);
  const targetOpt = opts.find((o) => o.models === targetModels);
  if (!targetOpt || targetOpt.models === u.models) return run;

  const currentOpt = opts.find((o) => o.models === u.models) ?? { pts: u.pts };
  const scrapDiff = targetOpt.pts - currentOpt.pts;
  if (scrapDiff > 0 && (run.scrap ?? 0) < scrapDiff) return run;

  const untouched = JSON.stringify(u.wargear ?? []) === JSON.stringify(defaultWargear(d, { ...u, wargear: undefined }).wargear ?? []);
  const updatedUnit: ArmyUnitEntry = syncWargear(d, untouched
    ? defaultWargear(d, { ...u, models: targetOpt.models, pts: targetOpt.pts, wargear: undefined })
    : { ...u, models: targetOpt.models, pts: targetOpt.pts });

  const units = run.list.units.map((x) => (x.uid === unitUid ? updatedUnit : x));
  const scrap = scrapDiff > 0 ? (run.scrap ?? 0) - scrapDiff : (run.scrap ?? 0);
  const story = [...run.story, scrapDiff > 0
    ? `Reinforced ${u.datasheet} to ${targetOpt.models} models (-${scrapDiff} Scrap)`
    : `Reorganized ${u.datasheet} to ${targetOpt.models} models`];

  return {
    ...run,
    scrap,
    list: { ...run.list, units },
    story,
  };
}

/** Combine / merge two squads of the same datasheet in the campaign roster */
export function combineSquads(run: Run, faction: FactionData, targetUid: string, sourceUid: string): Run {
  if (targetUid === sourceUid) return run;
  const target = run.list.units.find((x) => x.uid === targetUid);
  const source = run.list.units.find((x) => x.uid === sourceUid);
  if (!target || !source || target.datasheet !== source.datasheet) return run;

  const d = faction.datasheets.find((x) => x.name === target.datasheet);
  if (!d) return run;

  const opts = pointsOptions(d);
  const combinedModels = target.models + source.models;
  const matchedOpt = opts.find((o) => o.models === combinedModels)
    ?? opts.filter((o) => o.models <= combinedModels).sort((a, b) => b.models - a.models)[0]
    ?? opts[opts.length - 1];

  if (!matchedOpt) return run;

  const combinedXp = (target.xp ?? 0) + (source.xp ?? 0);
  const combinedHonors = [...new Set([...(target.honors ?? []), ...(source.honors ?? [])])];

  const combinedEntry: ArmyUnitEntry = syncWargear(d, defaultWargear(d, {
    ...target,
    models: matchedOpt.models,
    pts: matchedOpt.pts,
    xp: combinedXp,
    honors: combinedHonors,
    wargear: undefined,
  }));

  const units = run.list.units
    .filter((x) => x.uid !== sourceUid)
    .map((x) => {
      if (x.uid === targetUid) return combinedEntry;
      if (x.attachTo === sourceUid) return { ...x, attachTo: targetUid };
      return x;
    });

  return {
    ...run,
    list: { ...run.list, units },
    story: [...run.story, `Combined squads: ${target.datasheet} merged into ${matchedOpt.models}-model squad`],
  };
}

/** Retire / dismiss a unit from the campaign roster */
export function dismissUnit(run: Run, unitUid: string): Run {
  if (run.list.units.length <= 1) return run;
  const target = run.list.units.find((u) => u.uid === unitUid);
  const units = run.list.units
    .filter((u) => u.uid !== unitUid)
    .map((u) => (u.attachTo === unitUid ? { ...u, attachTo: undefined } : u));
  return {
    ...run,
    list: { ...run.list, units },
    story: [...run.story, `Retired: ${target?.datasheet ?? 'Unit'}`],
  };
}

/** Modify wargear picks for a unit in the campaign roster */
export function updateRosterWargear(run: Run, faction: FactionData, unitUid: string, wargear: WargearPick[]): Run {
  const units = run.list.units.map((u) => {
    if (u.uid !== unitUid) return u;
    const d = faction.datasheets.find((x) => x.name === u.datasheet);
    const updated = { ...u, wargear };
    return d ? syncWargear(d, updated) : updated;
  });
  return { ...run, list: { ...run.list, units } };
}

/** Use Medicae Tent services */
export function applyMedicaeService(run: Run, service: 'fate' | 'cp'): Run {
  if (service === 'fate') {
    if (run.fate >= 3 || (run.scrap ?? 0) < 60) return run;
    return { ...run, fate: run.fate + 1, scrap: (run.scrap ?? 0) - 60, story: [...run.story, 'Medicae: Restored 1 Fate'] };
  } else {
    if ((run.scrap ?? 0) < 45) return run;
    return { ...run, cp: run.cp + 1, scrap: (run.scrap ?? 0) - 45, story: [...run.story, 'Field Briefing: +1 CP each battle'] };
  }
}

const DETACHMENT_PREMIER = new Set([
  'Gladius Strike Force', 'Ironstorm Spearhead', 'War Horde', 'Awakened Dynasty',
  'Invasion Fleet', 'Slaves to Darkness', 'Kauyon', 'Mont\'ka', 'Cult of Strife',
  'Hallowed Martyrs', 'Host of the Brass Stampede', 'Pactbound Zealots', 'Synaptic Nexus'
]);
const DETACHMENT_STANDARD = new Set([
  '1st Company Task Force', 'Firestorm Assault Force', 'Green Tide',
  'Obeisance Phalanx', 'Assimilation Brood', 'Deceptors', 'Nob Mob'
]);

export function detachmentScrapCost(name: string): number {
  if (DETACHMENT_PREMIER.has(name)) return 140;
  if (DETACHMENT_STANDARD.has(name)) return 60;
  return 90;
}

/** Requisition / adopt a new detachment into the campaign army using Scrap */
export function adoptDetachment(run: Run, detachmentName: string, cost = detachmentScrapCost(detachmentName)): Run {
  if ((run.scrap ?? 0) < cost) return run;
  const cur = run.list.detachments ?? [];
  if (cur.includes(detachmentName)) return run;
  return {
    ...run,
    scrap: (run.scrap ?? 0) - cost,
    list: { ...run.list, detachments: [...cur, detachmentName] },
    story: [...run.story, `Armory Requisition: Adopted ${detachmentName} (-${cost} Scrap)`],
  };
}

/** Continue a won campaign run into the next sector with harder enemies (Endless Rogue Mode) */
export function continueNextLoop(run: Run, faction: FactionData): Run {
  const nextLoop = (run.loop ?? 1) + 1;
  const newSeed = Math.floor(Math.random() * 1e9);
  const nextEnemies = ALL_PLAYABLE_FACTIONS.filter((id) => id !== faction.id && id !== 'TL');
  const newMap = makeMap(newSeed, nextEnemies, nextLoop, run.recentOpponentFactions ?? []);
  const isEndless = nextLoop > 5;
  const sectorTitle = isEndless ? `Sector ${nextLoop} (Endless Crusade Mode)` : `Sector ${nextLoop} of 5`;
  return {
    ...run,
    loop: nextLoop,
    sector: nextLoop,
    seed: newSeed,
    map: newMap,
    path: [],
    fighting: undefined,
    offer: undefined,
    picksLeft: undefined,
    over: undefined,
    fate: Math.min(5, (run.fate ?? 0) + 2),
    scrap: (run.scrap ?? 0) + 120,
    story: [...run.story, `Entered ${sectorTitle}! Enemy forces reinforced. (+120 Scrap, +2 Fate)`],
  };
}

// ---------- Smart Upgrade Filter & Datasheet-Wide Upgrade Logic ----------

/** Filter battle honors intelligently to prevent redundant or incompatible choices */
export function getSmartBattleHonors(d: DatasheetData, currentHonors: string[] = []): BattleHonor[] {
  const minSave = Math.min(...d.models.map((m) => m.Sv ?? 6));
  const bestInvuln = Math.min(...d.models.map((m) => m.InSv ?? 99));
  const hasBuiltIn4Invuln = bestInvuln <= 4 || (d.abilities || []).some((a) => /4\+\s*invulnerable/i.test(a.text || ''));

  const hasRanged = (d.weapons || []).some((w) => w.profiles.some((p) => p.range !== 'Melee' && p.range !== null && (typeof p.range === 'number' ? p.range > 0 : true)));
  const hasMelee = (d.weapons || []).some((w) => w.profiles.some((p) => p.range === 'Melee'));

  const weaponAbilities = new Set((d.weapons || []).flatMap((w) => w.profiles.flatMap((p) => p.abilities || [])).map((k) => k.toLowerCase()));

  return BATTLE_HONORS.filter((h) => {
    // Cannot buy duplicate of already chosen honor
    if (currentHonors.includes(h.id)) return false;

    // Smart Save & Invuln filters
    if ((h.id === 'invulnerable_aegis' || h.e.defend?.inv === 4) && hasBuiltIn4Invuln) return false;
    if (h.id === 'reinforced_save' && minSave <= 2) return false;

    // Pure melee units cannot receive ranged buffs
    if (h.role === 'ranged' && !hasRanged) return false;
    // Pure ranged units cannot receive melee buffs
    if (h.role === 'melee' && !hasMelee) return false;

    // Duplicate weapon abilities filter
    if (h.e.abilities) {
      if (h.e.abilities.includes('lethal hits') && weaponAbilities.has('lethal hits')) return false;
      if (h.e.abilities.includes('sustained hits 1') && (weaponAbilities.has('sustained hits 1') || weaponAbilities.has('sustained hits 2'))) return false;
      if (h.e.abilities.includes('devastating wounds') && weaponAbilities.has('devastating wounds')) return false;
      if (h.e.abilities.includes('ignores cover') && weaponAbilities.has('ignores cover')) return false;
    }

    return true;
  });
}

/** Calculate datasheet upgrade scrap cost scaled by squad count */
export function datasheetHonorCost(baseCost: number, squadCount: number): number {
  return baseCost + Math.max(0, squadCount - 1) * Math.round(baseCost * 0.4);
}

/** Purchase a Battle Honor for all squads of a given datasheet type across the army */
export function buyDatasheetHonor(run: Run, faction: FactionData, datasheetName: string, honorId: string, unitUid?: string): Run {
  const honor = battleHonorById(honorId);
  if (!honor) return run;

  const check = canBuyDatasheetHonor(run, datasheetName, honor, unitUid);
  if (!check.ok) return run;

  const squads = run.list.units.filter((u) => u.datasheet === datasheetName);
  const squadCount = Math.max(1, squads.length);
  const cost = datasheetHonorCost(honor.cost, squadCount);

  const currentHonors = run.datasheetHonors?.[datasheetName] ?? [];
  if (currentHonors.includes(honorId)) return run;

  const nextDatasheetHonors = {
    ...(run.datasheetHonors ?? {}),
    [datasheetName]: [...currentHonors, honorId],
  };

  const updatedUnits = run.list.units.map((u) => {
    if (u.datasheet !== datasheetName) return u;
    const existing = u.honors ?? [];
    return { ...u, honors: [...new Set([...existing, honorId])] };
  });

  return {
    ...run,
    scrap: (run.scrap ?? 0) - cost,
    datasheetHonors: nextDatasheetHonors,
    list: { ...run.list, units: updatedUnits },
    story: [...run.story, `Datasheet Upgrade: ${datasheetName} (x${squadCount}) received ${honor.name} (-${cost} Scrap)`],
  };
}

/** Automatically upgrade all squads in the army in one click using available Scrap */
export function autoUpgradeAll(run: Run, faction: FactionData): Run {
  let cur = run;
  const distinctDatasheets = [...new Set(cur.list.units.map((u) => u.datasheet))];
  let upgradedAny = false;

  let iterations = 0;
  while (iterations < 10) {
    iterations++;
    let boughtInPass = false;
    for (const dname of distinctDatasheets) {
      const d = faction.datasheets.find((x) => x.name === dname);
      if (!d) continue;
      const curHonors = cur.datasheetHonors?.[dname] ?? [];
      const eligible = getSmartBattleHonors(d, curHonors);
      if (!eligible.length) continue;

      const affordable = eligible.filter((h) => canBuyDatasheetHonor(cur, dname, h).ok);
      if (!affordable.length) continue;

      const hasRanged = (d.weapons || []).some((w) => w.profiles.some((p) => p.range !== 'Melee' && p.range !== null));
      const hasMelee = (d.weapons || []).some((w) => w.profiles.some((p) => p.range === 'Melee'));
      let pick = affordable[0];
      if (hasRanged && !hasMelee) {
        pick = affordable.find((h) => h.role === 'ranged') || pick;
      } else if (hasMelee && !hasRanged) {
        pick = affordable.find((h) => h.role === 'melee') || pick;
      }

      cur = buyDatasheetHonor(cur, faction, dname, pick.id);
      boughtInPass = true;
      upgradedAny = true;
    }
    if (!boughtInPass) break;
  }

  if (upgradedAny) {
    cur.story = [...cur.story, `[AUTO-UPGRADE ALL] Completed automated squad upgrades.`];
  }
  return cur;
}

// ---------- Command Tech Tree & Faction Lock System ----------

export interface TechNode {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  family: 'IMPERIUM' | 'CHAOS' | 'NECRONS' | 'ORKS' | 'TYRANIDS' | 'XENOS';
  tag: string;
  desc: string;
  cost: number;
  effect: Effect;
  req?: string;
}

export function getFactionFamily(factionId: string): 'IMPERIUM' | 'CHAOS' | 'NECRONS' | 'ORKS' | 'TYRANIDS' | 'XENOS' {
  if (['SM', 'AM', 'AdM', 'AS', 'AC', 'GK', 'AoI', 'QI'].includes(factionId)) return 'IMPERIUM';
  if (['CSM', 'DG', 'TS', 'WE', 'CD', 'QT'].includes(factionId)) return 'CHAOS';
  if (factionId === 'NEC') return 'NECRONS';
  if (factionId === 'ORK') return 'ORKS';
  if (factionId === 'TYR') return 'TYRANIDS';
  return 'XENOS';
}

export const FACTION_TECH_TREES: Record<string, TechNode[]> = {
  IMPERIUM: [
    { id: 'imp_orbital', name: 'Orbital Bombardment', tier: 1, family: 'IMPERIUM', tag: 'ORBITAL STRIKE', desc: 'At battle round 1 start, rain fire dealing mortal wounds to enemy units.', cost: 80, effect: {} },
    { id: 'imp_logistics', name: 'Munitorum Supply Lines', tier: 1, family: 'IMPERIUM', tag: 'SCRAP HARVEST +30', desc: 'Munitorum tithes grant +30 Scrap salvaged after every battle.', cost: 70, effect: {} },
    { id: 'imp_shield', name: 'Emperor\'s Aegis', tier: 2, family: 'IMPERIUM', tag: 'FAITH SHIELD', desc: 'INFANTRY & CHARACTER units gain +1 Save and 6+ Feel No Pain.', cost: 120, effect: { defend: { save: 1, fnp: 6 } }, req: 'imp_orbital' },
    { id: 'imp_litany', name: 'Litany of Devotion', tier: 2, family: 'IMPERIUM', tag: 'UNYIELDING FAITH', desc: 'Reroll Battle-shock tests and +1 Leadership army-wide.', cost: 110, effect: { ld: 1, rerollShock: true }, req: 'imp_logistics' },
    { id: 'imp_tactics', name: 'Master Tactician', tier: 3, family: 'IMPERIUM', tag: 'TACTICAL SUPREMACY', desc: '+1 CP every battle round, and army-wide tactical flexibility.', cost: 160, effect: {}, req: 'imp_shield' },
    { id: 'imp_armor', name: 'Astartes Ceramite Reinforcement', tier: 3, family: 'IMPERIUM', tag: 'ARMORED RESILIENCE', desc: 'VEHICLE and DREADNOUGHT units gain +1 Toughness and +1 Wound.', cost: 160, effect: { toughness: 1, wound: 1 }, req: 'imp_litany' },
    { id: 'imp_righteous', name: 'Righteous Vengeance', tier: 3, family: 'IMPERIUM', tag: 'LETHAL ZEAL', desc: 'Melee attacks gain [LETHAL HITS] and +1 Strength.', cost: 150, effect: { abilities: ['lethal hits'], strength: 1, attack: 'melee' }, req: 'imp_shield' },
    { id: 'imp_titanic', name: 'Imperial Knight Requisition', tier: 4, family: 'IMPERIUM', tag: 'KNIGHT TITANIC UNLOCK', desc: 'Unlocks Imperial Knights and Titanic warmachines for army recruitment.', cost: 250, effect: {}, req: 'imp_tactics' },
    { id: 'imp_crusade', name: 'Indomitus Crusade Mandate', tier: 4, family: 'IMPERIUM', tag: 'CRUSADE SUPREMACY', desc: 'All friendly units score Critical Hits on 5+ and gain +1 Move.', cost: 260, effect: { critHitOn: 5, move: 1 }, req: 'imp_armor' },
  ],
  CHAOS: [
    { id: 'chaos_pact', name: 'Dark Pact Overdrive', tier: 1, family: 'CHAOS', tag: 'WARP CRITICALS 5+', desc: 'All units score Critical Hits on an unmodified roll of 5+.', cost: 80, effect: { critHitOn: 5 } },
    { id: 'chaos_tribute', name: 'Dark Scrap Tribute', tier: 1, family: 'CHAOS', tag: 'WARP SALVAGE +30', desc: 'Dark Mechanicum rituals salvage +30 Scrap after every battle.', cost: 70, effect: {} },
    { id: 'chaos_siphon', name: 'Soul Siphon', tier: 2, family: 'CHAOS', tag: 'SOUL STEAL', desc: 'Destroying an enemy unit restores lost wounds or models to friendly units.', cost: 120, effect: {}, req: 'chaos_pact' },
    { id: 'chaos_warpfire', name: 'Warpfire Infusion', tier: 2, family: 'CHAOS', tag: 'SUSTAINED FIRE', desc: 'Ranged weapons gain [SUSTAINED HITS 1] and +1 AP.', cost: 120, effect: { abilities: ['sustained hits 1'], ap: 1, attack: 'ranged' }, req: 'chaos_tribute' },
    { id: 'chaos_mutation', name: 'Warp Mutation', tier: 3, family: 'CHAOS', tag: 'MUTATION FRENZY', desc: 'All units gain +1 Strength, +1 Melee Attack, and +1 AP.', cost: 160, effect: { strength: 1, attacks: 1, ap: 1 }, req: 'chaos_siphon' },
    { id: 'chaos_daemon_ward', name: 'Daemonic Ward', tier: 3, family: 'CHAOS', tag: 'INVULNERABLE 5+', desc: 'All friendly units gain a 5+ Invulnerable save.', cost: 170, effect: { defend: { inv: 5 } }, req: 'chaos_warpfire' },
    { id: 'chaos_bloodlust', name: 'Blood God Fury', tier: 3, family: 'CHAOS', tag: 'SAVAGE CHARGE', desc: 'Reroll Charge rolls and +2 Strength on Melee weapons.', cost: 150, effect: { rerollCharge: true, strength: 2, attack: 'melee' }, req: 'chaos_mutation' },
    { id: 'chaos_titanic', name: 'Chaos Knight Requisition', tier: 4, family: 'CHAOS', tag: 'CHAOS TITANIC UNLOCK', desc: 'Unlocks Chaos Knights and Daemon Engine titans for army recruitment.', cost: 250, effect: {}, req: 'chaos_mutation' },
    { id: 'chaos_apocalypse', name: 'Eye of Terror Ascendance', tier: 4, family: 'CHAOS', tag: 'TOTAL CORRUPTION', desc: 'All friendly units gain Feel No Pain 5+ and +1 Attack army-wide.', cost: 260, effect: { defend: { fnp: 5 }, attacks: 1 }, req: 'chaos_daemon_ward' },
  ],
  NECRONS: [
    { id: 'nec_reanim', name: 'Reanimation Overdrive', tier: 1, family: 'NECRONS', tag: 'DOUBLE REANIMATION', desc: 'Reanimation Protocols trigger at double potency each turn.', cost: 80, effect: {} },
    { id: 'nec_salvage', name: 'Dynastic Scrap Siphon', tier: 1, family: 'NECRONS', tag: 'CANOPTEK SALVAGE +30', desc: 'Canoptek scarabs harvest +30 Scrap from battlefield wreckage.', cost: 70, effect: {} },
    { id: 'nec_gauss', name: 'Gauss Disintegration', tier: 2, family: 'NECRONS', tag: 'MORTAL GAUSS', desc: 'Critical Wound rolls on ranged attacks inflict 1 additional Mortal Wound.', cost: 120, effect: { critHitOn: 6, mortalPerWound: 1, attack: 'ranged' }, req: 'nec_reanim' },
    { id: 'nec_chronomancy', name: 'Chronomantic Phasing', tier: 2, family: 'NECRONS', tag: 'TEMPORAL DRIFT +2M', desc: '+2" Move and advance re-rolls army-wide.', cost: 110, effect: { move: 2, rerollAdvance: true }, req: 'nec_salvage' },
    { id: 'nec_living_metal', name: 'Living Metal Protocol', tier: 3, family: 'NECRONS', tag: 'LIVING METAL FNP 5+', desc: 'Every unit gains Feel No Pain 5+ and +1 Toughness.', cost: 160, effect: { defend: { fnp: 5 }, toughness: 1 }, req: 'nec_gauss' },
    { id: 'nec_tesla', name: 'Tesla Arcing Overcharge', tier: 3, family: 'NECRONS', tag: 'TESLA ARCING', desc: 'Ranged weapons gain [SUSTAINED HITS 2] on critical hits.', cost: 160, effect: { abilities: ['sustained hits 2'], attack: 'ranged' }, req: 'nec_chronomancy' },
    { id: 'nec_command', name: 'Phaeron Absolute Authority', tier: 3, family: 'NECRONS', tag: 'IMPERIAL WILL +2 OC', desc: '+2 Objective Control and +1 to Hit rolls army-wide.', cost: 150, effect: { oc: 2, hit: 1 }, req: 'nec_living_metal' },
    { id: 'nec_supremacy', name: 'Monolith & C\'tan Supremacy', tier: 4, family: 'NECRONS', tag: 'NECRON SUPER-HEAVY', desc: 'Unlocks Monoliths and C\'tan Shards for army recruitment.', cost: 250, effect: {}, req: 'nec_living_metal' },
    { id: 'nec_awakened_god', name: 'Awakened Star God Ascendancy', tier: 4, family: 'NECRONS', tag: 'STAR GOD POWER', desc: '+1 AP across all weapons, and 4+ Invulnerable save.', cost: 260, effect: { ap: 1, defend: { inv: 4 } }, req: 'nec_tesla' },
  ],
  ORKS: [
    { id: 'ork_waaagh', name: 'Permanent WAAAGH!', tier: 1, family: 'ORKS', tag: 'PERMANENT WAAAGH!', desc: 'WAAAGH! is permanently active (+1 Melee Attack, 5+ Invuln in melee, Advance & Charge).', cost: 80, effect: { attacks: 1, defend: { inv: 5 }, rerollAdvance: true, rerollCharge: true, attack: 'melee' } },
    { id: 'ork_scrappers', name: 'Grot Scrap Scavengers', tier: 1, family: 'ORKS', tag: 'GROT LOOT +40', desc: 'Grot mobs scavenge +40 Scrap after every scrap!', cost: 70, effect: {} },
    { id: 'ork_dakka', name: 'More Dakka!', tier: 2, family: 'ORKS', tag: 'SUSTAINED DAKKA', desc: 'Ranged weapons gain +1 Attack and [SUSTAINED HITS 1].', cost: 120, effect: { attacks: 1, abilities: ['sustained hits 1'], attack: 'ranged' }, req: 'ork_waaagh' },
    { id: 'ork_cybork', name: 'Cybork Bodies', tier: 2, family: 'ORKS', tag: 'CYBORK BITS FNP 6+', desc: 'All units gain 6+ Feel No Pain and +1 Wound.', cost: 120, effect: { defend: { fnp: 6 }, wound: 1 }, req: 'ork_scrappers' },
    { id: 'ork_ram', name: 'Ramming Speed', tier: 3, family: 'ORKS', tag: 'RAMMING CHARGE +2M', desc: '+2" Move army-wide, and charging deals crushing impact damage.', cost: 160, effect: { move: 2 }, req: 'ork_dakka' },
    { id: 'ork_choppa', name: 'Extra Choppy Bits', tier: 3, family: 'ORKS', tag: 'CHOPPA CARNAGE', desc: 'Melee weapons gain +1 Damage and +1 AP.', cost: 160, effect: { damage: 1, ap: 1, attack: 'melee' }, req: 'ork_cybork' },
    { id: 'ork_mob_rule', name: 'Unstoppable Green Tide', tier: 3, family: 'ORKS', tag: 'MOB RULE +3 OC', desc: '+3 Objective Control and re-roll Battle-shock tests.', cost: 150, effect: { oc: 3, rerollShock: true }, req: 'ork_ram' },
    { id: 'ork_titan', name: 'Stompa Warboss Requisition', tier: 4, family: 'ORKS', tag: 'STOMPA UNLOCK', desc: 'Unlocks Stompas and heavy Ork war-constructs for army recruitment.', cost: 250, effect: {}, req: 'ork_ram' },
    { id: 'ork_gorkamorka', name: 'Wrath of Gork and Mork', tier: 4, family: 'ORKS', tag: 'GORKAMORKA WRATH', desc: 'Critical Hits on 5+, +2 Strength, and Feel No Pain 5+.', cost: 260, effect: { critHitOn: 5, strength: 2, defend: { fnp: 5 } }, req: 'ork_choppa' },
  ],
  TYRANIDS: [
    { id: 'xenos_synapse', name: 'Synaptic Dominance', tier: 1, family: 'TYRANIDS', tag: 'SYNAPSE +2 OC', desc: 'Re-roll Battle-shock tests and gain +2 Objective Control.', cost: 80, effect: { oc: 2, rerollShock: true } },
    { id: 'tyr_biomass', name: 'Biomass Digestion Pools', tier: 1, family: 'TYRANIDS', tag: 'BIOMASS SALVAGE +30', desc: 'Hive fleet reclamation pools generate +30 Scrap after every victory.', cost: 70, effect: {} },
    { id: 'xenos_shadow', name: 'Shadow in the Warp', tier: 2, family: 'TYRANIDS', tag: 'WARP TERROR -1 HIT', desc: 'Enemy forces suffer -1 to Hit across the entire battle.', cost: 120, effect: {}, req: 'xenos_synapse' },
    { id: 'tyr_chitin', name: 'Reinforced Chitin Shells', tier: 2, family: 'TYRANIDS', tag: 'CHITIN CARAPACE +1T', desc: 'All units gain +1 Toughness and 6+ Feel No Pain.', cost: 120, effect: { toughness: 1, defend: { fnp: 6 } }, req: 'tyr_biomass' },
    { id: 'xenos_adaptation', name: 'Hyper-Adaptation', tier: 3, family: 'TYRANIDS', tag: 'LETHAL & DEVASTATING', desc: 'All units gain [LETHAL HITS] and [DEVASTATING WOUNDS].', cost: 160, effect: { abilities: ['lethal hits', 'devastating wounds'] }, req: 'xenos_shadow' },
    { id: 'tyr_swarming', name: 'Endless Swarm Instinct', tier: 3, family: 'TYRANIDS', tag: 'SWARM HORDE +2M', desc: '+2" Move and Advance & Charge for all units.', cost: 160, effect: { move: 2, rerollAdvance: true, rerollCharge: true }, req: 'tyr_chitin' },
    { id: 'tyr_predator', name: 'Apex Predator Instincts', tier: 3, family: 'TYRANIDS', tag: 'PREDATOR CRIT 5+', desc: 'Critical Hits on 5+ in melee combat and +1 Melee Attack.', cost: 150, effect: { critHitOn: 5, attacks: 1, attack: 'melee' }, req: 'xenos_adaptation' },
    { id: 'xenos_apex', name: 'Apex Bio-Titan Requisition', tier: 4, family: 'TYRANIDS', tag: 'BIO-TITAN UNLOCK', desc: 'Unlocks Titanic Bio-constructs and Super-Heavies for recruitment.', cost: 250, effect: {}, req: 'xenos_adaptation' },
    { id: 'tyr_hive_devour', name: 'Planetary Devastation Swarm', tier: 4, family: 'TYRANIDS', tag: 'HIVE DEVOURER', desc: 'All units gain +1 Wound, +1 Strength, and 5+ Invulnerable save.', cost: 260, effect: { wound: 1, strength: 1, defend: { inv: 5 } }, req: 'tyr_swarming' },
  ],
  XENOS: [
    { id: 'xenos_marker', name: 'Target Lock Network', tier: 1, family: 'XENOS', tag: 'TARGET LOCK +1 HIT', desc: '+1 to Hit on ranged attacks and re-roll Wound rolls of 1.', cost: 80, effect: { hit: 1, reroll: 'wounds1', attack: 'ranged' } },
    { id: 'xenos_trade', name: 'Black Market Scrap Conduit', tier: 1, family: 'XENOS', tag: 'BLACK MARKET +30', desc: 'Shadow trading networks supply +30 Scrap after every victory.', cost: 70, effect: {} },
    { id: 'xenos_shields', name: 'Energy Shield Matrices', tier: 2, family: 'XENOS', tag: 'SHIELD MATRIX 5+ INV', desc: 'All units gain 5+ Invulnerable save and +1 Save.', cost: 120, effect: { defend: { inv: 5, save: 1 } }, req: 'xenos_marker' },
    { id: 'xenos_repulsor', name: 'Gravitic Repulsor Skimmers', tier: 2, family: 'XENOS', tag: 'GRAV SKIMMER +2M', desc: '+2" Move and advance re-rolls army-wide.', cost: 110, effect: { move: 2, rerollAdvance: true }, req: 'xenos_trade' },
    { id: 'xenos_hyper', name: 'Hyper-Frequency Beamers', tier: 3, family: 'XENOS', tag: 'HYPER BEAM [LETHAL]', desc: 'All weapons gain [LETHAL HITS] and +1 AP.', cost: 160, effect: { abilities: ['lethal hits'], ap: 1 }, req: 'xenos_shields' },
    { id: 'xenos_drone', name: 'Combat Drone Sub-routines', tier: 3, family: 'XENOS', tag: 'DRONE SUB-ROUTINE', desc: '+2 Objective Control and 6+ Feel No Pain.', cost: 150, effect: { oc: 2, defend: { fnp: 6 } }, req: 'xenos_repulsor' },
    { id: 'xenos_sniper', name: 'Predictive AI Targeting', tier: 3, family: 'XENOS', tag: 'CRIT 5+ & PRECISION', desc: 'Critical Hits on 5+ and [PRECISION] on all weapons.', cost: 160, effect: { critHitOn: 5, abilities: ['precision'] }, req: 'xenos_hyper' },
    { id: 'xenos_titanic_war', name: 'Super-Heavy Titan Construct', tier: 4, family: 'XENOS', tag: 'SUPER-HEAVY UNLOCK', desc: 'Unlocks faction Titanic and Super-Heavy war engines for recruitment.', cost: 250, effect: {}, req: 'xenos_hyper' },
    { id: 'xenos_singularity', name: 'Singularity Weapon System', tier: 4, family: 'XENOS', tag: 'SINGULARITY CANNON', desc: 'Weapons gain [DEVASTATING WOUNDS] and +1 Damage.', cost: 260, effect: { abilities: ['devastating wounds'], damage: 1 }, req: 'xenos_drone' },
  ],
};

export function getFactionTechNodes(factionId: string): TechNode[] {
  const family = getFactionFamily(factionId);
  return FACTION_TECH_TREES[family] ?? FACTION_TECH_TREES.XENOS;
}

export function buyTechNode(run: Run, techId: string): Run {
  const family = getFactionFamily(run.factionId);
  const nodes = FACTION_TECH_TREES[family] ?? FACTION_TECH_TREES.XENOS;
  const node = nodes.find((n) => n.id === techId);
  if (!node) return run;

  const current = run.techTree ?? [];
  if (current.includes(techId)) return run;
  if (node.req && !current.includes(node.req)) return run;
  if ((run.scrap ?? 0) < node.cost) return run;

  return {
    ...run,
    scrap: (run.scrap ?? 0) - node.cost,
    techTree: [...current, techId],
    story: [...run.story, `Command Tech Tree: Unlocked ${node.name} (-${node.cost} Scrap)`],
  };
}

/** Check if a unit is permitted by faction family (Imperium -> QI/TL, Chaos -> QT/CD, Xenos -> only own) */
export function isFactionAllowedKnight(factionId: string, targetDatasheet: DatasheetData): boolean {
  const isImperialKnight = (targetDatasheet.factionKeywords || []).includes('IMPERIAL KNIGHTS') || targetDatasheet.ally === 'QI';
  const isChaosKnight = (targetDatasheet.factionKeywords || []).includes('CHAOS KNIGHTS') || targetDatasheet.ally === 'QT';
  const isTitanic = (targetDatasheet.keywords || []).includes('TITANIC') || (targetDatasheet.keywords || []).includes('TOWERING');

  const family = getFactionFamily(factionId);

  // Strict Lock: Non-Imperium cannot recruit Imperial Knights / Titans
  if (family !== 'IMPERIUM' && (isImperialKnight || (isTitanic && targetDatasheet.ally === 'QI'))) return false;
  // Strict Lock: Non-Chaos cannot recruit Chaos Knights / Titans
  if (family !== 'CHAOS' && (isChaosKnight || (isTitanic && targetDatasheet.ally === 'QT'))) return false;
  // Xenos cannot recruit Imperial or Chaos Knights
  if (family === 'XENOS' && (isImperialKnight || isChaosKnight || targetDatasheet.ally === 'QI' || targetDatasheet.ally === 'QT')) return false;

  return true;
}

/** Check if this unit requires Tier 4 Super-Heavy / Titanic support in the Command Tech Tree */
export function requiresTier4Tech(targetDatasheet: DatasheetData): boolean {
  const isLightKnight = (targetDatasheet.keywords || []).includes('ARMIGER') || (targetDatasheet.keywords || []).includes('WAR DOG');
  if (isLightKnight) return false;
  const isTitanic = (targetDatasheet.keywords || []).includes('TITANIC') || (targetDatasheet.keywords || []).includes('TOWERING');
  const isBigKnight = (targetDatasheet.factionKeywords || []).includes('IMPERIAL KNIGHTS') ||
    (targetDatasheet.factionKeywords || []).includes('CHAOS KNIGHTS') ||
    targetDatasheet.ally === 'QI' || targetDatasheet.ally === 'QT';
  return isTitanic || isBigKnight;
}

/** Check if a unit is permitted to be recruited under the strict Knight/Titan faction lock */
export function canRecruitTitanOrKnight(factionId: string, targetDatasheet: DatasheetData, run: Run): boolean {
  if (!isFactionAllowedKnight(factionId, targetDatasheet)) return false;

  if (requiresTier4Tech(targetDatasheet)) {
    const family = getFactionFamily(factionId);
    const nodes = getFactionTechNodes(factionId);
    const hasTier4 = (run.techTree ?? []).some((t) => {
      if (family === 'IMPERIUM' && (t === 'imp_titanic' || t.includes('titanic') || t.includes('titan'))) return true;
      if (family === 'CHAOS' && (t === 'chaos_titanic' || t.includes('titanic') || t.includes('titan'))) return true;
      if (family === 'NECRONS' && (t === 'nec_supremacy' || t.includes('supremacy'))) return true;
      if (family === 'ORKS' && (t === 'ork_titan' || t.includes('titan'))) return true;
      if (family === 'TYRANIDS' && (t === 'xenos_apex' || t.includes('apex'))) return true;
      if (family === 'XENOS' && (t === 'xenos_titanic_war' || t.includes('titanic'))) return true;
      const n = nodes.find((x) => x.id === t);
      return n?.tier === 4 || t.endsWith('_titanic') || t.endsWith('_supremacy') || t.endsWith('_titan') || t.endsWith('_apex') || t.endsWith('_titanic_war');
    });
    if (!hasTier4) return false;
  }

  return true;
}

export interface AutoUpgradePreview {
  unit: ArmyUnitEntry;
  honor: BattleHonor;
  baseCost: number;
  finalCost: number;
  companion?: ArmyUnitEntry;
  isAttached: boolean;
  rankDiscountPct: number;
}

export function previewAutoUpgradeUnit(run: Run, faction: FactionData, unitUid: string): AutoUpgradePreview | null {
  const u = run.list.units.find((x) => x.uid === unitUid);
  if (!u) return null;
  const d = faction.datasheets.find((x) => x.name === u.datasheet);
  if (!d) return null;

  // Attached companion: either leader attached to u, or bodyguard u is attached to
  const companion = run.list.units.find((x) => x.attachTo === u.uid) ?? (u.attachTo ? run.list.units.find((x) => x.uid === u.attachTo) : undefined);
  const isAttached = !!companion;

  const curHonors = [
    ...(run.datasheetHonors?.[u.datasheet] ?? []),
    ...(u.honors ?? []),
  ];
  const eligible = getSmartBattleHonors(d, curHonors);
  if (!eligible.length) return null;

  // Filter by rank / XP
  const xp = u.xp ?? 0;
  const available = eligible.filter((h) => honorMinXp(h) <= xp);
  if (!available.length) return null;

  // Role matching
  const hasRanged = (d.weapons || []).some((w) => w.profiles.some((p) => p.range !== 'Melee' && p.range !== null));
  const hasMelee = (d.weapons || []).some((w) => w.profiles.some((p) => p.range === 'Melee'));
  let pick = available[0];
  if (hasRanged && !hasMelee) {
    pick = available.find((h) => h.role === 'ranged') || pick;
  } else if (hasMelee && !hasRanged) {
    pick = available.find((h) => h.role === 'melee') || pick;
  }

  // Base cost scaled by squad count
  const squads = run.list.units.filter((x) => x.datasheet === u.datasheet);
  const squadCount = Math.max(1, squads.length);
  const baseCost = datasheetHonorCost(pick.cost, squadCount);

  // Rank discount if any
  const rkb = rankCombatBonus(xp);
  const rankDiscountPct = rkb.discountPct ?? 0;
  let finalCost = Math.round(baseCost * (1 - rankDiscountPct));

  // Attached companion surcharge: +25%
  if (isAttached) {
    finalCost = Math.round(finalCost * 1.25);
  }

  return {
    unit: u,
    honor: pick,
    baseCost,
    finalCost,
    companion,
    isAttached,
    rankDiscountPct,
  };
}

export function applyAutoUpgradeUnit(run: Run, faction: FactionData, unitUid: string): Run {
  const preview = previewAutoUpgradeUnit(run, faction, unitUid);
  if (!preview) return run;
  if ((run.scrap ?? 0) < preview.finalCost) return run;

  const { unit, honor, finalCost, companion, isAttached } = preview;
  const curDatasheetHonors = { ...(run.datasheetHonors ?? {}) };

  // Add to main unit datasheet
  curDatasheetHonors[unit.datasheet] = [...new Set([...(curDatasheetHonors[unit.datasheet] ?? []), honor.id])];

  // If companion attached, also add to companion datasheet
  if (companion) {
    curDatasheetHonors[companion.datasheet] = [...new Set([...(curDatasheetHonors[companion.datasheet] ?? []), honor.id])];
  }

  // Also update per-unit honors on run.list.units
  const updatedUnits = run.list.units.map((x) => {
    if (x.datasheet === unit.datasheet || (companion && x.datasheet === companion.datasheet)) {
      return { ...x, honors: [...new Set([...(x.honors ?? []), honor.id])] };
    }
    return x;
  });

  const storyMsg = isAttached && companion
    ? `Auto-Upgrade (Sync): Upgraded ${unit.datasheet} and ${companion.datasheet} with ${honor.name} (-${finalCost} Scrap)`
    : `Auto-Upgrade: Upgraded ${unit.datasheet} with ${honor.name} (-${finalCost} Scrap)`;

  return {
    ...run,
    scrap: (run.scrap ?? 0) - finalCost,
    datasheetHonors: curDatasheetHonors,
    list: { ...run.list, units: updatedUnits },
    story: [...run.story, storyMsg],
  };
}


