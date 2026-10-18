// Leagues of Votann army rule: Prioritised Efficiency & Detachment Rules.
//
// Army Rule mechanics:
// - Yield Points (YP) pool per Votann player:
//   - At the start of the battle: units have Hostile Acquisition (0 YP).
//   - At the end of each player's Command phase:
//     - Gain 1 YP if controlling 1+ objective markers within own deployment zone.
//     - From round 2 onwards, gain 1 additional YP for each of:
//       • Control 1+ objective markers not within own deployment zone.
//       • Control 2+ objective markers not within own deployment zone.
//       • Control more objective markers than opponent.
//     - In own turn, YP gained before evaluating ability stance.
//   - Active stance (evaluated at end of own Command phase):
//     - < 7 YP: Hostile Acquisition
//     - >= 7 YP: Fortify Takeover
//     (Exception: Mercenary Oathband does not auto-switch; can spend 3 YP to switch).
//
// Hostile Acquisition:
// - +1 to Hit roll when targeting an enemy unit within range of 1+ objective markers.
// - Re-roll Advance and Charge rolls.
//
// Fortify Takeover:
// - +1 to Hit roll when attacking if within range of 1+ controlled objective markers.
// - If non-VEHICLE and attack S > T: -1 to Wound roll.

import { alive, boardUnits, hasKw, log, onBoard, other, pushFx, unitById } from '../engine/state';
import type { GameState, ModelState, PlayerId, UnitState, WeaponProfileData, ObjectiveState } from '../engine/types';
import { unitInRange, zonePoly } from '../engine/missions';
import { baseDist, pointInPoly, ptGap } from '../engine/geometry';

export interface VotannAttackBonus {
  hitMod: number;
  strengthBonus: number;
  apBonus: number;
  woundMod: number;
  ignoresCover: boolean;
  rerollHits1: boolean;
  rerollWounds1: boolean;
  rerollWounds: boolean;
  rerollHits: boolean;
  lethal: boolean;
  sustained: string | null;
  notes: string[];
}

export interface VotannDefenseBonus {
  woundMod: number;
  apWorsen: number;
  notes: string[];
}

export function isVotannArmy(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (!P) return false;
  return P.factionId === 'LoV'
    || P.factionId === 'LOV'
    || P.factionName?.toLowerCase().includes('votann')
    || s.units.some((u) => u.owner === p && (u.factionKeywords?.includes('LEAGUES OF VOTANN') || u.keywords?.includes('LEAGUES OF VOTANN')));
}

export function hasVotannFaction(u: UnitState): boolean {
  return u.factionKeywords?.includes('LEAGUES OF VOTANN') || u.keywords?.includes('LEAGUES OF VOTANN');
}

export function getYieldPoints(s: GameState, p: PlayerId): number {
  return s.players[p]?.yieldPoints ?? 0;
}

/** Gain one or more Yield Points (YP) into the player's pool. */
export function gainYieldPoints(s: GameState, p: PlayerId, amount = 1, reason = 'Prioritised Efficiency'): number {
  if (amount <= 0 || !isVotannArmy(s, p)) return 0;
  s.players[p].yieldPoints = (s.players[p].yieldPoints ?? 0) + amount;
  log(s, `[YP] Prioritised Efficiency: ${s.players[p].name} gained ${amount} YP (${reason}) — Total: ${s.players[p].yieldPoints} YP`, 'info', p);
  pushFx(s, { kind: 'skill', unitId: '', owner: p, at: { x: 22, y: 15 }, name: 'Yield Points', who: `+${amount} YP (${s.players[p].yieldPoints} total)`, style: 'tech', epic: false });
  return amount;
}

/** Spend Yield Points if player has enough. Returns true on success, false if insufficient. */
export function spendYieldPoints(s: GameState, p: PlayerId, amount: number, reason = 'Yield Points'): boolean {
  if (!isVotannArmy(s, p) || amount < 0) return false;
  const current = s.players[p].yieldPoints ?? 0;
  if (current < amount) return false;
  s.players[p].yieldPoints = current - amount;
  log(s, `[YP] Prioritised Efficiency: ${s.players[p].name} spent ${amount} YP (${reason}) — Remaining: ${s.players[p].yieldPoints} YP`, 'info', p);
  return true;
}

