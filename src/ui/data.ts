import type { FactionData } from '../engine/types';

export interface FactionIndex {
  source: string;
  sourceUrl: string;
  lastUpdate: string;
  factions: { id: string; name: string; group?: string; datasheets: number; detachments: number; subfactions?: string[] }[];
}

const cache = new Map<string, Promise<FactionData>>();
let indexPromise: Promise<FactionIndex> | null = null;

export function loadIndex(): Promise<FactionIndex> {
  indexPromise ??= fetch(`./data/index.json?v=${__DATA_VERSION__}`).then((r) => r.json());
  return indexPromise;
}

export function loadFaction(id: string): Promise<FactionData> {
  if (!cache.has(id)) cache.set(id, fetch(`./data/factions/${id}.json?v=${__DATA_VERSION__}`).then((r) => r.json()));
  return cache.get(id)!;
}
