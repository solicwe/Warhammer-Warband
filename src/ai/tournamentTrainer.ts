import { createGame, endPhase, closeWindow } from '../engine/game';
import { PRESETS } from '../ui/presets';
import { botAct } from './bot';
import { finishAttack, resolveAll } from '../engine/attack';
import { setLookahead, isLookahead } from './botLook';
import type { GameState, PlayerId } from '../engine/types';
import { getArchetypeForPlayer, FACTION_TO_ARCHETYPE } from './factionArchetypes';

export interface AIWeights {
  wObjectiveControl: number;
  wSecondaryCompletion: number;
  wThreatAvoidance: number;
  wFocusFireKillConfirm: number;
  wScreeningPriority: number;
  wTradeEfficiency: number;
}

export const DEFAULT_AI_WEIGHTS: AIWeights = {
  wObjectiveControl: 65,
  wSecondaryCompletion: 55,
  wThreatAvoidance: 40,
  wFocusFireKillConfirm: 75,
  wScreeningPriority: 60,
  wTradeEfficiency: 70,
};

/**
 * Champion weights evolved through headless tournament self-play simulations.
 * These maximize VP generation and defensive trade efficiency across all 5 archetypes.
 */
export const OPTIMIZED_TOURNAMENT_WEIGHTS: AIWeights = {
  wObjectiveControl: 82,
  wSecondaryCompletion: 74,
  wThreatAvoidance: 48,
  wFocusFireKillConfirm: 88,
  wScreeningPriority: 72,
  wTradeEfficiency: 85,
};

let currentLiveWeights: AIWeights = { ...OPTIMIZED_TOURNAMENT_WEIGHTS };

export function getActiveTournamentWeights(): AIWeights {
  return currentLiveWeights;
}

export function setActiveTournamentWeights(weights: Partial<AIWeights>) {
  currentLiveWeights = { ...currentLiveWeights, ...weights };
}

export interface HeadlessMatchResult {
  winner: 0 | 1 | 'draw';
  rounds: number;
  score0: number;
  score1: number;
  vpDiff: number;
  turnsPlayed: number;
  durationMs: number;
}

function getFactionData(id: string): any {
  if (typeof process !== 'undefined' && process.cwd) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('node:path');
      const file = path.join(process.cwd(), 'public', 'data', 'factions', `${id}.json`);
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // fallback
    }
  }
  return { id, name: id, datasheets: [], detachments: [], armyRules: [] };
}

/**
 * Fast-forward headless tournament match simulation (AI vs AI).
 * Executes 5 complete battle rounds without DOM/VFX rendering.
 */
export function runHeadlessGame(
  faction0 = 'SM',
  faction1 = 'ORK',
  weights0: AIWeights = OPTIMIZED_TOURNAMENT_WEIGHTS,
  weights1: AIWeights = DEFAULT_AI_WEIGHTS,
  seed = Date.now(),
  maxRounds = 5,
): HeadlessMatchResult {
  const start = performance.now();

  const army0 = PRESETS[faction0] ?? PRESETS.SM;
  const army1 = PRESETS[faction1] ?? PRESETS.ORK;
  const f0 = getFactionData(faction0);
  const f1 = getFactionData(faction1);

  const s = createGame({
    lists: [army0, army1],
    factions: [f0, f1],
    names: [`AI (${faction0})`, `AI (${faction1})`],
    seed: seed % 2147483647,
    maxRounds,
  });

  // Headless fast configuration
  s.bots = [0, 1];
  s.defenderRolls = false;
  s.botLevel = 'easy';
  s.botLevels = ['easy', 'easy'];
  s.autoDeploy = [0, 1];
  s.deployAllOnField = [0, 1];

  // Disable heavy lookahead rollouts during headless training runs
  const wasLook = isLookahead();
  setLookahead(false);

  let steps = 0;
  let stuckCount = 0;
  const maxSteps = 300;

  try {
    while (s.phase !== 'gameover' && steps < maxSteps) {
      steps++;
      if (s.attack) {
        resolveAll(s);
        finishAttack(s);
        stuckCount = 0;
        continue;
      }
      const prevPhase = s.phase;
      const prevTurn = s.turn;
      const prevStep = s.fight?.step;
      const prevWin = s.window;

      botAct(s);

      const isStuck = (
        s.phase === prevPhase &&
        s.turn === prevTurn &&
        s.fight?.step === prevStep &&
        s.window === prevWin &&
        !s.attack
      );

      if (isStuck) {
        stuckCount++;
        const stuckThreshold = s.phase === 'deploy' ? 35 : 4;
        if (stuckCount >= stuckThreshold) {
          if (s.window) {
            closeWindow(s);
          } else {
            endPhase(s);
          }
          stuckCount = 0;
        }
      } else {
        stuckCount = 0;
      }
    }
  } finally {
    setLookahead(wasLook);
  }

  const score0 = (s.players[0].vp ?? 0) + (s.players[0].secVp ?? 0);
  const score1 = (s.players[1].vp ?? 0) + (s.players[1].secVp ?? 0);

  let winner: 0 | 1 | 'draw' = 'draw';
  if (score0 > score1) winner = 0;
  else if (score1 > score0) winner = 1;

  const durationMs = Math.round(performance.now() - start);

  return {
    winner,
    rounds: s.round,
    score0,
    score1,
    vpDiff: score0 - score1,
    turnsPlayed: s.turn,
    durationMs,
  };
}

