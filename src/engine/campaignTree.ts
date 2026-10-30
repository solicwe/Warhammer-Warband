// The campaign's army tree (docs/04-campaign-tree.md): one passive tree for the whole army, paid for with Renown.
// Seven shared spokes and the army's own branch around a start node, an inner ring of bridges halfway out and an
// outer ring of keystones that convert keywords. Nodes reach units through keywords and use the existing Effect
// fields, so the engine and the bot need no new rules code.
import { addTimed } from '../rules-engine/effects';
import type { Effect } from '../rules-engine/effects';
import type { ArmyUnitEntry, DatasheetData, GameState, PlayerId } from './types';

export type TreeKind = 'start' | 'small' | 'notable' | 'keystone';

interface Spec {
  name: string;
  text: string;
  /** keywords the node reaches ("INFANTRY|MOUNTED"); none: every unit */
  units?: string;
  e?: Effect | Effect[];
  /** CP at the start of every battle */
  cp?: number;
  /** Scrap after every won battle */
  scrap?: number;
  /** TITANIC units and Knights can be recruited */
  titan?: boolean;
  /** threshold: once this many nodes of the same spoke are taken */
  bonus?: { count: number; text: string; e?: Effect; cp?: number; scrap?: number };
  /** keyword conversion: units with `from` also count as `to` for tree nodes */
  as?: { from: string; to: string };
}

export interface TreeNode extends Spec {
  id: string;
  kind: TreeKind;
  /** the spoke or branch it belongs to ('ring' for bridges and outer keystones) */
  slot: string;
  x: number;
  y: number;
  links: string[];
}

interface Branch { id: string; name: string; main: Spec[]; sideA: Spec[]; sideB?: Spec[] }

const s = (name: string, text: string, units: string | undefined, e: Effect | Effect[]): Spec => ({ name, text, units, e });
const R = (e: Effect, ...rounds: ('early' | 'late')[]): Effect => ({ ...e, if: [...(e.if ?? []), ...rounds.map((r) => (r === 'early' ? '!roundAtLeast:3' : 'roundAtLeast:3'))] });

// ---------- the seven shared spokes ----------

