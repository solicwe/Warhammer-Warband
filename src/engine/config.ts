import coreRules from '../../data/core-rules.json';
import missions from '../../data/missions.json';
import layoutsData from '../../data/layouts.json';
import type { Pt } from './types';

// Rule numbers and mission data are kept in data/*.json so they can be edited without touching code.
export const RULES = coreRules;

export type ScoringWhen = 'endOfYourTurn' | 'endOfYourCommandPhase' | 'endOfBattle' | 'endOfAnyTurn';
export interface ScoringRule {
  rounds: number[];
  when: ScoringWhen;
  round5When?: 'endOfYourTurn';
  condition: string;
  vp: number;
  /** count-based tiers [[minCount, vp], ...]: the highest tier reached scores */
  tiers?: [number, number][];
  /** cumulative bonus, only when the base condition scored */
  bonus?: { condition: string; vp: number };
  bonusText?: string;
  text: string;
}
export type DispositionId = 'take-and-hold' | 'purge-the-foe' | 'disruption' | 'reconnaissance' | 'priority-assets';
export interface PrimaryDef { id: string; name: string; forceDisposition: DispositionId; vs: DispositionId; action?: string; scoring: ScoringRule[] }
export interface ActionDef { name: string; starts: 'shooting'; fromRound: number; limit: 'unlimited' | 'oncePerTurn'; completes: 'immediately' | 'endOfTurnIfControl' | 'endOfTurnIfNoEnemyInArea'; text: string }

/** One official terrain layout (Chapter Approved 2026-27): deployment, territories, objectives and terrain. */
export interface LayoutDef {
  id: string;
  matchup: [DispositionId, DispositionId];
  number: number;
  deployment: string;
  attackerEdge: string;
  defenderEdge: string;
  zones: { attacker: number[][]; defender: number[][] };
  territory: { attacker: number[][]; defender: number[][] };
  objectives: { type: 'home' | 'central' | 'expansion'; owner: 'attacker' | 'defender' | null; x: number; y: number }[];
  terrain: { poly: number[][]; walls: number[][]; obstacles: number[][]; box?: number[][] }[];
  /** a table that is not 44" x 60" (the test range); the layout itself is still drawn in 44 x 60 units and scaled to it */
  table?: { width: number; height: number };
}
export type DeploymentDef = LayoutDef & { name: string };

export const MISSIONS = missions as unknown as {
  terrainKinds: Record<string, { category: 'exposed' | 'light' | 'dense'; height: number; walls: 'L' | 'box' | 'none'; label: string }>;
  primaries: PrimaryDef[];
  forceDispositions: { id: DispositionId; name: string; color: string; text: string }[];
  deploymentCards: { id: string; name: string }[];
  actions: Record<string, ActionDef>;
  vpCaps: { primaryTotal: number; primaryPerRound: number; secondaryTotal: number; secondaryPerRound: number; fixedPerCard: number };
  secondaries: SecondaryDef[];
};
export interface SecondaryRule {
  trigger: 'endOfYourTurn' | 'endOfOpponentTurn' | 'endOfAnyTurn';
  condition: string;
  vp: number;
  mode: 'fixed' | 'tactical' | 'both';
  fromRound: number;
  tiers?: [number, number][];
  cap?: number;
  bonus?: { condition: string; vp: number };
  /** "end of your opponent's turn or the end of the fifth battle round (whichever comes first)" */
  orEndOfRound5?: boolean;
}
export interface SecondaryDef {
  id: string; name: string; when: string; text: string; auto: SecondaryRule[];
  fixed?: boolean; round1Redraw?: boolean; mandatoryRedraw?: boolean; redrawIf?: string; redrawIfNo?: 'ss13' | 'w10';
  whenDrawn?: 'beacon' | 'tempting-target' | 'guard'; action?: string;
}
export const secondaryById = (id: string) => MISSIONS.secondaries.find((x) => x.id === id)!;

