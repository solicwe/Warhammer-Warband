// T’au Empire army rule: For the Greater Good (FTGG) & Detachment Rules.
//
// Army Rule mechanics:
// - In the Shooting phase, when a T’AU EMPIRE unit is selected to shoot:
//   Select one friendly unit to be Observer (not Fortification, not Battle-shocked, eligible to shoot).
//   The shooting unit is Guided, the friendly unit is Observer, enemy unit is Spotted.
// - Guided attacks targeting Spotted unit:
//   +1 BS (skillDelta -1)
//   If Observer has MARKERLIGHT: [IGNORES COVER]
//   If Observer is Stealth Battlesuits (Forward Observers): re-roll 1s to hit & wound
// - Guided attacks NOT targeting Spotted unit:
//   -1 BS (skillDelta +1)
//
// Detachments:
// - Kauyon (Patient Hunter): Round 3+: [SUSTAINED HITS 1]. While Guided vs Spotted: ignore modifiers to BS & Hit.
// - Mont’ka (Killing Blow): Round 1-3: [ASSAULT]. While Guided vs Spotted: [LETHAL HITS].
// - Retaliation Cadre (Bonded Heroes): Battlesuits: +1 S within 12", +1 AP within 8".
// - Kroot Hunting Pack (Hunter's Instincts): Target below starting: +1 to hit; below half: +1 to wound. 6++ melee, 5++ ranged.

import { alive, boardUnits, hasKw, log, onBoard, pushFx, unitById } from '../engine/state';
import type { GameState, ModelState, Phase, PlayerId, UnitState } from '../engine/types';
import { modelVisible } from '../engine/visibility';

export interface FtggAttackBonus {
  isGuided: boolean;
  isSpotted: boolean;
  skillDelta: number;
  hitMod: number;
  strengthBonus: number;
  apBonus: number;
  woundMod: number;
  ignoresCover: boolean;
  rerollHits1: boolean;
  rerollWounds1: boolean;
  lethal: boolean;
  sustained: string | null;
  ignoreMods: boolean;
  notes: string[];
}

export function isTauArmy(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (!P) return false;
  return P.factionId === 'TAU'
    || P.factionName?.toLowerCase().includes('tau')
    || s.units.some((u) => u.owner === p && (u.factionKeywords?.includes('T’AU EMPIRE') || u.factionKeywords?.includes("T'AU EMPIRE")));
}

export function hasFtgg(u: UnitState): boolean {
  return u.abilities.some((a) => a.name === 'For the Greater Good')
    || u.factionKeywords.includes('T’AU EMPIRE')
    || u.factionKeywords.includes("T'AU EMPIRE");
}

export function hasMarkerlight(u: UnitState): boolean {
  return u.keywords.includes('MARKERLIGHT')
    || u.models.some((m) => (m.gear ?? []).some((g) => /markerlight/i.test(g)));
}

export function isUnitObserver(s: GameState, u: UnitState): boolean {
  return (s.ftggPairs ?? []).some((p) => p.observerId === u.id && p.turn === s.turn && p.phase === s.phase);
}

export function isUnitGuided(s: GameState, u: UnitState): boolean {
  return (s.ftggPairs ?? []).some((p) => p.guidedId === u.id && p.turn === s.turn && p.phase === s.phase);
}

export function getFtggPairForGuided(s: GameState, u: UnitState) {
  return (s.ftggPairs ?? []).find((p) => p.guidedId === u.id && p.turn === s.turn && p.phase === s.phase);
}

export function canBeObserver(s: GameState, u: UnitState): boolean {
  if (!onBoard(u) || u.battleShocked || hasKw(u, 'FORTIFICATION')) return false;
  const isPathfinder = u.abilities.some((a) => a.name === 'Target Uploaded');
  // Normally cannot have already shot or been an observer
  if (!isPathfinder) {
    if (u.selectedToShoot || u.shotTurn === s.turn) return false;
    if (isUnitObserver(s, u)) return false;
  } else {
    // Pathfinder can observe up to 2 times
    const timesObserved = (s.ftggPairs ?? []).filter((p) => p.observerId === u.id && p.turn === s.turn && p.phase === s.phase).length;
    if (timesObserved >= 2) return false;
  }
  return true;
}

