// Lookahead: at the start of its Movement phase the bot tries a few ways of playing the turn (as it is, more
// aggressive, more careful) on copies of the game, plays each copy through the rest of its turn and the opponent's
// next turn, and keeps the style that leaves it best off (VP and army left). The real turn is then played that way.
import { botAct } from './bot';
import { unitValue } from './botEval';
import { setBotWeights, W, type BotW } from './botWeights';
import { alive, other } from './state';
import type { GameState, PlayerId } from './types';

const STYLES: Record<string, Partial<BotW>> = {
  steady: {},
  aggressive: { cautionOther: 0.55, cautionBrawler: 0.25, cautionHolder: 0.2, pullBrawler: 0.9, pullRange: 0.65, chargeNonBrawler: 0.8, advanceMargin: 1 },
  careful: { cautionOther: 1.6, cautionBrawler: 0.8, cautionHolder: 0.6, pullBrawler: 0.4, pullRange: 0.25, advanceMargin: 5 },
};

/** Points of army a VP is worth when comparing outcomes (a 1000-point game is decided by a few dozen VP). */
const VP_POINTS = 15;

let inRollout = false;
let enabled = true;
/** Switch lookahead off (tests that need the plain bot, quick games). */
export const setLookahead = (on: boolean) => { enabled = on; };
export const lookaheadOn = () => enabled && !inRollout;

/** Each side's own weights before any style was mixed in (styles are applied on top of these, not compounded). */
const own: Partial<Record<PlayerId, BotW>> = {};

function armyLeft(s: GameState, p: PlayerId): number {
  return s.units.filter((u) => u.owner === p && u.status !== 'destroyed')
    .reduce((a, u) => a + unitValue(u) * (alive(u).length / Math.max(1, u.startingStrength)), 0);
}

const standing = (s: GameState, p: PlayerId) => {
  const vp = (q: PlayerId) => s.players[q].vp + s.players[q].secVp;
  return (vp(p) - vp(other(p))) * VP_POINTS + armyLeft(s, p) - armyLeft(s, other(p));
};

/** Play a copy through the rest of this turn and the opponent's next one with `style` for p; how p stands then. */
function rollout(s: GameState, p: PlayerId, style: Partial<BotW>): number {
  const c = structuredClone(s);
  c.bots = [0, 1];
  const before = { 0: W(0), 1: W(1) };
  setBotWeights(p, { ...own[p]!, ...style });
  const end = s.turn + 2;
  inRollout = true;
  try {
    let steps = 0;
    while (c.phase !== 'gameover' && c.turn < end && steps < 4000) { botAct(c); steps++; }
  } finally {
    inRollout = false;
    setBotWeights(0, before[0]);
    setBotWeights(1, before[1]);
  }
  return standing(c, p);
}

/** The style that leaves p best off after playing this turn and the opponent's next one on copies of the game. */
export function chooseTurnStyle(s: GameState, p: PlayerId): string {
  if (!enabled || inRollout || s.phase === 'gameover') return 'steady';
  own[p] ??= W(p);
  let best = { name: 'steady', v: -Infinity };
  for (const [name, style] of Object.entries(STYLES)) {
    const v = rollout(s, p, style);
    if (v > best.v + 1e-6) best = { name, v };
  }
  return best.name;
}

/** The key that says this turn's style is chosen (so the Movement phase doesn't look ahead twice). */
const styleKey = (s: GameState) => `${s.turn}|movement|look`;
export const styleChosen = (s: GameState) => (s.botTried ?? []).includes(styleKey(s));

/** Play the rest of this turn in this style (the app gets the name from a Web Worker; tests and the tuner here). */
export function applyStyle(s: GameState, p: PlayerId, name: string) {
  own[p] ??= W(p);
  s.botTried = [...(s.botTried ?? []), styleKey(s)];
  setBotWeights(p, { ...own[p]!, ...(STYLES[name] ?? {}) });
  if (name !== 'steady') s.log.push({ turn: s.turn, round: s.round, player: p, kind: 'info', text: `${s.players[p].name}: plays this turn ${name === 'aggressive' ? 'aggressively' : 'carefully'} (looked ahead: it plays out better)` });
}

/** Forget the per-side weights captured for styles (a new game, or the tuner changed them). */
export function resetLookahead() { delete own[0]; delete own[1]; }
