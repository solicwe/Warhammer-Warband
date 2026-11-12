// ============================================================================
// WARHAMMER WARBAND v2.0 — FACTION ASCENDANCY ENGINE (ARPG League Specializations)
// Thousand Sons Arcane Flux, Orks WAAAGH! Momentum, Necrons Dynastic Grid, World Eaters Blood Tithe
// ============================================================================

import { addTimed } from '../rules-engine/effects';
import { addCombatMods, type AttackContext } from './combatMods';
import { applyMortalWounds } from './combatEngine';
import { d6, rollExpr } from './dice';
import { alive, boardUnits, hasKw, log, onBoard, other, pushFx } from './state';
import type { GameState, PlayerId, UnitState } from './types';

export interface WaaaghTierInfo {
  tier: 1 | 2 | 3;
  name: string;
  min: number;
  max: number;
  chargeBonus: number;
  meleeStrBonus: number;
  meleeAtkBonus: number;
  invulnSave: number | null;
  advanceAndCharge: boolean;
  description: string;
}

export const WAAAGH_TIERS: Record<1 | 2 | 3, WaaaghTierInfo> = {
  1: {
    tier: 1,
    name: 'Rowdy',
    min: 0,
    max: 33,
    chargeBonus: 1,
    meleeStrBonus: 0,
    meleeAtkBonus: 0,
    invulnSave: null,
    advanceAndCharge: false,
    description: '+1 to Charge rolls.',
  },
  2: {
    tier: 2,
    name: 'Proper Killy',
    min: 34,
    max: 66,
    chargeBonus: 1,
    meleeStrBonus: 1,
    meleeAtkBonus: 0,
    invulnSave: null,
    advanceAndCharge: false,
    description: '+1 Melee Strength, +1 to Charge rolls.',
  },
  3: {
    tier: 3,
    name: 'Da Biggest WAAAGH!',
    min: 67,
    max: 100,
    chargeBonus: 2,
    meleeStrBonus: 1,
    meleeAtkBonus: 1,
    invulnSave: 5,
    advanceAndCharge: true,
    description: '+1 Melee Str, +1 Melee Atk, 5+ Invuln Save, Advance & Charge, +2 to Charge rolls.',
  },
};

/**
 * Returns the current WAAAGH! momentum tier (1, 2, or 3)
 */
export function getWaaaghTier(momentum: number): WaaaghTierInfo {
  if (momentum >= 67) return WAAAGH_TIERS[3];
  if (momentum >= 34) return WAAAGH_TIERS[2];
  return WAAAGH_TIERS[1];
}

/**
 * Add or reduce WAAAGH! momentum for a player (clamped 0 - 100)
 */
export function addWaaaghMomentum(s: GameState, p: PlayerId, amount: number) {
  const P = s.players[p];
  if (P.waaaghMomentum === undefined) P.waaaghMomentum = 20;
  const oldTier = getWaaaghTier(P.waaaghMomentum).tier;
  P.waaaghMomentum = Math.max(0, Math.min(100, P.waaaghMomentum + amount));
  const newTier = getWaaaghTier(P.waaaghMomentum).tier;

  if (newTier > oldTier) {
    const info = WAAAGH_TIERS[newTier];
    log(s, `[WAAAGH! ASCENDANCY] ${P.name}'s momentum surged to Tier ${newTier} (${info.name})! ${info.description}`, 'info', p);
    const repUnit = boardUnits(s, p)[0];
    if (repUnit && repUnit.models[0]) {
      pushFx(s, {
        kind: 'skill',
        unitId: repUnit.id,
        at: { x: repUnit.models[0].x, y: repUnit.models[0].y },
        owner: p,
        name: `WAAAGH! ${info.name.toUpperCase()}`,
        who: P.name,
        style: 'waaagh',
        epic: true,
      });
    }
  }
}

/**
 * Thousand Sons: Add or reduce Cabalistic Arcane Flux (clamped 0 - 12)
 */
