// The player's army lists, kept in this browser: any number of them, each with its own id. The home screen lists
// them; a battle picks one for each side.
import { newUid } from '../engine/army';
import { KEYS, readJSON, writeJSON } from '../services/storage';
import type { ArmyList, BotLevel, GameState, PlayerId } from '../engine/types';


export type Army = ArmyList & { id: string; updatedAt?: number };

const withId = (l: ArmyList): Army => ({ ...l, id: l.id ?? newUid('a'), updatedAt: l.updatedAt ?? Date.now() });
const valid = (l: unknown): l is ArmyList => !!l && typeof l === 'object' && Array.isArray((l as ArmyList).units) && typeof (l as ArmyList).factionId === 'string';

/** The saved armies; the first time, the two lists of the old two-player screen move in. */
export function loadArmies(): Army[] {
  try {
    const v = readJSON<unknown>(KEYS.armies);
    // the ready-made "(Quick)" lists are gone from the app
    if (Array.isArray(v)) return v.filter(valid).filter((a) => !/\(Quick\)$/.test(a.name ?? '')).map(withId);
  } catch { /* fall through */ }
  let start: ArmyList[] = [];
  try {
    const old = readJSON<unknown>(KEYS.oldPair);
    if (Array.isArray(old) && old.every(valid)) start = old;
  } catch { /* start empty */ }
  return start.map((l) => withId(structuredClone(l)));
}

export function saveArmies(armies: Army[]) {
  writeJSON(KEYS.armies, armies);
}

export const exportArmiesJson = (armies: Army[]): string => JSON.stringify({ kind: 'w40k11-armies', version: 1, armies }, null, 2);

export function importArmiesJson(text: string): Army[] | null {
  try {
    const j = JSON.parse(text);
    const list = Array.isArray(j) ? j : j?.armies;
    if (Array.isArray(list)) {
      const validArmies = list.filter(valid).map(withId);
      if (validArmies.length) return validArmies;
    }
  } catch { /* parse error */ }
  return null;
}

/** A side's army in a battle: one of the player's lists (id '' until they have one). */
export type ArmyRef = { kind: 'list'; id: string };
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
  const fallback = (i: number): ArmyRef => { const a = armies[i] ?? armies[0]; return { kind: 'list', id: a?.id ?? '' }; };
  const base: BattlePrefs = { mode: 'bot', sides: [fallback(0), fallback(1)], names: ['Player 1', 'Player 2'], secMode: 'tactical', layoutPick: '', level: 'hard', rounds: 5 };
  try {
    const v = readJSON<Partial<BattlePrefs>>(KEYS.battlePrefs);
    if (!v) return base;
    const ok = (r?: ArmyRef): r is ArmyRef => !!r && armies.some((a) => a.id === r.id);
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
  writeJSON(KEYS.battlePrefs, p);
}

/** Every player who is not a bot plays with automatic rules: they only move and pick shooting targets. */
export function withAutoRules(s: GameState): GameState {
  if (!s.autoRules) s.autoRules = ([0, 1] as PlayerId[]).filter((p) => !(s.bots ?? []).includes(p));
  // people make every choice themselves (stratagem prompts, reactions, Rituals, Blessings); bots make their own
  s.decides = ([0, 1] as PlayerId[]).filter((p) => !(s.bots ?? []).includes(p));
  // battles saved before the Thousand Sons fix still carry army rules that are not theirs
  for (const P of s.players) if (P.factionId === 'TS') P.armyRules = P.armyRules.filter((r) => r.name !== 'Oath of Moment' && r.name !== 'Dark Pacts');
  return s;
}
