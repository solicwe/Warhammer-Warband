// A campaign: a run of short battles across a branching map, roguelite style. The player starts with a small army of
// one faction and picks a road through the map: battles, elite enemies with a special rule, supply drops, armories,
// medicae tents, and a boss at the end.
import { addTimed } from '../rules-engine/effects';
import type { Effect } from '../rules-engine/effects';
import { canLeaderAttach, defaultWargear, pointsOptions, syncWargear } from './army';
import { AUX_EXCLUSIONS } from './autoList';
import type { ArmyList, ArmyUnitEntry, BotLevel, DatasheetData, FactionData, GameState, PlayerId, UnitState, WargearPick } from './types';
import { hasPicture } from './state';
import { applyTree, enemyTree, enemyTreePoints, fitsArmy, getFactionFamily, RENOWN, titanUnlocked, treeCp, treeFor, treeScrap } from './campaignTree';
import { MISSIONS, type DispositionId, type PrimaryDef } from './config';

export { getFactionFamily };

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
  /** army tree points (docs/04-campaign-tree.md) */
  renown?: number;
  /** army tree nodes taken, in order (the start is implicit) */
  tree?: string[];
  /** 3: the tree that fits the army (older saves are refunded once) */
  treeVersion?: number;
  /** tree nodes refunded this run (each refund costs more Scrap) */
  refunds?: number;
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

/** Relics: artefacts for the whole army (or units with a keyword), for every battle of the run. They give special
 *  rules only, never the numbers and re-rolls the army tree gives (docs/04-campaign-tree.md, rule 4); the text is
 *  written from the effect, so it always says what the relic does at its level. */
export interface Relic { id: string; name: string; text: string; units?: string; e: Effect; rare?: boolean; factionId?: string }
const ELIGIBLE: Record<string, string> = { shootAfterAdvance: 'can shoot after Advancing', shootAfterFallBack: 'can shoot after Falling Back',
  chargeAfterAdvance: 'can charge after Advancing', chargeAfterFallBack: 'can charge after Falling Back' };

