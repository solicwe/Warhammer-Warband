// A test the game rolls in one go (Dark Pact, Malefic Surge, Deadly Vectors) stops when it came out badly for a person
// who can spare a Command Re-roll: the dice wait in a window, the player taps a die to re-roll it (1CP) or carries on.
// Bots and automatic rules never wait: `crTest` (state.ts) re-rolls for them when a CP can be spared.
import { d6 } from '../engine/dice';
import { canUseStratagem, log, playsItself, spendStratagem } from '../engine/state';
import type { GameState, PlayerId } from '../engine/types';

type CrWindow = Extract<NonNullable<GameState['window']>, { kind: 'crTest' }>;
const finishers: Partial<Record<CrWindow['test'], (s: GameState, w: CrWindow) => void>> = {};
/** The faction file that rolled the test registers how it goes on once the dice are final. */
export const onCrTestDone = (test: CrWindow['test'], fn: (s: GameState, w: CrWindow) => void) => { finishers[test] = fn; };

const isBad = (w: Pick<CrWindow, 'dice' | 'bad'>) => {
  const v = w.dice.reduce((a, b) => a + b, 0) + w.bad.adj;
  return w.bad.op === 'lt' ? v < w.bad.n : v > w.bad.n;
};

/** Open the window when a person can still do something about this roll. 'busy': another window is open, no re-roll then. */
export function openCrTest(s: GameState, w: Omit<CrWindow, 'kind' | 'rerolled'>): 'opened' | 'busy' | 'no' {
  const p: PlayerId = w.player;
  if (playsItself(s, p) || !isBad(w) || canUseStratagem(s, p, 'command-reroll')) return 'no';
  if (s.window) return 'busy';
  s.window = { ...w, kind: 'crTest' };
  return 'opened';
}

/** Command Re-roll (1CP) on one die of the test in the window, once. */
export function crTestReroll(s: GameState, index: number): string | null {
  const w = s.window;
  if (w?.kind !== 'crTest' || index < 0 || index >= w.dice.length) return 'No test to re-roll';
  if (w.rerolled) return 'Only one die can be re-rolled';
  const why = canUseStratagem(s, w.player, 'command-reroll');
  if (why) return why;
  spendStratagem(s, w.player, 'command-reroll');
  const old = w.dice[index];
  w.dice[index] = d6(s);
  w.rerolled = true;
  log(s, `Command Re-roll: ${w.label} die ${old} → ${w.dice[index]}`, 'roll', w.player);
  return null;
}

/** Carry on with the dice as they are. */
export function crTestDone(s: GameState) {
  const w = s.window;
  if (w?.kind !== 'crTest') return;
  s.window = null;
  finishers[w.test]?.(s, w);
}
