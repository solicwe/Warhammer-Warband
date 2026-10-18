// Game lifecycle events. The core loop (game.ts) emits them; faction modules subscribe in factionHooks.ts, so a new
// faction never needs an edit to the core loop.
import type { MoveKind, Phase, PlayerId, Pt, UnitState } from './types';
import type { GameState } from './types';

export interface GameEvents {
  /** the game was just created, before deployment */
  setup: Record<string, never>;
  /** the first turn begins, before its Command phase */
  battleStart: Record<string, never>;
  /** a turn begins: nothing of it has happened yet */
  turnBegin: { p: PlayerId };
  /** the first player's turn begins a new battle round */
  roundStart: Record<string, never>;
  /** after the round start, just before the Command phase */
  turnStart: { p: PlayerId };
  commandStart: { p: PlayerId };
  commandEnd: { p: PlayerId };
  /** end of the Movement phase, after the Reinforcements step */
  movementEnd: { p: PlayerId };
  shootingStart: { p: PlayerId };
  /** any phase ends (before the next one is set up) */
  phaseEnd: { phase: Phase };
  turnEnd: { p: PlayerId };
  roundEnd: Record<string, never>;
  /** a Battle-shock test was resolved */
  shockResult: { u: UnitState; passed: boolean };
  /** a unit finished a Normal, Advance or Fall Back move */
  moved: { u: UnitState; kind: MoveKind; paths: Map<string, Pt[]> };
  /** a unit moved or arrived: the enemy may react (Cult Ambush markers) */
  unitMoved: { u: UnitState };
}

export type EventName = keyof GameEvents;
type Handler<K extends EventName> = (s: GameState, e: GameEvents[K]) => void;

const handlers: { [K in EventName]?: Handler<K>[] } = {};

/** Subscribe to an event. Handlers run in the order they were added (factionHooks.ts fixes that order). */
export function on<K extends EventName>(name: K, fn: Handler<K>) {
  ((handlers[name] ??= []) as Handler<K>[]).push(fn);
}

export function emit<K extends EventName>(s: GameState, name: K, e: GameEvents[K]) {
  for (const fn of (handlers[name] ?? []) as Handler<K>[]) fn(s, e);
}

/** Numbers several rules can change: each faction adds its part. */
export interface GameModifiers {
  /** added to a unit's Battle-shock test */
  battleShock: (s: GameState, u: UnitState) => number;
  /** the closest a Deep Striking unit may be set up to enemies at this point (the smallest answer wins); null: no say */
  deepStrikeDistance: (s: GameState, u: UnitState, at: Pt) => number | null;
}

const modifiers: { [K in keyof GameModifiers]?: GameModifiers[K][] } = {};

export function addModifier<K extends keyof GameModifiers>(name: K, fn: GameModifiers[K]) {
  ((modifiers[name] ??= []) as GameModifiers[K][]).push(fn);
}

export function battleShockMod(s: GameState, u: UnitState): number {
  return (modifiers.battleShock ?? []).reduce((sum, fn) => sum + fn(s, u), 0);
}

export function deepStrikeDistance(s: GameState, u: UnitState, at: Pt, base: number): number {
  return (modifiers.deepStrikeDistance ?? []).reduce((d, fn) => Math.min(d, fn(s, u, at) ?? Infinity), base);
}
