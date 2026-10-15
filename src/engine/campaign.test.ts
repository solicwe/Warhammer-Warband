// The campaign: a map every node of which can be reached and left, rewards that change the army, relics and the
// enemy's special rules that act in battle, and Fate that ends the run.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoList } from './autoList';
import { afterBattle, applyCampaign, enter, makeMap, newRun, reachable, takeReward } from './campaign';
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
});
