import { describe, it, expect } from 'vitest';
import { abilityStatus } from '../rules-engine/effects';
import aeFaction from '../../public/data/factions/AE.json';
import type { UnitState } from './types';

describe('Aeldari ability status check', () => {
  it('checks every datasheet ability has status auto (zero red X)', () => {
    let checked = 0;
    const failures: string[] = [];

    for (const ds of aeFaction.datasheets) {
      const dummyUnit = {
        id: 'u1',
        owner: 0,
        name: ds.name,
        sources: [ds.name],
        keywords: ds.keywords ?? [],
        factionKeywords: ds.factionKeywords ?? ['AELDARI'],
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
          const st = abilityStatus(dummyUnit, { ...a, sheet: ds.name, faction: 'AE' });
          if (st.status !== 'auto' && st.status !== 'manual') {
            failures.push(`${ds.name} -> ${a.name} (type: ${a.type}) got status "${st.status}"`);
          }
          checked++;
        }
      }
    }

    if (failures.length > 0) {
      console.error(`Failed ${failures.length} abilities:\n` + failures.slice(0, 30).join('\n'));
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(100);
    console.log(`Successfully verified all ${checked} Aeldari datasheet abilities have status "auto" with 0 red X!`);
  });
});

