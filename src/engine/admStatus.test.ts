import { describe, it, expect } from 'vitest';
import { abilityStatus } from './effects';
import admFaction from '../../public/data/factions/AdM.json';
import type { UnitState } from './types';

describe('Adeptus Mechanicus ability status check', () => {
  it('checks every datasheet ability has status auto (zero red X)', () => {
    let checked = 0;
    const failures: string[] = [];

    for (const ds of admFaction.datasheets) {
      const dummyUnit = {
        id: 'u1',
        owner: 0,
        name: ds.name,
        sources: [ds.name],
        keywords: ds.keywords ?? [],
        factionKeywords: ds.factionKeywords ?? ['ADEPTUS MECHANICUS'],
        models: [],
        startingStrength: 1,
        abilities: ds.abilities ?? [],
        core: {},
        pts: 100,
        status: 'board',
        embarkedIn: null,
        weaponsFired: [],
        cantCharge: false,
        transport: null,
      } as unknown as UnitState;

      for (const a of ds.abilities ?? []) {
        if (a.type !== 'Core' && a.type !== 'Faction' && !a.type?.includes('Fortification')) {
          const st = abilityStatus(dummyUnit, { ...a, sheet: ds.name, faction: 'AdM' });
          if (st.status !== 'auto') {
            failures.push(`${ds.name} -> ${a.name} got status "${st.status}"`);
          }
          checked++;
        }
      }
    }

    for (const det of admFaction.detachments ?? []) {
      for (const e of det.enhancements ?? []) {
        const dummyUnit = {
          id: 'u1',
          owner: 0,
          name: 'Tech-priest Dominus',
          sources: ['Tech-priest Dominus'],
          keywords: ['CHARACTER', 'INFANTRY', 'TECH-PRIEST'],
          factionKeywords: ['ADEPTUS MECHANICUS'],
          models: [],
          startingStrength: 1,
          abilities: [],
          core: {},
          pts: 100,
          status: 'board',
          embarkedIn: null,
          weaponsFired: [],
          cantCharge: false,
          transport: null,
        } as unknown as UnitState;
        const st = abilityStatus(dummyUnit, { name: e.name, type: 'Enhancement', text: e.text, faction: 'AdM' } as never);
        if (st.status !== 'auto') {
          failures.push(`Enhancement ${e.name} got status "${st.status}"`);
        }
        checked++;
      }
    }

    if (failures.length > 0) {
      console.error('Failed abilities:\n' + failures.join('\n'));
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(50);
    console.log(`Successfully verified all ${checked} Adeptus Mechanicus abilities have status "auto"!`);
  });
});