const SPOKES: Branch[] = [
  {
    id: 'fire', name: 'Fire',
    main: [
      s('Steady Aim', 'INFANTRY ranged weapons: +3" Range.', 'INFANTRY', { rangeBonus: 3, attack: 'ranged' }),
      s('Drilled Volleys', 'BATTLELINE ranged attacks re-roll Hit rolls of 1.', 'BATTLELINE', { reroll: 'hits1', attack: 'ranged' }),
      { ...s('Gun Line', 'Units that Remained Stationary: +1 to Hit with ranged attacks.', undefined, { hit: 1, attack: 'ranged', if: ['stationary'] }) },
      s('Heavy Rounds', 'VEHICLE ranged weapons: +1 Strength.', 'VEHICLE', { strength: 1, attack: 'ranged' }),
      s('Marksmen', 'CHARACTER ranged weapons: +1 Ballistic Skill.', 'CHARACTER', { skill: 1, attack: 'ranged' }),
      { ...s('Focused Fire', 'Ranged attacks against a unit below its Starting Strength: +1 AP.', undefined, { ap: 1, attack: 'ranged', if: ['targetBelowStarting'] }),
        bonus: { count: 6, text: 'With 6 Fire nodes: those attacks also get +1 to Wound.', e: { wound: 1, attack: 'ranged', if: ['targetBelowStarting'] } } },
      s('Iron Discipline', 'Keystone. Ranged attacks: +1 to Hit. Every unit: -2" Move.', undefined, [{ hit: 1, attack: 'ranged' }, { move: -2 }]),
    ],
    sideA: [
      s('Hunter\'s Eye', 'Ranged attacks against MONSTER or VEHICLE units: +1 AP.', 'VEHICLE|MONSTER', { ap: 1, attack: 'ranged', if: ['targetMV'] }),
      s('Spotters', 'INFANTRY ranged attacks re-roll Wound rolls of 1.', 'INFANTRY', { reroll: 'wounds1', attack: 'ranged' }),
      s('Overlapping Fields', 'Ranged weapons have [IGNORES COVER].', undefined, { abilities: ['ignores cover'], attack: 'ranged' }),
    ],
    sideB: [
      s('Heavy Ordnance', 'MONSTER ranged weapons: +1 Strength.', 'MONSTER', { strength: 1, attack: 'ranged' }),
      s('Long Barrels', 'VEHICLE and MONSTER ranged weapons: +4" Range.', 'VEHICLE|MONSTER', { rangeBonus: 4, attack: 'ranged' }),
      s('Opening Salvo', 'Rounds 1-2: ranged weapons have [SUSTAINED HITS 1].', undefined, R({ abilities: ['sustained hits 1'], attack: 'ranged' }, 'early')),
    ],
  },
  {
    id: 'assault', name: 'Assault',
    main: [
      s('Bayonet Drill', 'INFANTRY melee weapons: +1 Strength.', 'INFANTRY', { strength: 1, attack: 'melee' }),
      s('Blood Up', 'INFANTRY: +1 to Charge rolls.', 'INFANTRY', { chargeBonus: 1 }),
      s('Hammer Blow', 'CHARACTER melee weapons have [LETHAL HITS].', 'CHARACTER', { abilities: ['lethal hits'], attack: 'melee' }),
      s('Brutal Edge', 'MONSTER and WALKER melee weapons: +1 Strength.', 'MONSTER|WALKER', { strength: 1, attack: 'melee' }),
      s('Savagery', 'Units that charged this turn re-roll melee Hit rolls of 1.', undefined, { reroll: 'hits1', attack: 'melee', if: ['charged'] }),
      { ...s('Shock Assault', 'Units that charged this turn: +1 Attack in melee.', undefined, { attacks: 1, attack: 'melee', if: ['charged'] }),
        bonus: { count: 6, text: 'With 6 Assault nodes: those attacks also get +1 Damage.', e: { damage: 1, attack: 'melee', if: ['charged'] } } },
      s('Berserk Fury', 'Keystone. Melee weapons: +1 Attack. Ranged attacks: -1 to Hit.', undefined, [{ attacks: 1, attack: 'melee' }, { hit: -1, attack: 'ranged' }]),
    ],
    sideA: [
      s('Close Quarters', 'INFANTRY melee attacks re-roll Wound rolls of 1.', 'INFANTRY', { reroll: 'wounds1', attack: 'melee' }),
      s('Duellists', 'CHARACTER melee weapons: +1 Strength.', 'CHARACTER', { strength: 1, attack: 'melee' }),
      s('Reaping Strokes', 'INFANTRY melee weapons have [SUSTAINED HITS 1].', 'INFANTRY', { abilities: ['sustained hits 1'], attack: 'melee' }),
    ],
    sideB: [
      s('Momentum', 'MOUNTED melee weapons: +1 Strength.', 'MOUNTED', { strength: 1, attack: 'melee' }),
      s('Rending', 'Melee attacks against INFANTRY units: +1 AP.', undefined, { ap: 1, attack: 'melee', if: ['targetInfantry'] }),
      s('The Long Fight', 'From round 3: melee attacks get +1 to Wound.', undefined, R({ wound: 1, attack: 'melee' }, 'late')),
    ],
  },
  {
    id: 'armour', name: 'Armour',
    main: [
      s('Thick Hide', 'MONSTER: +1 Toughness.', 'MONSTER', { toughness: 1 }),
      s('Warded Hulls', 'VEHICLE: Feel No Pain 6+ against mortal wounds.', 'VEHICLE', { defend: { fnp: 6, fnpVs: 'mortal' } }),
      s('Combat Stimms', 'INFANTRY: Feel No Pain 6+.', 'INFANTRY', { defend: { fnp: 6 } }),
      s('Bodyguard Plate', 'CHARACTER: Feel No Pain 6+.', 'CHARACTER', { defend: { fnp: 6 } }),
      s('Dig In', 'Units on an objective: +1 to saving throws.', undefined, { defend: { save: 1 }, if: ['onObjective'] }),
      { ...s('Unbreakable', 'Units below Half-strength: Feel No Pain 5+.', undefined, { defend: { fnp: 5 }, if: ['belowHalfStrength'] }),
        bonus: { count: 6, text: 'With 6 Armour nodes: those units also take -1 Damage.', e: { defend: { damage: 1 }, if: ['belowHalfStrength'] } } },
      s('Fortress', 'Keystone. Every unit: +1 Toughness and -2" Move.', undefined, [{ toughness: 1 }, { move: -2 }]),
    ],
    sideA: [
      s('Smoke Screens', 'Ranged attacks against VEHICLE units: -1 to Hit.', 'VEHICLE', { defend: { hit: -1, vs: 'ranged' } }),
      s('Carapace', 'MONSTER: Feel No Pain 6+.', 'MONSTER', { defend: { fnp: 6 } }),
      s('Bulwark', 'VEHICLE: +1 Toughness.', 'VEHICLE', { toughness: 1 }),
    ],
    sideB: [
      s('Hardened', 'BATTLELINE: Feel No Pain 6+.', 'BATTLELINE', { defend: { fnp: 6 } }),
      s('Cover Drills', 'INFANTRY in terrain: +1 to saving throws.', 'INFANTRY', { defend: { save: 1 }, if: ['inTerrain'] }),
      s('Brace for Impact', 'Rounds 1-2: ranged attacks against your units get -1 to Hit.', undefined, R({ defend: { hit: -1, vs: 'ranged' } }, 'early')),
    ],
  },
  {
    id: 'speed', name: 'Speed',
    main: [
      s('Forced March', 'INFANTRY: +1" Move.', 'INFANTRY', { move: 1 }),
      s('Outriders', 'MOUNTED: +2" Move.', 'MOUNTED', { move: 2 }),
      s('Swift Strike', 'Every unit re-rolls Advance rolls.', undefined, { rerollAdvance: true }),
      s('Jump Troops', 'FLY: +1" Move.', 'FLY', { move: 1 }),
      s('Fast Engines', 'VEHICLE: +2" Move.', 'VEHICLE', { move: 2 }),
      { ...s('Rapid Assault', 'Every unit re-rolls Charge rolls.', undefined, { rerollCharge: true }),
        bonus: { count: 6, text: 'With 6 Speed nodes: +1 to Charge rolls too.', e: { chargeBonus: 1 } } },
      s('Blitz', 'Keystone. Every unit: +2" Move and -1 Toughness.', undefined, [{ move: 2 }, { toughness: -1 }]),
    ],
    sideA: [
      s('Light Packs', 'INFANTRY: +1 to Advance rolls.', 'INFANTRY', { advanceBonus: 1 }),
      s('Skirmishers', 'BATTLELINE: +1" Move.', 'BATTLELINE', { move: 1 }),
      s('Lightning Raid', 'MOUNTED and FLY: +1 to Charge rolls and re-roll Advance rolls.', 'MOUNTED|FLY', { chargeBonus: 1, rerollAdvance: true }),
    ],
    sideB: [
      s('Couriers', 'CHARACTER: +1" Move.', 'CHARACTER', { move: 1 }),
      s('Evasive', 'Ranged attacks against MOUNTED units: -1 to Hit.', 'MOUNTED', { defend: { hit: -1, vs: 'ranged' } }),
      s('First Wave', 'Rounds 1-2: every unit +2" Move.', undefined, R({ move: 2 }, 'early')),
    ],
  },
  {
    id: 'command', name: 'Command',
    main: [
      s('Steady Nerves', 'BATTLELINE re-rolls Battle-shock tests.', 'BATTLELINE', { rerollShock: true }),
      s('Officer Corps', 'CHARACTER re-rolls Hit rolls of 1.', 'CHARACTER', { reroll: 'hits1' }),
      { name: 'War Council', text: '+1 CP at the start of every battle.', cp: 1 },
      s('Iron Will', 'INFANTRY re-rolls Battle-shock tests.', 'INFANTRY', { rerollShock: true }),
      s('Executioners', 'CHARACTER melee attacks re-roll Wound rolls of 1.', 'CHARACTER', { reroll: 'wounds1', attack: 'melee' }),
      { name: 'Master Tactician', text: '+1 CP at the start of every battle.', cp: 1,
        bonus: { count: 6, text: 'With 6 Command nodes: +1 CP more.', cp: 1 } },
      { ...s('Total War', 'Keystone. +2 CP at the start of every battle. Every unit: -1 OC.', undefined, { oc: -1 }), cp: 2 },
    ],
    sideA: [
      s('Heroes\' Example', 'CHARACTER melee weapons have [PRECISION].', 'CHARACTER', { abilities: ['precision'], attack: 'melee' }),
      s('Lead from the Front', 'CHARACTER ranged weapons: +1 Strength.', 'CHARACTER', { strength: 1, attack: 'ranged' }),
      s('Inspiring Presence', 'Units led by a CHARACTER: +1 to Hit in melee.', undefined, { hit: 1, attack: 'melee', if: ['attached'] }),
    ],
    sideB: [
      s('Stern Command', 'Units below Starting Strength re-roll Battle-shock tests.', undefined, { rerollShock: true, if: ['belowStartingStrength'] }),
      s('Signal Flares', 'CHARACTER ranged weapons: +3" Range.', 'CHARACTER', { rangeBonus: 3, attack: 'ranged' }),
      s('Seize the Initiative', 'Rounds 1-2: CHARACTER +1 Attack.', 'CHARACTER', R({ attacks: 1 }, 'early')),
    ],
  },
  {
    id: 'objectives', name: 'Objectives',
    main: [
      s('Hold the Line', 'BATTLELINE: +1 OC.', 'BATTLELINE', { oc: 1 }),
      s('Entrench', 'Units on an objective: Feel No Pain 6+.', undefined, { defend: { fnp: 6 }, if: ['onObjective'] }),
      s('Objective Secured', 'INFANTRY: +1 OC.', 'INFANTRY', { oc: 1 }),
      s('Area Denial', 'VEHICLE and MONSTER: +1 OC.', 'VEHICLE|MONSTER', { oc: 1 }),
      s('Stubborn', 'BATTLELINE units on an objective: +1 to saving throws.', 'BATTLELINE', { defend: { save: 1 }, if: ['onObjective'] }),
      { ...s('Fortified Ground', 'Units on an objective: +1 to Hit.', undefined, { hit: 1, if: ['onObjective'] }),
        bonus: { count: 6, text: 'With 6 Objectives nodes: those units also get +1 OC.', e: { oc: 1, if: ['onObjective'] } } },
      s('Endless Ranks', 'Keystone. BATTLELINE: +2 OC and -1" Move.', 'BATTLELINE', [{ oc: 2 }, { move: -1 }]),
    ],
    sideA: [
      s('Sentries', 'Units on an objective re-roll Hit rolls of 1.', undefined, { reroll: 'hits1', if: ['onObjective'] }),
      s('Claim Markers', 'MOUNTED: +1 OC.', 'MOUNTED', { oc: 1 }),
      s('Bastion', 'Units on an objective: +1 Toughness.', undefined, { toughness: 1, if: ['onObjective'] }),
    ],
    sideB: [
      s('Field Command', 'CHARACTER: +1 OC.', 'CHARACTER', { oc: 1 }),
      s('Reclaim', 'Units on an objective re-roll Wound rolls of 1.', undefined, { reroll: 'wounds1', if: ['onObjective'] }),
      s('Last Push', 'From round 3: every unit +1 OC.', undefined, R({ oc: 1 }, 'late')),
    ],
  },
  {
    id: 'logistics', name: 'Logistics',
    main: [
      { name: 'Salvage Crews', text: '+10 Scrap after every won battle.', scrap: 10 },
      s('Blooded', 'VETERAN: +1 OC.', 'VETERAN', { oc: 1 }),
      s('Veteran Cadre', 'VETERAN re-rolls Hit rolls of 1.', 'VETERAN', { reroll: 'hits1' }),
      { name: 'Scavengers', text: '+10 Scrap after every won battle.', scrap: 10 },
      s('Battle-scarred', 'VETERAN: Feel No Pain 6+.', 'VETERAN', { defend: { fnp: 6 } }),
      { name: 'Tithe Masters', text: '+25 Scrap after every won battle.', scrap: 25,
        bonus: { count: 6, text: 'With 6 Logistics nodes: +1 CP at the start of every battle.', cp: 1 } },
      { name: 'Titan Requisition', text: 'Keystone. TITANIC units and Knights of your side can be recruited. -20 Scrap after every won battle.', titan: true, scrap: -20 },
    ],
    sideA: [
      s('Hardened Survivors', 'VETERAN: +1" Move.', 'VETERAN', { move: 1 }),
      s('Old Hands', 'VETERAN re-rolls Battle-shock tests.', 'VETERAN', { rerollShock: true }),
      s('Honoured Veterans', 'VETERAN weapons: +1 AP.', 'VETERAN', { ap: 1 }),
    ],
    sideB: [
      { name: 'Requisition Office', text: '+15 Scrap after every won battle.', scrap: 15 },
      { name: 'Forward Depot', text: '+10 Scrap after every won battle.', scrap: 10 },
      s('Last Stand', 'From round 3: VETERAN attacks get +1 to Wound.', 'VETERAN', R({ wound: 1 }, 'late')),
    ],
  },
];

