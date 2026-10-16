import { describe, expect, it } from 'vitest';
import { getAbilityOrWeaponInfo, renderHighlightedText } from './AbilityBadgePopover';
import type { ModelState, UnitState } from '../engine/types';
import { dismissUnit } from '../engine/campaign';

describe('AbilityBadgePopover', () => {
  it('resolves Bolt Rifle sample data with stats and keywords', () => {
    const info = getAbilityOrWeaponInfo('Bolt Rifle');
    expect(info.title).toBe('Bolt Rifle');
    expect(info.category.label).toBe('Ranged Weapon');
    expect(info.category.variant).toBe('ranged');
    expect(info.stats).toBeDefined();
    expect(info.stats?.range).toBe('24"');
    expect(info.stats?.a).toBe('2');
    expect(info.stats?.bs).toBe('3+');
    expect(info.stats?.s).toBe('4');
    expect(info.stats?.ap).toBe('-1');
    expect(info.stats?.d).toBe('1');
    expect(info.keywords).toContain('[RAPID FIRE 1]');
    expect(info.keywords).toContain('[ASSAULT]');
    expect(info.keywords).toContain('[HEAVY]');
  });

  it('resolves Plasma Pistol & Power Fist dual loadout', () => {
    const info = getAbilityOrWeaponInfo('Plasma Pistol & Power Fist');
    expect(info.title).toBe('Plasma Pistol & Power Fist');
    expect(info.category.variant).toBe('special');
    expect(info.stats).toBeDefined();
    expect(info.stats?.range).toBe('12" / Melee');
    expect(info.keywords).toContain('[PISTOL]');
    expect(info.keywords).toContain('[HAZARDOUS]');
  });

  it('resolves Grenade Launcher with special icon badge', () => {
    const info = getAbilityOrWeaponInfo('Grenade Launcher');
    expect(info.title).toBe('Astartes Grenade Launcher');
    expect(info.badgeLabel).toBe('Grenade Launcher');
    expect(info.category.label).toBe('Ranged Weapon');
    expect(info.stats?.s).toBe('9');
    expect(info.keywords).toContain('[BLAST]');
  });

  it('resolves +CP shorthand into human-readable rule and emerald badge', () => {
    const info = getAbilityOrWeaponInfo('+CP');
    expect(info.badgeLabel).toBe('+1 CP');
    expect(info.category.label).toBe('Gains +1 CP');
    expect(info.category.variant).toBe('cp');
    expect(info.summary).toContain('Gain 1 Command Point');
    expect(info.summary).toContain('4+');
  });

  it('dynamically parses weapons from unit state models', () => {
    const dummyModel = {
      id: 'm1',
      source: 'Intercessor Squad',
      name: 'Intercessor',
      dead: false,
      weapons: [
        {
          name: 'Heavy Bolter',
          profiles: [
            {
              name: 'Heavy Bolter',
              range: 36,
              A: '3',
              skill: 4,
              S: 5,
              AP: -1,
              D: '2',
              abilities: ['heavy', 'sustained hits 1'],
            },
          ],
        },
      ],
    } as unknown as ModelState;

    const dummyUnit = {
      id: 'u1',
      name: 'Intercessors',
      models: [dummyModel],
      abilities: [],
    } as unknown as UnitState;

    const info = getAbilityOrWeaponInfo('Heavy Bolter', dummyUnit, dummyModel);
    expect(info.title).toBe('Heavy Bolter');
    expect(info.stats?.range).toBe('36"');
    expect(info.stats?.a).toBe('3');
    expect(info.stats?.bs).toBe('4+');
    expect(info.stats?.s).toBe('5');
    expect(info.stats?.ap).toBe('-1');
    expect(info.stats?.d).toBe('2');
    expect(info.keywords).toContain('[HEAVY]');
    expect(info.keywords).toContain('[SUSTAINED HITS 1]');
  });

  it('highlights numbers, dice rolls, and inches in plain-language summaries', () => {
    const nodes = renderHighlightedText('Within 12" and rolls 4+ on D6 to gain 1 CP') as React.ReactNode[];
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.length).toBeGreaterThan(1);
  });
});

describe('Campaign dismissUnit attachment cleanup', () => {
  it('clears attachTo reference if the bodyguard squad is dismissed', () => {
    const run = {
      list: {
        units: [
          { uid: 'leader-1', datasheet: 'Captain', attachTo: 'bodyguard-1' },
          { uid: 'bodyguard-1', datasheet: 'Intercessors' },
        ],
      },
      story: [],
    } as never;

    const updated = dismissUnit(run, 'bodyguard-1');
    expect(updated.list.units.length).toBe(1);
    expect(updated.list.units[0].uid).toBe('leader-1');
    expect(updated.list.units[0].attachTo).toBeUndefined();
  });
});
