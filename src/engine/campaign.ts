// A campaign: a run of short battles across a branching map, roguelite style. The player starts with a small army of
// one faction and picks a road through the map: battles, elite enemies with a special rule, supply drops, armories,
// medicae tents, and a boss at the end.
import { addTimed } from './effects';
import type { Effect } from './effects';
import { defaultWargear, syncWargear } from './army';
import type { ArmyList, ArmyUnitEntry, BotLevel, DatasheetData, FactionData, GameState, PlayerId, UnitState, WargearPick } from './types';

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

export type Reward =
  | { kind: 'unit'; datasheet: string; models: number; pts: number }
  | { kind: 'relic'; id: string }
  | { kind: 'cp' }
  | { kind: 'scrap'; amount: number }
  | { kind: 'fate'; amount: number };

export interface BattleHonor {
  id: string;
  name: string;
  desc: string;
  cost: number;
  e: Effect;
}

export const BATTLE_HONORS: BattleHonor[] = [
  { id: 'hardened', name: 'Hardened Armor', desc: '+1 Toughness characteristic.', cost: 60, e: { toughness: 1 } },
  { id: 'weapon_master', name: 'Weapon Masters', desc: 'Improve Ballistic Skill and Weapon Skill by 1.', cost: 75, e: { skill: 1 } },
  { id: 'swift', name: 'Swift Assault', desc: '+2" Move, and +1 to Advance and Charge rolls.', cost: 50, e: { move: 2, advanceBonus: 1, chargeBonus: 1 } },
  { id: 'master_crafted', name: 'Master-crafted Weapons', desc: 'Improve the AP of all attacks by 1.', cost: 80, e: { ap: 1 } },
  { id: 'iron_will', name: 'Iron Will', desc: 'Models have Feel No Pain 6+, and re-roll Battle-shock tests.', cost: 70, e: { defend: { fnp: 6 }, rerollShock: true } },
  { id: 'lethal_spec', name: 'Deadly Marksmen', desc: 'Ranged attacks have [LETHAL HITS].', cost: 90, e: { abilities: ['lethal hits'], attack: 'ranged' } },
  { id: 'sustained_fury', name: 'Savage Frenzy', desc: 'Melee attacks have [SUSTAINED HITS 1].', cost: 90, e: { abilities: ['sustained hits 1'], attack: 'melee' } },
  { id: 'reinforced_save', name: 'Reinforced Carapace', desc: 'Add 1 to saving throws against all attacks.', cost: 85, e: { defend: { save: 1 } } },
  { id: 'heroic_strike', name: 'Heroic Might', desc: '+1 Attack characteristic on melee weapons.', cost: 65, e: { attacks: 1, attack: 'melee' } },
  { id: 'range_finders', name: 'Advanced Targeters', desc: 'Ranged weapons gain +4" range and ignore cover.', cost: 60, e: { rangeBonus: 4, abilities: ['ignores cover'], attack: 'ranged' } },
];
export const battleHonorById = (id: string) => BATTLE_HONORS.find((h) => h.id === id);

export interface Run {
  version: 1;
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
  /** the battle being fought */
  fighting?: string;
  /** rewards to pick one from */
  offer?: Reward[];
  picksLeft?: number;
  freeRerolls?: number;
  rerollCount?: number;
  /** what happened, newest last */
  story: string[];
  over?: 'won' | 'lost';
  wins: number;
  started: number;
}

/** Relics: rules on the player's whole army (or on units with a keyword), for every battle of the run. */
export interface Relic { id: string; name: string; text: string; units?: string; e: Effect; rare?: boolean }
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
];
export const relicById = (id: string) => RELICS.find((r) => r.id === id);

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
];
export const bossRuleById = (id: string) => BOSS_RULES.find((r) => r.id === id);

const RUN_KEY = 'campaign-run';

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
const LEVEL_BY_LAYER: BotLevel[] = ['easy', 'normal', 'normal', 'normal', 'hard', 'hard', 'hard'];

