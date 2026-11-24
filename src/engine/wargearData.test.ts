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
          for (const w of c) if (/ is replaced| can be | with one of|^\d|^options?$|^following$/i.test(w) || w.length > 45) bad.push(`${d.id} ${u.name}: "${w}"`);
        }
      }
    }
  }
  expect(bad).toEqual([]);
});

// Raptors (CSM, 22 Nov 2026): "one of the following options (you cannot select the same option more than once)" read
// as a choice called "Options", and nothing stopped two meltaguns from the same option
it('"duplicates are not allowed": each choice once, and the default loadout keeps to it', async () => {
  const { defaultWargear, syncWargear, wargearProblems } = await import('./army');
  const csm = JSON.parse(fs.readFileSync('public/data/factions/CSM.json', 'utf8')) as FactionData;
  const sheet = csm.datasheets.find((x) => x.name === 'Raptors')!;
  const i = sheet.wargearOptions!.findIndex((o) => /following options/.test(o.text) && !o.minModels);
  const o = sheet.wargearOptions![i];
  expect(o.distinct).toBe(true);
  expect(o.choices.map((c) => c[0])).toEqual(['Flamer', 'Meltagun', 'Plasma gun']);
  const melta = o.choices.findIndex((c) => c[0] === 'Meltagun');
  const e = { uid: 'r', datasheet: 'Raptors', models: 10, pts: 0 };
  expect(wargearProblems(sheet, { ...e, wargear: [{ opt: i, choice: melta, count: 2 }] }).join()).toMatch(/only once/);
  expect(wargearProblems(sheet, { ...e, wargear: [{ opt: i, choice: melta, count: 1 }, { opt: i, choice: 0, count: 1 }] })).toEqual([]);
  // the 10-model option is a second list: one meltagun from each is legal
  const j = sheet.wargearOptions!.findIndex((x) => /following options/.test(x.text) && x.minModels === 10);
  expect(wargearProblems(sheet, { ...e, wargear: [{ opt: i, choice: melta, count: 1 }, { opt: j, choice: melta, count: 1 }] })).toEqual([]);
  for (const models of [5, 10]) {
    const d = syncWargear(sheet, defaultWargear(sheet, { ...e, models }));
    expect(wargearProblems(sheet, d)).toEqual([]);
  }
});
