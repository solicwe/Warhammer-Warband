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

  it('prunes terrain from later frames during compression and restores it upon decompression', async () => {
    const terrain = [{ id: 't1', kind: 'ruin', poly: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }] as unknown as GameState['terrain'];
    const snapshots = [
      { version: 3, turn: 0, phase: 'deploy', terrain },
      { version: 3, turn: 1, phase: 'movement', terrain },
      { version: 3, turn: 2, phase: 'gameover', terrain },
    ] as GameState[];

    const compressed = await compressReplayTimeline(snapshots);
    const restored = await decompressReplayTimeline(compressed);
    expect(restored).toHaveLength(3);
    expect(restored[0].terrain).toEqual(terrain);
    expect(restored[1].terrain).toEqual(terrain);
    expect(restored[2].terrain).toEqual(terrain);
  });

  it('records full timeline from deploy/round 1 to gameover and decompressReplayTimeline preserves round 0/1 at frame 0', async () => {
    const initial = { version: 3, round: 0, phase: 'deploy', units: [] } as unknown as GameState;
    const frames: GameState[] = [structuredClone(initial)];
    frames.push(structuredClone({ version: 3, round: 0, phase: 'deploy', units: [] } as unknown as GameState));
    frames.push(structuredClone({ version: 3, round: 1, phase: 'command', units: [] } as unknown as GameState));
    frames.push(structuredClone({ version: 3, round: 2, phase: 'movement', units: [] } as unknown as GameState));
    frames.push(structuredClone({ version: 3, round: 5, phase: 'gameover', units: [] } as unknown as GameState));

    const compressed = await compressReplayTimeline(frames);
    const restored = await decompressReplayTimeline(compressed);
    expect(restored).toHaveLength(5);
    expect(restored[0].round).toBe(0);
    expect(restored[0].phase).toBe('deploy');
    expect(restored[2].round).toBe(1);
    expect(restored[4].round).toBe(5);
    expect(restored[4].phase).toBe('gameover');
  });

});
