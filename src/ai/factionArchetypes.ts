import type { GameState, UnitState, PlayerId } from '../engine/types';
import { alive, hasKw } from '../engine/state';

export type FactionArchetype =
  | 'GUNLINE_CASTLE'
  | 'PRESSURE_MELEE_TRADING'
  | 'GLASS_CANNON_TRICKERY'
  | 'ATTRITION_ANVIL'
  | 'COMBINED_ARMS_TACTICAL';

export interface ArchetypeProfile {
  name: FactionArchetype;
  description: string;
  kitePreference: number;          // 0 to 1: tendency to fall back or keep distance
  screeningPriority: number;       // 0 to 1: priority of placing chaff 4-6" in front of heavy shooters
  stagingBehindRuins: boolean;     // Whether melee units stage behind obscuring cover turns 1-2
  threatBubbleEvasion: number;     // Inches of buffer kept away from enemy advance+charge threat
  centerBoardDominance: number;    // Weight on occupying central primary objectives
  toeInCoverHolding: boolean;      // Whether units toe-in into terrain footprint edges for cover
  deepStrikeScreenGrid: number;    // Inches between backline screeners (default 18" to deny 9" deep strike)
  overkillToleranceFactor: number; // 1.0 = exact expected kill; 1.25 = 25% safety margin, avoiding waste
  chargeThreshold: number;         // Minimum probability to declare charge (e.g., 0.45 = 8" roll)
  vpFirstBias: number;             // Weight on flipping objective OC vs hunting kills
}

export const ARCHETYPE_PROFILES: Record<FactionArchetype, ArchetypeProfile> = {
  GUNLINE_CASTLE: {
    name: 'GUNLINE_CASTLE',
    description: 'Defensive firing corridors, 4-6" chaff screens protecting heavy assets, kiting away from melee',
    kitePreference: 0.85,
    screeningPriority: 0.95,
    stagingBehindRuins: false,
    threatBubbleEvasion: 12.0,
    centerBoardDominance: 0.55,
    toeInCoverHolding: true,
    deepStrikeScreenGrid: 17.5,
    overkillToleranceFactor: 1.15,
    chargeThreshold: 0.75, // Only charge when overwhelmingly safe or defensive tag
    vpFirstBias: 0.75,
  },
  PRESSURE_MELEE_TRADING: {
    name: 'PRESSURE_MELEE_TRADING',
    description: 'Stage behind obscuring ruins turns 1-2, multi-charge overload turns 2-3, aggressive OC flipping',
    kitePreference: 0.05,
    screeningPriority: 0.60,
    stagingBehindRuins: true,
    threatBubbleEvasion: 0.0,
    centerBoardDominance: 0.90,
    toeInCoverHolding: true,
    deepStrikeScreenGrid: 16.0,
    overkillToleranceFactor: 1.30,
    chargeThreshold: 0.40, // Willing to take longer charges (7-9")
    vpFirstBias: 0.85,
  },
  GLASS_CANNON_TRICKERY: {
    name: 'GLASS_CANNON_TRICKERY',
    description: 'Threat bubble avoidance (Move + 8"), surgical focus fire, high-mobility secondary snatching',
    kitePreference: 0.90,
    screeningPriority: 0.70,
    stagingBehindRuins: true,
    threatBubbleEvasion: 14.0,
    centerBoardDominance: 0.60,
    toeInCoverHolding: true,
    deepStrikeScreenGrid: 18.0,
    overkillToleranceFactor: 1.10, // Surgical target allocation, minimum overkill
    chargeThreshold: 0.65,
    vpFirstBias: 0.95, // Highly focused on Tactical Secondaries & primary point theft
  },
  ATTRITION_ANVIL: {
    name: 'ATTRITION_ANVIL',
    description: 'Center expansion, toe-in behind cover to hold primary VP while remaining obscured, high durability grind',
    kitePreference: 0.20,
    screeningPriority: 0.50,
    stagingBehindRuins: false,
    threatBubbleEvasion: 4.0,
    centerBoardDominance: 1.00,
    toeInCoverHolding: true,
    deepStrikeScreenGrid: 17.0,
    overkillToleranceFactor: 1.20,
    chargeThreshold: 0.50,
    vpFirstBias: 0.90,
  },
  COMBINED_ARMS_TACTICAL: {
    name: 'COMBINED_ARMS_TACTICAL',
    description: 'Balanced mid-board presence, transport blocking, CP preservation for critical stratagems, flexible response',
    kitePreference: 0.50,
    screeningPriority: 0.75,
    stagingBehindRuins: true,
    threatBubbleEvasion: 8.0,
    centerBoardDominance: 0.80,
    toeInCoverHolding: true,
    deepStrikeScreenGrid: 17.5,
    overkillToleranceFactor: 1.20,
    chargeThreshold: 0.55,
    vpFirstBias: 0.85,
  },
};

