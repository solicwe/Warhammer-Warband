// Fight phase choices: a melee weapon with several profiles fights with the one the player picked; a unit left with
// no enemy within 5" (its foe destroyed by another unit) is done on its own, one with an enemy near can Overrun.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { buildFightPools } from './attack';
import { canOverrun, createGame, endPileInStep, fightCandidates, formationAt, markFought, placeUnit } from './game';
import { alive, unitDistance } from './state';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM'), ORK = load('ORK');
const list = (f: string, units: [string, number, number][]): ArmyList => ({ name: 't', factionId: f, battleSize: 'incursion', detachments: [], units: units.map(([d, n, pts], i) => ({ uid: 'x' + i, datasheet: d, models: n, pts })) });

function game(a: [string, number, number][], b: [string, number, number][]): GameState {
  const s = createGame({ lists: [list('SM', a), list('ORK', b)], factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 7 });
  s.terrain = []; // an open board
  for (const u of s.units) u.status = 'reserves';
  s.round = 2; s.turn = 3; s.active = 0; s.phase = 'fight';
  return s;
}
const put = (s: GameState, id: string, c: Pt) => { const u = s.units.find((x) => x.id === id)!; placeUnit(s, u, formationAt(u, c)); return u; };

it('a melee weapon with strike and sweep fights with the profile picked', () => {
  const s = game([['Kaius Konorius', 1, 100]], [['Boyz', 10, 90]]);
  const boyz = put(s, 'p1-x0', { x: 22, y: 30 });
  const k = put(s, 'p0-x0', { x: 22, y: 25 });
  const near = alive(boyz).sort((a, b) => a.y - b.y)[0];
  k.models[0].x = near.x; k.models[0].y = near.y - near.r - k.models[0].r - 0.2;
  const w = k.models[0].weapons.find((x) => x.profiles.length > 1 && x.profiles[0].range === 'Melee')!;
  expect(w.profiles.map((p) => p.name)).toEqual(['strike', 'sweep']);
  expect(buildFightPools(s, k.id, boyz.id).pools[0].profile.name).toBe('strike');
  expect(buildFightPools(s, k.id, boyz.id, { profile: { [w.name]: 1 } }).pools[0].profile.name).toBe('sweep');
});

it('a unit whose foe was destroyed is done on its own when no enemy is within 5", and may Overrun when one is', () => {
  const s = game([['Intercessor Squad', 5, 80], ['Intercessor Squad', 5, 80]], [['Boyz', 10, 90], ['Boyz', 10, 90]]);
  const foe = put(s, 'p1-x0', { x: 22, y: 30 });
  const a = put(s, 'p0-x0', { x: 22, y: 26.4 });
  const b = put(s, 'p0-x1', { x: 22, y: 33.6 });
  const far = put(s, 'p1-x1', { x: 22, y: 50 });
  s.fight = { step: 'pileIn', stepPlayer: 0, chooser: 0, eligible: [], fought: [], forcedNext: null, movedThisStep: [] };
  endPileInStep(s); endPileInStep(s);
  expect(s.fight.eligible).toEqual(expect.arrayContaining([a.id, b.id, foe.id]));
  // a wipes the foe out
  for (const m of foe.models) m.dead = true;
  foe.status = 'destroyed';
  markFought(s, a);
  // b has no enemy within 5": done without anyone picking it, so the fight step ends
  expect(canOverrun(s, b)).toBe(false);
  expect(s.fight.fought).toContain(b.id);
  expect(fightCandidates(s).units).toEqual([]);
  expect(s.fight.step).toBe('consolidate');

  // the same, with another enemy 4" away: b may Overrun, so it is still to pick
  const s2 = game([['Intercessor Squad', 5, 80], ['Intercessor Squad', 5, 80]], [['Boyz', 10, 90], ['Boyz', 10, 90]]);
  const foe2 = put(s2, 'p1-x0', { x: 22, y: 30 });
  const a2 = put(s2, 'p0-x0', { x: 22, y: 26.4 });
  const b2 = put(s2, 'p0-x1', { x: 22, y: 33.6 });
  const near2 = put(s2, 'p1-x1', { x: 22, y: 50 });
  while (unitDistance(b2, near2) > 4) for (const m of near2.models) m.y -= 0.1; // 4" away: beyond engagement, within 5"
  s2.fight = { step: 'pileIn', stepPlayer: 0, chooser: 0, eligible: [], fought: [], forcedNext: null, movedThisStep: [] };
  endPileInStep(s2); endPileInStep(s2);
  for (const m of foe2.models) m.dead = true;
  foe2.status = 'destroyed';
  markFought(s2, a2);
  expect(canOverrun(s2, b2)).toBe(true);
  expect(fightCandidates(s2).units.map((u) => u.id)).toEqual([b2.id]);
  expect(unitDistance(b, far)).toBeGreaterThan(5);
});
