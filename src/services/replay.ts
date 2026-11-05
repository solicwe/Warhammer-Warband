import type { GameState } from '../engine/types';

export async function compressReplayTimeline(states: GameState[]): Promise<string> {
  if (typeof CompressionStream === 'undefined') throw new Error('Replay compression is not supported by this browser.');
  const stream = new Blob([JSON.stringify(states)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function decompressReplayTimeline(encoded: string): Promise<GameState[]> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Replay decompression is not supported by this browser.');
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const states: unknown = JSON.parse(await new Response(stream).text());
  if (!Array.isArray(states) || states.some((state) => !state || typeof state !== 'object' || (state as GameState).version !== 3)) {
    throw new Error('The saved replay timeline is invalid.');
  }
  return states as GameState[];
}
