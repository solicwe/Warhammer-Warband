// Lookahead: at the start of its Movement phase the bot tries a few ways of playing the turn (as it is, more
// aggressive, more careful) on copies of the game, plays each copy through the rest of its turn and the opponent's
// next turn, and keeps the style that leaves it best off (VP and army left). The real turn is then played that way.
import { botAct } from './bot';
import { unitValue } from './botEval';
import { botOff, setBotWeights, W, type BotW } from './botWeights';
import { withFastPlanning } from './botMove';
import { alive, other } from './state';
import type { BotLevel, GameState, PlayerId } from './types';

const STYLES: Record<string, Partial<BotW>> = {
  steady: {},
  // the styles differ enough to move units differently (milder ones played the same moves, so the look compared nothing)
  aggressive: { cautionOther: 0.4, cautionBrawler: 0.15, cautionHolder: 0.15, pullBrawler: 1.2, pullRange: 0.9, pullHammer: 1, pullHolder: 2.2, chargeNonBrawler: 0.9, advanceMargin: 0.5 },
  careful: { cautionOther: 2, cautionBrawler: 1, cautionHolder: 0.8, pullBrawler: 0.4, pullRange: 0.25, advanceMargin: 5 },
  // the expert also tries playing the turn for the objectives, and for the kill
  objectives: { objective: 55, pullHolder: 2.6, pullObjective: 0.9, claimPull: 3.2, homeExpensive: 0.1 },
  hunt: { pullHammer: 1.2, pullBrawler: 1.2, chargeNonBrawler: 0.9, cautionOther: 0.6, cautionBrawler: 0.25 },
};

/** What each level tries: the ways of playing the turn, how many rolls of the dice each is played on (the dice are
 *  different on each copy, so one lucky roll doesn't decide it), and how long it may think on a phone. */
const LEVELS: Record<BotLevel, { styles: string[]; samples: number; budget: number }> = {
  easy: { styles: [], samples: 0, budget: 0 },
  normal: { styles: ['steady', 'aggressive', 'careful'], samples: 1, budget: 9000 },
  hard: { styles: ['steady', 'aggressive', 'careful'], samples: 2, budget: 20000 },
  expert: { styles: ['steady', 'aggressive', 'careful', 'objectives', 'hunt'], samples: 3, budget: 40000 },
};
export const levelOf = (s: GameState, p?: PlayerId): BotLevel => (p !== undefined ? s.botLevels?.[p] : undefined) ?? s.botLevel ?? 'normal';
/** How long the app lets the bot think about its turn at this level (a Web Worker, so the screen never freezes). */
export const lookBudget = (s: GameState, p?: PlayerId) => LEVELS[levelOf(s, p)].budget;

/** Points of army a VP is worth when comparing outcomes (a 1000-point game is decided by a few dozen VP). */
const VP_POINTS = 15;
/**
 * An objective held when the look ends: the VP it scores next turn (worth a few). Without it the look only sees the
 * enemy's next turn of shooting, and hanging back always looks safest: the bot would sit in its own zone.
 */
const HOLD_POINTS = 3 * VP_POINTS;

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
  const held = (q: PlayerId) => s.objectives.filter((o) => o.controller === q).length;
  const hold = botOff('lookHold') ? 0 : (held(p) - held(other(p))) * HOLD_POINTS;
  return (vp(p) - vp(other(p))) * VP_POINTS + hold + armyLeft(s, p) - armyLeft(s, other(p));
};

/** Play a copy through the rest of this turn and the opponent's next one with `style` for p; how p stands then.
 *  `sample` > 0 rolls different dice on the copy (another throw of the same turn). */
function rollout(s: GameState, p: PlayerId, style: Partial<BotW>, deadline = Infinity, sample = 0): number {
  const c = structuredClone(s);
  if (sample) c.rng = (c.rng ^ Math.imul(sample, 2654435761)) >>> 0;
  // the copy's turn already has its style: without this mark the copy's own movement would pick (and set) the plain
  // weights again, and every style would play the same way
  c.botTried = [...(c.botTried ?? []), styleKey(c)];
  c.bots = [0, 1];
  const before = { 0: W(0), 1: W(1) };
  setBotWeights(p, { ...own[p]!, ...style });
  const end = s.turn + 2;
  inRollout = true;
  try {
    let steps = 0;
    while (c.phase !== 'gameover' && c.turn < end && steps < 4000) {
      if (botOff('fastLook')) botAct(c); else withFastPlanning(() => botAct(c));
      steps++;
      if (Date.now() > deadline) return -Infinity; // out of time: this style is not compared
    }
  } finally {
    inRollout = false;
    setBotWeights(0, before[0]);
    setBotWeights(1, before[1]);
  }
  return standing(c, p);
}

/** The style that leaves p best off after playing this turn and the opponent's next one on copies of the game. */
export function chooseTurnStyle(s: GameState, p: PlayerId, budgetMs?: number): string {
  if (!enabled || inRollout || s.phase === 'gameover') return 'steady';
  let best = { name: 'steady', v: -Infinity };
  for (const [name, v] of Object.entries(styleValues(s, p, budgetMs))) if (v > best.v + 1e-6) best = { name, v };
  return best.name;
}

/**
 * How p stands after this turn and the opponent's next, for each way of playing the turn its level tries (the mean
 * over the rolls of the dice played). Every way gets one roll first, then the extra rolls go round, so a phone that
 * runs out of time has still compared them all once.
 */
export function styleValues(s: GameState, p: PlayerId, budgetMs?: number): Record<string, number> {
  const L = LEVELS[levelOf(s, p)];
  const out: Record<string, number> = {};
  if (!L.styles.length) return out;
  own[p] ??= W(p);
  const deadline = Date.now() + (budgetMs ?? Infinity);
  const sum: Record<string, number> = {}, n: Record<string, number> = {};
  for (let k = 0; k < L.samples; k++) {
    for (const name of L.styles) {
      // a slow device: whatever could not be tried in time is skipped (steady, the first, is the fallback)
      if (Date.now() > deadline && n.steady) break;
      const v = rollout(s, p, STYLES[name], deadline, k);
      if (!Number.isFinite(v)) continue;
      sum[name] = (sum[name] ?? 0) + v; n[name] = (n[name] ?? 0) + 1;
    }
  }
  for (const name of Object.keys(n)) out[name] = sum[name] / n[name];
  return out;
}

/** The key that says this turn's style is chosen (so the Movement phase doesn't look ahead twice). */
const styleKey = (s: GameState) => `${s.turn}|movement|look`;
export const styleChosen = (s: GameState) => (s.botTried ?? []).includes(styleKey(s));

/** Play the rest of this turn in this style (the app gets the name from a Web Worker; tests and the tuner here). */
export function applyStyle(s: GameState, p: PlayerId, name: string) {
  own[p] ??= W(p);
  s.botTried = [...(s.botTried ?? []), styleKey(s)];
  setBotWeights(p, { ...own[p]!, ...(STYLES[name] ?? {}) });
  const how: Record<string, string> = { aggressive: 'aggressively', careful: 'carefully', objectives: 'for the objectives', hunt: 'for the kill' };
  if (name !== 'steady') s.log.push({ turn: s.turn, round: s.round, player: p, kind: 'info', text: `${s.players[p].name}: plays this turn ${how[name] ?? name} (looked ahead: it plays out better)` });
}

/** Forget the per-side weights captured for styles (a new game, or the tuner changed them). */
export function resetLookahead() { delete own[0]; delete own[1]; }
