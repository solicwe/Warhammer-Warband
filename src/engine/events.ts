// The engine's extension points. The core (game.ts, attack.ts, effects.ts, activations.ts ...) emits events and asks
// these hooks; faction modules register in src/factions/index.ts. No core file imports a faction module.
import type { MoveKind, ModelState, Phase, PlayerId, Pt, StratagemData, UnitState } from './types';
import type { Action } from '../rules-engine/activations';
import type { GameState } from './types';
import type { Active, Ctx, DetChoiceOption, Eligibility } from '../rules-engine/effects';

// ---------- events: something happened ----------

export interface GameEvents {
  /** the game was just created, before deployment */
  setup: Record<string, never>;
  /** deployment is over, before Scout moves (Resolve Pre-battle Abilities) */
  preBattle: Record<string, never>;
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
  movementStart: { p: PlayerId };
  movementEnd: { p: PlayerId };
  shootingStart: { p: PlayerId };
  /** the Fight phase starts (before pile-in) */
  fightStart: Record<string, never>;
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
  /** a unit is selected to shoot or fight, before its weapons are picked */
  unitSelected: { u: UnitState; kind: 'shoot' | 'fight' };
  /** a unit chose a target (shooting, fighting or charging) */
  targetChosen: { attackerId: string; targetId: string };
  /** a unit finished an attack against a target */
  attackDone: { A: UnitState; T: UnitState };
  /** the last model of a unit was destroyed by an attack */
  unitDestroyed: { u: UnitState; attackerId?: string };
  /** a Deadly Demise explosion of unit u hit unit v */
  deadlyDemiseHit: { u: UnitState; v: UnitState };
  /** a model was destroyed, after the core reactions to it (u may now be wiped out) */
  /** a unit was set up on the battlefield from Reserves */
  arrived: { u: UnitState };
  /** a unit got out of a transport */
  disembarked: { u: UnitState; t: UnitState };
  modelKilled: { u: UnitState; m: ModelState; killerId?: string };
}

export type EventName = keyof GameEvents;
type Handler<K extends EventName> = (s: GameState, e: GameEvents[K]) => void;

const handlers: { [K in EventName]?: Handler<K>[] } = {};

/** Subscribe to an event. Handlers run in the order they were added (src/factions/index.ts fixes that order). */
export function on<K extends EventName>(name: K, fn: Handler<K>) {
  ((handlers[name] ??= []) as Handler<K>[]).push(fn);
}

export function emit<K extends EventName>(s: GameState, name: K, e: GameEvents[K]) {
  for (const fn of (handlers[name] ?? []) as Handler<K>[]) fn(s, e);
}

// ---------- modifiers: questions several rules can answer ----------

export type RollStage = 'charge' | 'advance' | 'shock' | 'hit' | 'wound' | 'save' | 'damage';
export interface RollContext { need?: number; best?: boolean; damage?: number; isCharacter?: boolean }

export interface GameModifiers {
  /** added to a unit's Battle-shock test */
  battleShock: (s: GameState, u: UnitState) => number;
  /** the closest a Deep Striking unit may be set up to enemies at this point (the smallest answer wins); null: no say */
  deepStrikeDistance: (s: GameState, u: UnitState, at: Pt) => number | null;
  /** how close this model may arrive by Deep Strike to this enemy unit (Death Approaches); null: no say */
  deepStrikeKeep: (s: GameState, u: UnitState, e: UnitState, at: Pt, m: ModelState) => number | null;
  /** a unit that must Deep Strike within its army's own zone (Flow of Magic): may this model be set up here? */
  deepStrikeZone: (s: GameState, p: PlayerId, at: Pt, r: number) => boolean | null;
  /** a unit about to arrive from Strategic Reserves is stopped this turn (Psychostatic Disruption): the reason, or null */
  arrivalDenied: (s: GameState, u: UnitState) => string | null;
  /** a model's move is not allowed: the reason, or null */
  moveBlock: (s: GameState, u: UnitState, m: ModelState, from: Pt, to: Pt, kind: MoveKind) => string | null;
  /** this unit may not target that one (shooting, charging or fighting): the reason, or null */
  targetBlock: (s: GameState, A: UnitState, T: UnitState, kind: 'shoot' | 'charge' | 'fight', assault: boolean) => string | null;
  /** extra inches on the unit's aura abilities */
  auraRange: (s: GameState, u: UnitState) => number;
  /** dice rolled for its Battle-shock and Leadership tests (the highest answer wins, 2 by default) */
  shockDice: (s: GameState, u: UnitState) => number;
  /** the unit may do this although it normally could not (charge after Advancing ...) */
  eligible: (s: GameState, u: UnitState, what: Eligibility) => boolean;
  /** all its ranged weapons count as [ASSAULT] */
  assaultWeapons: (s: GameState, u: UnitState) => boolean;
  /** its moves of this kind go through models of these kinds */
  moveThroughModels: (s: GameState, u: UnitState, kind: MoveKind) => 'titanic' | null;
  /** its moves of this kind go through terrain */
  moveThroughTerrain: (s: GameState, u: UnitState, kind: MoveKind) => boolean;
  /** melee Strength bonus from an army rule, with the note shown on the attack */
  meleeStrength: (s: GameState, u: UnitState) => { n: number; note: string } | null;
}