export function canBeGuided(s: GameState, u: UnitState): boolean {
  if (!onBoard(u) || !hasFtgg(u)) return false;
  if (isUnitObserver(s, u)) return false;
  if (isUnitGuided(s, u)) return false;
  return true;
}

/** Check if any model in observer can see any model in target. */
export function observerCanSeeTarget(s: GameState, observer: UnitState, target: UnitState): boolean {
  const oModels = alive(observer);
  const tModels = alive(target);
  return oModels.some((o) => tModels.some((t) => modelVisible(s, o, target, t)));
}

/** Pair a Guided unit, an Observer unit, and a Spotted enemy unit. */
export function pairFtgg(s: GameState, guidedId: string, observerId: string, spottedId: string): boolean {
  const guided = unitById(s, guidedId);
  const observer = unitById(s, observerId);
  const spotted = unitById(s, spottedId);
  if (!guided || !observer || !spotted) return false;

  s.ftggPairs ??= [];
  s.ftggPairs.push({
    guidedId,
    observerId,
    spottedId,
    turn: s.turn,
    phase: s.phase,
  });

  const ml = hasMarkerlight(observer);
  const isStealth = observer.abilities.some((a) => a.name === 'Forward Observers');
  const details = [
    '+1 BS',
    ml ? '[IGNORES COVER]' : '',
    isStealth ? 're-roll 1s to hit & wound' : '',
  ].filter(Boolean).join(' · ');

  log(s, `[Greater Good] For the Greater Good: ${observer.name} observed ${spotted.name} for ${guided.name} (${details})`, 'info', guided.owner);
  const oModel = alive(observer)[0];
  if (oModel) {
    pushFx(s, {
      kind: 'skill',
      unitId: observer.id,
      owner: observer.owner,
      at: { x: oModel.x, y: oModel.y },
      name: 'For the Greater Good',
      who: `Spotting ${spotted.name} for ${guided.name}`,
      style: 'holy',
      epic: false,
    });
  }
  return true;
}

/**
 * Automatically select the best available Observer for this Guided unit targeting an enemy.
 * Priority:
 * 1. Stealth Battlesuits (Forward Observers: re-roll 1s to hit and wound)
 * 2. Units with MARKERLIGHT keyword (grants [IGNORES COVER])
 * 3. Pathfinder Team (can observe even after shooting)
 * 4. Other eligible units
 */
export function autoSelectFtgg(s: GameState, guided: UnitState, target: UnitState): boolean {
  if (!isTauArmy(s, guided.owner) || !hasFtgg(guided) || !canBeGuided(s, guided)) return false;

  const eligibleObservers = boardUnits(s, guided.owner).filter((u) => u.id !== guided.id && canBeObserver(s, u) && observerCanSeeTarget(s, u, target));
  if (!eligibleObservers.length) return false;

  eligibleObservers.sort((a, b) => {
    const aStealth = a.abilities.some((x) => x.name === 'Forward Observers') ? 1 : 0;
    const bStealth = b.abilities.some((x) => x.name === 'Forward Observers') ? 1 : 0;
    if (aStealth !== bStealth) return bStealth - aStealth;

    const aMl = hasMarkerlight(a) ? 1 : 0;
    const bMl = hasMarkerlight(b) ? 1 : 0;
    if (aMl !== bMl) return bMl - aMl;

    const aPath = a.abilities.some((x) => x.name === 'Target Uploaded') ? 1 : 0;
    const bPath = b.abilities.some((x) => x.name === 'Target Uploaded') ? 1 : 0;
    return bPath - aPath;
  });

  const bestObserver = eligibleObservers[0];
  return pairFtgg(s, guided.id, bestObserver.id, target.id);
}

/** Check if player has a specific detachment name active. */
function hasDetachment(s: GameState, p: PlayerId, detName: string): boolean {
  const P = s.players[p];
  if (!P) return false;
  return (P.detachments ?? []).some((d) => d.name.toLowerCase().includes(detName.toLowerCase()));
}

/**
 * Calculate all FTGG and T’au detachment modifications for an attack by A against T.
 */