/** The map: seven layers, each node leading to one or two nodes of the next; the last is the boss. */
export function makeMap(seed: number, enemies: string[]): MapNode[] {
  const r = rng(seed * 7919 + 13);
  const nodes: MapNode[] = [];
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
        const pts = Math.round((450 + layer * 90 + (kind === 'elite' ? 150 : 0) + (kind === 'boss' ? 300 : 0)) / 10) * 10;
        const rules = kind === 'elite' ? pickN(BOSS_RULES, 1, r).map((b) => b.id) : kind === 'boss' ? pickN(BOSS_RULES, 2, r).map((b) => b.id) : [];
        const level: BotLevel = kind === 'boss' ? 'hard' : kind === 'elite' ? (layer >= 4 ? 'hard' : 'normal') : LEVEL_BY_LAYER[layer];
        node.enemy = { factionId: enemies[Math.floor(r() * enemies.length)], pts, level, rules, seed: Math.floor(r() * 1e9) };
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
  return {
    version: 1, seed: seed >>> 0, factionId: faction.id, list, map: makeMap(seed >>> 0, enemies.filter((e) => e !== faction.id && e !== 'TL')),
    path: [], relics: [], relicLevels: {}, freeRerolls: 1, cp: 0, fate: 3, scrap: 120, story: [`${faction.name}: the campaign begins.`], wins: 0, started: Date.now(),
  };
}

/** Where the player can go next: the first layer at the start, else the roads from where they stand. */
export function reachable(run: Run): MapNode[] {
  if (run.over || run.offer) return [];
  const at = run.path.length ? run.map.find((n) => n.id === run.path[run.path.length - 1]) : null;
  return at ? run.map.filter((n) => at.next.includes(n.id)) : run.map.filter((n) => n.layer === 0);
}

const usable = (f: FactionData, main?: string) => f.datasheets.filter((d) => !d.ally && d.points[0]?.options?.length && !d.subfaction && d.models.length && d.weapons.length
  && !d.keywords.includes('FORTIFICATION') && !d.keywords.includes('AIRCRAFT') && !d.keywords.includes('EPIC HERO') && !d.transport && (!main || d.factionKeywords.includes(main)));
export const cheapest = (d: DatasheetData) => [...d.points[0].options].sort((a, b) => a.pts - b.pts)[0];
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
  const eligibleRelics = RELICS.filter((x) => (run.relicLevels?.[x.id] ?? (run.relics.includes(x.id) ? 1 : 0)) < maxLvl);
  const count = (kind === 'boss' || kind === 'elite') ? 5 : 3;
  const relics = (rare: boolean) => pickN(eligibleRelics.filter((x) => rare || !x.rare), count, r).map((x): Reward => ({ kind: 'relic', id: x.id }));
  const units = (n: number, cap: number) => pickN(usable(faction, mainKeyword(faction)).filter((d) => { const o = cheapest(d); return o.pts >= 50 && o.pts <= cap; }), n, r)
    .map((d): Reward => { const o = cheapest(d); return { kind: 'unit', datasheet: d.name, models: o.models, pts: o.pts }; });
  if (kind === 'elite' || kind === 'boss') return relics(true);
  const cap = 140 + run.path.length * 25;
  const scrapReward: Reward = { kind: 'scrap', amount: Math.round(60 + r() * 50) };
  if (kind === 'supply') return [...units(1, cap), ...relics(false).slice(0, 1), scrapReward];
  // a won battle: one new unit, one relic, or scrap/cp
  return [...units(1, cap), ...relics(false).slice(0, 1), scrapReward];
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
    next.list = { ...run.list, units: [...run.list.units, e] };
    next.story.push(`Reinforcements: ${rw.datasheet}`);
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
  if (node.kind === 'armory') return { ...run, path: [...run.path, nodeId], scrap: (run.scrap ?? 0) + 40, story: [...run.story, 'Munitorum Armory reached (+40 Scrap)'] };
  if (node.kind === 'medicae') return { ...run, path: [...run.path, nodeId], story: [...run.story, 'Medicae Field Camp reached'] };
  return { ...run, fighting: nodeId };
}

