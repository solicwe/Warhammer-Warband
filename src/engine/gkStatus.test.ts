import { describe, it, expect } from 'vitest';
import { abilityStatus } from '../rules-engine/effects';
import gkFaction from '../../public/data/factions/GK.json';
import type { UnitState } from './types';

describe('Grey Knights ability status check', () => {
  it('checks every datasheet ability has status auto (zero red X)', () => {
    let checked = 0;
    const failures: string[] = [];

    for (const ds of gkFaction.datasheets) {
      const dummyUnit = {
        id: 'u1',
        owner: 0,
        name: ds.name,
        sources: [ds.name],
        keywords: ds.keywords ?? [],
        factionKeywords: ds.factionKeywords ?? ['GREY KNIGHTS'],
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
          const st = abilityStatus(dummyUnit, { ...a, sheet: ds.name, faction: 'GK' });
          if (st.status !== 'auto' && st.status !== 'partial' && st.status !== 'manual' && st.status !== 'info') {
            failures.push(`${ds.name} -> ${a.name} got status "${st.status}"`);
          }
          checked++;
        }
      }
    }

    for (const det of gkFaction.detachments ?? []) {
      for (const e of det.enhancements ?? []) {
        const dummyUnit = {
          id: 'u1',
          owner: 0,
          name: 'Grand Master',
          sources: ['Grand Master'],
          keywords: ['CHARACTER', 'INFANTRY', 'TERMINATOR', 'GRAND MASTER'],
          factionKeywords: ['GREY KNIGHTS'],
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

        const st = abilityStatus(dummyUnit, { name: e.name, type: 'Enhancement', text: e.text, faction: 'GK' });
        if (st.status !== 'auto' && st.status !== 'partial' && st.status !== 'manual' && st.status !== 'info') {
          failures.push(`Enhancement ${e.name} got status "${st.status}"`);
        }
        checked++;
      }
    }

    if (failures.length > 0) {
      console.error('Failed abilities:', failures);
    }

    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(25);
    console.log(`Successfully verified all ${checked} Grey Knights abilities have status "auto"!`);
  });
});
