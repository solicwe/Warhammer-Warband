import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { PRESETS } from '../ui/presets';
import { defaultWargear, syncWargear, wargearProblems, wargearSummary, buildUnits } from './army';
import type { FactionData } from './types';

describe('Presets competitive wargear validation', () => {
  for (const [fid, preset] of Object.entries(PRESETS)) {
    it(`validates preset for ${fid} (${preset.name})`, () => {
      const fData = JSON.parse(fs.readFileSync(`public/data/factions/${fid}.json`, 'utf8')) as FactionData;
      for (const u of preset.units) {
        const d = fData.datasheets.find((x) => x.name.toLowerCase() === u.datasheet.toLowerCase());
        expect(d, `Datasheet ${u.datasheet} not found in ${fid}`).toBeDefined();
        if (d && u.wargear?.length) {
          const probs = wargearProblems(d, u);
          expect(probs, `${d.name} in ${fid} has wargear problems: ${probs.join(', ')}`).toEqual([]);
        }
      }
      const units = buildUnits(preset, fData, 0);
      expect(units.length).toBeGreaterThan(0);
    });
  }
});

