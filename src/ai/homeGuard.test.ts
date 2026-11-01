// The bot keeps a unit on its home objective only when holding it scores: a kills-only mission or one that scores every
// objective except home leaves home empty, and never with an expensive unit.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, findPlacement, placeUnit } from '../engine/game';
import { armyPlan, homeScoresVp } from './botPlan';
import type { ArmyList, FactionData } from '../engine/types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const list = (f: string): ArmyList => ({ name: 't', factionId: f, battleSize: 'incursion', detachments: [], units: [
  { uid: 'a', datasheet: 'Redemptor Dreadnought', models: 1, pts: 195 }, { uid: 'b', datasheet: 'Intercessor Squad', models: 5, pts: 80 },
] });

it.each([['battlefield-dominance', true], ['meatgrinder', false], ['determined-acquisition', true]] as [string, boolean][])(
  'home counts for %s: %s', (primaryId, scores) => {
    const s = createGame({ lists: [list('SM'), list('SM')], factions: [load('SM'), load('SM')], names: ['A', 'B'], seed: 3, primaryId } as Parameters<typeof createGame>[0]);
    s.players[0].primaryId = primaryId;
    s.players[0].secActive = []; // the primary alone (a card like Defend Stronghold does make home count)
    expect(homeScoresVp(s, 0)).toBe(scores);
    for (const u of s.units) { const at = findPlacement(s, u, 'deploy'); if (at) placeUnit(s, u, at); }
    s.phase = 'movement'; s.round = 2;
    const homeJobs = [...armyPlan(s, 0).jobs.entries()].filter(([, j]) => j.role === 'home').map(([id]) => s.units.find((u) => u.id === id)!);
    if (!scores) expect(homeJobs).toEqual([]);
    for (const u of homeJobs) expect(u.pts).toBeLessThanOrEqual(160);
  });

it('a 230-point gun line is not parked on home, even when it is the only unit that could hold it', () => {
  const l: ArmyList = { name: 't', factionId: 'SM', battleSize: 'incursion', detachments: [], units: [
    { uid: 'a', datasheet: 'Hellblaster Squad', models: 10, pts: 230 }, { uid: 'b', datasheet: 'Redemptor Dreadnought', models: 1, pts: 195 },
  ] };
  const s = createGame({ lists: [l, l], factions: [load('SM'), load('SM')], names: ['A', 'B'], seed: 3, primaryId: 'battlefield-dominance' } as Parameters<typeof createGame>[0]);
  s.players[0].primaryId = 'battlefield-dominance';
  for (const u of s.units) { const at = findPlacement(s, u, 'deploy'); if (at) placeUnit(s, u, at); }
    s.phase = 'movement'; s.round = 2;
  const homeJobs = [...armyPlan(s, 0).jobs.values()].filter((j) => j.role === 'home');
  expect(homeJobs).toEqual([]);
});
it('in Assault mode, cheapest unit holds home while unsecured if home scores VP, and joins assault once secured', () => {
  const l: ArmyList = { name: 't', factionId: 'SM', battleSize: 'incursion', detachments: [], units: [
    { uid: 'a', datasheet: 'Redemptor Dreadnought', models: 1, pts: 195 },
    { uid: 'b', datasheet: 'Intercessor Squad', models: 5, pts: 80 },
  ] };
  const s = createGame({ lists: [l, l], factions: [load('SM'), load('SM')], names: ['A', 'B'], seed: 3, primaryId: 'battlefield-dominance' } as Parameters<typeof createGame>[0]);
  s.players[0].primaryId = 'battlefield-dominance';
  s.idleTactic = 'assault';
  for (const u of s.units) { const at = findPlacement(s, u, 'deploy'); if (at) placeUnit(s, u, at); }
  s.phase = 'movement'; s.round = 2;

  // 1. Home is not secured yet: cheapest unit (Intercessor Squad) holds home
  const plan1 = armyPlan(s, 0);
  const homeObj = s.objectives.find((o) => o.type === 'home' && o.owner === 0)!;
  const intercessor = s.units.find((u) => u.owner === 0 && u.name.includes('Intercessor'))!;
  const dread = s.units.find((u) => u.owner === 0 && u.name.includes('Dreadnought'))!;

  expect(plan1.jobs.get(intercessor.id)?.role).toBe('home');
  expect(plan1.jobs.get(intercessor.id)?.keep).toBe(true);
  expect(plan1.jobs.get(dread.id)?.role).toBe('hammer');

  // 2. Once home becomes secured (e.g. sticky effect triggered), in assault mode the unit joins hammer
  homeObj.secured = 0;
  const plan2 = armyPlan(s, 0);
  expect(plan2.jobs.get(intercessor.id)?.role).toBe('hammer');
  expect(plan2.jobs.get(dread.id)?.role).toBe('hammer');
});

it('smartPlacement prioritizes deploying a sticky unit on home from the start', () => {
  const l: ArmyList = { name: 't', factionId: 'AS', battleSize: 'incursion', detachments: [], units: [
    { uid: 'a', datasheet: 'Paragon Warsuits', models: 3, pts: 210 },
    { uid: 'b', datasheet: 'Battle Sisters Squad', models: 10, pts: 115 },
  ] };
  const s = createGame({ lists: [l, l], factions: [load('AS'), load('AS')], names: ['A', 'B'], seed: 3, primaryId: 'battlefield-dominance' } as Parameters<typeof createGame>[0]);
  s.players[0].primaryId = 'battlefield-dominance';

  const bss = s.units.find((u) => u.owner === 0 && u.name.includes('Battle Sisters'))!;
  const homeObj = s.objectives.find((o) => o.type === 'home' && o.owner === 0)!;

  const placement = findPlacement(s, bss, 'deploy');
  expect(placement).toBeDefined();
  if (placement) {
    placeUnit(s, bss, placement);
    // BSS should be placed right on or within 3" of home objective
    const onHome = bss.models.some((m) => Math.hypot(m.x - homeObj.x, m.y - homeObj.y) <= 3 + 1e-3);
    expect(onHome).toBe(true);
  }
});
