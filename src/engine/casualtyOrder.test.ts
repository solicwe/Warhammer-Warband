import { describe, expect, it } from 'vitest';
import { pickCasualty, weaponValue } from './attack';
import type { ModelState, UnitState, WeaponData } from './types';

const gun = (A: string, S: number, AP: number, D: string): WeaponData => ({
  name: 'g', profiles: [{ name: 'g', range: 24, A, skill: 3, S, AP, D, abilities: [] }],
});
const model = (id: string, x: number, weapons: WeaponData[]): ModelState => ({
  id, x, y: 0, r: 0.5, wounds: 1, dead: false, weapons, isCharacter: false,
  profile: { W: 1, Sv: 3, InSv: null },
} as unknown as ModelState);

describe('casualty order', () => {
  it('removes models with weak or no weapons before the one holding the big gun', () => {
    const heavy = model('h', 0, [gun('1', 12, -3, 'D6+1')]);
    const bolter = model('b', 1, [gun('2', 4, 0, '1')]);
    const none = model('n', 2, []);
    const u = { models: [heavy, bolter, none] } as unknown as UnitState;
    expect(weaponValue(heavy)).toBeGreaterThan(weaponValue(bolter));
    expect(weaponValue(none)).toBe(0);
    expect(pickCasualty(u, u.models)?.id).toBe('n');
    none.dead = true;
    expect(pickCasualty(u, u.models)?.id).toBe('b');
  });
});