/** Called at start of battle: initial stance is Hostile Acquisition. */
export function votannBattleStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (isVotannArmy(s, p)) {
      s.players[p].yieldPoints = 0;
      s.players[p].votannAbility = 'Hostile Acquisition';
      log(s, `[Prioritised Efficiency] Leagues of Votann active ability: Hostile Acquisition (0 YP)`, 'info', p);
    }
  }
}

/** Called at the end of each player's Command phase. */
export function votannCommandEnd(s: GameState, commandPlayer: PlayerId) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!isVotannArmy(s, p)) continue;
    let gained = 0;
    const z = zonePoly(s, p);

    // 1 YP if you control 1+ objective markers within your deployment zone
    const inDz = s.objectives.filter((o) => o.controller === p && pointInPoly(o, z)).length;
    if (inDz >= 1) gained += 1;

    // From round 2 onwards:
    if (s.round >= 2) {
      const notInDz = s.objectives.filter((o) => o.controller === p && !pointInPoly(o, z)).length;
      if (notInDz >= 1) gained += 1;
      if (notInDz >= 2) gained += 1;

      const myTotal = s.objectives.filter((o) => o.controller === p).length;
      const enemyTotal = s.objectives.filter((o) => o.controller === other(p)).length;
      if (myTotal > enemyTotal) gained += 1;
    }

    // Detachment: Hearthfyre Arsenal (Optimal Application)
    const isHearthfyre = (s.players[p].detachments ?? []).some((d) => d.name.toLowerCase().includes('hearthfyre'));
    if (isHearthfyre && p === commandPlayer) {
      const optObjs = s.objectives.filter((o) => o.controller === p && !pointInPoly(o, z) && boardUnits(s, p).some((u) => alive(u).some((m) => (m.keywords.includes('IRON-MASTER') || m.keywords.includes('MEMNYR STRATEGIST') || u.name.includes('Iron-master') || u.name.includes('Memnyr Strategist')) && ptGap(m, o) <= 3 + 1e-6)));
      const optGained = Math.min(2, optObjs.length);
      if (optGained > 0) gained += optGained;
    }

    if (gained > 0) {
      gainYieldPoints(s, p, gained, 'End of Command phase');
    }

    // Ability stance update (only in own turn)
    if (p === commandPlayer) {
      const isMerc = (s.players[p].detachments ?? []).some((d) => d.name.toLowerCase().includes('mercenary oathband'));
      if (!isMerc) {
        const currentYp = s.players[p].yieldPoints ?? 0;
        const newStance = currentYp >= 7 ? 'Fortify Takeover' : 'Hostile Acquisition';
        const oldStance = s.players[p].votannAbility ?? 'Hostile Acquisition';
        s.players[p].votannAbility = newStance;
        if (newStance !== oldStance) {
          log(s, `[Prioritised Efficiency] Leagues of Votann units switched to ${newStance} (${currentYp} YP)`, 'info', p);
          pushFx(s, { kind: 'skill', unitId: '', owner: p, at: { x: 22, y: 15 }, name: newStance, who: `Active Stance: ${newStance}`, style: newStance === 'Fortify Takeover' ? 'shield' : 'fury', epic: false });
        }
      }
    }
  }
}

/** Called when a unit is destroyed. Handles Martial Leverage & Mercenary Prospector. */
export function votannUnitDestroyed(s: GameState, destroyedUnit: UnitState, killerId?: string) {
  const opp = other(destroyedUnit.owner);
  if (!isVotannArmy(s, opp)) return;

  // Needgaârd Oathband: Martial Leverage (+1 YP when an enemy unit is destroyed)
  const isNeedgaard = (s.players[opp].detachments ?? []).some((d) => d.name.toLowerCase().includes('needga'));
  if (isNeedgaard) {
    gainYieldPoints(s, opp, 1, 'Martial Leverage');
  }

  // Mercenary Prospector enhancement: killer gains 2 YP
  if (killerId) {
    const killer = unitById(s, killerId);
    if (killer && killer.owner === opp && killer.enhancements.some((e) => e.name.toLowerCase().includes('mercenary prospector'))) {
      gainYieldPoints(s, opp, 2, 'Mercenary Prospector');
    }
  }
}

/** Check if unit is within range of objective marker (inside terrain area or within 3"). */
export function isUnitNearObjective(s: GameState, u: UnitState, o: ObjectiveState): boolean {
  if (unitInRange(s, u, o)) return true;
  return alive(u).some((m) => ptGap(m, o) <= 3 + 1e-6 || Math.hypot(m.x - o.x, m.y - o.y) <= 3 + (m.r ?? 0.63));
}

