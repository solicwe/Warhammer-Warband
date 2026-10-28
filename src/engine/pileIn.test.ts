// Pile-in from 2" away: every unit makes its move and brings most models that can reach into the fight.
// It used to fail outright when a model held back by a wall was driven into by the one behind it, and each model only
// tried a few spots, so many that could reach engagement range stayed back.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { autoPileMove, createGame, formationAt, placeUnit } from './game';
import { alive } from './state';
import { nextRandom } from './dice';
import type { ArmyList, FactionData, GameState } from './types';
const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM'), ORK = load('ORK');
const list = (f: string, units: [string, number, number][]): ArmyList => ({ name: 't', factionId: f, battleSize: 'incursion', detachments: [], units: units.map(([d, n, pts], i) => ({ uid: 'x' + i, datasheet: d, models: n, pts })) });

it('pile-in moves every unit and brings most models that can reach into engagement range', () => {
  let moved = 0, reach = 0, engaged = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s: GameState = createGame({ lists: [list('SM', [['Assault Intercessor Squad', 10, 100]]), list('ORK', [['Boyz', 10, 90]])], factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed });
    for (const u of s.units) u.status = 'reserves';
    s.round = 2; s.turn = 3; s.active = 0; s.phase = 'fight';
    const a = s.units.find((u) => u.owner === 0)!, t = s.units.find((u) => u.owner === 1)!;
    const tc = { x: 10 + nextRandom(s) * 24, y: 14 + nextRandom(s) * 30 }, ang = nextRandom(s) * Math.PI * 2;
    placeUnit(s, t, formationAt(t, tc));
    placeUnit(s, a, formationAt(a, { x: tc.x + Math.cos(ang) * 14, y: tc.y + Math.sin(ang) * 14 }));
    const gapOf = (m: { x: number; y: number; r: number }) => Math.min(...alive(t).map((e) => Math.hypot(m.x - e.x, m.y - e.y) - m.r - e.r));
    while (Math.min(...alive(a).map(gapOf)) > 2) for (const m of alive(a)) { m.x -= Math.cos(ang) * 0.1; m.y -= Math.sin(ang) * 0.1; }
    reach += alive(a).filter((m) => gapOf(m) <= 4).length;
    s.fight = { step: 'pileIn', stepPlayer: 0, chooser: 0, eligible: [], fought: [], forcedNext: null, movedThisStep: [] };
    if (autoPileMove(s, a, 'pileIn')) moved++;
    engaged += alive(a).filter((m) => gapOf(m) <= 1.01).length;
  }
  expect(moved).toBe(40);
  expect(engaged / reach).toBeGreaterThan(0.65);
});