/** Inner ring: one bridge between each pair of neighbouring slots (the army's branch is the eighth slot). */
const BRIDGES: Spec[] = [
  s('Combined Arms', 'INFANTRY melee attacks re-roll Hit rolls of 1.', 'INFANTRY', { reroll: 'hits1', attack: 'melee' }),
  s('Iron Fists', 'MONSTER melee attacks re-roll Wound rolls of 1.', 'MONSTER', { reroll: 'wounds1', attack: 'melee' }),
  s('Reinforced Frames', 'MOUNTED: +1 Toughness.', 'MOUNTED', { toughness: 1 }),
  s('Messengers', 'CHARACTER: +1" Move.', 'CHARACTER', { move: 1 }),
  s('Rallying Point', 'Units on an objective re-roll Battle-shock tests.', undefined, { rerollShock: true, if: ['onObjective'] }),
  { name: 'Supply Caches', text: '+10 Scrap after every won battle.', scrap: 10 },
  s('Trusted Hands', 'VETERAN: +1 OC.', 'VETERAN', { oc: 1 }),
  s('Sighting Lens', 'VEHICLE ranged attacks re-roll Hit rolls of 1.', 'VEHICLE', { reroll: 'hits1', attack: 'ranged' }),
];

/** Outer ring: keystones between the tips of neighbouring shared spokes. They convert keywords. */
const CONVERSIONS: Spec[] = [
  { name: 'Brute Gunners', text: 'Keystone. MONSTER units also count as VEHICLE for tree nodes.', as: { from: 'MONSTER', to: 'VEHICLE' } },
  { name: 'Iron Hulks', text: 'Keystone. VEHICLE units also count as MONSTER for tree nodes.', as: { from: 'VEHICLE', to: 'MONSTER' } },
  { name: 'Mechanised Infantry', text: 'Keystone. INFANTRY units also count as VEHICLE for tree nodes.', as: { from: 'INFANTRY', to: 'VEHICLE' } },
  { name: 'Mounted Officers', text: 'Keystone. MOUNTED units also count as CHARACTER for tree nodes.', as: { from: 'MOUNTED', to: 'CHARACTER' } },
  { name: 'Every Soldier a Hero', text: 'Keystone. BATTLELINE units also count as CHARACTER for tree nodes.', as: { from: 'BATTLELINE', to: 'CHARACTER' } },
  { name: 'Old Guard', text: 'Keystone. BATTLELINE units also count as VETERAN for tree nodes.', as: { from: 'BATTLELINE', to: 'VETERAN' } },
];

