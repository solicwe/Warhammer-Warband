import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { applyManifest, cloudMode, cloudPortraitCount, getPortrait, hasOwnPortrait, imageSlug, initCloudPortraits, makeZip, matchDatasheet, ownPortraitCount, setPortrait } from './portraits';

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

describe('photos kept on the web page (claude.ai artifact)', () => {
  it('a photo added on the web link is uploaded, indexed in the page db, and shown from there', async () => {
    const docs = new Map<string, Record<string, unknown>>();
    const subs: ((q: { docs: { id: string; data(): Record<string, unknown> }[] }) => void)[] = [];
    const push = () => subs.forEach((f) => f({ docs: [...docs].filter(([k]) => k.startsWith('portraits/')).map(([k, v]) => ({ id: k.split('/')[1], data: () => v })) }));
    const uploads: string[] = [];
    const deleted: string[] = [];
    const db = {
      collection: () => ({ onSnapshot: (f: (typeof subs)[number]) => { subs.push(f); push(); return () => undefined; } }),
      doc: (path: string) => ({ set: async (d: Record<string, unknown>) => { docs.set(path, d); push(); }, delete: async () => { docs.delete(path); push(); } }),
    };
    const assets = {
      upload: async (b: Blob) => { const id = String(uploads.length + 1).padStart(32, 'a'); uploads.push(b.type); return { id, url: `/_blob/${id}` }; },
      delete: async (ref: string) => { deleted.push(ref); return { deleted: true }; },
    };
    (globalThis as unknown as { claude: unknown }).claude = { use: async (n: string) => (n === 'db' ? db : n === 'assets' ? assets : null) };
    await initCloudPortraits();
    expect(cloudMode).toBe('write');

    const jpg = 'data:image/jpeg;base64,' + btoa('fake-jpeg-bytes');
    setPortrait('Warboss', jpg);
    expect(getPortrait('Warboss')).toBe(jpg); // shown at once from this browser
    await new Promise((r) => setTimeout(r, 10));
    expect(uploads).toEqual(['image/jpeg']);
    expect(docs.get('portraits/warboss')).toEqual({ name: 'Warboss', asset: 'a'.repeat(31) + '1' });
    expect(getPortrait('Warboss')).toBe(`/_blob/${'a'.repeat(31)}1`);
    expect(ownPortraitCount()).toBe(0); // the local copy is dropped once it is on the site
    expect(cloudPortraitCount()).toBe(1);
    expect(hasOwnPortrait('Warboss')).toBe(true);

    // replacing it deletes the old file; removing it deletes the row and the file
    setPortrait('Warboss', jpg);
    await new Promise((r) => setTimeout(r, 10));
    expect(deleted).toEqual(['a'.repeat(31) + '1']);
    setPortrait('Warboss', null);
    await new Promise((r) => setTimeout(r, 10));
    expect(docs.has('portraits/warboss')).toBe(false);
    expect(deleted).toEqual(['a'.repeat(31) + '1', 'a'.repeat(31) + '2']);
    expect(getPortrait('Warboss')).toBeUndefined();
  });
});