const relic = (r: Omit<Relic, 'text'>): Relic => ({ ...r, text: relicText(r.e, r.units) });
const M = 'melee' as const, G = 'ranged' as const;
export const RELICS: Relic[] = [
  relic({ id: 'litany', name: 'Hymn of Hatred', units: 'BATTLELINE', e: { abilities: ['twin-linked'], attack: M } }),
  relic({ id: 'stimms', name: 'Stimm Injectors', units: 'INFANTRY', e: { fightOnDeath: 5 } }),
  relic({ id: 'plating', name: 'Sanctified Plating', units: 'VEHICLE', e: { defend: { ap: 1 } } }),
  relic({ id: 'smoke', name: 'Smoke Dischargers', units: 'VEHICLE', e: { defend: { cover: true } } }),
  relic({ id: 'blade', name: 'Master-crafted Blade', units: 'CHARACTER', e: { critWoundAp: 1, attack: M } }),
  relic({ id: 'overdrive', name: 'Machine Spirit Overdrive', units: 'VEHICLE', e: { eligible: ['shootAfterFallBack'] } }),
  relic({ id: 'sandals', name: 'Fleet of Foot', units: 'INFANTRY', e: { advanceSix: true } }),
  relic({ id: 'banner', name: 'Ancient Banner', units: 'BATTLELINE', e: { shockedOc: -1 } }),
  relic({ id: 'ledger', name: 'Grudge Ledger', e: { abilities: ['anti-vehicle 5+'], attack: G } }),
  relic({ id: 'barrels', name: 'Gyro-stabilised Mounts', e: { abilities: ['heavy'], attack: G } }),
  relic({ id: 'zeal', name: 'Zealous Fervour', e: { eligible: ['chargeAfterFallBack'] }, rare: true }),
  relic({ id: 'relentless', name: 'Relentless Advance', e: { abilities: ['assault'], attack: G } }),
  relic({ id: 'lethal', name: 'Venom-tipped Rounds', e: { abilities: ['anti-infantry 4+'], attack: G }, rare: true }),
  relic({ id: 'fury', name: 'Blessed Blades', e: { abilities: ['sustained hits 2'], attack: M }, rare: true }),
  relic({ id: 'iron', name: 'Iron Halo', units: 'CHARACTER', e: { defend: { inv: 4 } }, rare: true }),
  relic({ id: 'cache', name: 'Strategium Cache', e: { stratsWhileShocked: true } }),
  relic({ id: 'auspex', name: 'Targeting Auspex', e: { ignoreHitMods: true, attack: G } }),
  relic({ id: 'chains', name: 'Chain-blade Teeth', e: { abilities: ['anti-infantry 5+'], attack: M } }),
  relic({ id: 'hymn', name: 'Battle Hymn', e: { pileIn: 5, consolidate: 5 } }),
  relic({ id: 'servo', name: 'Servo-arm Repairs', units: 'VEHICLE', e: { defend: { damage: 1 } } }),
  relic({ id: 'jump', name: 'Overcharged Thrusters', e: { chargeThroughModels: true } }),
  relic({ id: 'bulwark', name: 'Bulwark Doctrine', units: 'BATTLELINE', e: { defend: { wound: -1 } } }),
  relic({ id: 'veterans', name: 'Marksman\'s Honours', units: 'BATTLELINE', e: { critHitOn: 5, attack: G } }),
  relic({ id: 'brutes', name: 'Brute Strength', units: 'MONSTER|WALKER', e: { abilities: ['devastating wounds'], attack: M } }),
  relic({ id: 'mantle', name: 'Hero\'s Mantle', units: 'CHARACTER', e: { defend: { negateOnce: 'battle', negateUses: 1 } } }),
  relic({ id: 'rounds', name: 'Hellfire Rounds', e: { abilities: ['anti-monster 4+'], attack: G }, rare: true }),
  relic({ id: 'firstblow', name: 'Lightning Reflexes', units: 'CHARACTER', e: { fightsFirst: true }, rare: true }),
  relic({ id: 'reaper', name: 'Reaper\'s Edge', e: { abilities: ['lance'], attack: M }, rare: true }),
  relic({ id: 'shield', name: 'Storm Shield Drills', units: 'INFANTRY', e: { defend: { inv: 5 } }, rare: true }),
  relic({ id: 'devastate', name: 'Executioner Shells', e: { abilities: ['devastating wounds'], attack: G }, rare: true }),
  relic({ id: 'grip', name: 'Iron Grip', e: { eligible: ['shootAfterAdvance'] }, rare: true }),
  relic({ id: 'void_shield', name: 'Void Shield Generator', units: 'VEHICLE|MONSTER', e: { defend: { inv: 4 } }, rare: true }),
  relic({ id: 'digi_weapons', name: 'Digital Weapons', units: 'CHARACTER', e: { critHitOn: 5, attack: M }, rare: true }),
  relic({ id: 'plasma_coils', name: 'Supercharged Coils', e: { abilities: ['melta 2'], attack: G }, rare: true }),
  relic({ id: 'teleport_beacon', name: 'Teleport Transponder', e: { throughTerrain: true }, rare: true }),
  relic({ id: 'shock_assault', name: 'Shock Assault Doctrine', e: { eligible: ['chargeAfterAdvance'] } }),
  relic({ id: 'adamantine_will', name: 'Adamantine Will', e: { defend: { inv: 4, invVs: 'psychic' } } }),
  // the army's own relics
  relic({ id: 'sm_indomitus', factionId: 'SM', name: 'Armor of the Indomitus', units: 'INFANTRY', e: { defend: { damage: 1 } }, rare: true }),
  relic({ id: 'tyr_synaptic_chitin', factionId: 'TYR', name: 'Synaptic Chitin Weave', e: { critHitOn: 5, attack: M }, rare: true }),
  relic({ id: 'ork_cybork', factionId: 'ORK', name: 'Super-Cybork Body', e: { defend: { inv: 5 } }, rare: true }),
  relic({ id: 'am_kurov_aquila', factionId: 'AM', name: 'Kurov\'s Aquila', e: { stratsWhileShocked: true, ordersStayShocked: true }, rare: true }),
  relic({ id: 'csm_liber', factionId: 'CSM', name: 'Liber Hereticus', e: { abilities: ['devastating wounds'], attack: M }, rare: true }),
  relic({ id: 'gc_ambush_banner', factionId: 'GC', name: 'Icon of the Cult Unveiled', e: { eligible: ['chargeAfterAdvance'], advanceSix: true }, rare: true }),
  relic({ id: 'nec_veil', factionId: 'NEC', name: 'Veil of Darkness', units: 'INFANTRY', e: { defend: { inv: 4 } }, rare: true }),
  relic({ id: 'tau_puretide', factionId: 'TAU', name: 'Puretide Engram Chip', e: { abilities: ['twin-linked'], ignoreHitMods: true, attack: G }, rare: true }),
  relic({ id: 'ac_auramite', factionId: 'AC', name: 'Auramite Bastion', e: { defend: { damage: 1 } }, rare: true }),
  relic({ id: 'gk_nemesis_soul', factionId: 'GK', name: 'Soul-warding Glaives', e: { abilities: ['devastating wounds', 'anti-psyker 4+'], attack: M }, rare: true }),
  relic({ id: 'dru_crucible', factionId: 'DRU', name: 'Crucible of Agonies', e: { abilities: ['anti-infantry 4+'] }, rare: true }),
  relic({ id: 'ae_phoenix_gem', factionId: 'AE', name: 'Phoenix Gem of Asuryan', e: { defend: { inv: 4 } }, rare: true }),
  relic({ id: 'dg_plague_skull', factionId: 'DG', name: 'Plague Skull of Glothila', e: { defend: { wound: -1 } }, rare: true }),
  relic({ id: 'ts_athanaean', factionId: 'TS', name: 'Athenaean Sorcery Scrolls', e: { abilities: ['devastating wounds'], critHitOn: 5, attack: G }, rare: true }),
  relic({ id: 'we_brazen_glaive', factionId: 'WE', name: 'Berzerker Glaive of Khorne', e: { fightsFirst: true, pileIn: 5, consolidate: 5 }, rare: true }),
  relic({ id: 'lov_crest', factionId: 'LoV', name: 'Ancestral Hearth Crest', e: { defend: { ap: 1 } }, rare: true }),
  relic({ id: 'adm_autocaduceus', factionId: 'AdM', name: 'Autocaduceus of Arkhan Land', units: 'VEHICLE', e: { defend: { inv: 4 } }, rare: true }),
  relic({ id: 'cd_argath', factionId: 'CD', name: 'A\'rgath, King of Blades', e: { critHitOn: 5, mortalPerWound: 1, attack: M }, rare: true }),
  relic({ id: 'as_saint_lucius', factionId: 'AS', name: 'Book of Saint Lucius', e: { defend: { inv: 5 }, fightOnDeath: 5 }, rare: true }),
  relic({ id: 'aoi_rosette', factionId: 'AoI', name: 'Rosette of the Inquisitor Lord', e: { critWoundAp: 1, ignoreHitMods: true, attack: G }, rare: true }),
  relic({ id: 'qi_sanctuary', factionId: 'QI', name: 'Sanctuary Ion Shield', e: { defend: { inv: 4 } }, rare: true }),
  relic({ id: 'qt_warpsight', factionId: 'QT', name: 'Helm of Warpsight', e: { critHitOn: 5, attack: G }, rare: true }),
  // wild relics
  relic({ id: 'wild_phase_shift', name: 'Phase-Shift Distortion Drives', e: { throughTerrain: true, moveThroughModels: true }, rare: true }),
  relic({ id: 'wild_chain_lightning', name: 'Arcing Lightning Munitions', e: { critHitOn: 5, mortalPerWound: 1, attack: G }, rare: true }),
  relic({ id: 'wild_kinetic_deflector', name: 'Reactive Kinetic Deflectors', e: { defend: { reflect6: true }, retaliate: { on: 6, max: 6 } }, rare: true }),
  relic({ id: 'wild_death_burst', name: 'Spiteful Plasma Overload Core', e: { demiseSure: { range: 6 } }, rare: true }),
  relic({ id: 'nec_hypercrypt', factionId: 'NEC', name: 'Hypercrypt Reanimation Matrix', e: { defend: { negateOnce: 'turn' } }, rare: true }),
  relic({ id: 'am_overlapping_vox', factionId: 'AM', name: 'Tactical Vox Relay Grid', e: { eligible: ['shootAfterFallBack'], ignoreHitMods: true }, rare: true }),
  relic({ id: 'sm_artificer_plasma', factionId: 'SM', name: 'Artificer Plasma', e: { abilities: ['sustained hits 2'], attack: G }, rare: true }),
  relic({ id: 'ork_endless_waaagh', factionId: 'ORK', name: 'Endless WAAAGH! Frenzy', e: { abilities: ['sustained hits 2'], attack: M }, rare: true }),
  relic({ id: 'csm_spiteful_daemon', factionId: 'CSM', name: 'Spiteful Daemonic Fury', e: { critHitOn: 5, mortalPerWound: 1, attack: M }, rare: true }),
  relic({ id: 'tyr_hyper_evolution', factionId: 'TYR', name: 'Hyper-Evolution Feeding Tendrils', e: { throughTerrain: true, chargeThroughModels: true }, rare: true }),
];
export const relicById = (id: unknown) => {
  const key = typeof id === 'string' ? id : (id && typeof id === 'object' ? String((id as any).id || (id as any).name || '') : String(id ?? ''));
  const upper = key.toUpperCase();
  return RELICS.find((r) => r.id === key || r.id.toUpperCase() === upper || r.name.toUpperCase() === upper);
};

