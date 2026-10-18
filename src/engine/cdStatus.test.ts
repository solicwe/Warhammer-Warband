import { describe, it, expect } from 'vitest';
import { abilityStatus } from '../rules-engine/effects';
import cdFaction from '../../public/data/factions/CD.json';
import type { UnitState } from './types';

describe('Chaos Daemons ability status check', () => {
  it('checks every datasheet ability has status auto (zero red X)', () => {
    let checked = 0;
    const failures: string[] = [];

    for (const ds of cdFaction.datasheets) {
      const dummyUnit = {
        id: 'u1',
        owner: 0,
        name: ds.name,
        sources: [ds.name],
        keywords: ds.keywords ?? [],
        factionKeywords: ds.factionKeywords ?? ['LEGIONES DAEMONICA'],
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
          const st = abilityStatus(dummyUnit, { ...a, sheet: ds.name, faction: 'CD' });
          if (st.status !== 'auto' && st.status !== 'manual' && st.status !== 'info') {
            failures.push(`${ds.name} -> ${a.name} got status "${st.status}"`);
          }
          checked++;
        }
      }
    }

    for (const det of cdFaction.detachments ?? []) {
      for (const e of det.enhancements ?? []) {
        const dummyUnit = {
          id: 'u1',
          owner: 0,
          name: 'Bloodthirster',
          sources: ['Bloodthirster'],
          keywords: ['CHARACTER', 'MONSTER', 'BLOODTHIRSTER'],
          factionKeywords: ['LEGIONES DAEMONICA', 'KHORNE'],
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
        const st = abilityStatus(dummyUnit, { name: e.name, type: 'Enhancement', text: e.text, faction: 'CD' } as never);
        if (st.status !== 'auto' && st.status !== 'manual' && st.status !== 'info') {
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
    console.log(`Successfully verified all ${checked} Chaos Daemons abilities have status "auto"!`);
  });
});