/** Check if enemy unit T is the closest eligible target to A. */
function isClosestEnemy(s: GameState, A: UnitState, T: UnitState): boolean {
  let best = Infinity, bestId = '';
  for (const e of boardUnits(s, other(A.owner))) {
    const d = Math.min(...alive(A).flatMap((m) => alive(e).map((n) => baseDist(m, n))));
    if (d < best - 1e-6) {
      best = d;
      bestId = e.id;
    }
  }
  return bestId === T.id;
}

/** Calculate attack bonuses for a Leagues of Votann attacking unit A targeting T. */
export function votannAttackModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  distance: number,
  kind: 'ranged' | 'melee',
): VotannAttackBonus {
  const out: VotannAttackBonus = {
    hitMod: 0,
    strengthBonus: 0,
    apBonus: 0,
    woundMod: 0,
    ignoresCover: false,
    rerollHits1: false,
    rerollWounds1: false,
    rerollWounds: false,
    rerollHits: false,
    lethal: false,
    sustained: null,
    notes: [],
  };

  if (!isVotannArmy(s, A.owner) || !hasVotannFaction(A)) return out;

  const stance = s.players[A.owner]?.votannAbility ?? 'Hostile Acquisition';

  // 1. Hostile Acquisition: +1 to Hit vs enemy within range of objective marker
  if (stance === 'Hostile Acquisition') {
    const nearObj = s.objectives.some((o) => isUnitNearObjective(s, T, o));
    if (nearObj) {
      out.hitMod += 1;
      out.notes.push('Hostile Acquisition (+1 Hit)');
    }
  }

  // 2. Fortify Takeover: +1 to Hit if A is within range of controlled objective marker
  if (stance === 'Fortify Takeover') {
    const onOurObj = s.objectives.some((o) => o.controller === A.owner && isUnitNearObjective(s, A, o));
    if (onOurObj) {
      out.hitMod += 1;
      out.notes.push('Fortify Takeover (+1 Hit)');
    }
  }

  // 3. Hearthband: Methodical Annihilation
  // Targets closest eligible target or target within Engagement Range: re-roll Wound 1.
  // Kâhl / Einhyr Hearthguard / Ûthar the Destined: +1 AP.
  const isHearthband = (s.players[A.owner].detachments ?? []).some((d) => d.name.toLowerCase().includes('hearthband'));
  if (isHearthband) {
    const isEngaged = distance <= 1.0;
    const isClosest = isClosestEnemy(s, A, T);
    if (isEngaged || isClosest) {
      out.rerollWounds1 = true;
      out.notes.push('Methodical Annihilation (re-roll Wound 1)');
      const isElite = A.name.includes('Kâhl') || A.name.includes('Einhyr Hearthguard') || A.name.includes('Ûthar the Destined') || A.keywords.includes('KÂHL');
      if (isElite) {
        out.apBonus += 1;
        out.notes.push('Methodical Annihilation (+1 AP)');
      }
    }
  }

  // 4. Farseekers: Eye of the Hunt
  // Friendly HERNKYN ranged attacks within 12" have +1 to hit
  const isFarseekers = (s.players[A.owner].detachments ?? []).some((d) => d.name.toLowerCase().includes('farseekers'));
  if (isFarseekers && kind === 'ranged' && distance <= 12 && (A.keywords.includes('HERNKYN') || A.name.includes('Hernkyn'))) {
    out.hitMod += 1;
    out.notes.push('Eye of the Hunt (+1 Hit)');
  }

  // 5. Hearthguard Covenant: Avatars of the Ancestors
  // Friendly KÂHL/EINHYR CHAMPION/EINHYR HEARTHGUARD/ÛTHAR THE DESTINED ranged attacks within 9": re-roll wound 1
  const isCovenant = (s.players[A.owner].detachments ?? []).some((d) => d.name.toLowerCase().includes('covenant'));
  if (isCovenant && kind === 'ranged' && distance <= 9) {
    const isAv = A.keywords.includes('KÂHL') || A.keywords.includes('EINHYR CHAMPION') || A.keywords.includes('EINHYR HEARTHGUARD') || A.keywords.includes('ÛTHAR THE DESTINED') || A.name.includes('Kâhl') || A.name.includes('Einhyr') || A.name.includes('Ûthar');
    if (isAv) {
      out.rerollWounds1 = true;
      out.notes.push('Avatars of the Ancestors (re-roll Wound 1)');
    }
  }

  // 6. Brandfast Oathband: Mobile Sensor Relays
  // Friendly INFANTRY wholly within 6" of friendly Votann TRANSPORT: [SUSTAINED HITS 1]
  const isBrandfast = (s.players[A.owner].detachments ?? []).some((d) => d.name.toLowerCase().includes('brandfast'));
  if (isBrandfast && kind === 'ranged' && hasKw(A, 'INFANTRY')) {
    const nearTransport = boardUnits(s, A.owner).some((t) => hasKw(t, 'TRANSPORT') && hasVotannFaction(t) && alive(A).every((m) => alive(t).some((tm) => baseDist(m, tm) <= 6 + 1e-6)));
    if (nearTransport) {
      out.sustained = '1';
      out.notes.push('Mobile Sensor Relays [Sustained Hits 1]');
    }
  }

  // 7. Berehk Stornbröw: Break the Foe
  // Melee weapons in unit have [SUSTAINED HITS 1]
  if (kind === 'melee') {
    const hasBerehk = A.name.includes('Berehk') || alive(A).some((m) => m.name.includes('Berehk') || m.keywords.includes('BEREHK STORNBRÖW'));
    if (hasBerehk) {
      out.sustained = '1';
      out.notes.push('Break the Foe [Sustained Hits 1]');
    }
  }

  return out;
}

