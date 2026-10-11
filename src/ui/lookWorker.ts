// The bot thinks off the main thread, so the board keeps animating and the screen never freezes:
//  - look: plays the bot's turn a few ways on copies of the game (src/engine/botLook.ts) and answers with the style;
//  - ponder: the same during the player's turn, from where the bot's next turn would start (a worker of its own);
//  - step: plays the bot's next step (one unit moves / shoots / charges …) and answers with the new game state.
import { applyStyle, lookAhead, lookBudget, lookSig, playToMovement, setLookahead, type Intent } from '../engine/botLook';
import { botAct, botStep } from '../engine/bot';
import type { GameState, PlayerId } from '../engine/types';

type Msg =
  | { kind?: 'look' | 'ponder'; state: GameState; p: PlayerId; id: number }
  | { kind: 'step'; state: GameState; who: PlayerId | null; id: number; style?: { p: PlayerId; name: string } };

// the lookahead runs only when asked (a look message); a step never starts one by itself
setLookahead(false);

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.kind === 'step') {
    const g = m.state;
    let error: string | null = null;
    try {
      // the turn's style (picked by a look) is this worker's bot weights for that side
      if (m.style) applyStyle(structuredClone(g), m.style.p, m.style.name);
      if (m.who === null) botAct(g); else botStep(g, m.who);
    } catch (err) { error = err instanceof Error ? err.message : String(err); }
    self.postMessage({ id: m.id, state: error ? null : g, error });
    return;
  }
  let g: GameState | null = m.state;
  if (m.kind === 'ponder') {
    // the board where the bot's turn will start (as far as can be told now): the app checks it against the real one
    try { g = playToMovement(m.state, m.p); } catch { g = null; }
    self.postMessage({ id: m.id, sig: g ? lookSig(g) : null });
    if (!g) return;
  }
  let res: { name: string; values: Record<string, number>; intents: Intent[] } = { name: 'steady', values: {}, intents: [] };
  setLookahead(true);
  // each way of playing the turn is reported as soon as it has been played out, so the screen can show the thinking
  const progress = (name: string, value: number, done: number, total: number) => self.postMessage({ id: m.id, progress: { name, value, done, total } });
  try { res = lookAhead(g, m.p, lookBudget(g, m.p), progress); } catch { /* a failed look plays the turn as it is */ }
  setLookahead(false);
  self.postMessage({ id: m.id, name: res.name, values: res.values, intents: res.intents });
};
