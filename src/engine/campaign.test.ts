// The campaign: a map every node of which can be reached and left, rewards that change the army, relics and the
// enemy's special rules that act in battle, and Fate that ends the run.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoList } from './autoList';
import { afterBattle, applyCampaign, changeSquadSize, combineSquads, enter, makeMap, newRun, reachable, recruitUnit, takeReward } from './campaign';
import { effectsFor } from './effects';
import { createGame } from './game';
import type { FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;

describe('campaign', () => {
  it('makes a map where every node is reachable and leads on, ending at one boss', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const map = makeMap(seed, ['ORK', 'TYR', 'NEC']);
      const layers = Math.max(...map.map((n) => n.layer));
      expect(map.filter((n) => n.layer === layers).map((n) => n.kind)).toEqual(['boss']);
      for (const n of map) {
        if (n.layer < layers) expect(n.next.length).toBeGreaterThan(0);
        if (['battle', 'elite', 'boss'].includes(n.kind)) expect(n.enemy?.pts).toBeGreaterThan(0);
      }
      expect(map.find((n) => n.kind === 'boss')!.enemy!.rules.length).toBe(2);
    }
  });

  it('a campaign start list is a random draw: different runs, different units', () => {
    const sm = load('SM');
    const lists = [11, 22, 33, 44, 55].map((seed) => autoList(sm, 500, seed, true).units.map((u) => u.datasheet).sort().join());
    expect(new Set(lists).size).toBeGreaterThan(2);
    for (const seed of [11, 22]) expect(autoList(sm, 500, seed, true).units.some((u) => u.warlord)).toBe(true);
  });

  it('plays a run: battle, reward, relics in battle, a loss costs Fate', () => {
    const sm = load('SM');
    const list = autoList(sm, 500, 3);
    let run = newRun(sm, list, ['ORK'], 42);
    const first = reachable(run)[0];
    run = enter(run, first.id, sm);
    expect(run.fighting).toBe(first.id);
    run = afterBattle(run, 0, sm, 'Orks');
    expect(run.path).toEqual([first.id]);
    expect(run.offer?.length).toBeGreaterThan(0);
    const unit = run.offer!.find((r) => r.kind === 'unit');
    const before = run.list.units.length;
    if (unit) { run = takeReward(run, unit, sm); expect(run.list.units.length).toBe(before + 1); }
    run = takeReward({ ...run, offer: [{ kind: 'relic', id: 'stimms' }] }, { kind: 'relic', id: 'stimms' }, sm);
    expect(run.relics).toContain('stimms');
    expect(reachable(run).length).toBeGreaterThan(0);

    // the relic and the enemy rule are on the units in battle
    const ork = load('ORK');
    const s = createGame({ lists: [run.list, autoList(ork, 500, 1)], factions: [sm, ork], names: ['You', 'Orks'], seed: 4, maxRounds: 3 });
    run = { ...run, fighting: reachable(run)[0].id };
    applyCampaign(s, run, ['iron-will']);
    const inf = s.units.find((u) => u.owner === 0 && u.keywords.includes('INFANTRY'))!;
    expect(effectsFor(s, inf).some((x) => x.label === 'Combat Stimms')).toBe(true);
    const foe = s.units.find((u) => u.owner === 1)!;
    expect(effectsFor(s, foe).some((x) => x.label === 'Iron Will')).toBe(true);
    expect(s.campaign?.relics).toContain('stimms');

    // three losses end the run
    for (let i = 0; i < 3; i++) run = afterBattle({ ...run, fighting: reachable(run)[0]?.id ?? run.fighting }, 1, sm, 'Orks');
    expect(run.fate).toBe(0);
    expect(run.over).toBe('lost');
  });

  it('campaign starter list and recruit options do not get overwritten by allied units (e.g. GK with AoI)', () => {
    const gk = load('GK');
    const aoi = load('AoI');
    // Simulate withAllies appending AoI datasheets marked as ally
    const gkWithAllies: FactionData = {
      ...gk,
      datasheets: [
        ...gk.datasheets,
        ...aoi.datasheets.map((d) => ({ ...d, ally: 'AoI', allyName: 'Imperial Agents' })),
      ],
    };
    for (const seed of [1, 2, 3, 42, 999]) {
      const list = autoList(gkWithAllies, 500, seed, true);
      for (const u of list.units) {
        const d = gk.datasheets.find((x) => x.name === u.datasheet);
        expect(d).toBeDefined();
        expect(d?.factionKeywords).toContain('GREY KNIGHTS');
      }
    }
  });

  it('allows changing squad size to 10 models and combining squads in roguelike campaign', () => {
    const sm = load('SM');
    const list = autoList(sm, 500, 3);
    let run = newRun(sm, list, ['ORK'], 42);
    run.scrap = 300;

    // Recruit a 5-man Intercessor Squad
    run = recruitUnit(run, sm, 'Intercessor Squad', 5);
    const unit1 = run.list.units.find((u) => u.datasheet === 'Intercessor Squad' && u.models === 5)!;
    expect(unit1).toBeDefined();
    expect(unit1.models).toBe(5);

    // 1. Change squad size directly from 5 to 10 models using Scrap
    const scrapBefore = run.scrap;
    run = changeSquadSize(run, sm, unit1.uid, 10);
    const updated1 = run.list.units.find((u) => u.uid === unit1.uid)!;
    expect(updated1.models).toBe(10);
    expect(updated1.pts).toBe(175);
    expect(run.scrap).toBe(scrapBefore - 80); // 175 - 95 = 80 Scrap spent

    // 2. Recruit a second 5-man Intercessor Squad
    run = recruitUnit(run, sm, 'Intercessor Squad', 5);
    // And recruit a third 5-man Intercessor Squad
    run = recruitUnit(run, sm, 'Intercessor Squad', 5);
    const squads = run.list.units.filter((u) => u.datasheet === 'Intercessor Squad' && u.models === 5);
    expect(squads.length).toBe(2);

    // Give one of them some XP and an honor
    squads[0].xp = 5;
    squads[0].honors = ['hardened'];
    squads[1].xp = 3;
    squads[1].honors = ['weapon_master'];

    // Combine the two 5-man squads into one 10-man squad for free
    const countBefore = run.list.units.length;
    run = combineSquads(run, sm, squads[0].uid, squads[1].uid);
    expect(run.list.units.length).toBe(countBefore - 1); // duplicate squad removed

    const merged = run.list.units.find((u) => u.uid === squads[0].uid)!;
    expect(merged.models).toBe(10);
    expect(merged.pts).toBe(175);
    expect(merged.xp).toBe(8); // 5 + 3 combined
    expect(merged.honors).toEqual(expect.arrayContaining(['hardened', 'weapon_master']));
  });

  it('allows recruiting Epic Heroes into the campaign roster but limits them to max 1', () => {
    const sm = load('SM');
    const list = autoList(sm, 500, 3);
    let run = newRun(sm, list, ['ORK'], 42);
    run.scrap = 500;

    // Recruit Marneus Calgar
    const countBefore = run.list.units.length;
    run = recruitUnit(run, sm, 'Marneus Calgar');
    expect(run.list.units.length).toBe(countBefore + 1);
    expect(run.list.units.some((u) => u.datasheet === 'Marneus Calgar')).toBe(true);

    // Attempting to recruit Marneus Calgar again should be rejected
    const countAfter = run.list.units.length;
    run = recruitUnit(run, sm, 'Marneus Calgar');
    expect(run.list.units.length).toBe(countAfter);
  });
});