export function relicLevel(run: Run, id: string): number {
  return run.relicLevels?.[id] ?? (run.relics.includes(id) ? 1 : 0);
}

/** A relic one level up: thresholds drop (4+ invulnerable becomes 3+, Critical Hits on 5+ become 4+), amounts grow.
 *  A relic with nothing to grow stays at level 1 (relicMaxLevel). */
export function scaleRelicEffect(e: Effect, lvl: number): Effect {
  if (lvl <= 1) return { ...e };
  const up = lvl - 1, out: Effect = { ...e };
  if (out.critHitOn) out.critHitOn = Math.max(4, out.critHitOn - up);
  if (out.critWoundAp) out.critWoundAp += up;
  if (out.mortalPerWound) out.mortalPerWound = Math.min(2, out.mortalPerWound + up);
  if (out.fightOnDeath) out.fightOnDeath = Math.max(3, out.fightOnDeath - up);
  if (out.pileIn) out.pileIn += up;
  if (out.consolidate) out.consolidate += up;
  if (out.retaliate) out.retaliate = { ...out.retaliate, on: Math.max(4, out.retaliate.on - up) };
  if (out.demiseSure) out.demiseSure = { ...out.demiseSure, range: out.demiseSure.range + 3 * up };
  if (out.defend) {
    const d = (out.defend = { ...out.defend });
    if (d.inv) d.inv = Math.max(3, d.inv - up);
    if (d.damage) d.damage = Math.min(2, d.damage + up);
    if (d.ap) d.ap = Math.min(2, d.ap + up);
    if (d.negateOnce === 'battle') d.negateUses = (d.negateUses ?? 1) + up;
  }
  if (out.abilities?.length) {
    out.abilities = out.abilities.map((a) => a.replace(/^(sustained hits) (\d)$/, (_, w, n) => `${w} ${Math.min(3, +n + up)}`)
      .replace(/^(anti-[a-z ]+) (\d)\+$/, (_, w, n) => `${w} ${Math.max(2, +n - up)}+`)
      .replace(/^melta (\d)$/, (_, n) => `melta ${+n * lvl}`));
  }
  return out;
}

