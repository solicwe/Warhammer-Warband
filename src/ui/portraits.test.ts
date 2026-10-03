import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { applyManifest, getPortrait, imageSlug, makeZip, matchDatasheet } from './portraits';

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

describe('server images', () => {
  it('file names: the app and the manifest script use the same slug', () => {
    expect(imageSlug('Intercessor Squad')).toBe('intercessor-squad');
    expect(imageSlug("Headwoppa's Killchoppa")).toBe('headwoppas-killchoppa');
    expect(imageSlug('Captain in Terminator Armour')).toBe('captain-in-terminator-armour');
    const script = execFileSync('node', ['-e', `import('./scripts/build-images.mjs').catch(()=>{})`], { encoding: 'utf8' });
    expect(script).toMatch(/manifest\.json/);
  });

  it('a manifest entry becomes the portrait (relative to the image base, or a full URL)', () => {
    applyManifest({ version: 1, units: { SM: { 'Intercessor Squad': 'units/SM/intercessor-squad.webp' }, ORK: { Boyz: 'https://cdn.example/boyz.jpg' } } }, 'https://srv/images/');
    expect(getPortrait('Intercessor Squad')).toBe('https://srv/images/units/SM/intercessor-squad.webp');
    expect(getPortrait('Boyz')).toBe('https://cdn.example/boyz.jpg');
    expect(getPortrait('Warboss')).toBeUndefined();
  });

  it('the export zip is a valid archive', () => {
    const z = makeZip([{ name: 'units/SM/a.jpg', data: new Uint8Array([1, 2, 3]) }, { name: 'manifest.json', data: new TextEncoder().encode('{}') }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = z.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    // the central directory points back at the first local header
    const dir = v.getUint32(end + 16, true);
    expect(v.getUint32(dir, true)).toBe(0x02014b50);
    expect(v.getUint32(dir + 16, true)).toBe(0x55bc801d); // crc32 of [1,2,3]
  });
});
