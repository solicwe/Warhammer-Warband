import coreRules from '../../data/core-rules.json';
import missions from '../../data/missions.json';
import layoutsData from '../../data/layouts.json';
import type { Pt } from './types';

// Rule numbers and mission data are kept in data/*.json so they can be edited without touching code.
export const RULES = coreRules;
export type CoreStratagemId = (typeof coreRules.coreStratagems)[number]['id'];
export const stratagemDef = (id: string) => coreRules.coreStratagems.find((s) => s.id === id)!;

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
export const deploymentName = (id: string) => MISSIONS.deploymentCards.find((d) => d.id === id)?.name ?? id;
export const dispositionById = (id: string) => MISSIONS.forceDispositions.find((d) => d.id === id)!;
/** Map a detachment's Force Disposition text ("Take and Hold") to its id. */
export const dispositionId = (name: string | null | undefined): DispositionId | null =>
  (MISSIONS.forceDispositions.find((d) => d.name.toLowerCase() === (name ?? '').toLowerCase())?.id ?? null);
/** Your primary mission: your disposition (row) against your opponent's (column). */
export const primaryFor = (mine: DispositionId, theirs: DispositionId) => MISSIONS.primaries.find((p) => p.forceDisposition === mine && p.vs === theirs)!;
/** The three official layouts for a pair of dispositions (order does not matter). */
export const layoutsFor = (a: DispositionId, b: DispositionId) =>
  LAYOUTS.filter((l) => (l.matchup[0] === a && l.matchup[1] === b) || (l.matchup[0] === b && l.matchup[1] === a)).sort((x, y) => x.number - y.number);

export const toPoly = (arr: number[][]): Pt[] => arr.map(([x, y]) => ({ x, y }));
export const deploymentById = (id: string): DeploymentDef => {
  const l = LAYOUTS.find((d) => d.id === id) ?? LAYOUTS[0];
  return { ...l, name: deploymentName(l.deployment) };
};
export const ROGUELIKE_PRIMARY: PrimaryDef = {
  id: 'roguelike-annihilation',
  name: 'Annihilation',
  forceDisposition: 'purge-the-foe',
  vs: 'purge-the-foe',
  scoring: [
    {
      rounds: [1, 5],
      when: 'endOfAnyTurn',
      condition: 'enemyDestroyed',
      vp: 0,
      text: 'Eliminate enemy units to score VP equal to their points value. Total annihilation wins immediately!',
    },
    {
      rounds: [1, 5],
      when: 'endOfAnyTurn',
      condition: 'captureLoot',
      vp: 5,
      text: 'Capturing an Objective marker awards +100 Scrap, +1 CP, and +5 VP!',
    },
    {
      rounds: [1, 5],
      when: 'endOfYourCommandPhase',
      condition: 'perObjectiveControlled',
      vp: 5,
      text: 'Control objectives (5 VP each per round)',
    },
    {
      rounds: [1, 5],
      when: 'endOfYourCommandPhase',
      condition: 'controlMoreThanOpponent',
      vp: 5,
      text: 'Control more objectives than your opponent (5 VP)',
    },
  ],
};

export const primaryById = (id: string): PrimaryDef => {
  if (id === 'roguelike-annihilation') return ROGUELIKE_PRIMARY;
  return MISSIONS.primaries.find((p) => p.id === id) ?? ROGUELIKE_PRIMARY;
};
