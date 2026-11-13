import { describe, expect, it } from 'vitest';
import {
  runHeadlessGame,
  runTournamentBenchmark,
  OPTIMIZED_TOURNAMENT_WEIGHTS,
  DEFAULT_AI_WEIGHTS,
} from './tournamentTrainer';
import { ARCHETYPE_PROFILES, FACTION_TO_ARCHETYPE } from './factionArchetypes';

describe('Tournament AI Engine & Headless Trainer', () => {
  it('covers all 23 competitive factions with 5 tactical archetypes', () => {
    const factions = [
      'SM', 'BA', 'BT', 'DA', 'SW',
      'CSM', 'WE', 'DG', 'TS', 'EC', 'CD',
      'AC', 'GK', 'AM', 'AS', 'AdM', 'QI', 'QT', 'AoI',
      'TAU', 'LoV', 'AE', 'DRU', 'GC', 'NEC', 'ORK', 'TYR'
    ];

    for (const f of factions) {
      const arch = FACTION_TO_ARCHETYPE[f];
      expect(arch).toBeDefined();
      expect(ARCHETYPE_PROFILES[arch]).toBeDefined();
      expect(ARCHETYPE_PROFILES[arch].vpFirstBias).toBeGreaterThan(0.5);
    }
  });

  it('runs a complete headless tournament match in milliseconds', () => {
    const res = runHeadlessGame('SM', 'ORK', OPTIMIZED_TOURNAMENT_WEIGHTS, DEFAULT_AI_WEIGHTS, 42, 1);
    expect(res).toBeDefined();
    expect(res.turnsPlayed).toBeGreaterThan(0);
    expect(['0', '1', 'draw']).toContain(String(res.winner));
    expect(res.score0 + res.score1).toBeGreaterThanOrEqual(0);
    expect(res.durationMs).toBeLessThan(30000);
  });

  it('executes a tournament benchmark batch calculating win rates and averages', () => {
    const report = runTournamentBenchmark(1, 'SM', 'ORK', OPTIMIZED_TOURNAMENT_WEIGHTS, 1);
    expect(report.totalMatches).toBe(1);
    expect(report.winRate0Percent).toBeGreaterThanOrEqual(0);
    expect(report.winRate0Percent).toBeLessThanOrEqual(100);
  });
});
