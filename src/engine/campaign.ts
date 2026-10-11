// A campaign: a run of short battles across a branching map, roguelite style. The player starts with a small army of
// one faction and picks a road through the map: battles, elite enemies with a special rule, supply drops, a boss at the
// end. Each win offers one of three rewards: a new unit, a relic (a rule for the whole army, like a joker in Balatro)
// or a Command Point every battle. A loss costs one of three Fate points; the run ends when Fate runs out.
import { addTimed } from './effects';
import type { Effect } from './effects';
import { defaultWargear, syncWargear } from './army';
import type { ArmyList, ArmyUnitEntry, BotLevel, DatasheetData, FactionData, GameState, PlayerId, UnitState } from './types';

export type NodeKind = 'battle' | 'elite' | 'supply' | 'boss';

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
  | { kind: 'cp' };

export interface Run {
  version: 1;
  seed: number;
  factionId: string;
  list: ArmyList;
  map: MapNode[];
  /** nodes cleared, in order (the last one is where the player stands) */
  path: string[];
  relics: string[];
  /** extra CP at the start of every battle */
  cp: number;
  fate: number;
  /** the battle being fought */
  fighting?: string;
  /** rewards to pick one from */
  offer?: Reward[];
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
];
export const relicById = (id: string) => RELICS.find((r) => r.id === id);

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
    let supplies = 0;
    for (let i = 0; i < n; i++) {
      const last = layer === LAYERS.length - 1;
      // at most one supply drop and one elite a layer: most roads are battles
      const kind: NodeKind = last ? 'boss' : layer === 0 ? 'battle'
        : (() => {
          const x = r();
          if (layer >= 2 && x < 0.3 && !nodes.some((m) => m.layer === layer && m.kind === 'elite')) return 'elite';
          if (x < 0.6 && layer !== 5 && supplies === 0) { supplies++; return 'supply'; }
          return 'battle';
        })();
      const node: MapNode = { id: `n${layer}-${i}`, layer, kind, x: (i + 0.5) / n, next: [] };
      if (kind !== 'supply') {
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
    version: 1, seed: seed >>> 0, factionId: faction.id, list, map: makeMap(seed >>> 0, enemies.filter((e) => e !== faction.id)),
    path: [], relics: [], cp: 0, fate: 3, story: [`${faction.name}: the campaign begins.`], wins: 0, started: Date.now(),
  };
}

/** Where the player can go next: the first layer at the start, else the roads from where they stand. */
export function reachable(run: Run): MapNode[] {
  if (run.over || run.offer) return [];
  const at = run.path.length ? run.map.find((n) => n.id === run.path[run.path.length - 1]) : null;
  return at ? run.map.filter((n) => at.next.includes(n.id)) : run.map.filter((n) => n.layer === 0);
}

const usable = (f: FactionData, main?: string) => f.datasheets.filter((d) => d.points[0]?.options?.length && !d.subfaction && d.models.length && d.weapons.length
  && !d.keywords.includes('FORTIFICATION') && !d.keywords.includes('AIRCRAFT') && !d.keywords.includes('EPIC HERO') && !d.transport && (!main || d.factionKeywords.includes(main)));
const cheapest = (d: DatasheetData) => [...d.points[0].options].sort((a, b) => a.pts - b.pts)[0];
const mainKeyword = (f: FactionData) => {
  const count = new Map<string, number>();
  for (const d of f.datasheets) for (const k of d.factionKeywords) count.set(k, (count.get(k) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** Three rewards to pick one from after a win (an elite battle offers relics; a supply drop a mix). */
export function makeOffer(run: Run, faction: FactionData, kind: NodeKind, salt = 0): Reward[] {
  const r = rng(run.seed + run.path.length * 101 + salt * 7 + 3);
  const relics = (rare: boolean) => pickN(RELICS.filter((x) => !run.relics.includes(x.id) && (rare || !x.rare)), 3, r).map((x): Reward => ({ kind: 'relic', id: x.id }));
  const units = (n: number, cap: number) => pickN(usable(faction, mainKeyword(faction)).filter((d) => { const o = cheapest(d); return o.pts >= 50 && o.pts <= cap; }), n, r)
    .map((d): Reward => { const o = cheapest(d); return { kind: 'unit', datasheet: d.name, models: o.models, pts: o.pts }; });
  if (kind === 'elite' || kind === 'boss') return relics(true);
  const cap = 140 + run.path.length * 25;
  if (kind === 'supply') return [...units(1, cap), ...relics(false).slice(0, 1), { kind: 'cp' }];
  // a won battle: one new unit or one of two relics (more powers to build a run around)
  return [...units(1, cap), ...relics(false).slice(0, 2)];
}

export function takeReward(run: Run, rw: Reward, faction: FactionData): Run {
  const next: Run = { ...run, offer: undefined, story: [...run.story] };
  if (rw.kind === 'relic') { next.relics = [...run.relics, rw.id]; next.story.push(`Relic: ${relicById(rw.id)?.name}`); if (rw.id === 'cache') next.cp += 1; }
  if (rw.kind === 'cp') { next.cp = run.cp + 1; next.story.push('+1 CP every battle'); }
  if (rw.kind === 'unit') {
    const d = faction.datasheets.find((x) => x.name === rw.datasheet);
    const uid = `c${run.path.length}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const e: ArmyUnitEntry = syncWargear(d, defaultWargear(d, { uid, datasheet: rw.datasheet, models: rw.models, pts: rw.pts }));
    next.list = { ...run.list, units: [...run.list.units, e] };
    next.story.push(`Reinforcements: ${rw.datasheet}`);
  }
  return next;
}

/** Walk to a node: a supply drop gives its rewards at once, a battle waits to be fought. */
export function enter(run: Run, nodeId: string, faction: FactionData): Run {
  const node = run.map.find((n) => n.id === nodeId)!;
  if (node.kind === 'supply') return { ...run, path: [...run.path, nodeId], offer: makeOffer(run, faction, 'supply'), story: [...run.story, 'Supply drop'] };
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
  const next: Run = { ...run, fighting: undefined, path: [...run.path, node.id], wins: run.wins + 1, story: [...run.story, `${winner === 'draw' ? 'Held off' : 'Victory over'} ${enemyName}${node.kind === 'boss' ? ' — the campaign is won' : ''}`] };
  next.offer = node.kind === 'boss' ? undefined : makeOffer(next, faction, node.kind);
  if (node.kind === 'boss') next.over = 'won';
  return next;
}

const hasKwIn = (u: UnitState, units?: string) => !units || units.split('|').some((k) => u.keywords.includes(k));

/** Put the run's relics on the player's army and the enemy's special rules on theirs, for the whole battle. */
export function applyCampaign(s: GameState, run: Run, rules: string[]) {
  const me: PlayerId = 0, foe: PlayerId = 1;
  for (const id of run.relics) {
    const r = relicById(id);
    if (!r || id === 'cache') continue;
    for (const u of s.units.filter((x) => x.owner === me && hasKwIn(x, r.units))) addTimed(s, u, { e: { ...r.e }, label: r.name, until: 'battle', by: me });
  }
  for (const id of rules) {
    const b = bossRuleById(id);
    if (!b) continue;
    for (const u of s.units.filter((x) => x.owner === foe && hasKwIn(x, b.units))) addTimed(s, u, { e: { ...b.e }, label: b.name, until: 'battle', by: foe });
  }
  s.players[me].cp += run.cp;
  s.campaign = { node: run.fighting ?? '', relics: [...run.relics], rules: [...rules] };
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
