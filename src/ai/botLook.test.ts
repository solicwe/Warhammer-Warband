// Lookahead: the bot plays its coming turn a few ways on copies of the game and keeps the best style, without
// touching the real game or the weights it plays with.
import fs from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { botAct } from './bot';
import { applyStyle, chooseTurnStyle, resetLookahead, setLookahead, styleChosen } from './botLook';
import { W } from './botWeights';
import { createGame } from '../engine/game';
import { TUNE_ARMIES } from '../engine/tune.test';
import type { FactionData, GameState } from '../engine/types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
afterAll(() => setLookahead(false));

it('looks ahead on copies, then plays the real turn in the chosen style once', () => {
  const s: GameState = createGame({
    lists: [TUNE_ARMIES['SM gunline'](), TUNE_ARMIES['ORK horde']()] as never, factions: [load('SM'), load('ORK')],
    names: ['A', 'B'], seed: 77, secondaryMode: 'tactical',
  });
  s.bots = [0, 1];
  let steps = 0;
  while (!(s.round === 2 && s.phase === 'movement') && steps < 5000) { botAct(s); steps++; }
  resetLookahead();
  setLookahead(true);
  const before = JSON.stringify(s);
  const w0 = W(s.active);
  const name = chooseTurnStyle(s, s.active);
  expect(['steady', 'aggressive', 'careful']).toContain(name);
  expect(JSON.stringify(s)).toBe(before); // the real game is untouched
  expect(W(s.active)).toEqual(w0);
  expect(styleChosen(s)).toBe(false);
  applyStyle(s, s.active, name);
  expect(styleChosen(s)).toBe(true);
  // the turn plays on without looking again
  setLookahead(false);
  const turn = s.turn;
  while (s.turn === turn && steps < 9000) { botAct(s); steps++; }
  expect(s.turn).toBe(turn + 1);
});