export const LAYOUTS = (layoutsData as unknown as { layouts: LayoutDef[] }).layouts;
/** A small empty table for trying out shooting: 24" x 30", no terrain, 10" deployment bands with a 10" gap. Not one of the
 *  45 official layouts, so it never turns up in the official lists or in a random pick. */
export const TEST_RANGE_ID = 'test-range';
export const TEST_RANGE: LayoutDef = {
  id: TEST_RANGE_ID, matchup: ['take-and-hold', 'take-and-hold'], number: 1, deployment: TEST_RANGE_ID, attackerEdge: 'top', defenderEdge: 'bottom',
  table: { width: 24, height: 30 },
  zones: { attacker: [[0, 0], [44, 0], [44, 20], [0, 20]], defender: [[0, 40], [44, 40], [44, 60], [0, 60]] },
  territory: { attacker: [[0, 0], [44, 0], [44, 30], [0, 30]], defender: [[0, 30], [44, 30], [44, 60], [0, 60]] },
  objectives: [{ type: 'home', owner: 'attacker', x: 22, y: 10 }, { type: 'central', owner: null, x: 22, y: 30 }, { type: 'home', owner: 'defender', x: 22, y: 50 }],
  terrain: [],
};
/** The official layouts and the test range: for looking a layout up by id. */
export const layoutById = (id: string | undefined) => LAYOUTS.find((l) => l.id === id) ?? (id === TEST_RANGE_ID ? TEST_RANGE : undefined);
export const deploymentName = (id: string) => (id === TEST_RANGE_ID ? 'Test range' : MISSIONS.deploymentCards.find((d) => d.id === id)?.name ?? id);
export const dispositionById = (id: string) => MISSIONS.forceDispositions.find((d) => d.id === id)!;
/** Map a detachment's Force Disposition text ("Take and Hold") to its id. */
export const dispositionId = (name: string | null | undefined): DispositionId | null => {
  if (!name) return null;
  const direct = MISSIONS.forceDispositions.find((d) => d.name.toLowerCase() === name.trim().toLowerCase())?.id;
  if (direct) return direct;
  if (name.includes(',')) {
    for (const part of name.split(',')) {
      const match = MISSIONS.forceDispositions.find((d) => d.name.toLowerCase() === part.trim().toLowerCase())?.id;
      if (match) return match;
    }
  }
  return null;
};
/** Your primary mission: your disposition (row) against your opponent's (column). */
export const primaryFor = (mine: DispositionId, theirs: DispositionId) => MISSIONS.primaries.find((p) => p.forceDisposition === mine && p.vs === theirs)!;
/** The three official layouts for a pair of dispositions (order does not matter). */
/** One official map for each of the six deployments: the pairing's own, else one from a pairing that shares a disposition, else any. */
export const mapsPerDeployment = (a?: DispositionId, b?: DispositionId): LayoutDef[] => [...new Set(LAYOUTS.map((l) => l.deployment))].map((dep) =>
  (a && b ? layoutsFor(a, b).find((l) => l.deployment === dep) : undefined)
  ?? LAYOUTS.find((l) => l.deployment === dep && ((l.matchup as string[]).includes(a ?? '') || (l.matchup as string[]).includes(b ?? '')))
  ?? LAYOUTS.find((l) => l.deployment === dep)!);

export const layoutsFor = (a: DispositionId, b: DispositionId) =>
  LAYOUTS.filter((l) => (l.matchup[0] === a && l.matchup[1] === b) || (l.matchup[0] === b && l.matchup[1] === a)).sort((x, y) => x.number - y.number);

export const toPoly = (arr: number[][]): Pt[] => arr.map(([x, y]) => ({ x, y }));
export const deploymentById = (id: string): DeploymentDef => {
  const l = layoutById(id) ?? LAYOUTS[0];
  return { ...l, name: deploymentName(l.deployment) };
};
export const primaryById = (id: string): PrimaryDef => {
  // a legacy battle saved before the old 'roguelike-annihilation' mission went plays Meatgrinder (both Purge the Foe)
  return MISSIONS.primaries.find((p) => p.id === id) ?? MISSIONS.primaries.find((p) => p.id === 'meatgrinder')!;
};