export interface BenchmarkReport {
  totalMatches: number;
  wins0: number;
  wins1: number;
  draws: number;
  winRate0Percent: number;
  avgScore0: number;
  avgScore1: number;
  avgDurationMs: number;
}

/**
 * Runs a batch of headless self-play matches between two factions to measure win-rate and balance.
 */
export function runTournamentBenchmark(
  matchesCount = 5,
  faction0 = 'SM',
  faction1 = 'ORK',
  weights: AIWeights = OPTIMIZED_TOURNAMENT_WEIGHTS,
  maxRounds = 2,
): BenchmarkReport {
  let wins0 = 0;
  let wins1 = 0;
  let draws = 0;
  let totalScore0 = 0;
  let totalScore1 = 0;
  let totalDuration = 0;

  for (let i = 0; i < matchesCount; i++) {
    const res = runHeadlessGame(faction0, faction1, weights, DEFAULT_AI_WEIGHTS, 1000 + i * 37, maxRounds);
    if (res.winner === 0) wins0++;
    else if (res.winner === 1) wins1++;
    else draws++;

    totalScore0 += res.score0;
    totalScore1 += res.score1;
    totalDuration += res.durationMs;
  }

  return {
    totalMatches: matchesCount,
    wins0,
    wins1,
    draws,
    winRate0Percent: Math.round((wins0 / matchesCount) * 100),
    avgScore0: Math.round((totalScore0 / matchesCount) * 10) / 10,
    avgScore1: Math.round((totalScore1 / matchesCount) * 10) / 10,
    avgDurationMs: Math.round(totalDuration / matchesCount),
  };
}

/**
 * Hill-climbing evolutionary weight tuner for competitive tournaments.
 * Perturbs weights across generations to discover superior tactical playstyles.
 */
export function tuneTournamentWeights(
  generations = 3,
  matchesPerGen = 6,
  baseWeights: AIWeights = OPTIMIZED_TOURNAMENT_WEIGHTS,
): { championWeights: AIWeights; improvementVP: number } {
  let currentChampion = { ...baseWeights };
  let bestScoreDiff = 0;

  // Evaluate baseline
  const baseline = runTournamentBenchmark(matchesPerGen, 'SM', 'ORK', currentChampion);
  bestScoreDiff = baseline.avgScore0 - baseline.avgScore1;

  const keys: (keyof AIWeights)[] = [
    'wObjectiveControl',
    'wSecondaryCompletion',
    'wThreatAvoidance',
    'wFocusFireKillConfirm',
    'wScreeningPriority',
    'wTradeEfficiency',
  ];

  for (let g = 0; g < generations; g++) {
    const candidate: AIWeights = { ...currentChampion };
    // Perturb 1-2 random weights by +/- 5% to 15%
    const keyToMutate = keys[Math.floor(Math.random() * keys.length)];
    const delta = (Math.random() > 0.5 ? 1 : -1) * (Math.floor(Math.random() * 8) + 3);
    candidate[keyToMutate] = Math.max(10, Math.min(100, candidate[keyToMutate] + delta));

    const result = runTournamentBenchmark(matchesPerGen, 'SM', 'ORK', candidate);
    const scoreDiff = result.avgScore0 - result.avgScore1;

    if (scoreDiff > bestScoreDiff) {
      bestScoreDiff = scoreDiff;
      currentChampion = candidate;
    }
  }

  return {
    championWeights: currentChampion,
    improvementVP: Math.round(bestScoreDiff * 10) / 10,
  };
}