/** how far a relic can level up: as long as a level still changes something (at most 3; Fights First or [LANCE] stay at 1) */
export function relicMaxLevel(r: Relic): number {
  let lvl = 1;
  while (lvl < 3 && JSON.stringify(scaleRelicEffect(r.e, lvl + 1)) !== JSON.stringify(scaleRelicEffect(r.e, lvl))) lvl++;
  return lvl;
}

/** What a relic does, from its effect: "CHARACTER units: 4+ invulnerable save." */
export function relicText(e: Effect, units?: string): string {
  const w = e.attack ? `${e.attack} ` : '', d = e.defend ?? {}, out: string[] = [];
  if (e.abilities?.length) out.push(`${w}weapons have ${e.abilities.map((a) => `[${a.toUpperCase()}]`).join(' and ')}`);
  if (e.critHitOn) out.push(`${w}Critical Hits on ${e.critHitOn}+`);
  if (e.critWoundAp) out.push(`${w}Critical Wounds get +${e.critWoundAp} AP`);
  if (e.mortalPerWound) out.push(`each ${w}attack that wounds also deals ${e.mortalPerWound} mortal wound${e.mortalPerWound > 1 ? 's' : ''}`);
  if (e.ignoreHitMods) out.push(`${w}attacks ignore modifiers to the Hit roll`);
  if (e.fightsFirst) out.push('Fights First');
  if (e.fightOnDeath) out.push(`destroyed in melee before fighting: on a ${e.fightOnDeath}+ fights first`);
  if (e.pileIn) out.push(`Pile-in and Consolidation moves of up to ${e.pileIn}"`);
  for (const x of e.eligible ?? []) out.push(ELIGIBLE[x] ?? x);
  if (e.advanceSix) out.push('Advance rolls count as 6');
  if (e.throughTerrain) out.push('moves through terrain features');
  if (e.moveThroughModels) out.push('moves through models');
  if (e.chargeThroughModels) out.push('charges through models other than MONSTER and VEHICLE');
  if (e.retaliate) out.push(`each melee attack allocated to it: on a ${e.retaliate.on}+ the attacker takes 1 mortal wound`);
  if (e.demiseSure) out.push(`friendly models destroyed within ${e.demiseSure.range}" set off Deadly Demise without a roll`);
  if (e.stratsWhileShocked) out.push('can be targeted by Stratagems while Battle-shocked');
  if (e.ordersStayShocked) out.push('keeps its Orders while Battle-shocked');
  if (e.shockedOc) out.push(e.shockedOc < 0 ? `keeps its OC (${e.shockedOc}) while Battle-shocked` : `OC ${e.shockedOc} while Battle-shocked`);
  if (d.inv) out.push(`${d.inv}+ invulnerable save${d.invVs === 'psychic' ? ' against Psychic Attacks' : ''}`);
  if (d.damage) out.push(`-${d.damage} Damage taken`);
  if (d.wound) out.push(`attacks against it ${d.wound} to Wound`);
  if (d.ap) out.push(`attacks against it worsen AP by ${d.ap}`);
  if (d.cover) out.push('always has the Benefit of Cover');
  if (d.reflect6) out.push('each saving throw of 6 against a ranged attack deals 1 mortal wound back');
  if (d.negateOnce) out.push(`${(d.negateUses ?? 1) > 1 ? `${d.negateUses} times` : 'once'} per ${d.negateOnce}: a failed saving throw deals no damage`);
  const body = out.join('; ');
  return `${units ? `${units.split('|').join(' and ')} units` : 'Every unit'}: ${body}.`;
}