// ---------- the army's own branch (per family for now; per army next) ----------

export type Family = 'IMPERIUM' | 'CHAOS' | 'NECRONS' | 'ORKS' | 'TYRANIDS' | 'XENOS';

export function getFactionFamily(factionId: string): Family {
  if (['SM', 'AM', 'AdM', 'AS', 'AC', 'GK', 'AoI', 'QI'].includes(factionId)) return 'IMPERIUM';
  if (['CSM', 'DG', 'TS', 'WE', 'EC', 'CD', 'QT'].includes(factionId)) return 'CHAOS';
  if (factionId === 'NEC') return 'NECRONS';
  if (factionId === 'ORK') return 'ORKS';
  if (factionId === 'TYR' || factionId === 'GC') return 'TYRANIDS';
  return 'XENOS';
}

const FAMILY_BRANCHES: Record<Family, Branch> = {
  IMPERIUM: {
    id: 'army', name: 'Faith and Duty',
    main: [
      s('Litany of Hate', 'BATTLELINE melee attacks re-roll Hit rolls of 1.', 'BATTLELINE', { reroll: 'hits1', attack: 'melee' }),
      s('Blessed Plating', 'VEHICLE: Feel No Pain 6+.', 'VEHICLE', { defend: { fnp: 6 } }),
      s('Emperor\'s Aegis', 'INFANTRY and CHARACTER: Feel No Pain 6+.', 'INFANTRY|CHARACTER', { defend: { fnp: 6 } }),
      s('Orbital Spotters', 'VEHICLE ranged weapons: +3" Range.', 'VEHICLE', { rangeBonus: 3, attack: 'ranged' }),
      s('Righteous Zeal', 'CHARACTER melee weapons: +1 Strength.', 'CHARACTER', { strength: 1, attack: 'melee' }),
      { ...s('Righteous Vengeance', 'Melee weapons have [LETHAL HITS].', undefined, { abilities: ['lethal hits'], attack: 'melee' }),
        bonus: { count: 6, text: 'With 6 branch nodes: melee weapons +1 Strength.', e: { strength: 1, attack: 'melee' } } },
      s('Indomitus Mandate', 'Keystone. Critical Hits on 5+. Every unit: -1 OC.', undefined, [{ critHitOn: 5 }, { oc: -1 }]),
    ],
    sideA: [
      { name: 'Munitorum Tithes', text: '+10 Scrap after every won battle.', scrap: 10 },
      s('Vox Network', 'Every unit re-rolls Battle-shock tests.', undefined, { rerollShock: true }),
      { name: 'Strategium', text: '+1 CP at the start of every battle.', cp: 1 },
    ],
  },
  CHAOS: {
    id: 'army', name: 'The Dark Gods',
    main: [
      s('Dark Zeal', 'INFANTRY melee weapons: +1 Strength.', 'INFANTRY', { strength: 1, attack: 'melee' }),
      { name: 'Warp Tribute', text: '+10 Scrap after every won battle.', scrap: 10 },
      s('Daemonic Ward', 'CHARACTER: 5+ invulnerable save.', 'CHARACTER', { defend: { inv: 5 } }),
      s('Warpfire', 'INFANTRY ranged weapons: +1 Strength.', 'INFANTRY', { strength: 1, attack: 'ranged' }),
      s('Blood Offering', 'Units that charged this turn re-roll melee Wound rolls of 1.', undefined, { reroll: 'wounds1', attack: 'melee', if: ['charged'] }),
      { ...s('Warp Mutation', 'Melee weapons: +1 AP.', undefined, { ap: 1, attack: 'melee' }),
        bonus: { count: 6, text: 'With 6 branch nodes: melee weapons +1 Attack.', e: { attacks: 1, attack: 'melee' } } },
      s('Dark Pact', 'Keystone. Critical Hits on 5+. Every unit: -1 to saving throws.', undefined, [{ critHitOn: 5 }, { defend: { save: -1 } }]),
    ],
    sideA: [
      s('Soul Siphon', 'INFANTRY: Feel No Pain 6+.', 'INFANTRY', { defend: { fnp: 6 } }),
      s('Daemon Steeds', 'DAEMON: +1" Move.', 'DAEMON', { move: 1 }),
      s('Eye of Terror', 'MONSTER and VEHICLE: Feel No Pain 6+.', 'MONSTER|VEHICLE', { defend: { fnp: 6 } }),
    ],
  },
  NECRONS: {
    id: 'army', name: 'The Dynasty',
    main: [
      s('Living Metal', 'VEHICLE: Feel No Pain 6+.', 'VEHICLE', { defend: { fnp: 6 } }),
      s('Gauss Calibration', 'INFANTRY ranged weapons: +1 Strength.', 'INFANTRY', { strength: 1, attack: 'ranged' }),
      s('Reanimation Surge', 'INFANTRY: Feel No Pain 6+.', 'INFANTRY', { defend: { fnp: 6 } }),
      { name: 'Canoptek Salvage', text: '+10 Scrap after every won battle.', scrap: 10 },
      s('Phase Shift', 'INFANTRY: +1" Move.', 'INFANTRY', { move: 1 }),
      { ...s('Gauss Disintegration', 'Ranged weapons have [LETHAL HITS].', undefined, { abilities: ['lethal hits'], attack: 'ranged' }),
        bonus: { count: 6, text: 'With 6 branch nodes: ranged attacks against MONSTER or VEHICLE units +1 AP.', e: { ap: 1, attack: 'ranged', if: ['targetMV'] } } },
      s('Awakened Command', 'Keystone. Every attack: +1 to Hit. Every unit: -2" Move.', undefined, [{ hit: 1 }, { move: -2 }]),
    ],
    sideA: [
      s('Dimensional Corridors', 'CHARACTER: +2" Move.', 'CHARACTER', { move: 2 }),
      s('Tesla Coils', 'VEHICLE ranged attacks re-roll Wound rolls of 1.', 'VEHICLE', { reroll: 'wounds1', attack: 'ranged' }),
      { name: 'Phaeron\'s Will', text: '+1 CP at the start of every battle.', cp: 1 },
    ],
  },
  ORKS: {
    id: 'army', name: 'Waaagh!',
    main: [
      s('Choppa Drill', 'INFANTRY melee weapons: +1 Strength.', 'INFANTRY', { strength: 1, attack: 'melee' }),
      { name: 'Grot Scavengers', text: '+15 Scrap after every won battle.', scrap: 15 },
      s('More Dakka', 'INFANTRY ranged weapons have [SUSTAINED HITS 1].', 'INFANTRY', { abilities: ['sustained hits 1'], attack: 'ranged' }),
      s('Ramshackle', 'VEHICLE: Feel No Pain 6+.', 'VEHICLE', { defend: { fnp: 6 } }),
      s('Speed Freeks', 'VEHICLE and MOUNTED: +2" Move.', 'VEHICLE|MOUNTED', { move: 2 }),
      { ...s('Extra Choppy', 'Melee weapons: +1 AP.', undefined, { ap: 1, attack: 'melee' }),
        bonus: { count: 6, text: 'With 6 branch nodes: units that charged get +1 Damage in melee.', e: { damage: 1, attack: 'melee', if: ['charged'] } } },
      s('Green Tide', 'Keystone. Melee weapons: +1 Attack. Ranged attacks: -1 to Hit.', undefined, [{ attacks: 1, attack: 'melee' }, { hit: -1, attack: 'ranged' }]),
    ],
    sideA: [
      s('Mob Rule', 'INFANTRY: +1 OC.', 'INFANTRY', { oc: 1 }),
      s('Cybork Bits', 'CHARACTER: Feel No Pain 6+.', 'CHARACTER', { defend: { fnp: 6 } }),
      s('Ramming Speed', 'Every unit re-rolls Charge rolls.', undefined, { rerollCharge: true }),
    ],
  },
  TYRANIDS: {
    id: 'army', name: 'The Hive Mind',
    main: [
      s('Chitin', 'MONSTER: Feel No Pain 6+.', 'MONSTER', { defend: { fnp: 6 } }),
      s('Swarm', 'INFANTRY: +1" Move.', 'INFANTRY', { move: 1 }),
      s('Synaptic Dominance', 'INFANTRY: +1 OC and re-rolls Battle-shock tests.', 'INFANTRY', { oc: 1, rerollShock: true }),
      { name: 'Biomass Pools', text: '+10 Scrap after every won battle.', scrap: 10 },
      s('Adrenal Glands', 'MONSTER melee weapons: +1 Strength.', 'MONSTER', { strength: 1, attack: 'melee' }),
      { ...s('Hyper-Adaptation', 'Melee weapons have [LETHAL HITS].', undefined, { abilities: ['lethal hits'], attack: 'melee' }),
        bonus: { count: 6, text: 'With 6 branch nodes: melee weapons +1 AP.', e: { ap: 1, attack: 'melee' } } },
      s('Endless Swarm', 'Keystone. Every unit re-rolls Charge rolls and gets +1 Attack in melee; -1 to saving throws.', undefined, [{ rerollCharge: true, attacks: 1, attack: 'melee' }, { defend: { save: -1 } }]),
    ],
    sideA: [
      s('Bio-acid', 'MONSTER ranged weapons: +1 Strength.', 'MONSTER', { strength: 1, attack: 'ranged' }),
      s('Chameleonic Skin', 'INFANTRY in terrain: +1 to saving throws.', 'INFANTRY', { defend: { save: 1 }, if: ['inTerrain'] }),
      s('Shadow in the Warp', 'Attacks against CHARACTER units: -1 to Hit.', 'CHARACTER', { defend: { hit: -1 } }),
    ],
  },
  XENOS: {
    id: 'army', name: 'Alien Ingenuity',
    main: [
      s('Target Lock', 'INFANTRY ranged attacks re-roll Hit rolls of 1.', 'INFANTRY', { reroll: 'hits1', attack: 'ranged' }),
      { name: 'Black Market', text: '+10 Scrap after every won battle.', scrap: 10 },
      s('Shield Matrices', 'VEHICLE: 5+ invulnerable save.', 'VEHICLE', { defend: { inv: 5 } }),
      s('Grav Skimmers', 'FLY and VEHICLE: +2" Move.', 'FLY|VEHICLE', { move: 2 }),
      s('Drone Routines', 'INFANTRY: +1 OC.', 'INFANTRY', { oc: 1 }),
      { ...s('Hyper-Frequency', 'Ranged weapons have [LETHAL HITS].', undefined, { abilities: ['lethal hits'], attack: 'ranged' }),
        bonus: { count: 6, text: 'With 6 branch nodes: ranged weapons +1 AP.', e: { ap: 1, attack: 'ranged' } } },
      s('Singularity Weapons', 'Keystone. Every weapon: +1 Damage. Every unit: -1 Toughness.', undefined, [{ damage: 1 }, { toughness: -1 }]),
    ],
    sideA: [
      s('Predictive Targeting', 'CHARACTER ranged weapons have [PRECISION].', 'CHARACTER', { abilities: ['precision'], attack: 'ranged' }),
      s('Repulsors', 'INFANTRY: +1" Move.', 'INFANTRY', { move: 1 }),
      s('Combat Drones', 'INFANTRY: Feel No Pain 6+.', 'INFANTRY', { defend: { fnp: 6 } }),
    ],
  },
};

