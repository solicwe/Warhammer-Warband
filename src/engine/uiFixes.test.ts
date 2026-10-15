import { describe, it, expect } from 'vitest';
import TYR from '../../public/data/factions/TYR.json';
import SM from '../../public/data/factions/SM.json';
import { statGroups } from '../ui/Sheet';
import { shootingModes } from './attack';
import { createGame } from './game';
import { defaultWargear, syncWargear } from './army';
import type { ArmyList, FactionData } from './types';

describe('UI & Tyranid Datasheet Fixes', () => {
  it('Harridan and Hierophant datasheets have valid base and options', () => {
    const tyrFac = TYR as unknown as FactionData;
    const harridan = tyrFac.datasheets.find((d) => d.name === 'Harridan');
    const hierophant = tyrFac.datasheets.find((d) => d.name === 'Hierophant');

    expect(harridan).toBeDefined();
    expect(harridan?.models[0].base).toBeDefined();
    expect(harridan?.models[0].base.text).toBeTruthy();
    expect(harridan?.options).toBeDefined();

    expect(hierophant).toBeDefined();
    expect(hierophant?.models[0].base).toBeDefined();
    expect(hierophant?.models[0].base.text).toBeTruthy();
    expect(hierophant?.options).toBeDefined();

    // Verify statGroups does not throw on any Tyranid datasheet
    for (const d of tyrFac.datasheets) {
      expect(() => statGroups(d.models)).not.toThrow();
    }
  });

  it('Advanced unit with assault weapons is eligible to shoot with assault weapons directly', () => {
    const tyrFac = TYR as unknown as FactionData;
    const smFac = SM as unknown as FactionData;
    
    // Create an army with Termagants (equipped with Fleshborer [Assault])
    const term = tyrFac.datasheets.find((d) => d.name === 'Termagants')!;
    const entry = syncWargear(term, defaultWargear(term, { uid: 'u1', datasheet: term.name, models: 10, pts: 60 }));
    const listA: ArmyList = { id: 'a', name: 'Nids', factionId: 'TYR', battleSize: 'incursion', detachments: ['Invasion Fleet'], units: [entry] };
    const listB: ArmyList = { id: 'b', name: 'Enemy', factionId: 'SM', battleSize: 'incursion', detachments: ['Gladius Task Force'], units: [] };

    const s = createGame({ lists: [listA, listB], factions: [tyrFac, smFac], names: ['A', 'B'], seed: 42 });
    const u = s.units[0];
    // Fleshborer has [Assault]
    const fleshborer = term.weapons.find((w) => w.name === 'Fleshborer')!;
    u.models.forEach((m) => { m.weapons = [fleshborer]; });
    u.status = 'board';
    u.move = 'advance'; // Unit advanced!
    
    const modes = shootingModes(s, u);
    expect(modes.length).toBeGreaterThan(0);
    expect(modes[0]).toBe('assault');

    // If unit had NO assault weapons after advancing, it cannot shoot
    const noAssaultUnit = { ...u, models: u.models.map((m) => ({ ...m, weapons: [] })) };
    expect(shootingModes(s, noAssaultUnit)).toEqual([]);
  });
});
