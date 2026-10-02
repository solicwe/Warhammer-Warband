import { describe, expect, it } from 'vitest';
import { matchDatasheet } from './portraits';

const names = ['Intercessor Squad', 'Assault Intercessor Squad', 'Captain', 'Captain in Terminator Armour', 'Warboss', 'Boyz', 'Big Mek', "Headwoppa's Killchoppa"];

describe('matchDatasheet', () => {
  it('matches file names to datasheets', () => {
    expect(matchDatasheet('Intercessor Squad.jpg', names)).toBe('Intercessor Squad');
    expect(matchDatasheet('assault-intercessor-squad_2024.webp', names)).toBe('Assault Intercessor Squad');
    expect(matchDatasheet('warboss_01.png', names)).toBe('Warboss');
    expect(matchDatasheet('Captain in Terminator Armour.jpg', names)).toBe('Captain in Terminator Armour');
    expect(matchDatasheet('big_mek.jpeg', names)).toBe('Big Mek');
    expect(matchDatasheet('IMG_4512.jpg', names)).toBeUndefined();
  });
});