export const relicDesc = (r: Relic, lvl = 1): string => relicText(scaleRelicEffect(r.e, lvl), r.units);

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
    path: [], relics: [], relicLevels: {}, renown: RENOWN.start, tree: [], treeVersion: 3, freeRerolls: 1, cp: 0, fate: 3, scrap: 120, story: [`${faction.name}: the campaign begins.`], wins: 0, started: Date.now(),
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
    && hasPicture(d.name));
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
  // a relic held comes back as an upgrade until its top level (Vampire Survivors style); only relics of no army or of
  // this one, and only for units the army can field
  const eligibleRelics = RELICS.filter((x) => {
    if (x.factionId && x.factionId !== faction.id) return false;
    if (x.units && !fitsArmy(faction.id, { units: x.units })) return false;
    return (run.relicLevels?.[x.id] ?? (run.relics.includes(x.id) ? 1 : 0)) < relicMaxLevel(x);
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
          hasPicture(ld.name) &&
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
  // the depot: pick one of two bigger reinforcements or a relic (a relic already held levels up)
  if (kind === 'armory') return [...units(2, cap + 60), ...relics(false).slice(0, 1)];
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
  if (node.kind === 'armory') return { ...run, path: [...run.path, nodeId], scrap: (run.scrap ?? 0) + 25, offer: makeOffer(run, faction, 'armory'), story: [...run.story, 'Munitorum Depot (+25 Scrap)'] };
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
      renown: (run.renown ?? 0) + RENOWN.loss,
      list: { ...run.list, units: run.list.units.map((u) => ({ ...u, battles: (u.battles ?? 0) + 1 })) },
      over: fate <= 0 ? 'lost' : undefined,
      story: [...run.story, `Defeated by ${enemyName} (-1 Fate, +${RENOWN.loss} Renown${salvage > 0 ? `, +${salvage} Scrap salvaged` : ''})${fate > 0 ? ` · ${fate} Fate left` : ''}`],
    };
  }
  const baseGain = node.kind === 'boss' ? 120 : node.kind === 'elite' ? 70 : 45;
  const scrapTechBonus = treeScrap(run);
  const scrapGain = Math.max(0, baseGain + (battleScrap || 0) + scrapTechBonus);
  const renownGain = node.kind === 'boss' ? RENOWN.boss : node.kind === 'elite' ? RENOWN.elite : RENOWN.battle;
  // every unit counts the battle towards VETERAN
  const updatedUnits = run.list.units.map((u) => ({ ...u, battles: (u.battles ?? 0) + 1 }));
  const next: Run = {
    ...run,
    fighting: undefined,
    path: [...run.path, node.id],
    wins: run.wins + 1,
    scrap: (run.scrap ?? 0) + scrapGain,
    renown: (run.renown ?? 0) + renownGain,
    freeRerolls: 1,
    list: { ...run.list, units: updatedUnits },
    story: [...run.story, `${winner === 'draw' ? 'Held off' : 'Victory over'} ${enemyName} (+${scrapGain} Scrap${battleScrap > 0 ? `: ${baseGain} victory + ${battleScrap} battle loot` : ''}${scrapTechBonus ? ` ${scrapTechBonus > 0 ? '+' : '-'} ${Math.abs(scrapTechBonus)} army tree` : ''}, +${renownGain} Renown)${node.kind === 'boss' ? ' — the Warlord is vanquished!' : ''}`],
  };
  next.picksLeft = node.kind === 'boss' ? 2 : 1;
  next.offer = makeOffer(next, faction, node.kind);
  return next;
}