const modifiers: { [K in keyof GameModifiers]?: GameModifiers[K][] } = {};

export function addModifier<K extends keyof GameModifiers>(name: K, fn: GameModifiers[K]) {
  ((modifiers[name] ??= []) as GameModifiers[K][]).push(fn);
}

const all = <K extends keyof GameModifiers>(name: K) => (modifiers[name] ?? []) as GameModifiers[K][];

export const battleShockMod = (s: GameState, u: UnitState) => all('battleShock').reduce((sum, fn) => sum + fn(s, u), 0);

export const deepStrikeDistance = (s: GameState, u: UnitState, at: Pt, base: number) =>
  all('deepStrikeDistance').reduce((d, fn) => Math.min(d, fn(s, u, at) ?? Infinity), base);

/** The smallest deep strike distance any rule allows towards this enemy unit, or null when none has a say. */
export function deepStrikeKeep(s: GameState, u: UnitState, e: UnitState, at: Pt, m: ModelState): number | null {
  let out: number | null = null;
  for (const fn of all('deepStrikeKeep')) { const k = fn(s, u, e, at, m); if (k !== null && (out === null || k < out)) out = k; }
  return out;
}

export const deepStrikeZoneOk = (s: GameState, p: PlayerId, at: Pt, r: number) => all('deepStrikeZone').every((fn) => fn(s, p, at, r) ?? true);

export function arrivalDenied(s: GameState, u: UnitState): string | null {
  for (const fn of all('arrivalDenied')) { const why = fn(s, u); if (why) return why; }
  return null;
}

export function moveBlock(s: GameState, u: UnitState, m: ModelState, from: Pt, to: Pt, kind: MoveKind): string | null {
  for (const fn of all('moveBlock')) { const why = fn(s, u, m, from, to, kind); if (why) return why; }
  return null;
}

export function targetBlock(s: GameState, A: UnitState, T: UnitState, kind: 'shoot' | 'charge' | 'fight', assault = false): string | null {
  for (const fn of all('targetBlock')) { const why = fn(s, A, T, kind, assault); if (why) return why; }
  return null;
}

export const auraRangeBonus = (s: GameState, u: UnitState) => all('auraRange').reduce((sum, fn) => sum + fn(s, u), 0);
export const shockDice = (s: GameState, u: UnitState) => all('shockDice').reduce((n, fn) => Math.max(n, fn(s, u)), 2);
export const eligibleByRule = (s: GameState, u: UnitState, what: Eligibility) => all('eligible').some((fn) => fn(s, u, what));
export const assaultWeapons = (s: GameState, u: UnitState) => all('assaultWeapons').some((fn) => fn(s, u));

export function moveThroughModels(s: GameState, u: UnitState, kind: MoveKind): 'titanic' | null {
  for (const fn of all('moveThroughModels')) { const r = fn(s, u, kind); if (r) return r; }
  return null;
}

export const moveThroughTerrain = (s: GameState, u: UnitState, kind: MoveKind) => all('moveThroughTerrain').some((fn) => fn(s, u, kind));

export function meleeStrength(s: GameState, u: UnitState): { n: number; note: string }[] {
  return all('meleeStrength').map((fn) => fn(s, u)).filter((x): x is { n: number; note: string } => !!x);
}

// ---------- die rescue: a failed roll replaced by a die from a pool (Acts of Faith, Strands of Fate) ----------

interface Rescuer { rule: string; die: string; fn: (s: GameState, u: UnitState, stage: RollStage, x?: RollContext) => number | null }
const rescuers: Rescuer[] = [];

/** Add a pool of dice that can replace a failed roll. The first pool that answers is used. */
export function addDieRescue(rule: string, die: string, fn: Rescuer['fn']) {
  rescuers.push({ rule, die, fn });
}

