import { RULES } from './config';
import { baseDist, circleTouchesPoly } from './geometry';
import type { FxEvent, GameState, LogEntry, ModelState, PlayerId, UnitState } from './types';

export const unitById = (s: GameState, id: string) => s.units.find((u) => u.id === id)!;
export const alive = (u: UnitState) => u.models.filter((m) => !m.dead);
export const onBoard = (u: UnitState) => u.status === 'board' && alive(u).length > 0;
export const boardUnits = (s: GameState, owner?: PlayerId) => s.units.filter((u) => onBoard(u) && (owner === undefined || u.owner === owner));
export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
export const hasKw = (u: UnitState, kw: string) => u.keywords.includes(kw);
export const everyModelKw = (u: UnitState, kws: string[]) => alive(u).every((m) => kws.some((k) => m.keywords.includes(k)));

type FxInput = FxEvent extends infer E ? (E extends { seq: number } ? Omit<E, 'seq'> : never) : never;
export function pushFx(s: GameState, e: FxInput) {
  s.fxSeq = (s.fxSeq ?? 0) + 1;
  (s.fx ??= []).push({ ...e, seq: s.fxSeq } as FxEvent);
  if (s.fx.length > 24) s.fx.splice(0, s.fx.length - 24);
}

export function log(s: GameState, text: string, kind?: LogEntry['kind'], player: PlayerId | null = s.active) {
  s.log.push({ turn: s.turn, round: s.round, player, text, kind });
  if (s.log.length > 600) s.log.splice(0, s.log.length - 600);
}

export function unitDistance(a: UnitState, b: UnitState): number {
  let best = Infinity;
  for (const m of alive(a)) for (const n of alive(b)) best = Math.min(best, baseDist(m, n));
  return best;
}

export const modelEngagedWith = (m: ModelState, u: UnitState) => alive(u).some((n) => baseDist(m, n) <= RULES.engagementRange + 1e-6);

export function engagedEnemies(s: GameState, u: UnitState): UnitState[] {
  if (!onBoard(u)) return [];
  return boardUnits(s, other(u.owner)).filter((e) => !hasKw(e, 'AIRCRAFT') && alive(u).some((m) => modelEngagedWith(m, e)));
}
export const isEngaged = (s: GameState, u: UnitState) => engagedEnemies(s, u).length > 0;

/** Starting strength / half-strength (01.02.01). */
export function strength(u: UnitState): 'full' | 'below' | 'half' | 'belowHalf' {
  const a = alive(u);
  if (u.startingStrength === 1) {
    const m = u.models[0];
    if (m.dead) return 'belowHalf';
    if (m.wounds * 2 < m.profile.W) return 'belowHalf';
    if (m.wounds * 2 === m.profile.W) return 'half';
    return m.wounds < m.profile.W ? 'below' : 'full';
  }
  if (a.length * 2 < u.startingStrength) return 'belowHalf';
  if (a.length * 2 === u.startingStrength) return 'half';
  return a.length < u.startingStrength ? 'below' : 'full';
}

export const phaseKey = (s: GameState) => `${s.turn}:${s.phase}`;

/** CP discount (+) or tax (−) for using a stratagem on a unit (Rites of Battle, Unorthodox Strategist …) and what happens
 *  once it is paid (limited uses, CP refunds); registered by effects.ts so this module stays free of rules. */
type DiscountHook = (s: GameState, u: UnitState, id: string) => number;
type SpentHook = (s: GameState, u: UnitState, id: string) => void;
type RepeatHook = (s: GameState, u: UnitState, id: string) => boolean; // may be used again this phase (Countercharge)
let discountHook: DiscountHook | null = null;
let spentHook: SpentHook | null = null;
let repeatHook: RepeatHook | null = null;
let blockHook: ((s: GameState, u: UnitState) => string | null) | null = null;
/** Something on the battlefield stops this unit being the target of its player's stratagems (Coronal Susurrant). */
export const setStratBlockHook = (h: (s: GameState, u: UnitState) => string | null) => { blockHook = h; };
export const setStratHooks = (discount: DiscountHook, spent: SpentHook, repeat?: RepeatHook) => { discountHook = discount; spentHook = spent; repeatHook = repeat ?? null; };
export const stratCost = (s: GameState, id: string, unit?: UnitState, cost?: number) => {
  const def = RULES.coreStratagems.find((x) => x.id === id);
  const base = cost ?? def?.cp ?? 1;
  return unit && discountHook ? Math.max(0, base - discountHook(s, unit, id)) : base;
};

