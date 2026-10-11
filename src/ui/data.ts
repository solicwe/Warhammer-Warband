import { useEffect, useState } from 'react';
import { allySources, withAllies } from '../engine/allies';
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

const raw = new Map<string, Promise<FactionData>>();
function loadRaw(id: string): Promise<FactionData> {
  if (!raw.has(id)) raw.set(id, fetch(`./data/factions/${id}.json?v=${__DATA_VERSION__}`).then((r) => r.json()));
  return raw.get(id)!;
}

/** A faction's data with the allied units its army may bring from other books (Knights, Titans, Agents, Daemons). */
export function loadFaction(id: string): Promise<FactionData> {
  if (!cache.has(id)) {
    cache.set(id, Promise.all([loadRaw(id), loadIndex().catch(() => null)]).then(async ([f, idx]) => {
      const srcs = allySources(id, idx?.factions.find((x) => x.id === id)?.group);
      const allies = await Promise.all(srcs.map((src) => loadRaw(src.id).then((data) => ({ src, data })).catch(() => null)));
      return withAllies(f, allies.filter((a): a is NonNullable<typeof a> => !!a));
    }));
  }
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
