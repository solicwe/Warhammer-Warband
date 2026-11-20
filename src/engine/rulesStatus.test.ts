// docs/RULES_STATUS.md's summary table is built here from the rule data, so it cannot drift from it. A rule with
// executable data (effects, a trigger, a choice) counts as data; one that names a faction module (`code`) as code;
// one with only its card text as text only. Stratagems are graded by the reader the game uses (auto / partial /
// manual). Rewrite the table after changing data/: UPDATE_STATUS=1 npx vitest run src/engine/rulesStatus.test.ts
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { stratRule } from '../rules-engine/stratagems';
import type { FactionData } from './types';

const START = '<!-- status:start -->', END = '<!-- status:end -->';
const TEXT_ONLY = new Set(['note', 'status', 'gear', 'model', 'sheet']);

function table(): string {
  const idx = JSON.parse(fs.readFileSync('public/data/index.json', 'utf8')) as { factions: { id: string; name: string }[] };
  const rows: string[] = ['| Faction | Unit abilities: data / code / text only | Stratagems: auto / partial / manual |', '|---|---|---|'];
  const all = [0, 0, 0, 0, 0, 0];
  for (const f of idx.factions) {
    let ab: Record<string, Record<string, unknown>> = {};
    try { ab = JSON.parse(fs.readFileSync(`data/abilities/${f.id}.json`, 'utf8')); } catch { /* no unit rules of its own */ }
    const u = [0, 0, 0];
    for (const v of Object.values(ab)) {
      const keys = Object.keys(v ?? {});
      if (v?.code) u[1]++;
      else if (keys.some((k) => !TEXT_ONLY.has(k))) u[0]++;
      else u[2]++;
    }
    const data = JSON.parse(fs.readFileSync(`public/data/factions/${f.id}.json`, 'utf8')) as FactionData;
    const st = [0, 0, 0];
    for (const d of data.detachments) for (const s of d.stratagems) {
      const r = stratRule(s, f.id, d.name).status;
      st[r === 'auto' ? 0 : r === 'partial' ? 1 : 2]++;
    }
    [...u, ...st].forEach((n, i) => { all[i] += n; });
    rows.push(`| ${f.name} (${f.id}) | ${u.join(' / ')} | ${st.join(' / ')} |`);
  }
  rows.push(`| **All** | ${all.slice(0, 3).join(' / ')} | ${all.slice(3).join(' / ')} |`);
  return rows.join('\n');
}

it('docs/RULES_STATUS.md shows the rule data as it is', () => {
  const file = 'docs/RULES_STATUS.md';
  const doc = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const now = table();
  const a = doc.indexOf(START), b = doc.indexOf(END);
  if (process.env.UPDATE_STATUS) {
    fs.writeFileSync(file, doc.slice(0, a + START.length) + '\n' + now + '\n' + doc.slice(b));
    return;
  }
  expect(a, 'the status markers are in the doc').toBeGreaterThan(0);
  expect(doc.slice(a + START.length, b).trim()).toBe(now);
});