/** Calculate defensive modifiers when Leagues of Votann unit T is attacked by A. */
export function votannDefenseModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  p: WeaponProfileData,
  attackerDistance = 10,
): VotannDefenseBonus {
  const out: VotannDefenseBonus = {
    woundMod: 0,
    apWorsen: 0,
    notes: [],
  };

  if (!isVotannArmy(s, T.owner) || !hasVotannFaction(T)) return out;

  const stance = s.players[T.owner]?.votannAbility ?? 'Hostile Acquisition';
  const targetT = T.models[0]?.profile.T ?? 4;
  const attackS = p.S ?? 1;

  // 1. Fortify Takeover: if not VEHICLE and S > T: -1 to Wound roll
  if (stance === 'Fortify Takeover' && !hasKw(T, 'VEHICLE')) {
    if (attackS > targetT) {
      out.woundMod -= 1;
      out.notes.push('Fortify Takeover (−1 Wound: S > T)');
    }
  }

  // 2. Bastion Shield enhancement: ranged attack within 12" (or 18"): worsen AP by 1
  if (T.enhancements.some((e) => e.name.toLowerCase().includes('bastion shield')) && attackerDistance <= 12) {
    out.apWorsen += 1;
    out.notes.push('Bastion Shield (worsen AP by 1)');
  }

  // 3. Built to Last: Sagitaur S > T -> -1 to wound
  if (hasKw(T, 'SAGITAUR') && attackS > targetT && T.buffs.some((b) => b.label?.includes('Built to Last'))) {
    out.woundMod -= 1;
    out.notes.push('Built to Last (−1 Wound: S > T)');
  }

  return out;
}

/** Ûthar the Destined: Ancestral Fortune - spend 1 YP to turn a roll into unmodified 6. */
export function tryUtharAncestralFortune(
  s: GameState,
  u: UnitState,
  rollType: 'hit' | 'wound' | 'save',
  context?: { need?: number; isCharacter?: boolean },
): number | null {
  const hasUthar = u.name.includes('Ûthar') || alive(u).some((m) => m.name.includes('Ûthar'));
  if (!hasUthar) return null;
  if ((s.players[u.owner].yieldPoints ?? 0) < 1) return null;
  if (u.oncePerTurnUsed?.includes('ancestral-fortune')) return null;

  const need = context?.need ?? 4;
  // Bot decision threshold: use on difficult or crucial rolls (e.g. need 4+ on save, or need 5+ on hit/wound)
  const shouldSpend = (rollType === 'save' && need >= 4) || ((rollType === 'hit' || rollType === 'wound') && need >= 5);
  if (!shouldSpend) return null;

  spendYieldPoints(s, u.owner, 1, 'Ancestral Fortune');
  u.oncePerTurnUsed = [...(u.oncePerTurnUsed ?? []), 'ancestral-fortune'];
  log(s, `[Ancestral Fortune] Ûthar the Destined spent 1 YP to change ${rollType} roll to unmodified 6!`, 'roll', u.owner);
  return 6;
}
