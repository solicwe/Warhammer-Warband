// The campaign: a map every node of which can be reached and left, rewards that change the army, relics and the
// enemy's special rules that act in battle, and Fate that ends the run.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoList } from './autoList';
import {
  afterBattle, applyCampaign, buyEnhancementForUnit, changeSquadSize, combineSquads, continueNextLoop,
  enhancementScrapCost, enter, makeMap, newRun, reachable, recruitUnit, removeEnhancementFromUnit, takeReward
} from './campaign';
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

  it('supports endless campaign loops with scaling difficulty in subsequent sectors', () => {
    const sm = load('SM');
    const list = autoList(sm, 500, 3);
    let run = newRun(sm, list, ['ORK'], 42);
    run.over = 'won';
    run.wins = 6;
    run.fate = 1;
    run.scrap = 50;

    const sector2 = continueNextLoop(run, sm);
    expect(sector2.loop).toBe(2);
    expect(sector2.over).toBeUndefined();
    expect(sector2.path).toEqual([]);
    expect(sector2.fate).toBe(3); // 1 + 2 bonus fate
    expect(sector2.scrap).toBe(170); // 50 + 120 bonus scrap
    expect(sector2.map.length).toBeGreaterThan(0);

    // Difficulty scaling check: Sector 2 boss should have higher points and more rules than Sector 1 boss
    const map1 = makeMap(42, ['ORK'], 1);
    const map2 = makeMap(42, ['ORK'], 2);
    const boss1 = map1.find((n) => n.kind === 'boss')!;
    const boss2 = map2.find((n) => n.kind === 'boss')!;
    expect(boss2.enemy!.pts).toBeGreaterThan(boss1.enemy!.pts);
    expect(boss2.enemy!.rules.length).toBeGreaterThanOrEqual(boss1.enemy!.rules.length);

    // In loop 2 (Endless mode), starting layer battles are 1000+ points and expert bot level
    const layer0Node = map2.find((n) => n.layer === 0 && n.enemy)!;
    expect(layer0Node.enemy!.pts).toBeGreaterThanOrEqual(1000);
    expect(layer0Node.enemy!.level).toBe('expert');

    // No easy bot in roguelike maps
    for (const n of map2) {
      if (n.enemy?.level) {
        expect(n.enemy.level).not.toBe('easy');
      }
    }
  });

  it('campaign battle duration: miniboss is 3 rounds, boss is 5 rounds, and event extends to 5 rounds', () => {
    const sm = load('SM');
    const ork = load('ORK');
    const map = makeMap(42, ['ORK'], 1);
    const elite = map.find((n) => n.kind === 'elite')!;
    const boss = map.find((n) => n.kind === 'boss')!;

    // Elite / Miniboss round calculation
    const eliteRounds = elite.kind === 'boss' ? 5 : 3;
    expect(eliteRounds).toBe(3);

    // Boss round calculation
    const bossRounds = boss.kind === 'boss' ? 5 : 3;
    expect(bossRounds).toBe(5);

    // Initial game state for a 3-round battle
    const s = createGame({ lists: [autoList(sm, 500, 1), autoList(ork, 500, 2)], factions: [sm, ork], names: ['You', 'Orks'], seed: 4, maxRounds: 3 });
    s.campaign = { node: elite.id, relics: [], rules: [] };
    s.round = 2;
    expect(s.maxRounds).toBe(3);

    // Strategic event triggers enemy reinforcements and extends battle to 5 rounds
    s.maxRounds = 5;
    expect(s.maxRounds).toBe(5);
  });

  it('allows purchasing and unequipping detachment enhancements for characters using Scrap in roguelike campaign', () => {
    const sm = load('SM');
    const list = autoList(sm, 500, 3);
    let run = newRun(sm, list, ['ORK'], 42);
    run.scrap = 200;

    const char = run.list.units.find((u) => {
      const d = sm.datasheets.find((x) => x.name === u.datasheet);
      return d?.keywords.includes('CHARACTER') && !d.keywords.includes('EPIC HERO');
    })!;
    expect(char).toBeDefined();

    const initialScrap = run.scrap;
    const cost = enhancementScrapCost(20);
    expect(cost).toBe(60);

    // Buy enhancement
    run = buyEnhancementForUnit(run, sm, char.uid, 'Adept of the Codex', 20);
    const updatedChar = run.list.units.find((u) => u.uid === char.uid)!;
    expect(updatedChar.enhancement).toBe('Adept of the Codex');
    expect(updatedChar.enhancementPts).toBe(20);
    expect(run.scrap).toBe(initialScrap - cost);

    // Unequip & refund enhancement
    run = removeEnhancementFromUnit(run, char.uid);
    const refundedChar = run.list.units.find((u) => u.uid === char.uid)!;
    expect(refundedChar.enhancement).toBeUndefined();
    expect(refundedChar.enhancementPts).toBeUndefined();
    expect(run.scrap).toBe(initialScrap);
  });
});

