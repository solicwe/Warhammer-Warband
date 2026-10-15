import { describe, it, expect } from 'vitest';
import { abilityStatus } from './effects';
import gcFaction from '../../public/data/factions/GC.json';
import type { UnitState } from './types';

describe('Genestealer Cults ability status check', () => {
  it('checks every datasheet ability has status auto (zero red X)', () => {
    let checked = 0;
    const failures: string[] = [];

    for (const ds of gcFaction.datasheets) {
      const dummyUnit = {
        id: 'u1',
        owner: 0,
        name: ds.name,
        sources: [ds.name],
        keywords: ds.keywords ?? [],
        factionKeywords: ds.factionKeywords ?? ['GENESTEALER CULTS'],
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
          const st = abilityStatus(dummyUnit, { ...a, sheet: ds.name, faction: 'GC' });
          if (st.status !== 'auto') {
            failures.push(`${ds.name} -> ${a.name} got status "${st.status}"`);
          }
          checked++;
        }
      }
    }

    for (const det of gcFaction.detachments ?? []) {
      for (const e of det.enhancements ?? []) {
        const dummyUnit = {
          id: 'u1',
          owner: 0,
          name: 'Patriarch',
          sources: ['Patriarch'],
          keywords: ['CHARACTER', 'INFANTRY', 'PATRIARCH'],
          factionKeywords: ['GENESTEALER CULTS'],
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
        const st = abilityStatus(dummyUnit, { name: e.name, type: 'Enhancement', text: e.text, faction: 'GC' } as never);
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
    console.log(`Successfully verified all ${checked} Genestealer Cults abilities have status "auto"!`);
  });
});

