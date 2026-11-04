import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listPoints, unitPoints, dupTaxes } from './army';
import type { ArmyList, FactionData } from './types';

describe('Telemon Heavy Dreadnought Points Verification', () => {
  const AC = JSON.parse(fs.readFileSync('public/data/factions/AC.json', 'utf8')) as FactionData;
  const telemonSheet = AC.datasheets.find((d) => d.name === 'Telemon Heavy Dreadnought')!;

  it('has base cost of 280 pts and duplicate tax of +30 from unit 2', () => {
    expect(telemonSheet.points[0].options[0].pts).toBe(280);
    expect(telemonSheet.dupTax).toEqual({ pts: 30, from: 2 });
  });

  it('calculates 280 pts for 1st Telemon and 310 pts for 2nd Telemon', () => {
    const list: ArmyList = {
      name: 'Custodes List',
      factionId: 'AC',
      battleSize: 'incursion',
      detachments: [],
      units: [
        { uid: 't1', datasheet: 'Telemon Heavy Dreadnought', models: 1, pts: 280 },
        { uid: 't2', datasheet: 'Telemon Heavy Dreadnought', models: 1, pts: 280 },
      ],
    };

    const taxes = dupTaxes(list, AC);
    expect(taxes.get('t1')).toBeUndefined();
    expect(taxes.get('t2')).toBe(30);

    const total = listPoints(list, AC);
    // 280 + (280 + 30) = 590 pts
    expect(total).toBe(590);
  });
});