// ---------- building the graph ----------

/** distance between depths on the drawing */
const STEP = 60;
const SLOTS = 8;
const angleOf = (slot: number) => -Math.PI / 2 + (slot * 2 * Math.PI) / SLOTS;
const at = (a: number, r: number) => ({ x: Math.round(Math.cos(a) * r * STEP), y: Math.round(Math.sin(a) * r * STEP) });

const treeCache = new Map<Family, TreeNode[]>();

/** The whole tree for an army: the shared spokes and rings, and its own branch. */
export function treeFor(factionId: string): TreeNode[] {
  const fam = getFactionFamily(factionId);
  const hit = treeCache.get(fam);
  if (hit) return hit;
  const nodes: TreeNode[] = [{ id: 'start', name: 'Strike Force', kind: 'start', text: 'Where the tree starts. Always taken.', slot: 'start', x: 0, y: 0, links: [] }];
  const add = (n: TreeNode, from: string[]) => {
    nodes.push(n);
    for (const f of from) { n.links.push(f); nodes.find((x) => x.id === f)!.links.push(n.id); }
  };
  const branches = [...SPOKES, FAMILY_BRANCHES[fam]];
  branches.forEach((b, i) => {
    const a = angleOf(i);
    b.main.forEach((sp, d) => add({ ...sp, id: `${b.id}-${d + 1}`, kind: d === 6 ? 'keystone' : d === 2 || d === 5 ? 'notable' : 'small', slot: b.id, ...at(a, d + 1), links: [] }, [d ? `${b.id}-${d}` : 'start']));
    // side clusters: one off depth 2 to the left, one off depth 5 to the right
    const side = (list: Spec[] | undefined, from: number, dir: number, key: string) => list?.forEach((sp, k) => add(
      { ...sp, id: `${b.id}-${key}${k + 1}`, kind: k === 2 ? 'notable' : 'small', slot: b.id, ...at(a + dir * 0.3, from + 0.5 * (k + 1)), links: [] },
      [k ? `${b.id}-${key}${k}` : `${b.id}-${from}`]));
    side(b.sideA, 2, -1, 'a');
    side(b.sideB, 5, 1, 'b');
  });
  // inner ring at depth 4, outer ring between the tips of the shared spokes
  branches.forEach((b, i) => {
    const nb = branches[(i + 1) % SLOTS];
    add({ ...BRIDGES[i], id: `ring-${b.id}`, kind: 'small', slot: 'ring', ...at(angleOf(i + 0.5), 4.15), links: [] }, [`${b.id}-4`, `${nb.id}-4`]);
    if (i < CONVERSIONS.length) add({ ...CONVERSIONS[i], id: `outer-${b.id}`, kind: 'keystone', slot: 'ring', ...at(angleOf(i + 0.5), 7.6), links: [] }, [`${b.id}-7`, `${nb.id}-7`]);
  });
  treeCache.set(fam, nodes);
  return nodes;
}

