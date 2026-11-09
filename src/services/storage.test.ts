import { describe, expect, it, beforeEach } from 'vitest';
import { loadBattleLogs, saveBattleLog, clearBattleLogs, type BattleRecord } from './storage';

describe('storage battle logs', () => {
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

  it('strips legacy savedGame and retains compressed timeline', () => {
    const record: BattleRecord = {
      id: 'test-1',
      timestamp: Date.now(),
      mode: 'simulator',
      turn: 5,
      players: [
        { name: 'P1', score: 50 },
        { name: 'P2', score: 40 },
      ],
      replayState: {
        seed: 12345,
        timeline: 'H4sIAAAAAAAA/test',
        savedGame: { round: 5, phase: 'gameover' } as any,
      },
    };

    saveBattleLog(record);

    const loaded = loadBattleLogs();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].replayState?.timeline).toBe('H4sIAAAAAAAA/test');
    expect((loaded[0].replayState as any)?.savedGame).toBeUndefined();
  });

  it('keeps timeline for up to 10 recent battles and prunes older', () => {
    for (let i = 0; i < 15; i++) {
      saveBattleLog({
        id: `match-${i}`,
        timestamp: Date.now() + i,
        mode: 'simulator',
        turn: 5,
        players: [{ name: 'P1', score: 10 }, { name: 'P2', score: 20 }],
        replayState: {
          seed: i,
          timeline: `timeline-${i}`,
        },
      });
    }

    const loaded = loadBattleLogs();
    expect(loaded).toHaveLength(15);
    // Recent 10 (idx 0..9) should have timeline
    for (let i = 0; i < 10; i++) {
      expect(loaded[i].replayState?.timeline).toBeDefined();
    }
    // Older (idx 10..14) should have timeline pruned to save storage
    for (let i = 10; i < 15; i++) {
      expect(loaded[i].replayState?.timeline).toBeUndefined();
    }
  });
});
