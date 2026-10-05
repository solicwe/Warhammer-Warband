// Lookahead off the main thread: plays the bot's turn a few ways on copies of the game (src/engine/botLook.ts) and
// answers with the style to play it in, so the board keeps animating while the bot thinks.
import { chooseTurnStyle } from '../engine/botLook';
import type { GameState, PlayerId } from '../engine/types';

self.onmessage = (e: MessageEvent<{ state: GameState; p: PlayerId; id: number }>) => {
  const { state, p, id } = e.data;
  let name = 'steady';
  try { name = chooseTurnStyle(state, p); } catch { /* a failed look plays the turn as it is */ }
  self.postMessage({ id, name });
};