export const branchName = (factionId: string) => FAMILY_BRANCHES[getFactionFamily(factionId)].name;
export const SLOT_NAMES: Record<string, string> = Object.fromEntries([...SPOKES.map((b) => [b.id, b.name]), ['ring', 'Ring'], ['start', 'Start']]);

// ---------- Renown, allocating and refunding ----------

/** The run fields the tree reads and writes (Run in campaign.ts carries them). */
export interface TreeRun {
  factionId: string;
  renown?: number;
  tree?: string[];
  refunds?: number;
  scrap: number;
  story: string[];
  path: string[];
  map: { id: string; kind: string }[];
}

export const RENOWN = { battle: 3, elite: 5, boss: 6, loss: 1, start: 3 } as const;

export const taken = (run: TreeRun) => new Set(['start', ...(run.tree ?? [])]);

export function canAllocate(run: TreeRun, id: string): boolean {
  const n = treeFor(run.factionId).find((x) => x.id === id);
  const t = taken(run);
  return !!n && !t.has(id) && (run.renown ?? 0) >= 1 && n.links.some((l) => t.has(l));
}

export function allocate<T extends TreeRun>(run: T, id: string): T {
  if (!canAllocate(run, id)) return run;
  const n = treeFor(run.factionId).find((x) => x.id === id)!;
  return { ...run, renown: (run.renown ?? 0) - 1, tree: [...(run.tree ?? []), id], story: [...run.story, `Army tree: ${n.name}`] };
}

