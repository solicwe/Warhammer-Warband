import { expect, it } from 'vitest';
import { undoTarget, type HistoryEntry } from './store';
import type { GameState } from '../engine/types';

const st = (name: string, attack = false) => ({ name, attack: attack ? { stage: 'hit' } : null }) as unknown as GameState & { name: string };
const e = (name: string, auto = false, attack = false): HistoryEntry => ({ state: st(name, attack), auto });
const nameOf = (s: GameState | undefined) => (s as unknown as { name: string } | undefined)?.name;

it('undo takes back the player\'s last action and what the game did by itself after it', () => {
  const h = [e('before move'), e('before shoot'), e('bot step 1', true), e('bot step 2', true)];
  expect(nameOf(undoTarget(h))).toBe('before shoot');
  expect(h.map((x) => nameOf(x.state))).toEqual(['before move']);
});

it('undo in the middle of an attack goes back to before the shot', () => {
  const h = [e('before shoot'), e('rolling', false, true), e('rolling 2', false, true)];
  expect(nameOf(undoTarget(h))).toBe('before shoot');
});

it('with only automatic steps left it goes back before the first of them, and an empty history does nothing', () => {
  const h = [e('a', true), e('b', true)];
  expect(nameOf(undoTarget(h))).toBe('a');
  expect(undoTarget([])).toBeUndefined();
});
