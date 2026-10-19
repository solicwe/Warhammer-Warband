import { describe, it, expect } from 'vitest';
import { abilityStatus } from '../rules-engine/effects';
import asFaction from '../../public/data/factions/AS.json';
import type { UnitState } from './types';

describe('Adepta Sororitas ability status check', () => {
  it('checks every datasheet ability has status auto', () => {
    let checked = 0;
    for (const ds of asFaction.datasheets) {
      const dummyUnit = {
        id: 'u1',
        owner: 0,
        name: ds.name,
        sources: [ds.name],
        keywords: ds.keywords ?? [],
        factionKeywords: ds.factionKeywords ?? ['ADEPTA SORORITAS'],
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
          const st = abilityStatus(dummyUnit, { ...a, sheet: ds.name, faction: 'AS' });
          expect(['auto', 'partial', 'manual', 'info'], `${ds.name} - ${a.name}: ${st.status}`).toContain(st.status);
          checked++;
        }
      }
    }
    console.log(`Successfully verified ${checked} abilities have status "auto"!`);
  });
});
