// The player's army lists, kept in this browser: any number of them, each with its own id. The home screen lists
// them; a battle picks one for each side.
import { newUid } from '../engine/army';
import type { ArmyList, BotLevel, GameState, PlayerId } from '../engine/types';
import { PRESETS } from './presets';

const ARMIES_KEY = 'w40k11-armies';
const OLD_PAIR_KEY = 'w40k11-lists'; // before the library: exactly two lists, one per player
const BATTLE_KEY = 'w40k11-battle';

export type Army = ArmyList & { id: string; updatedAt?: number };

const withId = (l: ArmyList): Army => ({ ...l, id: l.id ?? newUid('a'), updatedAt: l.updatedAt ?? Date.now() });
const valid = (l: unknown): l is ArmyList => !!l && typeof l === 'object' && Array.isArray((l as ArmyList).units) && typeof (l as ArmyList).factionId === 'string';

/** The saved armies; the first time, the two lists of the old two-player screen move in (or the ready-made ones). */
export function loadArmies(): Army[] {
  try {
    const v = JSON.parse(localStorage.getItem(ARMIES_KEY) ?? 'null');
    if (Array.isArray(v)) return v.filter(valid).map(withId);
  } catch { /* fall through */ }
  let start: ArmyList[] = [PRESETS.SM, PRESETS.ORK];
  try {
    const old = JSON.parse(localStorage.getItem(OLD_PAIR_KEY) ?? 'null');
    if (Array.isArray(old) && old.every(valid)) start = old;
  } catch { /* keep the ready-made ones */ }
  return start.map((l) => withId(structuredClone(l)));
}

export function saveArmies(armies: Army[]) {
  try { localStorage.setItem(ARMIES_KEY, JSON.stringify(armies)); } catch { /* storage full or blocked */ }
}

/** A side's army in a battle: one of the player's lists, or a ready-made one. */
export type ArmyRef = { kind: 'list'; id: string } | { kind: 'preset'; factionId: string };
export type BattleMode = 'bot' | 'hotseat' | 'botbot';
export interface BattlePrefs {
  mode: BattleMode;
  sides: [ArmyRef, ArmyRef];
  names: [string, string];
  secMode: 'none' | 'tactical' | 'fixed';
  layoutPick: string;
  /** how hard the bot plays */
  level: BotLevel;
  /** battle rounds: the full 5, or a short game of 3 */
  rounds: 3 | 5;
}

export function loadBattlePrefs(armies: Army[]): BattlePrefs {
  const fallback = (i: number): ArmyRef => (armies[i] ? { kind: 'list', id: armies[i].id } : { kind: 'preset', factionId: i ? 'ORK' : 'SM' });
  const base: BattlePrefs = { mode: 'bot', sides: [fallback(0), fallback(1)], names: ['Player 1', 'Player 2'], secMode: 'tactical', layoutPick: '', level: 'hard', rounds: 5 };
  try {
    const v = JSON.parse(localStorage.getItem(BATTLE_KEY) ?? 'null') as Partial<BattlePrefs> | null;
    if (!v) return base;
    const ok = (r?: ArmyRef): r is ArmyRef => !!r && (r.kind === 'preset' ? !!PRESETS[r.factionId] : armies.some((a) => a.id === r.id));
    return {
      ...base, ...v,
      sides: [ok(v.sides?.[0]) ? v.sides![0] : base.sides[0], ok(v.sides?.[1]) ? v.sides![1] : base.sides[1]],
      names: Array.isArray(v.names) && v.names.length === 2 ? v.names as [string, string] : base.names,
      level: ['easy', 'normal', 'hard', 'expert'].includes(v.level as string) ? v.level as BotLevel : base.level,
      rounds: v.rounds === 3 ? 3 : 5,
    };
  } catch { return base; }
}

export function saveBattlePrefs(p: BattlePrefs) {
  try { localStorage.setItem(BATTLE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** Every player who is not a bot plays with automatic rules: they only move and pick shooting targets. */
export function withAutoRules(s: GameState): GameState {
  if (!s.autoRules) s.autoRules = ([0, 1] as PlayerId[]).filter((p) => !(s.bots ?? []).includes(p));
  // a new battle: people answer their own stratagem prompts and reactions and pick their own Rituals (the menu can
  // hand them back); a battle saved before this keeps playing the way it started
  if (!s.decides && s.turn < 0) s.decides = ([0, 1] as PlayerId[]).filter((p) => !(s.bots ?? []).includes(p));
  // battles saved before the Thousand Sons fix still carry army rules that are not theirs
  for (const P of s.players) if (P.factionId === 'TS') P.armyRules = P.armyRules.filter((r) => r.name !== 'Oath of Moment' && r.name !== 'Dark Pacts');
  return s;
}
