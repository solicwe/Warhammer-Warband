import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { applyManifest, cloudMode, cloudPortraitCount, getPortrait, hasOwnPortrait, imageSlug, initCloudPortraits, makeZip, matchDatasheet, ownPortraitCount, removeUnusedCloudFiles, setPortrait, uploadAllLocal, uploadsPending } from './portraits';

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
    const stored: { id: string; createdAt: string }[] = [];
    const db = {
      collection: () => ({ onSnapshot: (f: (typeof subs)[number]) => { subs.push(f); push(); return () => undefined; } }),
      doc: (path: string) => ({ set: async (d: Record<string, unknown>) => { docs.set(path, d); push(); }, delete: async () => { docs.delete(path); push(); } }),
    };
    const assets = {
      upload: async (b: Blob) => { const id = String(uploads.length + 1).padStart(32, 'a'); uploads.push(b.type); stored.push({ id, createdAt: new Date(0).toISOString() }); return { id, url: `/_blob/${id}` }; },
      delete: async (ref: string) => { deleted.push(ref); const i = stored.findIndex((a) => a.id === ref); if (i >= 0) stored.splice(i, 1); return { deleted: true }; },
      list: async () => ({ assets: [...stored] }),
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

    // the same photos sent again and again while they are still going up: each goes up once
    const a = 'data:image/jpeg;base64,' + btoa('boyz'), b = 'data:image/jpeg;base64,' + btoa('nobz');
    const before = uploads.length;
    setPortrait('Boyz', a); setPortrait('Nobz', b);
    void uploadAllLocal(); void uploadAllLocal(); void uploadAllLocal();
    expect(uploadsPending()).toBe(2);
    await uploadAllLocal();
    await new Promise((r) => setTimeout(r, 10));
    expect(uploads.length - before).toBe(2);
    expect(uploadsPending()).toBe(0);
    expect(cloudPortraitCount()).toBe(2);

    // a file nothing points at (an old doubled upload) is cleared; the ones in use stay
    stored.push({ id: 'f'.repeat(32), createdAt: new Date(0).toISOString() });
    expect(await removeUnusedCloudFiles()).toEqual({ photos: [], files: 1 });
    // a photo of a unit that is in no army any more (moved to Legends) goes, with its file
    expect(await removeUnusedCloudFiles(new Set(['Boyz']))).toEqual({ photos: ['Nobz'], files: 1 });
    expect(cloudPortraitCount()).toBe(1);
    expect(stored.map((x) => x.id).sort()).toEqual([...docs.values()].map((v) => (v as { asset: string }).asset).sort());
  });
});

describe('mixed squads', () => {
  it('a model name can have its own picture; without one the unit picture shows', async () => {
    const { getModelPortrait, modelPortraitKey } = await import('./portraits');
    setPortrait('Wardens of Ultramar', 'data:image/png;base64,AAAA');
    expect(getModelPortrait({ source: 'Wardens of Ultramar', name: 'Lucia Vestha' })).toBe('data:image/png;base64,AAAA');
    setPortrait(modelPortraitKey('Wardens of Ultramar', 'Lucia Vestha'), 'data:image/png;base64,BBBB');
    expect(getModelPortrait({ source: 'Wardens of Ultramar', name: 'Lucia Vestha' })).toBe('data:image/png;base64,BBBB');
    expect(getModelPortrait({ source: 'Wardens of Ultramar', name: 'Gaius Silva' })).toBe('data:image/png;base64,AAAA');
    setPortrait(modelPortraitKey('Wardens of Ultramar', 'Lucia Vestha'), null);
    setPortrait('Wardens of Ultramar', null);
  });
  it('models whose wargear differs from the squad get a weapon label', async () => {
    const { loadoutLabels } = await import('./loadout');
    const w = (name: string, range: number | 'Melee') => ({ name, profiles: [{ name, range, A: '1', skill: 3, S: 4, AP: 0, D: '1', abilities: [] }] });
    const m = (id: string, ws: ReturnType<typeof w>[]) => ({ id, name: 'Devastator Marine', source: 'Devastator Squad', weapons: ws, dead: false });
    const base = [w('Bolt Pistol', 12), w('Close Combat Weapon', 'Melee')];
    const u = { models: [m('a', [...base, w('Bolter', 24)]), m('b', [...base, w('Heavy Bolter', 36)]), m('c', [...base, w('Lascannon', 48)]), m('d', [...base, w('Bolter', 24)])] };
    const labels = loadoutLabels(u as never);
    expect(labels.get('b')).toBe('Heavy Bolter');
    expect(labels.get('c')).toBe('Lascannon');
    expect(labels.has('a')).toBe(false); // the usual kit of the squad needs no label
    const same = { models: [m('x', base), m('y', base)] };
    expect(loadoutLabels(same as never).size).toBe(0);
  });
});