export function ftggAttackModifiers(s: GameState, A: UnitState, T: UnitState, distance = 0): FtggAttackBonus {
  const bonus: FtggAttackBonus = {
    isGuided: false,
    isSpotted: false,
    skillDelta: 0,
    hitMod: 0,
    strengthBonus: 0,
    apBonus: 0,
    woundMod: 0,
    ignoresCover: false,
    rerollHits1: false,
    rerollWounds1: false,
    lethal: false,
    sustained: null,
    ignoreMods: false,
    notes: [],
  };

  if (!isTauArmy(s, A.owner)) return bonus;

  // If not guided yet in shooting phase, attempt auto-spotting
  if (s.phase === 'shooting' && canBeGuided(s, A)) {
    autoSelectFtgg(s, A, T);
  }

  const pair = getFtggPairForGuided(s, A);
  if (pair) {
    bonus.isGuided = true;
    const observer = unitById(s, pair.observerId);

    if (pair.spottedId === T.id) {
      bonus.isSpotted = true;
      bonus.skillDelta -= 1; // +1 BS
      bonus.notes.push('For the Greater Good +1 BS');

      if (observer && hasMarkerlight(observer)) {
        bonus.ignoresCover = true;
        bonus.notes.push('Markerlight [IGNORES COVER]');
      }

      // Forward Observers (Stealth Battlesuits)
      if (observer && observer.abilities.some((a) => a.name === 'Forward Observers')) {
        bonus.rerollHits1 = true;
        bonus.rerollWounds1 = true;
        bonus.notes.push('Forward Observers: re-roll 1s');
      }

      // Coordinated Strike (Ta'unar Supremacy Armour)
      if (A.abilities.some((a) => a.name === 'Coordinated Strike')) {
        bonus.rerollHits1 = true;
        bonus.notes.push('Coordinated Strike: re-roll 1s');
      }

      // Through Unity, Devastation (enhancement)
      if (observer && observer.enhancements?.some((e) => e.name === 'Through Unity, Devastation')) {
        bonus.lethal = true;
        bonus.notes.push('Through Unity: Lethal Hits');
      }

      // Coordinated Exploitation (enhancement)
      if (observer && observer.enhancements?.some((e) => e.name === 'Coordinated Exploitation')) {
        bonus.sustained = '1';
        bonus.notes.push('Coordinated Exploitation: Sustained 1');
      }

      // Mont'ka: Guided weapons have [LETHAL HITS] in rounds 1-3
      if (hasDetachment(s, A.owner, 'Mont') && s.round <= 3) {
        bonus.lethal = true;
        bonus.notes.push('Killing Blow: Lethal Hits');
      }

      // Kauyon: Guided weapons ignore modifiers to BS & Hit in rounds 3-5
      if (hasDetachment(s, A.owner, 'Kauyon') && s.round >= 3) {
        bonus.ignoreMods = true;
        bonus.notes.push('Patient Hunter: ignore modifiers');
      }
    } else {
      // Guided unit shooting non-spotted target: -1 BS
      bonus.skillDelta += 1;
      bonus.notes.push('For the Greater Good (non-spotted) −1 BS');
    }
  }

  // --- Detachment passive bonuses ---

  // Kauyon (Patient Hunter): Round 3+: Ranged weapons have [SUSTAINED HITS 1]
  if (hasDetachment(s, A.owner, 'Kauyon') && s.round >= 3) {
    if (!bonus.sustained) {
      bonus.sustained = '1';
      bonus.notes.push('Patient Hunter: Sustained Hits 1');
    }
  }

  // Retaliation Cadre (Bonded Heroes): Battlesuits within 12": +1 S; within 8": +1 AP
  if (hasDetachment(s, A.owner, 'Retaliation') && hasKw(A, 'BATTLESUIT')) {
    if (distance <= 12 + 1e-6) {
      bonus.strengthBonus += 1;
      bonus.notes.push('Bonded Heroes +1 S');
    }
    if (distance <= 8 + 1e-6) {
      bonus.apBonus += 1;
      bonus.notes.push('Bonded Heroes +1 AP');
    }
  }

  // Kroot Hunting Pack (Hunter's Instincts): Target below starting: +1 Hit; below half: +1 Wound
  if (hasDetachment(s, A.owner, 'Kroot') && hasKw(A, 'KROOT')) {
    if (alive(T).length < T.startingStrength) {
      bonus.hitMod += 1;
      bonus.notes.push("Hunter's Instincts +1 to hit");
    }
    if (alive(T).length * 2 < T.startingStrength) {
      bonus.woundMod += 1;
      bonus.notes.push("Hunter's Instincts +1 to wound");
    }
  }

  return bonus;
}