export function addCabalFlux(s: GameState, p: PlayerId, amount: number) {
  const P = s.players[p];
  if (P.cabalFlux === undefined) P.cabalFlux = 4;
  P.cabalFlux = Math.max(0, Math.min(12, P.cabalFlux + amount));
}

/**
 * Thousand Sons Ascendancy Spell: Doombolt Cascade (Cost: 6 Flux)
 * Blasts an enemy unit for 1d3+3 Mortal Wounds.
 */
export function castDoomboltCascade(s: GameState, p: PlayerId, targetUnitId: string): { success: boolean; damage?: number; error?: string } {
  const P = s.players[p];
  const flux = P.cabalFlux ?? 0;
  if (flux < 6) return { success: false, error: 'Not enough Arcane Flux (needs 6).' };

  const target = s.units.find((u) => u.id === targetUnitId && onBoard(u) && u.owner !== p);
  if (!target) return { success: false, error: 'Invalid enemy target.' };

  P.cabalFlux = flux - 6;
  const dmg = rollExpr(s, '1d3+3').total;
  log(s, `[DOOMBOLT CASCADE] ${P.name} expends 6 Arcane Flux to unleash Doombolt Cascade on ${target.name} for ${dmg} Mortal Wounds!`, 'info', p);

  pushFx(s, {
    kind: 'explosion',
    at: target.models[0] ? { x: target.models[0].x, y: target.models[0].y } : { x: 0, y: 0 },
    range: 3,
    radius: 3,
    hits: dmg,
    title: 'DOOMBOLT CASCADE',
  });

  applyMortalWounds(s, target, dmg, 'Doombolt Cascade');
  return { success: true, damage: dmg };
}

/**
 * Thousand Sons Ascendancy Spell: Temporal Twist (Cost: 4 Flux)
 * Grants an allied unit +3" Move and Advance re-rolls for 1 turn.
 */
export function castTemporalTwist(s: GameState, p: PlayerId, allyUnitId: string): { success: boolean; error?: string } {
  const P = s.players[p];
  const flux = P.cabalFlux ?? 0;
  if (flux < 4) return { success: false, error: 'Not enough Arcane Flux (needs 4).' };

  const ally = s.units.find((u) => u.id === allyUnitId && onBoard(u) && u.owner === p);
  if (!ally) return { success: false, error: 'Invalid allied target.' };

  P.cabalFlux = flux - 4;
  log(s, `⏳ [TEMPORAL TWIST] ${P.name} channels 4 Arcane Flux into ${ally.name}! (+3" Move & Temporal Acceleration)`, 'info', p);

  pushFx(s, {
    kind: 'skill',
    unitId: ally.id,
    at: ally.models[0] ? { x: ally.models[0].x, y: ally.models[0].y } : { x: 0, y: 0 },
    owner: p,
    name: 'TEMPORAL TWIST',
    who: ally.name,
    style: 'psychic',
    epic: true,
  });

  addTimed(s, ally, {
    e: { move: 3 },
    label: 'Temporal Twist (+3" Move)',
    until: 'turn',
    by: p,
  });

  return { success: true };
}

/**
 * Necrons: Toggle Dynastic Grid mode between 'resurrection' and 'detonation'
 */
export function toggleDynasticGrid(s: GameState, p: PlayerId): 'resurrection' | 'detonation' {
  const P = s.players[p];
  P.dynasticGridMode = P.dynasticGridMode === 'detonation' ? 'resurrection' : 'detonation';
  const mode = P.dynasticGridMode;
  const desc = mode === 'resurrection'
    ? 'Reanimation Protocols heal +1 extra wound.'
    : 'Gauss weapons score Critical Hits on 5+ and gain +1 AP.';
  log(s, `[DYNASTIC GRID] ${P.name} reconfigures Dynastic Grid to [${mode.toUpperCase()}]! (${desc})`, 'info', p);
  return mode;
}

/**
 * World Eaters: Add Blood Tithe points (capped at 8)
 */
