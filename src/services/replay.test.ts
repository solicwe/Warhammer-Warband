import { describe, expect, it } from 'vitest';
import { compressReplayTimeline, decompressReplayTimeline } from './replay';
import type { GameState } from '../engine/types';

describe('battle replay timeline', () => {
  it('round-trips an ordered list of game snapshots', async () => {
    const snapshots = [
      { version: 3, turn: 0, phase: 'deploy' },
      { version: 3, turn: 1, phase: 'movement' },
      { version: 3, turn: 2, phase: 'gameover' },
    ] as GameState[];

    await expect(decompressReplayTimeline(await compressReplayTimeline(snapshots))).resolves.toEqual(snapshots);
  });

});
