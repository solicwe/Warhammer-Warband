import { describe, expect, it } from 'vitest';
import { weaponFx } from './weaponFx';
import type { WeaponProfileData } from './types';

function mockProfile(name: string, abilities: string[] = []): WeaponProfileData {
  return {
    name,
    range: 24,
    A: '1',
    skill: 3,
    S: 4,
    AP: 0,
    D: '1',
    abilities,
  };
}

describe('weaponFx classification', () => {
  it('correctly classifies Necron Gauss weapons', () => {
    expect(weaponFx('Gauss Flayer', mockProfile('Gauss Flayer'), false)).toBe('gauss');
    expect(weaponFx('Gauss Blaster', mockProfile('Gauss Blaster'), false)).toBe('gauss');
    expect(weaponFx('Heavy Gauss Cannon', mockProfile('Heavy Gauss Cannon'), false)).toBe('gauss');
    expect(weaponFx('Staff of Light', mockProfile('Staff of Light'), false)).toBe('gauss');
    expect(weaponFx('Staff of the Destroyer', mockProfile('Staff of the Destroyer'), false)).toBe('gauss');
    expect(weaponFx('Death ray', mockProfile('Death ray'), false)).toBe('gauss');
    expect(weaponFx('Doomsday blaster', mockProfile('Doomsday blaster'), false)).toBe('gauss');
    expect(weaponFx('Enmitic annihilator', mockProfile('Enmitic annihilator'), false)).toBe('gauss');
  });

  it('correctly classifies Eldar Shuriken weapons', () => {
    expect(weaponFx('Shuriken Pistol', mockProfile('Shuriken Pistol'), false)).toBe('shuriken');
    expect(weaponFx('Avenger shuriken catapult', mockProfile('Avenger shuriken catapult'), false)).toBe('shuriken');
    expect(weaponFx('Shuriken Cannon', mockProfile('Shuriken Cannon'), false)).toBe('shuriken');
    expect(weaponFx('Bloody Twins', mockProfile('Bloody Twins'), false)).toBe('shuriken');
    expect(weaponFx('Silent Death', mockProfile('Silent Death'), false)).toBe('shuriken');
    expect(weaponFx('Maugetar', mockProfile('Maugetar'), false)).toBe('shuriken');
    expect(weaponFx('Triskele', mockProfile('Triskele'), false)).toBe('shuriken');
  });

  it('correctly classifies Tyranid Bio weapons', () => {
    expect(weaponFx('Fleshborer', mockProfile('Fleshborer'), false)).toBe('bio');
    expect(weaponFx('Devourer', mockProfile('Devourer'), false)).toBe('bio');
    expect(weaponFx('Deathspitter', mockProfile('Deathspitter'), false)).toBe('bio');
    expect(weaponFx('Spinefist', mockProfile('Spinefist'), false)).toBe('bio');
    expect(weaponFx('Tentaclids', mockProfile('Tentaclids'), false)).toBe('bio');
    expect(weaponFx('Grasping tongue', mockProfile('Grasping tongue'), false)).toBe('bio');
    expect(weaponFx('Massive toxic lashes', mockProfile('Massive toxic lashes'), false)).toBe('bio');
    expect(weaponFx('Barbed strangler', mockProfile('Barbed strangler'), false)).toBe('bio');
  });

  it('correctly classifies Noise Marine and Sonic weapons', () => {
    expect(weaponFx('Blastmaster', mockProfile('Blastmaster (varied frequency)'), false)).toBe('sonic');
    expect(weaponFx('Sonic blaster', mockProfile('Sonic blaster'), false)).toBe('sonic');
    expect(weaponFx('Scream of despair', mockProfile('Scream of despair'), false)).toBe('sonic');
    expect(weaponFx('Heartstring lyre', mockProfile('Heartstring lyre (euphonic blast)'), false)).toBe('sonic');
    expect(weaponFx('Dirgesinger', mockProfile('Dirgesinger'), false)).toBe('sonic');
  });

  it('correctly classifies Plasma weapons including Bio-plasmic scream', () => {
    expect(weaponFx('Plasma Gun', mockProfile('Plasma Gun - standard'), false)).toBe('plasma');
    expect(weaponFx('Plasma Cannon', mockProfile('Plasma Cannon - supercharge'), false)).toBe('plasma');
    expect(weaponFx('Bio-plasmic scream', mockProfile('Bio-plasmic scream'), false)).toBe('plasma');
  });

  it('correctly classifies Missile launchers across factions', () => {
    expect(weaponFx('Missile launcher', mockProfile('krak'), false)).toBe('missile');
    expect(weaponFx('Havoc launcher', mockProfile('Havoc launcher'), false)).toBe('missile');
    expect(weaponFx('Reaper launcher', mockProfile('starshot'), false)).toBe('missile');
    expect(weaponFx('Cyclone missile launcher', mockProfile('krak'), false)).toBe('missile');
    expect(weaponFx('Thundercoil harpoon', mockProfile('Thundercoil harpoon'), false)).toBe('missile');
  });

  it('correctly classifies Las and Melta weapons', () => {
    expect(weaponFx('Lascannon', mockProfile('Lascannon'), false)).toBe('las');
    expect(weaponFx('Bright lance', mockProfile('Bright lance'), false)).toBe('las');
    expect(weaponFx('Meltagun', mockProfile('Meltagun'), false)).toBe('melta');
    expect(weaponFx('Solar atomiser', mockProfile('Solar atomiser'), false)).toBe('melta');
    expect(weaponFx('Dark scythe', mockProfile('Dark scythe'), false)).toBe('melta');
  });

  it('correctly classifies Sniper and Volkite weapons', () => {
    expect(weaponFx('Sniper rifle', mockProfile('Sniper rifle'), false)).toBe('sniper');
    expect(weaponFx('Railgun', mockProfile('Railgun'), false)).toBe('sniper');
    expect(weaponFx('Tachyon arrow', mockProfile('Tachyon arrow'), false)).toBe('sniper');
    expect(weaponFx('Volkite culverin', mockProfile('Volkite culverin'), false)).toBe('volkite');
    expect(weaponFx('Eradication ray', mockProfile('focused'), false)).toBe('volkite');
    expect(weaponFx('Radium jezzail', mockProfile('Radium jezzail'), false)).toBe('volkite');
  });

  it('correctly classifies Torrent and Psychic weapons', () => {
    expect(weaponFx('Flamer', mockProfile('Flamer', ['torrent']), false)).toBe('flame');
    expect(weaponFx('Plaguespitter', mockProfile('Plaguespitter'), false)).toBe('flame');
    expect(weaponFx('Smite', mockProfile('Smite', ['psychic']), false)).toBe('psychic');
    expect(weaponFx('Neuro disruptor', mockProfile('Neuro disruptor'), false)).toBe('psychic');
  });
});