/** A die to replace a failed roll of this unit: its value and where it came from, or null. */
export function rescueDie(s: GameState, u: UnitState, stage: RollStage, x?: RollContext): { v: number; rule: string; die: string } | null {
  for (const r of rescuers) { const v = r.fn(s, u, stage, x); if (v !== null) return { v, rule: r.rule, die: r.die }; }
  return null;
}

// ---------- rule data: conditions and effects kept by faction modules ----------

type CondFn = (c: string, x: Ctx) => boolean;
export const condExact = new Map<string, CondFn>();
export const condPatterns: { re: RegExp; fn: CondFn }[] = [];

/** A condition (an `if` entry in the rule data) evaluated by a faction module: an exact name, or a pattern for
 *  conditions with a parameter (`quality:...`). */
export function addCondition(match: string | RegExp, fn: CondFn) {
  if (typeof match === 'string') condExact.set(match, fn);
  else condPatterns.push({ re: match, fn });
}

export const effectSources: ((s: GameState, u: UnitState) => Active[])[] = [];

/** Effects a faction module keeps for a unit outside its abilities (Blessings of Khorne, Plagues, Malefic Surge ...). */
export function addEffectSource(fn: (s: GameState, u: UnitState) => Active[]) {
  effectSources.push(fn);
}

// ---------- abilities, stratagems and detachment choices with faction mechanics ----------

export interface ActionContext {
  /** the rule's name */
  label: string;
  /** the unit whose ability it is */
  u: UnitState;
  /** the unit the action is done to */
  on: UnitState;
  target: UnitState | null;
}

const actionHandlers: ((s: GameState, a: Action, x: ActionContext) => void)[] = [];

/** Handle the faction-specific keys of an ability's actions (`do` entries). Called for every action. */
export function addActionHandler(fn: (s: GameState, a: Action, x: ActionContext) => void) {
  actionHandlers.push(fn);
}

export function runActionHandlers(s: GameState, a: Action, x: ActionContext) {
  for (const fn of actionHandlers) fn(s, a, x);
}

export interface SpecialContext { p: PlayerId; u: UnitState; enemy?: UnitState; label: string }
const specials = new Map<string, (s: GameState, x: SpecialContext) => void>();

/** A stratagem `special` handled by a faction module (Malefic Surge, Skulls for the Skull Throne ...). */
export function addStratSpecial(name: string, fn: (s: GameState, x: SpecialContext) => void) {
  specials.set(name, fn);
}

/** Run a faction stratagem special; false when no module handles it. */
export function runStratSpecial(s: GameState, name: string, x: SpecialContext): boolean {
  const fn = specials.get(name);
  if (!fn) return false;
  fn(s, x);
  return true;
}

const targetFilters = new Map<string, (s: GameState, u: UnitState, e: UnitState) => boolean>();

/** A stratagem target filter handled by a faction module (`contagion`: within the unit's Contagion Range). */
export function addTargetFilter(name: string, fn: (s: GameState, u: UnitState, e: UnitState) => boolean) {
  targetFilters.set(name, fn);
}

export const targetFilter = (name: string, s: GameState, u: UnitState, e: UnitState) => targetFilters.get(name)?.(s, u, e) ?? true;

export interface ChoiceHooks {
  /** why this option of a detachment / army rule choice cannot be picked now, or null */
  why?: (s: GameState, p: PlayerId, rule: string, o: DetChoiceOption) => string | null;
  /** options were picked */
  picked?: (s: GameState, p: PlayerId, rule: string, ids: string[], randomly: boolean) => void;
}
const choiceHooks: ChoiceHooks[] = [];

export function addChoiceHooks(h: ChoiceHooks) {
  choiceHooks.push(h);
}

export function choiceBlocked(s: GameState, p: PlayerId, rule: string, o: DetChoiceOption): string | null {
  for (const h of choiceHooks) { const why = h.why?.(s, p, rule, o); if (why) return why; }
  return null;
}

export function choicePickedHooks(s: GameState, p: PlayerId, rule: string, ids: string[], randomly: boolean) {
  for (const h of choiceHooks) h.picked?.(s, p, rule, ids, randomly);
}

// ---------- the bot's judgement, asked by the rules (registered by src/ai) ----------

export type ReactKind = 'move' | 'surge' | 'reserves' | 'embark';
let reactWorthFn: (s: GameState, u: UnitState, st: StratagemData, kind: ReactKind) => boolean = () => false;

/** The bot sets how it judges a reactive move / redeploy stratagem (src/ai/botPlus.ts). Without a bot: never worth it. */
export function setReactWorth(fn: typeof reactWorthFn) {
  reactWorthFn = fn;
}

export const reactWorth = (s: GameState, u: UnitState, st: StratagemData, kind: ReactKind) => reactWorthFn(s, u, st, kind);
