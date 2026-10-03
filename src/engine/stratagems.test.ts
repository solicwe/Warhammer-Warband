// Stratagem rules: hand-written ones in data/stratagems/<FACTION>.json load and point at real stratagems,
// and most Space Marine / Ork stratagems are played by the app.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stratRule, stratTargetOk } from './stratagems';
import type { FactionData, UnitState } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;

describe('stratagem rules data', () => {
  for (const id of ['SM', 'ORK']) {
    it(`${id}: every entry in data/stratagems/${id}.json names a stratagem of the faction`, () => {
      const f = load(id);
      const book = JSON.parse(fs.readFileSync(`data/stratagems/${id}.json`, 'utf8')).rules as Record<string, unknown>;
      const names = new Set(f.detachments.flatMap((d) => d.stratagems.flatMap((st) => [st.name, `${st.name}@${d.name}`])));
      expect(Object.keys(book).filter((k) => !names.has(k))).toEqual([]);
    });
    it(`${id}: most stratagems are played by the app`, () => {
      const f = load(id);
      const all = f.detachments.flatMap((d) => d.stratagems.map((st) => stratRule(st, id, d.name)));
      const done = all.filter((r) => r.status !== 'manual').length;
      expect(done / all.length).toBeGreaterThan(0.75);
    });
  }
  it('TARGET keywords: Hulking Brutes is for Nobz / Meganobz only', () => {
    const st = load('ORK').detachments.flatMap((d) => d.stratagems).find((x) => x.name === 'HULKING BRUTES')!;
    const u = (name: string, kws: string[]) => ({ keywords: kws, factionKeywords: ['ORKS'], sources: [name] }) as unknown as UnitState;
    expect(stratTargetOk(st, u('Nobz', ['INFANTRY', 'NOBZ']))).toBe(true);
    expect(stratTargetOk(st, u('Boyz', ['INFANTRY', 'BOYZ']))).toBe(false);
  });
});
