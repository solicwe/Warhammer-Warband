// Every wargear option in the faction data names real items: no sentence fragments left by the text parser
// ("Lasgun is replaced with 1 laspistol"), no choice repeated, no choice that only gives back what it replaces.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import type { FactionData } from './types';

it('wargear options name items, not rule text, in every faction', () => {
  const bad: string[] = [];
  for (const f of fs.readdirSync('public/data/factions')) {
    const d = JSON.parse(fs.readFileSync(`public/data/factions/${f}`, 'utf8')) as FactionData;
    for (const u of d.datasheets) {
      for (const o of u.wargearOptions ?? []) {
        const seen = new Set<string>();
        for (const c of o.choices) {
          const key = [...c].sort().join('+');
          if (seen.has(key)) bad.push(`${d.id} ${u.name}: ${key} listed twice`);
          seen.add(key);
          if (o.replace.length && key === [...o.replace].sort().join('+')) bad.push(`${d.id} ${u.name}: ${key} replaces itself`);
          for (const w of c) if (/ is replaced| can be | with one of|^\d/.test(w) || w.length > 45) bad.push(`${d.id} ${u.name}: "${w}"`);
        }
      }
    }
  }
  expect(bad).toEqual([]);
});
