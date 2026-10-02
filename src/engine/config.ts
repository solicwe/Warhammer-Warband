import coreRules from '../../data/core-rules.json';
import missions from '../../data/missions.json';
import type { Pt } from './types';

// Rule numbers and mission data are kept in data/*.json so they can be edited without touching code.
export const RULES = coreRules;
export type CoreStratagemId = (typeof coreRules.coreStratagems)[number]['id'];
export const stratagemDef = (id: string) => coreRules.coreStratagems.find((s) => s.id === id)!;

export interface ScoringRule {
  rounds: number[];
  when: 'endOfYourTurn' | 'endOfYourCommandPhase' | 'endOfBattle';
  round5When?: 'endOfYourTurn';
  condition: string;
  vp: number;
  bonus?: { condition: string; vp: number };
  text: string;
}
export interface PrimaryDef { id: string; name: string; forceDisposition: string; mirroredWorld?: boolean; scoring: ScoringRule[] }
export interface TerrainSpec { kind: string; x: number; y: number; w: number; h: number; mirror?: boolean }
export interface DeploymentDef {
  id: string;
  name: string;
  attackerEdge: string;
  defenderEdge: string;
  zones: { attacker: number[][]; defender: number[][] };
  territory: { attacker: number[][]; defender: number[][] };
  objectives: { id: string; type: 'home' | 'central' | 'expansion'; x: number; y: number; owner?: 'attacker' | 'defender' }[];
  terrain: TerrainSpec[];
}

export const MISSIONS = missions as unknown as {
  terrainKinds: Record<string, { category: 'exposed' | 'light' | 'dense'; height: number; walls: 'L' | 'box' | 'none'; label: string }>;
  objectiveTerrain: { kind: string; w: number; h: number };
  deployments: DeploymentDef[];
  primaries: PrimaryDef[];
  vpCaps: { primaryTotal: number; primaryPerRound: number; secondaryTotal: number; secondaryPerRound: number; fixedPerCard: number };
  secondaries: SecondaryDef[];
};
export interface SecondaryDef { id: string; name: string; when: string; text: string; options: number[]; fixed?: boolean; round1Redraw?: boolean; redrawIf?: string }
export const secondaryById = (id: string) => (missions as unknown as { secondaries: SecondaryDef[] }).secondaries.find((x) => x.id === id)!;

export const toPoly = (arr: number[][]): Pt[] => arr.map(([x, y]) => ({ x, y }));
export const deploymentById = (id: string) => MISSIONS.deployments.find((d) => d.id === id)!;
export const primaryById = (id: string) => MISSIONS.primaries.find((p) => p.id === id)!;