/** The battle's result: a win moves the player on and offers rewards, a loss costs a Fate point (a draw counts as a win). */
export function afterBattle(run: Run, winner: PlayerId | 'draw' | null, faction: FactionData, enemyName: string): Run {
  if (!run.fighting) return run;
  const node = run.map.find((n) => n.id === run.fighting)!;
  if (winner === 1) {
    const fate = run.fate - 1;
    return { ...run, fighting: undefined, fate, over: fate <= 0 ? 'lost' : undefined, story: [...run.story, `Defeated by ${enemyName}${fate > 0 ? ` · ${fate} Fate left` : ''}`] };
  }
  const scrapGain = node.kind === 'boss' ? 300 : node.kind === 'elite' ? 140 : 70;
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
    story: [...run.story, `${winner === 'draw' ? 'Held off' : 'Victory over'} ${enemyName} (+${scrapGain} Scrap)${node.kind === 'boss' ? ' — the Warlord is vanquished!' : ''}`],
  };
  next.picksLeft = node.kind === 'boss' ? 2 : 1;
  next.offer = makeOffer(next, faction, node.kind);
  return next;
}

const hasKwIn = (u: UnitState, units?: string) => !units || units.split('|').some((k) => u.keywords.includes(k));

/** Put the run's relics on the player's army and the enemy's special rules on theirs, for the whole battle. */
export function applyCampaign(s: GameState, run: Run, rules: string[]) {
  const me: PlayerId = 0, foe: PlayerId = 1;
  for (const id of run.relics) {
    const r = relicById(id);
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
  for (const id of rules) {
    const b = bossRuleById(id);
    if (!b) continue;
    for (const u of s.units.filter((x) => x.owner === foe && hasKwIn(x, b.units))) addTimed(s, u, { e: { ...b.e }, label: b.name, until: 'battle', by: foe });
  }
  const cacheLvl = run.relicLevels?.['cache'] ?? (run.relics.includes('cache') ? 1 : 0);
  s.players[me].cp += run.cp + (cacheLvl > 1 ? cacheLvl - 1 : 0);
  s.campaign = { node: run.fighting ?? '', relics: [...run.relics], rules: [...rules], relicLevels: { ...(run.relicLevels ?? {}) } };
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

/** Buy and recruit a new unit into the campaign roster using Scrap */
export function recruitUnit(run: Run, faction: FactionData, datasheetName: string): Run {
  const d = faction.datasheets.find((x) => x.name === datasheetName && !x.ally);
  if (!d) return run;
  const o = cheapest(d);
  if (!o || (run.scrap ?? 0) < o.pts) return run;
  const uid = `c${run.path.length}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const e: ArmyUnitEntry = syncWargear(d, defaultWargear(d, { uid, datasheet: d.name, models: o.models, pts: o.pts }));
  return {
    ...run,
    scrap: (run.scrap ?? 0) - o.pts,
    list: { ...run.list, units: [...run.list.units, e] },
    story: [...run.story, `Recruited: ${d.name} (${o.pts} pts)`],
  };
}

/** Retire / dismiss a unit from the campaign roster */
export function dismissUnit(run: Run, unitUid: string): Run {
  if (run.list.units.length <= 1) return run;
  const target = run.list.units.find((u) => u.uid === unitUid);
  const units = run.list.units.filter((u) => u.uid !== unitUid);
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

export function loadRun(): Run | null {
  try {
    const v = JSON.parse(localStorage.getItem(RUN_KEY) ?? 'null') as Run | null;
    return v && v.version === 1 && Array.isArray(v.map) ? v : null;
  } catch { return null; }
}
export function saveRun(run: Run | null) {
  try { if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run)); else localStorage.removeItem(RUN_KEY); } catch { /* private window */ }
}
