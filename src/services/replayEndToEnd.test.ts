import { describe, expect, it, beforeEach } from 'vitest';
import { compressReplayTimeline, decompressReplayTimeline } from './replay';
import { loadBattleLogs, saveBattleLog, clearBattleLogs, type BattleRecord } from './storage';
import type { GameState } from '../engine/types';

describe('Replay recording end-to-end simulation', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    };
    clearBattleLogs();
  });

  it('records a full match from start to gameover, saves it, and replays from Round 1', async () => {
    // 1. Game starts at deployment / Round 1
    const initialGame = {
      version: 3,
      round: 1,
      turn: 1,
      phase: 'deploy',
      active: 0,
      players: [
        { name: 'P1', score: 0, cp: 0, vp: 0, secVp: 0, secActive: [], secDone: [] },
        { name: 'P2', score: 0, cp: 0, vp: 0, secVp: 0, secActive: [], secDone: [] },
      ],
      units: [
        {
          id: 'u1',
          owner: 0,
          name: 'Intercessors',
          status: 'board',
          models: [{ id: 'm1', x: 10, y: 10, r: 0.6, wounds: 1, dead: false, profile: { M: 6, T: 4, Sv: 3, W: 1, Ld: 7, OC: 2 } }],
        },
      ],
      terrain: [{ id: 't1', kind: 'ruin', poly: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }] }],
      objectives: [],
      markers: [],
      log: [],
      rng: 9999,
    } as unknown as GameState;

    // Emulate GameScreen's replayFrames ref
    const replayFrames: GameState[] = [structuredClone(initialGame)];

    // Simulate 40 in-game actions from Round 1 to Round 5
    let current = structuredClone(initialGame);
    for (let action = 1; action <= 40; action++) {
      current = structuredClone(current);
      current.round = Math.min(5, Math.floor(action / 8) + 1);
      current.turn = Math.min(5, Math.floor(action / 8) + 1);
      const phases = ['command', 'movement', 'shooting', 'charge', 'fight'] as const;
      current.phase = action === 40 ? 'gameover' : phases[action % 5];
      (current.players[0] as any).vp = Math.floor(action / 2);
      (current.players[1] as any).vp = Math.floor(action / 3);
      current.units[0].models[0].x += 0.5;
      // Emulate commit -> recordReplayCommit
      replayFrames.push(structuredClone(current));
    }

    expect(replayFrames).toHaveLength(41);
    expect(replayFrames[0].round).toBe(1);
    expect(replayFrames[0].phase).toBe('deploy');
    expect(replayFrames[40].round).toBe(5);
    expect(replayFrames[40].phase).toBe('gameover');

    // 2. Game over occurs -> save battle log
    const finalState = replayFrames[40];
    const record: BattleRecord = {
      id: 'battle-sim-123',
      timestamp: Date.now(),
      mode: 'simulator',
      turn: finalState.turn,
      maxTurns: 5,
      players: [
        { name: 'P1', score: 20, isWinner: true },
        { name: 'P2', score: 13, isWinner: false },
      ],
      summary: 'Final VP: 20 - 13',
      replayState: {
        seed: finalState.rng,
      },
    };

    saveBattleLog(record);

    // Compress timeline and update
    const timeline = [...replayFrames];
    const encoded = await compressReplayTimeline(timeline);
    saveBattleLog({ ...record, replayState: { seed: finalState.rng, timeline: encoded } });

    // 3. User opens Battle Logs and clicks Replay
    const logs = loadBattleLogs();
    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.replayState?.timeline).toBeDefined();

    // 4. Decompress replay
    const replayedStates = await decompressReplayTimeline(log.replayState!.timeline!);
    expect(replayedStates).toHaveLength(41);

    // CRITICAL CHECKS:
    // Frame 0 MUST be the start of the battle (Round 1, Deploy)
    expect(replayedStates[0].round).toBe(1);
    expect(replayedStates[0].phase).toBe('deploy');
    expect(replayedStates[0].units[0].models[0].x).toBe(10);
    expect(replayedStates[0].terrain).toBeDefined();
    expect(replayedStates[0].terrain).toHaveLength(1);

    // Frame 40 MUST be game over (Round 5, Game Over)
    expect(replayedStates[40].round).toBe(5);
    expect(replayedStates[40].phase).toBe('gameover');
    expect(replayedStates[40].terrain).toBeDefined();
    expect(replayedStates[40].terrain).toHaveLength(1);
  });
});