const hasKwIn = (u: UnitState, units?: string) => !units || units.split('|').some((k) => (u.keywords || []).some((kw) => safeUpper(kw) === safeUpper(k)));

/** Put the run's relics on the player's army and the enemy's special rules on theirs, for the whole battle. */
export function applyCampaign(s: GameState, run: Run, rules: (string | { id?: string; name?: string })[]) {
  const me: PlayerId = 0, foe: PlayerId = 1;
  // the primary mission comes from the battle (campaignMission, passed to createGame); boss and elite fights are
  // won on VP like the others
  // the enemy's army tree grows with the player's
  const node = run.map.find((n) => n.id === run.fighting);
  if (node?.enemy) {
    const foeTree = { factionId: s.players[foe].factionId, tree: enemyTree(s.players[foe].factionId, enemyTreePoints(run.tree?.length ?? 0, node.kind), node.enemy.seed) };
    applyTree(s, { ...foeTree, list: { units: [] } }, foe);
    s.players[foe].cp += treeCp(foeTree);
  }

  for (const rawId of run.relics) {
    const r = relicById(rawId);
    const id = r?.id ?? (typeof rawId === 'string' ? rawId : String((rawId as any)?.id || ''));
    if (!r) continue;
    const lvl = run.relicLevels?.[id] ?? 1;
    const eff = scaleRelicEffect(r.e, lvl);
    for (const u of s.units.filter((x) => x.owner === me && hasKwIn(x, r.units))) {
      addTimed(s, u, { e: eff, label: lvl > 1 ? `${r.name} Lv.${lvl}` : r.name, until: 'battle', by: me });
    }
  }
  applyTree(s, run, me);
  const cleanRules: string[] = [];
  for (const rawId of rules) {
    const b = bossRuleById(rawId);
    if (!b) continue;
    cleanRules.push(b.id);
    for (const u of s.units.filter((x) => x.owner === foe && hasKwIn(x, b.units))) {
      addTimed(s, u, { e: { ...b.e }, label: b.name, until: 'battle', by: foe });
    }
  }
  s.players[me].cp += run.cp + treeCp(run);
  s.campaign = { node: run.fighting ?? '', relics: [...run.relics.map((r: any) => typeof r === 'string' ? r : String(r?.id || r?.name || ''))], rules: cleanRules, relicLevels: { ...(run.relicLevels ?? {}) } };
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
  if (!hasPicture(d.name)) return run;
  if (!canRecruitTitanOrKnight(faction.id, d, run)) return run;
  if ((d.keywords || []).includes('EPIC HERO') && run.list.units.some((x) => x.datasheet === d.name)) return run;
  const opts = pointsOptions(d);
  const o = (chosenModels ? opts.find((x) => x.models === chosenModels) : undefined) ?? cheapest(d);
  if (!o) return run;
  const cost = recruitScrapCost(run, d.name, o.pts);
  if ((run.scrap ?? 0) < cost) return run;
  const uid = `c${run.path.length}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const e: ArmyUnitEntry = syncWargear(d, defaultWargear(d, {
    uid,
    datasheet: d.name,
    models: o.models,
    pts: o.pts,
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


  const combinedEntry: ArmyUnitEntry = syncWargear(d, defaultWargear(d, {
    ...target,
    models: matchedOpt.models,
    pts: matchedOpt.pts,
    battles: Math.max(target.battles ?? 0, source.battles ?? 0),
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

/** Scrap to adopt a detachment, by its Detachment Points: the bigger the detachment, the dearer. */
export const DETACHMENT_SCRAP: Record<number, number> = { 1: 60, 2: 110, 3: 170 };
export const detachmentScrapCost = (d: { dp?: number }) => DETACHMENT_SCRAP[d.dp ?? 2] ?? DETACHMENT_SCRAP[3];

/** Requisition / adopt a new detachment into the campaign army using Scrap */
export function adoptDetachment(run: Run, detachmentName: string, cost: number): Run {
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

/** TITANIC units and big Knights need the Titan Requisition keystone of the army tree */
export function requiresTitanRequisition(targetDatasheet: DatasheetData): boolean {
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
  // a Knight army's own Knights are its core, not a requisition
  if (!targetDatasheet.ally && ((factionId === 'QI' && targetDatasheet.factionKeywords?.includes('IMPERIAL KNIGHTS')) || (factionId === 'QT' && targetDatasheet.factionKeywords?.includes('CHAOS KNIGHTS')))) return true;
  return !requiresTitanRequisition(targetDatasheet) || titanUnlocked(run);
}

/** Runs saved before the army tree: honors, experience and the old tech tree go; Renown is given back (wins x 3 + 3)
 *  and each unit keeps its battles from its old experience. */
export function migrateRun(run: Run): Run {
  const old = run as Run & { techTree?: string[]; datasheetHonors?: unknown };
  const units = run.list.units as (ArmyUnitEntry & { xp?: number; honors?: string[] })[];
  if (run.renown !== undefined && !old.techTree && !old.datasheetHonors && !units.some((u) => u.xp !== undefined || u.honors)) return pruneTree(run);
  const { techTree: _t, datasheetHonors: _d, ...rest } = old;
  return pruneTree({
    ...rest,
    renown: run.renown ?? run.wins * RENOWN.battle + RENOWN.start,
    tree: run.tree ?? [],
    list: { ...run.list, units: units.map(({ xp, honors: _h, ...u }) => ({ ...u, battles: u.battles ?? xp ?? 0 })) },
  });
}

/** Tree v3 (every node fits the army, docs/04-campaign-tree.md): the same node id can now hold a different node, so
 *  every taken node of an older tree is given back as Renown once, to spend again. */
export function pruneTree(run: Run): Run {
  if ((run.treeVersion ?? 1) >= 3) return run;
  const back = (run.tree ?? []).length;
  return { ...run, treeVersion: 3, tree: [], renown: (run.renown ?? 0) + back,
    story: back ? [...run.story, `The army tree was redrawn to fit the army: ${back} node${back > 1 ? 's' : ''} refunded as Renown`] : run.story };
}

/** A campaign battle is a normal battle: the official primary mission, Tactical secondaries and five rounds. Only the
 *  Force Dispositions are drawn at random (by the battle's seed, so the same battle always plays the same mission). */
export function campaignMission(node: MapNode): { primary: PrimaryDef; dispositions: [DispositionId, DispositionId]; secondaryMode: 'tactical'; maxRounds: number } {
  const all = MISSIONS.primaries;
  const primary = all[(node.enemy?.seed ?? 0) % all.length];
  return { primary, dispositions: [primary.forceDisposition, primary.vs], secondaryMode: 'tactical', maxRounds: 5 };
}

/** Detachments an enemy brings: one more for every 3 battles won and every sector after the first, one more for an
 *  elite or a boss; at most 4. */
export const enemyDetachmentCount = (run: Pick<Run, 'wins' | 'loop'>, kind: NodeKind) =>
  Math.min(4, 1 + Math.floor(run.wins / 3) + ((run.loop ?? 1) - 1) + (kind === 'elite' || kind === 'boss' ? 1 : 0));

/** The enemy's detachments: the list's own first, then others of its army (no Chapter-only ones), picked by the seed. */
export function enemyDetachments(f: FactionData, own: string[], n: number, seed: number): string[] {
  const r = rng(seed);
  const pool = f.detachments.filter((d) => !d.subfaction && d.forceDisposition && !own.includes(d.name)).map((d) => d.name);
  const out = [...own];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out.slice(0, Math.max(n, own.length ? 1 : 0));
}
