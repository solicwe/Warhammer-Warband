// Army-rule modifiers to an attack (Doctrina Imperatives, Power from Pain, For the Greater Good ...). Faction modules
// register a provider in src/factions/index.ts; attack.ts asks for the combined result once per weapon profile.
import type { GameState, ModelState, Pool, UnitState, WeaponProfileData } from './types';

/** What one rule changes about an attack. Every field is optional: a provider fills in only what it changes. */
export interface CombatMods {
  /** better Ballistic / Weapon Skill (+1: a 3+ becomes a 2+) */
  skillBonus?: number;
  hitMod?: number;
  woundMod?: number;
  /** improves the attack's AP */
  apBonus?: number;
  /** worsens the attack's AP (the defender's rules) */
  apWorsen?: number;
  strengthBonus?: number;
  attacksBonus?: number;
  damageBonus?: number;
  /** unmodified hit rolls of this or more are Critical Hits */
  critHitOn?: number;
  /** unmodified wound rolls of this or more are Critical Wounds */
  critWoundOn?: number;
  /** [SUSTAINED HITS X] */
  sustained?: string | null;
  lethal?: boolean;
  devastating?: boolean;
  precision?: boolean;
  ignoresCover?: boolean;
  ignoreMods?: boolean;
  assault?: boolean;
  heavy?: boolean;
  rerollHits?: boolean;
  rerollHits1?: boolean;
  rerollWounds?: boolean;
  rerollWounds1?: boolean;
  /** shown on the attack report; a note mentioning BS / WS goes with the skill, one mentioning hit with the hit roll */
  notes?: string[];
}

export interface AttackContext {
  s: GameState;
  /** the attacking unit */
  A: UnitState;
  /** the target unit */
  T: UnitState;
  /** the attacking model */
  m: ModelState;
  /** a Psychic Attack */
  psychic: boolean;
  mode: 'ranged' | 'melee';
  /** distance from the attacking model to the target (0 in melee) */
  d: number;
  p: WeaponProfileData;
  weapon: string;
}

export type CombatModsProvider = (x: AttackContext) => CombatMods | null;

const providers: CombatModsProvider[] = [];

/** Add a provider. They are asked in the order added; for [SUSTAINED HITS] the first one wins. */
export function addCombatMods(fn: CombatModsProvider) {
  providers.push(fn);
}

export interface CombinedMods extends Required<Omit<CombatMods, 'notes' | 'sustained' | 'critWoundOn'>> {
  sustained: string | null;
  critWoundOn: number | null;
  skillNotes: string[];
  hitNotes: string[];
  otherNotes: string[];
}

/** Every registered rule's change to this attack, added up. */
export function combatMods(x: AttackContext): CombinedMods {
  const out: CombinedMods = {
    skillBonus: 0, hitMod: 0, woundMod: 0, apBonus: 0, apWorsen: 0, strengthBonus: 0, attacksBonus: 0, damageBonus: 0,
    critHitOn: 6, critWoundOn: null, sustained: null,
    lethal: false, devastating: false, precision: false, ignoresCover: false, ignoreMods: false, assault: false, heavy: false,
    rerollHits: false, rerollHits1: false, rerollWounds: false, rerollWounds1: false,
    skillNotes: [], hitNotes: [], otherNotes: [],
  };
  for (const fn of providers) {
    const m = fn(x);
    if (!m) continue;
    out.skillBonus += m.skillBonus ?? 0;
    out.hitMod += m.hitMod ?? 0;
    out.woundMod += m.woundMod ?? 0;
    out.apBonus += m.apBonus ?? 0;
    out.apWorsen += m.apWorsen ?? 0;
    out.strengthBonus += m.strengthBonus ?? 0;
    out.attacksBonus += m.attacksBonus ?? 0;
    out.damageBonus += m.damageBonus ?? 0;
    if (m.critHitOn && m.critHitOn < out.critHitOn) out.critHitOn = m.critHitOn;
    if (m.critWoundOn && (!out.critWoundOn || m.critWoundOn < out.critWoundOn)) out.critWoundOn = m.critWoundOn;
    if (m.sustained && !out.sustained) out.sustained = m.sustained;
    out.lethal ||= !!m.lethal;
    out.devastating ||= !!m.devastating;
    out.precision ||= !!m.precision;
    out.ignoresCover ||= !!m.ignoresCover;
    out.ignoreMods ||= !!m.ignoreMods;
    out.assault ||= !!m.assault;
    out.heavy ||= !!m.heavy;
    out.rerollHits ||= !!m.rerollHits;
    out.rerollHits1 ||= !!m.rerollHits1;
    out.rerollWounds ||= !!m.rerollWounds;
    out.rerollWounds1 ||= !!m.rerollWounds1;
    for (const n of m.notes ?? []) (/\b(BS|WS)\b/.test(n) ? out.skillNotes : /hit/i.test(n) ? out.hitNotes : out.otherNotes).push(n);
  }
  return out;
}

export type PoolFinisher = (x: AttackContext, pool: Pool) => void;
const finishers: PoolFinisher[] = [];

/** A rule that changes the finished pool directly (Flow of Magic: +1 to wound, or re-roll wound rolls of 1). */
export function addPoolFinisher(fn: PoolFinisher) {
  finishers.push(fn);
}

export function runPoolFinishers(x: AttackContext, pool: Pool) {
  for (const fn of finishers) fn(x, pool);
}
