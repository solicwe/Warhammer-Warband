// Lookahead: at the start of its Movement phase the bot tries a few ways of playing the turn (as it is, more
// aggressive, more careful) on copies of the game, plays each copy through the rest of its turn and the opponent's
// next turn, and keeps the style that leaves it best off (VP and army left). The real turn is then played that way.
import { botAct } from './bot';
import { unitValue } from './botEval';
import { botOff, setBotWeights, W, type BotW } from './botWeights';
import { withFastPlanning } from './botMove';
import { endPhase } from './game';
import { alive, other } from './state';
import type { BotLevel, GameState, PlayerId, Pt } from './types';

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

/** An attack p made in a look's copy of its turn: what the bot means to do (shown to the player as the enemy plan). */
export interface Intent { attackerId: string; targetId: string; kind: 'shoot' | 'fight' | 'overwatch'; killed: number; from: Pt; to: Pt }

/**
 * Who is ahead, as the bot weighs it (VP, objectives held, army left): player 0's share, 0..1. An estimate for the
 * screen's advantage bar; at the end of the battle only the VP count.
 */
export function advantage(s: GameState): number {
  if (s.phase === 'gameover') return s.winner === 0 ? 1 : s.winner === 1 ? 0 : 0.5;
  return 1 / (1 + Math.exp(-standing(s, 0) / 220));
}

/** Play a copy through the rest of this turn and the opponent's next one with `style` for p; how p stands then.
 *  `sample` > 0 rolls different dice on the copy (another throw of the same turn). The attacks p makes this turn go
 *  into `intents` when given. */
function rollout(s: GameState, p: PlayerId, style: Partial<BotW>, deadline = Infinity, sample = 0, intents?: Intent[]): number {
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
    let seen = c.fxSeq ?? 0;
    while (c.phase !== 'gameover' && c.turn < end && steps < 4000) {
      if (botOff('fastLook')) botAct(c); else withFastPlanning(() => botAct(c));
      steps++;
      if (intents && c.turn === s.turn) {
        for (const e of c.fx ?? []) {
          if (e.seq <= seen || e.kind !== 'attack' || e.owner !== p) continue;
          intents.push({ attackerId: e.attackerId, targetId: e.targetId, kind: e.attackKind, killed: e.killed, from: e.from, to: e.to });
        }
      }
      seen = c.fxSeq ?? seen;
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
export function styleValues(s: GameState, p: PlayerId, budgetMs?: number, watch?: LookWatch): Record<string, number> {
  const L = LEVELS[levelOf(s, p)];
  const out: Record<string, number> = {};
  if (!L.styles.length) return out;
  own[p] ??= W(p);
  const deadline = Date.now() + (budgetMs ?? Infinity);
  const sum: Record<string, number> = {}, n: Record<string, number> = {};
  const total = L.samples * L.styles.length;
  let done = 0;
  for (let k = 0; k < L.samples; k++) {
    for (const name of L.styles) {
      // a slow device: whatever could not be tried in time is skipped (steady, the first, is the fallback)
      if (Date.now() > deadline && n.steady) break;
      const plan: Intent[] | undefined = watch && k === 0 ? [] : undefined;
      const v = rollout(s, p, STYLES[name], deadline, k, plan);
      done++;
      if (!Number.isFinite(v)) continue;
      sum[name] = (sum[name] ?? 0) + v; n[name] = (n[name] ?? 0) + 1;
      if (plan && watch) watch.plans[name] = plan;
      watch?.progress?.(name, sum[name] / n[name], done, total);
    }
  }
  for (const name of Object.keys(n)) out[name] = sum[name] / n[name];
  return out;
}

/** Watching a look as it goes: each way's value after every roll, and the attacks each way makes in its first roll. */
export interface LookWatch { progress?: (name: string, value: number, done: number, total: number) => void; plans: Record<string, Intent[]> }

/** A whole look: the style chosen, every style's value, and what the chosen style means to attack this turn. */
export function lookAhead(s: GameState, p: PlayerId, budgetMs?: number, progress?: LookWatch['progress']): { name: string; values: Record<string, number>; intents: Intent[] } {
  if (!enabled || inRollout || s.phase === 'gameover') return { name: 'steady', values: {}, intents: [] };
  const watch: LookWatch = { progress, plans: {} };
  const values = styleValues(s, p, budgetMs, watch);
  let best = { name: 'steady', v: -Infinity };
  for (const [name, v] of Object.entries(values)) if (v > best.v + 1e-6) best = { name, v };
  return { name: best.name, values, intents: watch.plans[best.name] ?? [] };
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

/**
 * The board as the look sees it, coarsely: whose turn and phase, each unit's models left and where it stands (to the
 * inch), command points and VP. The look thought out during the opponent's turn is used when the real board matches.
 */
export function lookSig(s: GameState): string {
  return `${s.round}|${s.turn}|${s.active}|${s.phase}|${boardSig(s)}`;
}

/** The board alone (units, command points, VP), whatever the phase: ending a phase without doing anything keeps it. */
export function boardSig(s: GameState): string {
  const units = s.units.map((u) => {
    const ms = alive(u);
    if (!ms.length || u.status !== 'board') return `${u.id}:${u.status}:${ms.length}`;
    const x = ms.reduce((a, m) => a + m.x, 0) / ms.length, y = ms.reduce((a, m) => a + m.y, 0) / ms.length;
    return `${u.id}:${ms.length}:${ms.reduce((a, m) => a + m.wounds, 0)}:${Math.round(x)},${Math.round(y)}${u.battleShocked ? '!' : ''}`;
  });
  const P = s.players;
  return `${P[0].cp},${P[1].cp}|${P[0].vp + P[0].secVp},${P[1].vp + P[1].secVp}|${units.join(';')}`;
}

/**
 * Thinking during the opponent's turn: a copy of the game played on to p's next Movement phase, where the look starts.
 * The opponent is taken to do nothing more of their own accord (they end their Movement, Shooting and Charge phases as
 * they stand); what the rules make happen still does (fights, reactions, p's Command phase with the same dice). When
 * they do act after all, the board changes and the app thinks again from there; their last action is usually the
 * last change, so the copy then gets to the very board the real game does. Null when the game ends first.
 */
export function playToMovement(s: GameState, p: PlayerId): GameState | null {
  const c = structuredClone(s);
  c.bots = [0, 1];
  const was = enabled;
  enabled = false; // the copy plays plainly: no look inside it
  try {
    let steps = 0;
    while (!(c.phase === 'movement' && c.active === p) && c.phase !== 'gameover' && steps < 3000) {
      const passes = c.active !== p && !c.window && !c.attack && (c.phase === 'movement' || c.phase === 'shooting' || c.phase === 'charge');
      if (passes) endPhase(c); else botAct(c);
      steps++;
    }
  } finally { enabled = was; }
  return c.phase === 'movement' && c.active === p ? c : null;
}

/** Forget the per-side weights captured for styles (a new game, or the tuner changed them). */
export function resetLookahead() { delete own[0]; delete own[1]; }
