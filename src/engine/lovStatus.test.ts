import { describe, it, expect } from 'vitest';
import { abilityStatus } from './effects';
import lovFaction from '../../public/data/factions/LOV.json';
import type { UnitState } from './types';

describe('Leagues of Votann ability status check', () => {
  it('checks every datasheet ability has status auto (zero red X)', () => {
    let checked = 0;
    const failures: string[] = [];

    for (const ds of lovFaction.datasheets) {
      const dummyUnit = {
        id: 'u1',
        owner: 0,
        name: ds.name,
        sources: [ds.name],
        keywords: ds.keywords ?? [],
        factionKeywords: ds.factionKeywords ?? ['LEAGUES OF VOTANN'],
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
          const st = abilityStatus(dummyUnit, { ...a, sheet: ds.name, faction: 'LoV' });
          if (st.status !== 'auto') {
            failures.push(`${ds.name} -> ${a.name} got status "${st.status}"`);
          }
          checked++;
        }
      }
    }

    for (const det of lovFaction.detachments ?? []) {
      for (const e of det.enhancements ?? []) {
        const dummyUnit = {
          id: 'u1',
          owner: 0,
          name: 'Kâhl',
          sources: ['Kâhl'],
          keywords: ['CHARACTER', 'INFANTRY'],
          factionKeywords: ['LEAGUES OF VOTANN'],
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
        const st = abilityStatus(dummyUnit, { name: e.name, type: 'Enhancement', text: e.text, faction: 'LoV' } as never);
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
    expect(checked).toBeGreaterThan(30);
    console.log(`Successfully verified all ${checked} Leagues of Votann abilities have status "auto"!`);
  });
});