export function canUseStratagem(s: GameState, player: PlayerId, id: string, unit?: UnitState, cost?: number): string | null {
  const cp = stratCost(s, id, unit, cost);
  const p = s.players[player];
  if (p.cp < cp) return 'CP ไม่พอ';
  if (p.stratagemsUsed.includes(`${phaseKey(s)}:${id}`) && !(unit && repeatHook?.(s, unit, id))) return 'ใช้ stratagem นี้ไปแล้วใน phase นี้';
  if (unit) {
    if (unit.battleShocked) return 'หน่วยที่ battle-shocked เป็นเป้า stratagem ไม่ได้';
    const blocked = blockHook?.(s, unit);
    if (blocked) return blocked;
    if (unit.stratagemPhase === phaseKey(s)) return 'หน่วยนี้โดน stratagem ไปแล้วใน phase นี้';
  }
  if (id === 'insane-bravery' && p.insaneBraveryUsed) return 'ใช้ได้ครั้งเดียวต่อเกม';
  return null;
}

export function spendStratagem(s: GameState, player: PlayerId, id: string, unit?: UnitState, cost?: number) {
  const def = RULES.coreStratagems.find((x) => x.id === id);
  const cp = stratCost(s, id, unit, cost);
  s.players[player].cp -= cp;
  s.players[player].stratagemsUsed.push(`${phaseKey(s)}:${id}`);
  if (unit) unit.stratagemPhase = phaseKey(s);
  if (id === 'insane-bravery') s.players[player].insaneBraveryUsed = true;
  // detachment stratagems are logged by name (with their effect) by the caller
  if (def) log(s, `ใช้ ${def.name} (−${cp}CP)${unit ? ' กับ ' + unit.name : ''}`, 'cp', player);
  if (unit && spentHook) spentHook(s, unit, id);
}

/** Rolls a player can have the Command Re-roll used on without stopping to ask (set in the game menu). */
export type AutoReroll = 'hazard' | 'damage' | 'attacks';

/**
 * Should `player` spend a Command Re-roll on this roll right now? Never when it can't be used. The game decides for
 * everyone, people included: it keeps 1CP spare until the last round.
 */
export function wantsCR(s: GameState, player: PlayerId, _what: AutoReroll, unit?: UnitState): boolean {
  if (canUseStratagem(s, player, 'command-reroll', unit)) return false;
  return s.players[player].cp - 1 >= (s.round >= 5 ? 0 : 1);
}

export function withinTerrain(s: GameState, m: ModelState, categories: string[] = ['exposed', 'light', 'dense']) {
  return s.terrain.filter((t) => categories.includes(t.category) && circleTouchesPoly(m, m.r, t.poly));
}

// ---------- stratagem reactions ----------
/** Moments a stratagem can react to (stratagems.ts registers the handler; the engine only reports the moment). */
export type ReactOn = 'enemyMoved' | 'enemyShot' | 'enemyChargeDeclared' | 'enemyChargePhaseEnd' | 'fightPhaseEnd' | 'chargeMoveEnd' | 'ownAttacked'
  | 'ownDestroyed' | 'modelDestroyed' | 'oathDestroyed' | 'deadlyDemise' | 'deadlyDemiseSix' | 'enemyChargeMoveEnd' | 'enemyChargePhaseStart' | 'enemyCommandStart' | 'enemyFallBack' | 'commandStart' | 'fightStart';
export interface ReactCtx { unitId?: string; modelId?: string; killerId?: string; six?: boolean }
type ReactHook = (s: GameState, p: PlayerId, on: ReactOn, ctx: ReactCtx) => boolean;
let reactHook: ReactHook | null = null;
export const setReactHook = (fn: ReactHook) => { reactHook = fn; };
/** Tell the reaction system a moment has come for player p. True when p used a stratagem / a prompt was opened. */
export const emitReact = (s: GameState, p: PlayerId, on: ReactOn, ctx: ReactCtx = {}) => (reactHook ? reactHook(s, p, on, ctx) : false);
