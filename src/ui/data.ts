import { useEffect, useState } from 'react';
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

/** Faction data for these ids as it loads (army lists show points with the duplicate tax, priced from it). */
export function useFactions(ids: string[]): Record<string, FactionData> {
  const [facs, setFacs] = useState<Record<string, FactionData>>({});
  const key = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    let live = true;
    for (const id of key.split(',').filter(Boolean)) loadFaction(id).then((f) => { if (live) setFacs((x) => (x[id] ? x : { ...x, [id]: f })); }).catch(() => {});
    return () => { live = false; };
  }, [key]);
  return facs;
}
