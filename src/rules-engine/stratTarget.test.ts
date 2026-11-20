import fs from 'node:fs';
import { expect, it } from 'vitest';
import { stratTargetOk, targetPhrase } from './stratagems';

const unitOf = (x: { name: string; keywords: string[]; factionKeywords: string[] }) => ({ keywords: x.keywords, factionKeywords: x.factionKeywords, sources: [x.name], name: x.name }) as never;

it('Infernal Fusillade is for Thousand Sons PSYKER units only (not a Defiler or a Rhino)', () => {
  const TS = JSON.parse(fs.readFileSync('public/data/factions/TS.json', 'utf8'));
  const st = TS.detachments.flatMap((d: { stratagems: { name: string }[] }) => d.stratagems).find((s: { name: string }) => s.name === 'INFERNAL FUSILLADE');
  const ok = (name: string) => stratTargetOk(st, unitOf(TS.datasheets.find((d: { name: string }) => d.name === name)));
  expect(ok('Rubric Marines')).toBe(true);
  expect(ok('Infernal Master')).toBe(true);
  expect(ok('Defiler')).toBe(false);
  expect(ok('Chaos Rhino')).toBe(false);
});

it('every simple TARGET line written in ordinary capitals fits at least one datasheet of its faction', () => {
  const idx = JSON.parse(fs.readFileSync('public/data/index.json', 'utf8')) as { factions: { id: string }[] };
  const bad: string[] = [];
  for (const f of idx.factions) {
    const d = JSON.parse(fs.readFileSync(`public/data/factions/${f.id}.json`, 'utf8'));
    const units = d.datasheets.map(unitOf);
    for (const det of d.detachments) for (const s of det.stratagems) {
      const tgt = /TARGET:\s*([\s\S]*?)(?=\n(?:WHEN|TARGET|EFFECT|RESTRICTIONS):|$)/.exec(s.text)?.[1]?.trim() ?? '';
      if (!targetPhrase(tgt) || /[A-Z]{3,}/.test(tgt.replace(/^(One|That)\s+/, ''))) continue;
      if (!units.some((u: never) => stratTargetOk(s, u))) bad.push(`${f.id}: ${s.name}`);
    }
  }
  expect(bad).toEqual([]);
});
