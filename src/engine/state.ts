import { RULES } from './config';
import { baseDist, circleTouchesPoly } from './geometry';
import type { FxEvent, GameState, LogEntry, ModelState, PlayerId, SkillStyle, UnitState } from './types';

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

/** The look of a hero's ability effect: from what it does and who uses it. */
export function skillStyle(u: UnitState, name: string, defensive = false): SkillStyle {
  const kw = (k: string) => hasKw(u, k);
  if (defensive) return 'shield';
  if (kw('PSYKER') || /psych|warp|smite|witch|null|soul/i.test(name)) return 'psychic';
  if (u.factionKeywords.includes('ORKS') || kw('ORKS')) return /waaagh/i.test(name) ? 'waaagh' : 'fury';
  if (kw('TECHMARINE') || kw('VEHICLE') || /servo|machine|forge|tech/i.test(name)) return 'tech';
  return 'holy';
}

/** A hero (CHARACTER) used a big ability: show it on the board. EPIC HERO models get the bigger version. */
/** grand = a once-per-battle moment (the big show); everything else gets a light touch */
export function heroFx(s: GameState, u: UnitState, name: string, defensive = false, ms?: ModelState[], grand = false) {
  const who = (ms?.length ? ms : alive(u)).filter((m) => !m.dead);
  if (!who.length || !onBoard(u)) return;
  const hero = who.find((m) => m.keywords.includes('EPIC HERO')) ?? who.find((m) => m.isCharacter) ?? who[0];
  pushFx(s, { kind: 'skill', unitId: u.id, owner: u.owner, at: { x: hero.x, y: hero.y }, name: name.replace(/\s*\((?:Once|Aura)[^)]*\)/gi, ''), who: hero.name,
    style: skillStyle(u, name, defensive), epic: who.some((m) => m.keywords.includes('EPIC HERO')), grand });
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

/** The battle round the game ends after (5, or fewer in a short game). */
export const lastRound = (s: GameState) => s.maxRounds ?? RULES.battleRounds;
/** How far into the battle this is, as the round of a full 5-round game (a short game's rounds count for more). */
export const pace = (s: GameState) => (s.maxRounds ? (s.round * RULES.battleRounds) / s.maxRounds : s.round);

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
  if (p.cp < cp) return 'Not enough CP';
  if (p.stratagemsUsed.includes(`${phaseKey(s)}:${id}`) && !(unit && repeatHook?.(s, unit, id))) return 'This Stratagem was already used this phase';
  if (unit) {
    if (unit.battleShocked) return 'A Battle-shocked unit cannot be targeted by Stratagems';
    const blocked = blockHook?.(s, unit);
    if (blocked) return blocked;
    if (unit.stratagemPhase === phaseKey(s)) return 'This unit was already targeted by a Stratagem this phase';
  }
  if (id === 'insane-bravery' && p.insaneBraveryUsed) return 'Once per battle';
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
  if (def) log(s, `${def.name} (−${cp}CP)${unit ? ' on ' + unit.name : ''}`, 'cp', player);
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
  return s.players[player].cp - 1 >= (s.round >= lastRound(s) ? 0 : 1);
}

export function withinTerrain(s: GameState, m: ModelState, categories: string[] = ['exposed', 'light', 'dense']) {
  return s.terrain.filter((t) => categories.includes(t.category) && circleTouchesPoly(m, m.r, t.poly));
}

// ---------- stratagem reactions ----------
/** Moments a stratagem can react to (stratagems.ts registers the handler; the engine only reports the moment). */
export type ReactOn = 'enemyMoved' | 'enemyShot' | 'enemyChargeDeclared' | 'enemyChargePhaseEnd' | 'fightPhaseEnd' | 'chargeMoveEnd' | 'ownAttacked'
  | 'ownDestroyed' | 'modelDestroyed' | 'oathDestroyed' | 'deadlyDemise' | 'enemyDeadlyDemise' | 'deadlyDemiseSix' | 'enemyChargeMoveEnd' | 'enemyChargePhaseStart' | 'enemyCommandStart' | 'enemyFallBack' | 'commandStart' | 'fightStart';
export interface ReactCtx { unitId?: string; modelId?: string; killerId?: string; six?: boolean }
type ReactHook = (s: GameState, p: PlayerId, on: ReactOn, ctx: ReactCtx) => boolean;
let reactHook: ReactHook | null = null;
export const setReactHook = (fn: ReactHook) => { reactHook = fn; };
/** Tell the reaction system a moment has come for player p. True when p used a stratagem / a prompt was opened. */
export const emitReact = (s: GameState, p: PlayerId, on: ReactOn, ctx: ReactCtx = {}) => (reactHook ? reactHook(s, p, on, ctx) : false);
