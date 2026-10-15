// Adeptus Mechanicus army rule: Doctrina Imperatives & Detachment Rules.
// Legal for matched play from 14th October 2026 (Faction Pack v1.4).

import { d6 } from './dice';
import { baseDist } from './geometry';
import { alive, boardUnits, hasKw, log, onBoard, other, unitDistance } from './state';
import type { GameState, PlayerId, UnitState, WeaponProfileData } from './types';

export type DoctrinaImperative = 'Protector Imperative' | 'Conqueror Imperative';

export interface AdmechAttackBonus {
  bsBonus: number;
  wsBonus: number;
  apBonus: number;
  hitMod: number;
  woundMod: number;
  rerollHits1: boolean;
  rerollWounds1: boolean;
  rerollHits: boolean;
  heavy: boolean;
  assault: boolean;
  lethal: boolean;
  sustained: string | null;
  ignoresCover: boolean;
  notes: string[];
}

export interface AdmechDefenseBonus {
  hitMod: number;
  apWorsen: number;
  inv?: number;
  fnp?: number;
  notes: string[];
}

export function isAdmechArmy(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (!P) return false;
  return (
    P.factionId === 'AdM'
    || P.factionName?.toLowerCase().includes('mechanicus')
    || s.units.some((u) => u.owner === p && (u.factionKeywords?.includes('ADEPTUS MECHANICUS') || u.keywords?.includes('ADEPTUS MECHANICUS')))
  );
}

export function hasAdmechFaction(u: UnitState): boolean {
  return u.factionKeywords?.includes('ADEPTUS MECHANICUS') || u.keywords?.includes('ADEPTUS MECHANICUS');
}

/** Check if unit is an Adeptus Mechanicus BATTLELINE unit (or has Cawl with Mantra of Discipline). */
export function isAdmechBattleline(u: UnitState): boolean {
  if (!hasAdmechFaction(u) || !onBoard(u) || !alive(u).length) return false;
  if (u.keywords.includes('BATTLELINE')) return true;
  if (u.name.includes('Belisarius Cawl') || u.sources.some((s) => s.includes('Belisarius Cawl'))) {
    return true;
  }
  return false;
}

/** Check if unit itself is Battleline or is within 6" of a friendly Adeptus Mechanicus Battleline unit. */
export function nearAdmechBattleline(s: GameState, u: UnitState): boolean {
  if (isAdmechBattleline(u)) return true;
  const allies = boardUnits(s, u.owner).filter((x) => x.id !== u.id && isAdmechBattleline(x));
  return allies.some((b) => unitDistance(u, b) <= 6 + 1e-6);
}

/** Check which Doctrina Imperatives are currently active for a specific unit. */
export function unitActiveImperatives(s: GameState, u: UnitState): Set<DoctrinaImperative> {
  const active = new Set<DoctrinaImperative>();
  if (!isAdmechArmy(s, u.owner) || !hasAdmechFaction(u)) return active;

  // Check if unit has both imperatives active via enhancement or ability
  // 1. Omnicogitator enhancement (Eradication Cohort)
  // 2. Cognitive Reinforcement enhancement (Haloscreed)
  // 3. Thulia Ghuld: The Fires of Mars ability
  const hasBoth = u.enhancements?.some((e) => e.name === 'Omnicogitator' || e.name === 'Cognitive Reinforcement')
    || u.timed?.some((t) => t.label === 'The Fires of Mars' || t.label.includes('Fires of Mars'));

  if (hasBoth) {
    active.add('Protector Imperative');
    active.add('Conqueror Imperative');
    return active;
  }

  const armyImperative = s.players[u.owner]?.admechImperative ?? 'Protector Imperative';
  active.add(armyImperative);
  return active;
}

