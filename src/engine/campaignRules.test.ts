// Campaign rules: a real primary mission per battle, enemies that grow with the run, Scrap and CP from the centre only,
// and detachments priced by their Detachment Points.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoList } from './autoList';
import { afterBattle, applyCampaign, campaignMission, detachmentScrapCost, enter, enemyDetachmentCount, enemyDetachments, newRun, type Run } from './campaign';
import { enemyTree, enemyTreePoints, treeFor } from './campaignTree';
import { MISSIONS, primaryById } from './config';
import { campaignRequisition, createGame } from './game';
import { applyMortalWounds, CAMPAIGN_KILL_VP } from './attack';
import type { FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

describe('campaign battles', () => {
  it('each battle plays one of the official primaries, some with actions, the same one for the same node', () => {
    const run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    const fights = run.map.filter((n) => n.enemy);
    const names = new Set(fights.map((n) => campaignMission(n).primary.id));
    expect(names.size).toBeGreaterThan(1);
    for (const n of fights) {
      const m = campaignMission(n);
      expect(MISSIONS.primaries).toContain(m.primary);
      expect(campaignMission(n).primary.id).toBe(m.primary.id);
      const s = createGame({ lists: [run.list, autoList(ORK, 500, 1)], factions: [SM, ORK], names: ['You', 'Orks'], dispositions: m.dispositions, secondaryMode: 'none', maxRounds: 3, seed: n.enemy!.seed });
      applyCampaign(s, { ...run, fighting: n.id }, n.enemy!.rules);
      expect(primaryById(s.players[0].primaryId).id).toBe(m.primary.id);
    }
    expect(MISSIONS.primaries.filter((p) => p.action).length).toBeGreaterThan(5);
  });

  it('the enemy brings more detachments as the run goes on', () => {
    const early: Pick<Run, 'wins' | 'loop'> = { wins: 0, loop: 1 };
    expect(enemyDetachmentCount(early, 'battle')).toBe(1);
    expect(enemyDetachmentCount(early, 'boss')).toBe(2);
    expect(enemyDetachmentCount({ wins: 6, loop: 1 }, 'battle')).toBe(3);
    expect(enemyDetachmentCount({ wins: 9, loop: 3 }, 'boss')).toBe(4);
    const own = autoList(ORK, 1000, 2).detachments;
    const dets = enemyDetachments(ORK, own, 3, 7);
    expect(dets.length).toBe(3);
    expect(dets[0]).toBe(own[0]);
    expect(new Set(dets).size).toBe(3);
  });

  it("the enemy's army tree grows with the player's and lands on its units", () => {
    expect(enemyTreePoints(5, 'battle')).toBe(5);
    expect(enemyTreePoints(5, 'elite')).toBe(8);
    expect(enemyTreePoints(5, 'boss')).toBe(11);
    const t = enemyTree('ORK', 12, 99);
    expect(t.length).toBe(12);
    // every node taken links to the start through other taken ones
    const nodes = treeFor('ORK'), got = new Set(['start', ...t]);
    for (const id of t) expect(nodes.find((n) => n.id === id)!.links.some((l) => got.has(l))).toBe(true);

    const base = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    const node = base.map.find((n) => n.kind === 'boss')!;
    const run = { ...base, fighting: node.id, tree: treeFor('SM').slice(1, 9).map((n) => n.id) };
    const s = createGame({ lists: [run.list, autoList(ORK, 500, 1)], factions: [SM, ORK], names: ['You', 'Orks'], secondaryMode: 'none', maxRounds: 5, seed: node.enemy!.seed });
    applyCampaign(s, run, []);
    expect(s.units.filter((u) => u.owner === 1).some((u) => (u.timed ?? []).length > 0)).toBe(true);
  });

  it('only the centre objective gives extra Scrap and CP; holding others gives nothing', () => {
    const run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    const node = run.map.find((n) => n.enemy)!;
    const s = createGame({ lists: [run.list, autoList(ORK, 500, 1)], factions: [SM, ORK], names: ['You', 'Orks'], secondaryMode: 'none', maxRounds: 3, seed: 3, dispositions: campaignMission(node).dispositions });
    expect(s.objectives.some((o) => o.type === 'central')).toBe(true);
    const take = (central: boolean) => { for (const o of s.objectives) o.controller = (o.type === 'central') === central ? 0 : null; };
    take(false);
    let scrap = s.campaignScrap ?? 0, cp = s.players[0].cp;
    campaignRequisition(s);
    expect([(s.campaignScrap ?? 0) - scrap, s.players[0].cp - cp]).toEqual([25, 0]);
    take(true);
    scrap = s.campaignScrap ?? 0; cp = s.players[0].cp;
    campaignRequisition(s);
    expect([(s.campaignScrap ?? 0) - scrap, s.players[0].cp - cp]).toEqual([45, 1]);
  });

  it('detachments cost more Scrap the more Detachment Points they take', () => {
    expect(detachmentScrapCost({ dp: 1 })).toBeLessThan(detachmentScrapCost({ dp: 2 }));
    expect(detachmentScrapCost({ dp: 2 })).toBeLessThan(detachmentScrapCost({ dp: 3 }));
  });
});

describe('campaign nodes and defeats', () => {
  it('the Munitorum Depot gives Scrap and a pick of two units or a relic', () => {
    let run = newRun(SM, autoList(SM, 500, 2), ['ORK'], 2);
    const node = run.map[0];
    run = { ...run, map: run.map.map((n) => (n === node ? { ...n, kind: 'armory' as const, enemy: undefined } : n)) };
    const next = enter(run, node.id, SM);
    expect(next.scrap).toBe((run.scrap ?? 0) + 25);
    expect(next.offer?.map((o) => o.kind)).toEqual(['unit', 'unit', 'relic']);
  });

  it('a defeat costs a Fate point, still pays Renown and salvage, and says so', () => {
    let run = newRun(SM, autoList(SM, 500, 3), ['ORK'], 3);
    run = enter(run, run.map.find((n) => n.enemy)!.id, SM);
    const lost = afterBattle(run, 1, SM, 'Orks', 80);
    expect(lost.fate).toBe(run.fate - 1);
    expect(lost.renown).toBe((run.renown ?? 0) + 1);
    expect(lost.scrap).toBe((run.scrap ?? 0) + 40);
    expect(lost.story.at(-1)).toMatch(/-1 Fate, \+1 Renown, \+40 Scrap/);
  });
});

describe('campaign kills', () => {
  it('a destroyed unit gives its killer a little VP (2 for characters, vehicles, monsters), capped below the primary', () => {
    const run = newRun(SM, autoList(SM, 1000, 5), ['ORK'], 5);
    const node = run.map.find((n) => n.enemy)!;
    const s = createGame({ lists: [run.list, autoList(ORK, 1000, 5)], factions: [SM, ORK], names: ['You', 'Orks'], secondaryMode: 'none', maxRounds: 3, seed: 5, dispositions: campaignMission(node).dispositions });
    applyCampaign(s, { ...run, fighting: node.id }, []);
    const orks = s.units.filter((u) => u.owner === 1);
    let want = 0;
    for (const u of orks) {
      const big = ['CHARACTER', 'VEHICLE', 'MONSTER'].some((k) => (u.keywords ?? []).includes(k));
      applyMortalWounds(s, u, 999, 'test');
      if (u.status === 'destroyed') want = Math.min(CAMPAIGN_KILL_VP, want + (big ? 2 : 1));
      expect(s.players[0].vp).toBe(want);
    }
    expect(want).toBeGreaterThan(3);
    expect(s.players[0].vp).toBe(Math.min(CAMPAIGN_KILL_VP, want));
    expect(CAMPAIGN_KILL_VP).toBeLessThan(45);
    // outside the campaign a kill scores nothing by itself
    const plain = createGame({ lists: [run.list, autoList(ORK, 1000, 5)], factions: [SM, ORK], names: ['You', 'Orks'], secondaryMode: 'none', seed: 5 });
    applyMortalWounds(plain, plain.units.find((u) => u.owner === 1)!, 999, 'test');
    expect(plain.players[0].vp).toBe(0);
  });
});

describe('mission actions for the player', () => {
  it('Pick the best actions for me starts what the bot would: an action in reach where shooting is worth less', async () => {
    const { autoActions } = await import('../ai/bot');
    const { actionOptions } = await import('./missions');
    const pr = MISSIONS.primaries.find((p) => p.id === 'secure-asset')!;
    const s = createGame({ lists: [autoList(SM, 500, 3), autoList(ORK, 500, 3)], factions: [SM, ORK], names: ['You', 'Orks'], secondaryMode: 'none', seed: 3, dispositions: [pr.forceDisposition, pr.vs] as never });
    // put a unit of ours on a non-home objective and move the game to our Shooting phase, enemies far away
    const o = s.objectives.find((x) => x.type !== 'home')!;
    const u = s.units.find((x) => x.owner === 0 && !(x.keywords ?? []).some((k) => ['AIRCRAFT', 'TITANIC', 'FORTIFICATION'].includes(k)))!;
    for (const [i, m] of u.models.entries()) { m.x = o.x + (i % 3) * 1.3; m.y = o.y + Math.floor(i / 3) * 1.3; }
    u.status = 'board';
    for (const e of s.units.filter((x) => x.owner === 1)) e.status = 'reserves' as never;
    Object.assign(s, { phase: 'shooting', active: 0, round: 2, turn: 3 });
    expect(actionOptions(s, 0).some((a) => a.unitId === u.id)).toBe(true);
    expect(autoActions(s, 0)).toBeGreaterThan(0);
    expect(s.pendingActions.some((a) => a.unitId === u.id) || s.players[0].mission.done.some((d) => d.unitId === u.id)).toBe(true);
  });
});