export function addBloodTithe(s: GameState, p: PlayerId, amount = 1) {
  const P = s.players[p];
  P.tithe = Math.min(8, (P.tithe ?? 0) + amount);
  log(s, `[BLOOD TITHE] Bloodshed fuels Khorne's altar! (${P.tithe}/8 Tithe points)`, 'info', p);
}

/**
 * World Eaters: Spend Blood Tithe for an instant Khorne Blessing
 */
export function spendBloodTithe(s: GameState, p: PlayerId, cost: number, blessingName: string): boolean {
  const P = s.players[p];
  if ((P.tithe ?? 0) < cost) return false;
  P.tithe = (P.tithe ?? 0) - cost;
  log(s, `[KHORNE'S BLESSING] ${P.name} claims ${blessingName} for ${cost} Tithe points!`, 'info', p);
  const repUnit = boardUnits(s, p)[0];
  if (repUnit && repUnit.models[0]) {
    pushFx(s, {
      kind: 'skill',
      unitId: repUnit.id,
      at: { x: repUnit.models[0].x, y: repUnit.models[0].y },
      owner: p,
      name: blessingName.toUpperCase(),
      who: P.name,
      style: 'chaos',
      epic: true,
    });
  }
  return true;
}

/**
 * Start of turn hook for Faction Ascendancy mechanics
 */
export function processAscendancyTurnStart(s: GameState, activePlayer: PlayerId) {
  const P = s.players[activePlayer];

  // Thousand Sons Arcane Flux replenishment
  const hasPsyker = boardUnits(s, activePlayer).some((u) => hasKw(u, 'PSYKER') || alive(u).some((m) => m.keywords.includes('PSYKER')));
  const isTsons = P.armyRules?.some((r) => r.name.toLowerCase().includes('cabal') || r.name.toLowerCase().includes('magic'))
    || boardUnits(s, activePlayer).some((u) => hasKw(u, 'THOUSAND SONS') || (u.sources ?? []).some((src) => src.includes('Rubric') || src.includes('Scarab')));

  if (isTsons || hasPsyker) {
    addCabalFlux(s, activePlayer, 2);
  }

  // Orks WAAAGH! Momentum natural decay/baseline
  const isOrk = boardUnits(s, activePlayer).some((u) => hasKw(u, 'ORK') || hasKw(u, 'ORKS') || (u.sources ?? []).some((src) => src.toLowerCase().includes('boyz')));
  if (isOrk && P.waaaghMomentum === undefined) {
    P.waaaghMomentum = 20;
  }

  // Necrons Dynastic Grid default
  const isNecron = boardUnits(s, activePlayer).some((u) => hasKw(u, 'NECRONS'));
  if (isNecron && !P.dynasticGridMode) {
    P.dynasticGridMode = 'resurrection';
  }
}

// Register Faction Ascendancy Combat Modifiers
addCombatMods((ctx: AttackContext) => {
  const { s, A, mode, weapon } = ctx;
  const P = s.players[A.owner];
  if (!P) return null;

  // 1. Orks WAAAGH! Momentum Melee Bonuses
  if ((hasKw(A, 'ORK') || hasKw(A, 'ORKS')) && mode === 'melee' && P.waaaghMomentum !== undefined) {
    const tier = getWaaaghTier(P.waaaghMomentum).tier;
    if (tier === 3) {
      return {
        strengthBonus: 1,
        attacksBonus: 1,
        notes: ['WAAAGH! Tier 3: Hit bonus (+1 Atk, +1 Str)'],
      };
    } else if (tier === 2) {
      return {
        strengthBonus: 1,
        notes: ['WAAAGH! Tier 2: Hit bonus (+1 Str)'],
      };
    }
  }

  // 2. Necrons Dynastic Grid Detonation Mode
  if (P.dynasticGridMode === 'detonation') {
    const isGauss = weapon?.toLowerCase().includes('gauss') || hasKw(A, 'NECRONS');
    if (isGauss) {
      return {
        apBonus: 1,
        critHitOn: 5,
        notes: ['Dynastic Detonation: 5+ Crit Hit, +1 AP'],
      };
    }
  }

  return null;
});