/** Set or switch Doctrina Imperative for an AdMech player. */
export function setAdmechImperative(s: GameState, p: PlayerId, imperative: DoctrinaImperative) {
  if (!isAdmechArmy(s, p)) return;
  s.players[p].admechImperative = imperative;
  log(s, `[Doctrina Imperatives] ${s.players[p].name} active imperative: ${imperative}`, 'info', p);
}

/** Start of battle round: evaluate AdMech imperatives. */
export function admechRoundStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!isAdmechArmy(s, p)) continue;
    if (!s.players[p].admechImperative) {
      // Default to Conqueror if starting aggressive, or Protector
      s.players[p].admechImperative = s.round <= 2 ? 'Conqueror Imperative' : 'Protector Imperative';
    }
  }
}

/** Start of Command phase: resolve Belisarius Cawl and AdMech command triggers. */
export function admechCommandStart(s: GameState, p: PlayerId) {
  if (!isAdmechArmy(s, p)) return;

  // Belisarius Cawl abilities:
  const cawl = s.units.find((u) => u.owner === p && onBoard(u) && alive(u).length > 0 && u.name.includes('Belisarius Cawl'));
  if (cawl) {
    // 1. Self-repair Mechanisms: regains up to D3 lost wounds
    const cawlModel = alive(cawl)[0];
    if (cawlModel && cawlModel.wounds < (cawlModel.profile?.W ?? 10)) {
      const maxW = cawlModel.profile?.W ?? 10;
      const healed = Math.min(Math.ceil(d6(s) / 2), maxW - cawlModel.wounds);
      cawlModel.wounds += healed;
      log(s, `[Self-repair Mechanisms] Belisarius Cawl regains ${healed} lost wounds (${cawlModel.wounds}/${maxW}W)`, 'info', p);
    }

    // 2. Invocation of Machine Vengeance: select enemy unit
    const enemies = boardUnits(s, other(p));
    if (enemies.length > 0) {
      const target = enemies.slice().sort((a, b) => b.pts - a.pts)[0];
      s.players[p].machineVengeanceTarget = target.id;
      log(s, `[Invocation of Machine Vengeance] Cawl designated ${target.name} as Machine Vengeance target (friendly ADEPTUS MECHANICUS re-roll Hits)`, 'info', p);
    }
  }
}

