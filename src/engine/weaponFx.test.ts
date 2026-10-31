import { describe, expect, it } from 'vitest';
import type { WeaponProfileData } from './types';
import { flameTint, weaponFx, weaponPow } from './weaponFx';

const prof = (o: Partial<WeaponProfileData> = {}): WeaponProfileData => ({ name: '', range: 24, A: '1', skill: 3, S: 4, AP: 0, D: '1', abilities: [], ...o });
const ranged = (weapon: string, profile = weapon) => weaponFx(weapon, prof({ name: profile }), false);
const melee = (weapon: string, profile = weapon) => weaponFx(weapon, prof({ name: profile, range: 'Melee' }), true);

describe('weapon effects match the weapon', () => {
  it.each([
    ['Boltgun', 'bolt'], ['Heavy bolter', 'heavyBolt'], ['Autocannon', 'heavyBolt'], ['Assault cannon', 'gatling'],
    ['Avenger gatling cannon', 'gatling'], ['Reaper chaincannon', 'gatling'], ['Vulcan mega-bolter', 'gatling'],
    ['Lasgun', 'las'], ['Lascarbine', 'las'], ['Death Rider lascarbine', 'las'], ['Lascannon', 'las'], ['Volcano cannon', 'las'],
    ['Blaster', 'las'], ['Blast pistol', 'las'], ['Solar Carbine', 'las'],
    ['Starcannon', 'plasma'], ['Plasma gun', 'plasma'],
    ['Ion rifle', 'pulse'], ['Cyclic ion blaster', 'pulse'], ['Pulse rifle', 'pulse'], ['Twin pulse blaster', 'pulse'],
    ['Splinter rifle', 'bio'], ['Splinter cannon', 'bio'], ['Shardcarbine', 'bio'], ['Venom cannon', 'bio'],
    ['Long rifle', 'sniper'], ['Kroot long gun', 'sniper'], ['Heavy rail cannon array', 'sniper'],
    ['Wraithcannon', 'psychic'], ['Vibro cannon', 'sonic'], ['Helfrost Pistol', 'cryo'],
    ['Doomsday cannon', 'gauss'], ['Gauss flayer', 'gauss'], ['Tesla carbine', 'lightning'],
    ['Leman Russ battle cannon', 'shell'], ['Earthshaker cannon', 'shell'], ['Missile launcher', 'missile'],
    ['Traktor Kannon', 'grav'], ['Psyko-gatler', 'gatling'], ['Big Shoota', 'shoota'],
  ] as const)('%s → %s', (w, fx) => expect(ranged(w)).toBe(fx));

  it('a profile name decides when it names a weapon kind, a generic one does not', () => {
    expect(ranged('Missile launcher', 'frag')).toBe('shell');
    expect(ranged('Missile launcher', 'krak')).toBe('missile');
    expect(ranged('Kombi-rokkit', 'Shoota')).toBe('shoota');
    expect(ranged('Kan Blasta', 'Kill Shot')).toBe('shoota');
    expect(ranged('Lascannon', 'Kill Shot')).toBe('las');
  });

  it.each([
    ['Chainsword', 'chain'], ['Power sword', 'power'], ['Thunder hammer', 'crush'], ['Lightning claws', 'claw'],
    ['Armoured tracks', 'crush'], ['Titanic feet', 'crush'], ['Dreadnought combat weapon', 'crush'],
    ['Ravenous maw', 'claw'], ['Huge tusks', 'claw'], ['Klaive', 'power'], ['Electroscourge', 'power'],
    ['Lash whip', 'slash'], ['Combat knife', 'slash'], ['Close combat weapon', 'slash'],
  ] as const)('melee %s → %s', (w, fx) => expect(melee(w)).toBe(fx));

  it('a named relic with strike and sweep profiles is a power weapon', () => expect(melee('Silence', 'strike')).toBe('power'));

  it('power grows with Strength and Damage', () => {
    const lasgun = weaponPow(prof({ S: 3, D: '1' })), bolter = weaponPow(prof({ S: 4, D: '1' })), lascannon = weaponPow(prof({ S: 12, D: 'D6+1' }));
    expect(lasgun).toBeLessThan(bolter);
    expect(bolter).toBeLessThan(lascannon);
    expect(lascannon).toBeLessThanOrEqual(1.8);
    expect(lasgun).toBeGreaterThanOrEqual(0.7);
  });

  it('psychic and daemon fire burns in its own colour, and flamers are sized by the weapon', () => {
    const torrent = (o: Partial<WeaponProfileData> = {}) => prof({ ...o, abilities: ['torrent', ...(o.abilities ?? [])] });
    expect(weaponFx('Coruscating Pink Flames', prof({ name: 'Coruscating Pink Flames', abilities: ['psychic'] }), false)).toBe('flame');
    expect(weaponFx('Arcane Fireball', prof({ name: 'Arcane Fireball', abilities: ['psychic'] }), false)).toBe('psychic');
    expect(flameTint('Warpflamer', torrent())).toBe('#a855f7');
    expect(flameTint('Fire of Tzeentch', torrent({ name: 'pink fire' }))).toBe('#ec4899');
    expect(flameTint('Torrent of burning blood', torrent())).toBe('#dc2626');
    expect(flameTint('Flamer', torrent())).toBeUndefined();
    expect(weaponPow(torrent({ abilities: ['pistol'] }), 'Hand flamer')).toBeLessThan(weaponPow(torrent(), 'Flamer'));
    expect(weaponPow(torrent(), 'Flamer')).toBeLessThan(weaponPow(torrent(), 'Heavy flamer'));
  });
});