/**
 * Maps all 23 competitive Warhammer 40k factions to their core tactical tournament archetype.
 */
export const FACTION_TO_ARCHETYPE: Record<string, FactionArchetype> = {
  // Gunline Castle
  TAU: 'GUNLINE_CASTLE',
  AM: 'GUNLINE_CASTLE',
  LoV: 'GUNLINE_CASTLE',
  AdM: 'GUNLINE_CASTLE',
  QI: 'GUNLINE_CASTLE',

  // Pressure Melee Trading
  WE: 'PRESSURE_MELEE_TRADING',
  ORK: 'PRESSURE_MELEE_TRADING',
  CD: 'PRESSURE_MELEE_TRADING',
  TYR: 'PRESSURE_MELEE_TRADING',
  BT: 'PRESSURE_MELEE_TRADING',
  BA: 'PRESSURE_MELEE_TRADING',

  // Glass Cannon Trickery
  AE: 'GLASS_CANNON_TRICKERY',
  DRU: 'GLASS_CANNON_TRICKERY',
  GC: 'GLASS_CANNON_TRICKERY',
  EC: 'GLASS_CANNON_TRICKERY',

  // Attrition Anvil
  DG: 'ATTRITION_ANVIL',
  NEC: 'ATTRITION_ANVIL',
  AC: 'ATTRITION_ANVIL',
  GK: 'ATTRITION_ANVIL',
  QT: 'ATTRITION_ANVIL',

  // Combined Arms Tactical
  SM: 'COMBINED_ARMS_TACTICAL',
  CSM: 'COMBINED_ARMS_TACTICAL',
  TS: 'COMBINED_ARMS_TACTICAL',
  AS: 'COMBINED_ARMS_TACTICAL',
  DA: 'COMBINED_ARMS_TACTICAL',
  SW: 'COMBINED_ARMS_TACTICAL',
  AoI: 'COMBINED_ARMS_TACTICAL',
};

/**
 * Retrieves the archetype profile for a given player or faction in the current game state.
 */
export function getArchetypeForPlayer(s: GameState, p: PlayerId): ArchetypeProfile {
  const factionId = s.players[p]?.factionId ?? (s.units.find((u) => u.owner === p)?.sources?.[0] as string) ?? 'SM';
  const archetypeKey = FACTION_TO_ARCHETYPE[factionId] ?? 'COMBINED_ARMS_TACTICAL';
  return ARCHETYPE_PROFILES[archetypeKey];
}

/**
 * Identifies whether a unit acts as screen/chaff vs heavy asset.
 */
export function isScreeningUnit(u: UnitState): boolean {
  if (hasKw(u, 'CHARACTER') || hasKw(u, 'MONSTER') || hasKw(u, 'VEHICLE') || hasKw(u, 'TITANIC')) {
    return false;
  }
  const pts = u.pts ?? 100;
  const count = alive(u).length;
  // Cheap unit with multiple models or high model count
  return pts <= 110 || count >= 10 || hasKw(u, 'BATTLELINE') || hasKw(u, 'SWARM');
}

/**
 * Calculates whether enemy units are in Deep Strike reserve and need 9" screening.
 */
export function needsDeepStrikeScreening(s: GameState, friendlyPlayer: PlayerId): boolean {
  const enemyId = (friendlyPlayer === 0 ? 1 : 0) as PlayerId;
  const enemyReserves = s.units.filter((u) => u.owner === enemyId && (u.status === 'reserves' || (u.status as string) === 'strategicReserves'));
  return enemyReserves.some((u) => u.core.deepStrike || u.models.some((m) => m.keywords.includes('DEEP STRIKE')));
}
