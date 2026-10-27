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
