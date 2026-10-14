import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALLIES, allySources, withAllies } from './allies';
import { buildUnits, unitPoints, validateList } from './army';
import type { ArmyList, FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const merged = (id: string, group: string) => withAllies(load(id), allySources(id, group).map((src) => ({ src, data: load(src.id) })));
const SF = { points: 2000, dp: 3, unitLimit: 3, enhancements: 3 };
const list = (factionId: string, units: [string, number, boolean?][]): ArmyList => ({
  name: 't', factionId, battleSize: 'strike-force', detachments: [],
  units: units.map(([datasheet, models, warlord], i) => ({ uid: `u${i}`, datasheet, models, pts: 100, warlord })),
});
const allyErrs = (f: FactionData, l: ArmyList) => validateList(l, f, SF).filter((e) => /Freeblades|Dreadblades|Titanic|Agents|Daemonic|Allied/.test(e));

describe('allied units', () => {
  it('each army gets the allies its rules allow', () => {
    const csm = merged('CSM', 'Chaos');
    expect([...new Set(csm.datasheets.map((d) => d.allyName).filter(Boolean))].sort()).toEqual(['Chaos Daemons', 'Chaos Knights']);
    expect(csm.datasheets.some((d) => d.name === 'War Dog Karnivore' && d.ally === 'QT')).toBe(true);
    // the Knights' cultists are not Dreadblades
    expect(csm.datasheets.find((d) => d.name === 'Cultist Mob')?.ally).toBeUndefined();
    const sm = merged('SM', 'Imperium');
    expect([...new Set(sm.datasheets.map((d) => d.ally).filter(Boolean))].sort()).toEqual(['AoI', 'QI', 'TL']);
    expect(sm.datasheets.find((d) => d.name === 'Skitarii Rangers')).toBeUndefined();
    expect(allySources('ORK', 'Xenos')).toEqual([]);
  });

  it('retains the originating faction for abilities on every allied datasheet', () => {
    for (const src of ALLIES) {
      const own = load(src.id);
      const hostId = src.id === 'QI' || src.id === 'TL' || src.id === 'AoI' ? 'SM' : 'CSM';
      const group = hostId === 'SM' ? 'Imperium' : 'Chaos';
      const host = load(hostId);
      const datasheet = own.datasheets.find((d) => src.unit(d) && d.abilities.length > 0);
      expect(datasheet, `${src.id} has an allied datasheet with abilities`).toBeDefined();
      const faction = withAllies(host, [{ src, data: own }]);
      const units = buildUnits(list(hostId, [[datasheet!.name, datasheet!.models.length]]), faction, 0);
      expect(units[0].abilities.filter((a) => a.sheet === datasheet!.name).every((a) => a.faction === src.id)).toBe(true);
    }
  });

  it('checks each rule: one Titanic or three small Knights, one Titan, never the Warlord', () => {
    const sm = merged('SM', 'Imperium');
    expect(allyErrs(sm, list('SM', [['Armiger Helverin', 1], ['Armiger Warglaive', 2]]))).toEqual([]);
    expect(allyErrs(sm, list('SM', [['Knight Paladin', 1], ['Armiger Helverin', 1]])).join()).toMatch(/Freeblades/);
    expect(allyErrs(sm, list('SM', [['Warhound Titan', 1], ['Reaver Titan', 1]])).join()).toMatch(/Titanic Support/);
    expect(allyErrs(sm, list('SM', [['Knight Paladin', 1, true]])).join()).toMatch(/Warlord/);
    expect(allyErrs(sm, list('SM', [['Vindicare Assassin', 1], ['Callidus Assassin', 1], ['Eversor Assassin', 1]])).join()).toMatch(/at most 2 CHARACTER/);
  });

  it('the Daemonic Pact caps the points and needs Battleline per god', () => {
    const csm = merged('CSM', 'Chaos');
    const d = csm.datasheets.filter((x) => x.ally === 'CD');
    const line = d.find((x) => x.keywords.includes('KHORNE') && x.keywords.includes('BATTLELINE'))!;
    const other = d.find((x) => x.keywords.includes('KHORNE') && !x.keywords.includes('BATTLELINE') && !x.keywords.includes('EPIC HERO'))!;
    expect(allyErrs(csm, list('CSM', [[other.name, other.models.length]])).join()).toMatch(/Khorne needs/);
    expect(allyErrs(csm, list('CSM', [[line.name, 10], [other.name, other.models.length]])).join()).not.toMatch(/Khorne needs/);
    const big = list('CSM', [[line.name, 10]]);
    big.units[0].pts = 600;
    expect(allyErrs(csm, big).join() + unitPoints(big.units[0])).toMatch(/at most 500 pts/);
  });
});
