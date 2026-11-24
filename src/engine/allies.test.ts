import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALLIES, allySources, withAllies } from './allies';
import { buildUnits, validateList } from './army';
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
    // as Wahapedia 11e (owner, 24 Nov 2026): Daemonic Pact for Chaos Space Marines and Chaos Knights
    expect([...new Set(csm.datasheets.map((d) => d.allyName).filter(Boolean))].sort()).toEqual(['Chaos Daemons', 'Chaos Knights']);
    expect(csm.datasheets.some((d) => d.name === 'War Dog Karnivore' && d.ally === 'QT')).toBe(true);
    const qt = merged('QT', 'Chaos');
    expect([...new Set(qt.datasheets.map((d) => d.allyName).filter(Boolean))]).toEqual(['Chaos Daemons']);
    // the Daemons book's Heretic Astartes units (Shadow Legion) are not daemons
    expect(qt.datasheets.some((d) => d.ally === 'CD' && d.factionKeywords.includes('HERETIC ASTARTES'))).toBe(false);
    expect(qt.datasheets.some((d) => d.name === 'Bloodletters' && d.ally === 'CD')).toBe(true);
    for (const [id, g] of [['DG', 'Chaos'], ['TS', 'Chaos'], ['WE', 'Chaos'], ['EC', 'Chaos']]) expect(merged(id, g).datasheets.some((d) => d.ally === 'CD'), id).toBe(false);
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

  it('the Daemonic Pact caps the points, needs Battleline per god, never the Warlord', () => {
    const csm = merged('CSM', 'Chaos');
    const d = csm.datasheets.filter((x) => x.ally === 'CD');
    const line = d.find((x) => x.keywords.includes('KHORNE') && x.keywords.includes('BATTLELINE'))!;
    const other = d.find((x) => x.keywords.includes('KHORNE') && !x.keywords.includes('BATTLELINE') && !x.keywords.includes('EPIC HERO'))!;
    expect(allyErrs(csm, list('CSM', [[other.name, other.models.length]])).join()).toMatch(/Khorne needs/);
    expect(allyErrs(csm, list('CSM', [[line.name, 10], [other.name, other.models.length]])).join()).not.toMatch(/Khorne needs/);
    const big = list('CSM', [[line.name, 10]]);
    big.units[0].pts = 600;
    expect(allyErrs(csm, big).join()).toMatch(/at most 500 pts/);
    expect(allyErrs(csm, list('CSM', [[line.name, 10, true]])).join()).toMatch(/Warlord/);
  });

  it('applies the Assigned Agents Retinue exemptions only when their matching Characters are present', () => {
    const sm = merged('SM', 'Imperium');
    expect(allyErrs(sm, list('SM', [['Inquisitor', 1], ['Inquisitorial Agents', 6], ['Inquisitorial Agents', 6], ['Inquisitorial Agents', 6]])).join()).not.toMatch(/at most 2 RETINUE/);
    expect(allyErrs(sm, list('SM', [['Inquisitorial Agents', 6], ['Inquisitorial Agents', 6], ['Inquisitorial Agents', 6]])).join()).toMatch(/at most 2 RETINUE/);
    expect(allyErrs(sm, list('SM', [['Rogue Trader Entourage', 4], ['Navigator', 1], ['Voidsmen-at-arms', 10], ['Voidsmen-at-arms', 10], ['Voidsmen-at-arms', 10], ['Voidsmen-at-arms', 10], ['Voidsmen-at-arms', 10]])).join()).toMatch(/at most 2 RETINUE/);
  });

});

// Owner, 21 Nov 2026: an army is not offered allied copies of its own units (Space Marines have their own Deathwatch)
it('Assigned Agents leaves out the requisitioned squads an army already has', () => {
  const sm = merged('SM', 'Imperium').datasheets.map((d) => d.name);
  expect(sm).not.toContain('Deathwatch Kill Team');
  expect(merged('GK', 'Imperium').datasheets.map((d) => d.name)).not.toContain('Grey Knights Terminator Squad');
  expect(merged('AS', 'Imperium').datasheets.map((d) => d.name)).not.toContain('Sisters of Battle Squad');
  expect(merged('AM', 'Imperium').datasheets.map((d) => d.name)).toContain('Deathwatch Kill Team');
});

// Thralls of the First Prince (Wahapedia 11e, owner 24 Nov 2026): a Chaos Daemons army takes the Heretic Astartes units
// of its book only with Shadow Legion, up to 500 / 1000 / 1500 pts, and then no Daemon Prince or Epic Hero but Be'lakor
it('Chaos Daemons: Heretic Astartes units only with Shadow Legion', () => {
  const cd = load('CD');
  const army = (det: string, units: [string, number, boolean?][]): ArmyList => ({ ...list('CD', units), detachments: [det] });
  const shadowErrs = (l: ArmyList) => validateList(l, cd, SF).filter((e) => /HERETIC ASTARTES|Shadow Legion/.test(e));
  expect(shadowErrs(army('Daemonic Incursion', [['Bloodthirster', 1, true], ['Raptors', 5]])).join()).toMatch(/only be included with the Shadow Legion/);
  expect(shadowErrs(army('Shadow Legion', [['Be’lakor', 1, true], ['Raptors', 5], ['Legionaries', 5]]))).toEqual([]);
  expect(shadowErrs(army('Shadow Legion', [['Be’lakor', 1, true], ['Skarbrand', 1]])).join()).toMatch(/Skarbrand cannot be included/);
  expect(shadowErrs(army('Shadow Legion', [['Be’lakor', 1, true], ['Daemon Prince of Chaos', 1]])).join()).toMatch(/Daemon Prince of Chaos cannot be included/);
  const many = army('Shadow Legion', [['Be’lakor', 1, true], ...Array.from({ length: 11 }, (): [string, number] => ['Legionaries', 10])]);
  expect(shadowErrs(many).join()).toMatch(/at most 1000 pts/);
});
