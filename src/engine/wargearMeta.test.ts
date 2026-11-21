import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import meta from '../../data/wargear-meta.json';
import { defaultWargear, metaWargear, wargearPoints, wargearProblems, wkey } from './army';
import type { ArmyUnitEntry, DatasheetData, FactionData } from './types';

// A new unit starts with the loadout tournament players take most (listhammer.info lists, data/wargear-meta.json);
// what costs points is left for the player (owner, 21 Nov 2026).
const units = (meta as { units: Record<string, { models: number; items: Record<string, number> }> }).units;
const sheets: DatasheetData[] = fs.readdirSync('public/data/factions')
  .flatMap((f) => (JSON.parse(fs.readFileSync(`public/data/factions/${f}`, 'utf8')) as FactionData).datasheets);

describe('meta wargear', () => {
  it('every datasheet a list took gets a legal loadout that costs no extra points', () => {
    let tried = 0;
    for (const d of sheets) {
      const m = units[d.name];
      const size = d.points[0]?.options.find((o) => o.models === m?.models) ?? d.points[0]?.options[0];
      if (!m || !size) continue;
      const e: ArmyUnitEntry = { uid: 'x', datasheet: d.name, models: size.models, pts: size.pts };
      const got = defaultWargear(d, e);
      expect(wargearProblems(d, got), d.name).toEqual([]);
      expect(wargearPoints(d, got), d.name).toBeLessThanOrEqual(wargearPoints(d, e));
      tried++;
    }
    expect(tried).toBeGreaterThan(300);
  });

  it('takes only swaps that give an item the meta lists', () => {
    let checked = 0;
    for (const d of sheets) {
      const m = units[d.name];
      if (!m || !d.wargearOptions?.length) continue;
      const size = d.points[0]?.options.find((o) => o.models === m.models);
      if (!size) continue;
      const e: ArmyUnitEntry = { uid: 'x', datasheet: d.name, models: size.models, pts: size.pts };
      const got = metaWargear(d, e)!;
      if (!got.wargear?.length) continue;
      // each chosen item is one the meta lists, or the item its option takes away
      for (const p of got.wargear) {
        const o = d.wargearOptions[p.opt];
        const gain = p.choice < 0 ? p.picks ?? [] : o.choices[p.choice];
        expect(gain.some((n) => m.items[Object.keys(m.items).find((k) => wkey(k) === wkey(n)) ?? ''] !== undefined), `${d.name}: ${gain.join(' + ')}`).toBe(true);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
});
