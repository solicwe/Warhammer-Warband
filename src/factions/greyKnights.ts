// Grey Knights: Teleport Assault, Detachment mechanics, and Sanctic psychic abilities.
import { alive, boardUnits, engagedEnemies, hasKw, log, other } from '../engine/state';
import { dist, ptGap } from '../engine/geometry';
import type { GameState, PlayerId, UnitState, WeaponProfileData } from '../engine/types';

export function hasAnyKw(u: UnitState, kw: string): boolean {
  const target = kw.toUpperCase();
  return (u.keywords ?? []).some((k) => k.toUpperCase() === target) ||
         (u.factionKeywords ?? []).some((k) => k.toUpperCase() === target);
}

export function isGKUnit(u: UnitState): boolean {
  return hasAnyKw(u, 'GREY KNIGHTS');
}

export function isGKArmy(s: GameState, p: PlayerId): boolean {
  return s.players[p]?.factionId === 'GK' || (s.players[p]?.detachments ?? []).some((d) => [
    'Teleport Strike Force', 'Warpbane Task Force', 'Brotherhood Strike',
    'Hallowed Conclave', 'Banishers', 'Sanctic Spearhead', 'Augurium Task Force',
    'Argent Assault', 'Fires of Purgation', 'Immaterial Interdiction'
  ].includes(d.name));
}

/** Max units that can be picked up with Teleport Assault at end of opponent's turn. */
export function teleportAssaultLimit(s: GameState): number {
  return s.objectives.length <= 4 ? 2 : s.objectives.length <= 5 ? 3 : 4;
}

/** End of opponent's turn: Grey Knights can pick up units into Strategic Reserves (Teleport Assault). */
export function gkEndOpponentTurn(s: GameState): void {
  const opp = s.active;
  const gkPlayer = other(opp);
  if (!isGKArmy(s, gkPlayer)) return;

  const limit = teleportAssaultLimit(s);
  const eligible = boardUnits(s, gkPlayer).filter(
    (u) => isGKUnit(u) && engagedEnemies(s, u).length === 0 && !hasAnyKw(u, 'AIRCRAFT')
  );

  // Bot or auto pick: take up to limit eligible units (e.g. damaged or out of position units)
  const toPickup = eligible.slice(0, Math.min(limit, 2));
  for (const u of toPickup) {
    u.status = 'reserves';
    // Deep strike arrival next turn
    if (!u.core.deepStrike) u.core.deepStrike = true;
    log(s, `Teleport Assault: ${u.name} enters Strategic Reserves`, 'info', gkPlayer);
  }
}

export interface GKAttackBonus {
  hitMod: number;
  woundMod: number;
  apBonus: number;
  attacksBonus: number;
  damageBonus: number;
  rerollHits1: boolean;
  rerollWounds1: boolean;
  rerollHits: boolean;
  rerollWounds: boolean;
  lethal: boolean;
  sustained: string | null;
  devastating: boolean;
  critHitThreshold: number;
  notes: string[];
}

export interface GKDefenseBonus {
  hitMod: number;
  woundMod: number;
  apWorsen: number;
  invulnSave?: number;
  notes: string[];
}

/** Calculate Grey Knights attack bonuses. */
export function gkAttackModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  distance: number,
  mode: 'ranged' | 'melee',
  profile?: WeaponProfileData,
  weaponName?: string,
): GKAttackBonus {
  const out: GKAttackBonus = {
    hitMod: 0,
    woundMod: 0,
    apBonus: 0,
    attacksBonus: 0,
    damageBonus: 0,
    rerollHits1: false,
    rerollWounds1: false,
    rerollHits: false,
    rerollWounds: false,
    lethal: false,
    sustained: null,
    devastating: false,
    critHitThreshold: 6,
    notes: [],
  };

  if (!isGKUnit(A)) return out;

  const det = (s.players[A.owner].detachments ?? [])[0]?.name;

  // 1. Warpbane Task Force: Hallowed Ground (+1 to Hit while on own objective or territory)
  if (det === 'Warpbane Task Force') {
    const onOwnObj = s.objectives.some(
      (o) => o.controller === A.owner && alive(A).some((m) => dist(m, o) <= 3 + (m.r ?? 0.63) + 1e-6)
    );
    if (onOwnObj) {
      out.hitMod += 1;
      out.notes.push('Hallowed Ground: +1 to Hit (controlling objective)');
    }
  }

  // 2. Brotherhood Strike: Fury of Titan (Terminators and Paladins re-roll 1s to Hit)
  if (det === 'Brotherhood Strike' && (hasAnyKw(A, 'TERMINATOR') || hasAnyKw(A, 'PALADIN'))) {
    out.rerollHits1 = true;
    out.notes.push('Fury of Titan: Re-roll Hit rolls of 1');
  }

  // 3. Hallowed Conclave: Duty Before All (+1 Attack to Character melee)
  if (det === 'Hallowed Conclave' && mode === 'melee' && hasAnyKw(A, 'CHARACTER')) {
    out.attacksBonus += 1;
    out.notes.push('Duty Before All: +1 Melee Attack');
  }

  // 4. Banishers: Channelled Force ([LETHAL HITS] in melee; +1 Damage vs Daemon or Psyker)
  if (det === 'Banishers' && mode === 'melee') {
    out.lethal = true;
    out.notes.push('Channelled Force: [LETHAL HITS]');
    if (hasAnyKw(T, 'DAEMON') || hasAnyKw(T, 'PSYKER')) {
      out.damageBonus += 1;
      out.notes.push('Channelled Force: +1 Damage vs Daemon/Psyker');
    }
  }

  // 5. Sanctic Spearhead: Mailed Fist (Nemesis Dreadknight +1 Damage on charge)
  if (det === 'Sanctic Spearhead' && mode === 'melee' && hasAnyKw(A, 'DREADKNIGHT') && A.chargedTurn === s.turn) {
    out.damageBonus += 1;
    out.notes.push('Mailed Fist: +1 Damage (charged)');
  }

  // 6. Argent Assault: Dauntless Champions (Paladins +1 to Wound when S < target T)
  if (det === 'Argent Assault' && mode === 'melee' && (hasAnyKw(A, 'PALADIN') || hasAnyKw(A, 'PALADIN SQUAD'))) {
    const sVal = profile?.S ?? 6;
    const tVal = T.models[0]?.profile.T ?? 4;
    if (sVal < tVal) {
      out.woundMod += 1;
      out.notes.push('Dauntless Champions: +1 to Wound (S < T)');
    }
  }

  return out;
}

/** Calculate Grey Knights defense bonuses. */
export function gkDefenseModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  mode: 'ranged' | 'melee',
  profile?: WeaponProfileData,
): GKDefenseBonus {
  const out: GKDefenseBonus = {
    hitMod: 0,
    woundMod: 0,
    apWorsen: 0,
    notes: [],
  };

  if (!isGKUnit(T)) return out;

  const det = (s.players[T.owner].detachments ?? [])[0]?.name;

  // Warpbane Task Force: Hallowed Ground (4+ invulnerable save while on controlled objective)
  if (det === 'Warpbane Task Force') {
    const onOwnObj = s.objectives.some(
      (o) => o.controller === T.owner && alive(T).some((m) => dist(m, o) <= 3 + (m.r ?? 0.63) + 1e-6)
    );
    if (onOwnObj) {
      out.invulnSave = 4;
      out.notes.push('Hallowed Ground: 4+ Invulnerable save');
    }
  }

  return out;
}