/** Calculate attack bonuses for an Adeptus Mechanicus unit attacking T. */
export function admechAttackModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  distance: number,
  mode: 'ranged' | 'melee',
  profile?: WeaponProfileData,
  weaponName?: string,
): AdmechAttackBonus {
  const out: AdmechAttackBonus = {
    bsBonus: 0,
    wsBonus: 0,
    apBonus: 0,
    hitMod: 0,
    woundMod: 0,
    rerollHits1: false,
    rerollWounds1: false,
    rerollHits: false,
    heavy: false,
    assault: false,
    lethal: false,
    sustained: null,
    ignoresCover: false,
    notes: [],
  };

  if (!isAdmechArmy(s, A.owner) || !hasAdmechFaction(A)) return out;

  const imperatives = unitActiveImperatives(s, A);
  const nearBl = nearAdmechBattleline(s, A);

  // --- Doctrina Imperatives ---
  // Protector Imperative:
  // - Ranged weapons have [HEAVY]
  // - +1 to BS characteristic of ranged weapons
  if (imperatives.has('Protector Imperative') && mode === 'ranged') {
    out.heavy = true;
    out.bsBonus += 1;
    out.notes.push('Protector: +1 BS');
  }

  // Conqueror Imperative:
  // - Ranged weapons have [ASSAULT]
  // - +1 to WS characteristic of melee weapons
  // - If BATTLELINE or within 6" of BATTLELINE: +1 AP to all attacks
  if (imperatives.has('Conqueror Imperative')) {
    if (mode === 'ranged') {
      out.assault = true;
      out.notes.push('Conqueror: [ASSAULT]');
    } else {
      out.wsBonus += 1;
      out.notes.push('Conqueror: +1 WS');
    }
    if (nearBl) {
      out.apBonus += 1;
      out.notes.push('Conqueror (Battleline): +1 AP');
    }
  }

  // --- Belisarius Cawl: Invocation of Machine Vengeance ---
  if (s.players[A.owner]?.machineVengeanceTarget === T.id) {
    out.rerollHits = true;
    out.notes.push('Machine Vengeance: re-roll Hits');
  }

  // --- Detachments ---
  const dets = s.players[A.owner]?.detachments ?? [];

  // Eradication Cohort: Murderous Imperative
  // - Protector: re-roll Hit rolls of 1 (Skitarii)
  // - Conqueror: re-roll Wound rolls of 1 (Skitarii)
  if (dets.some((d) => d.name === 'Eradication Cohort') && (hasKw(A, 'SKITARII') || A.keywords.includes('SKITARII'))) {
    if (imperatives.has('Protector Imperative')) {
      out.rerollHits1 = true;
      out.notes.push('Murderous Imperative: re-roll Hit 1s');
    }
    if (imperatives.has('Conqueror Imperative')) {
      out.rerollWounds1 = true;
      out.notes.push('Murderous Imperative: re-roll Wound 1s');
    }
  }

  // Luminen Auto-choir:
  // - Corpuscarii ranged attacks have [LETHAL HITS]
  if (dets.some((d) => d.name === 'Luminen Auto-choir') && mode === 'ranged') {
    if (A.name.toLowerCase().includes('corpuscarii') || A.keywords.includes('CORPUSCARII')) {
      out.lethal = true;
      out.notes.push('Luminen: [LETHAL HITS]');
    }
  }

  // Datasheet Specific Rules:
  // Hastarii Exterminators: Broad-spectrum Targeting Augurs
  // Ranged attacks with eradication caster vs non-Monster/Vehicle have [SUSTAINED HITS 1]
  if (weaponName?.toLowerCase().includes('eradication caster') && !hasKw(T, 'MONSTER') && !hasKw(T, 'VEHICLE')) {
    out.sustained = '1';
    out.notes.push('Broad-spectrum Augurs: [SUSTAINED HITS 1]');
  }

  // Hastarii Fusiliers: Monocular Targeting Helms
  // Ranged attacks with neutron fusil vs Monster/Vehicle have [IGNORES COVER]
  if (weaponName?.toLowerCase().includes('neutron fusil') && (hasKw(T, 'MONSTER') || hasKw(T, 'VEHICLE'))) {
    out.ignoresCover = true;
    out.notes.push('Monocular Helms: [IGNORES COVER]');
  }

  return out;
}

/** Calculate defensive modifiers when Adeptus Mechanicus unit T is attacked by A. */
export function admechDefenseModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  mode: 'ranged' | 'melee',
): AdmechDefenseBonus {
  const out: AdmechDefenseBonus = {
    hitMod: 0,
    apWorsen: 0,
    notes: [],
  };

  if (!isAdmechArmy(s, T.owner) || !hasAdmechFaction(T)) return out;

  const imperatives = unitActiveImperatives(s, T);
  const nearBl = nearAdmechBattleline(s, T);

  // Protector Imperative melee defence:
  // If targeted by melee attacks, if BATTLELINE or within 6" of BATTLELINE: -1 to Hit!
  if (imperatives.has('Protector Imperative') && mode === 'melee' && nearBl) {
    out.hitMod -= 1;
    out.notes.push('Protector (Battleline): −1 to be hit');
  }

  // Lords of the Forge:
  // Tech-Priest models have 4+ InSv and Feel No Pain 5+
  const dets = s.players[T.owner]?.detachments ?? [];
  if (dets.some((d) => d.name === 'Lords of the Forge') && (hasKw(T, 'TECH-PRIEST') || T.keywords.includes('TECH-PRIEST'))) {
    out.inv = 4;
    out.fnp = 5;
    out.notes.push('Lords of the Forge: 4+ inv / FNP 5+');
  }

  return out;
}