export const refundCost = (run: TreeRun) => 20 + 10 * (run.refunds ?? 0);

/** Respec happens at an armory or a medicae tent. */
export function atRespecSpot(run: TreeRun): boolean {
  const here = run.map.find((n) => n.id === run.path[run.path.length - 1]);
  return here?.kind === 'armory' || here?.kind === 'medicae';
}

/** A node can be refunded when everything else taken stays connected to the start. */
export function canRefund(run: TreeRun, id: string): boolean {
  if (!(run.tree ?? []).includes(id) || run.scrap < refundCost(run) || !atRespecSpot(run)) return false;
  const nodes = treeFor(run.factionId);
  const left = new Set(['start', ...(run.tree ?? []).filter((x) => x !== id)]);
  const seen = new Set(['start']);
  const queue = ['start'];
  while (queue.length) {
    const id = queue.pop();
    for (const l of nodes.find((n) => n.id === id)!.links) if (left.has(l) && !seen.has(l)) { seen.add(l); queue.push(l); }
  }
  return seen.size === left.size;
}

export function refund<T extends TreeRun>(run: T, id: string): T {
  if (!canRefund(run, id)) return run;
  const n = treeFor(run.factionId).find((x) => x.id === id)!;
  const cost = refundCost(run);
  return { ...run, renown: (run.renown ?? 0) + 1, scrap: run.scrap - cost, refunds: (run.refunds ?? 0) + 1, tree: (run.tree ?? []).filter((x) => x !== id), story: [...run.story, `Army tree: refunded ${n.name} (-${cost} Scrap)`] };
}

// ---------- what the taken nodes give ----------

const takenNodes = (run: TreeRun) => { const t = taken(run); return treeFor(run.factionId).filter((n) => t.has(n.id)); };

/** nodes of each spoke taken (for threshold bonuses) */
const slotCounts = (nodes: TreeNode[]) => nodes.reduce<Record<string, number>>((a, n) => ({ ...a, [n.slot]: (a[n.slot] ?? 0) + 1 }), {});
const bonusOn = (n: TreeNode, counts: Record<string, number>) => !!n.bonus && (counts[n.slot] ?? 0) >= n.bonus.count;

export function treeCp(run: TreeRun): number {
  const nodes = takenNodes(run), c = slotCounts(nodes);
  return nodes.reduce((a, n) => a + (n.cp ?? 0) + (bonusOn(n, c) ? n.bonus!.cp ?? 0 : 0), 0);
}

export function treeScrap(run: TreeRun): number {
  const nodes = takenNodes(run), c = slotCounts(nodes);
  return nodes.reduce((a, n) => a + (n.scrap ?? 0) + (bonusOn(n, c) ? n.bonus!.scrap ?? 0 : 0), 0);
}

export const titanUnlocked = (run: TreeRun) => takenNodes(run).some((n) => n.titan);

// ---------- VETERAN and keywords ----------

export const VETERAN_BATTLES = 3;
export const isVeteran = (u: Pick<ArmyUnitEntry, 'battles'>) => (u.battles ?? 0) >= VETERAN_BATTLES;

/** The keywords a unit counts as for the tree: its own, VETERAN, then the conversion keystones. */
export function treeKeywords(keywords: string[], veteran: boolean, conversions: { from: string; to: string }[]): Set<string> {
  const k = new Set(keywords);
  if (veteran) k.add('VETERAN');
  for (const c of conversions) if (k.has(c.from)) k.add(c.to);
  return k;
}

const reaches = (n: Pick<Spec, 'units'>, k: Set<string>) => !n.units || n.units.split('|').some((w) => k.has(w));
const effectsOf = (n: TreeNode, counts: Record<string, number>): Effect[] => [...(n.e ? (Array.isArray(n.e) ? n.e : [n.e]) : []), ...(bonusOn(n, counts) && n.bonus!.e ? [n.bonus!.e] : [])];

/** How many units of the roster a node reaches ("Applies to 4 units"). */
export function unitsReached(run: TreeRun & { list: { units: ArmyUnitEntry[] } }, sheets: DatasheetData[], node: TreeNode): ArmyUnitEntry[] {
  if (!node.e && !node.bonus?.e) return [];
  const conv = takenNodes(run).flatMap((n) => (n.as ? [n.as] : []));
  if (node.as) conv.push(node.as);
  return run.list.units.filter((u) => {
    const d = sheets.find((x) => x.name === u.datasheet);
    return !!d && reaches(node, treeKeywords([...d.keywords, ...d.factionKeywords], isVeteran(u), conv));
  });
}

/** Put the taken nodes on the player's units for the whole battle. */
export function applyTree(s: GameState, run: TreeRun & { list: { units: ArmyUnitEntry[] } }, me: PlayerId = 0) {
  const nodes = takenNodes(run);
  const counts = slotCounts(nodes);
  const conv = nodes.flatMap((n) => (n.as ? [n.as] : []));
  for (const u of s.units.filter((x) => x.owner === me)) {
    // a unit is VETERAN when its body or a character leading it is
    const entries = run.list.units.filter((e) => u.id.endsWith(`-${e.uid}`) || run.list.units.some((b) => e.attachTo === b.uid && u.id.endsWith(`-${b.uid}`)));
    const k = treeKeywords([...u.keywords, ...u.factionKeywords], entries.some(isVeteran), conv);
    for (const n of nodes) {
      if (!reaches(n, k)) continue;
      for (const e of effectsOf(n, counts)) addTimed(s, u, { e: { ...e }, label: n.name, until: 'battle', by: me });
    }
  }
}
