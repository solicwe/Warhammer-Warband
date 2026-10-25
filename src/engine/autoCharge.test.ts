import fs from 'node:fs';
import { expect, it } from 'vitest';
import { autoCharge, createGame, formationAt, placeUnit } from './game';
import { alive, unitDistance } from './state';
import { nextRandom } from './dice';
import type { ArmyList, FactionData, GameState } from './types';
const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM'), ORK = load('ORK');
const list = (f: string, units: [string, number, number][]): ArmyList => ({ name: 't', factionId: f, battleSize: 'incursion', detachments: [], units: units.map(([d, n, pts], i) => ({ uid: 'x' + i, datasheet: d, models: n, pts })) });
// A charge the dice allow is made by the auto-charge: straight lines that cross a wall or end on a model are routed
// and settled the way a dragged charge is (these legal setups failed before, leaving the unit where it stood)
function setup(att: string, n: number, seed: number) {
  const s: GameState = createGame({ lists: [list('SM', [[att, n, 100]]), list('ORK', [['Boyz', 10, 90]])], factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed });
  for (const u of s.units) u.status = 'reserves';
  s.round = 2; s.turn = 3; s.active = 0; s.phase = 'charge';
  const a = s.units.find((u) => u.owner === 0)!, t = s.units.find((u) => u.owner === 1)!;
  const r = () => nextRandom(s);
  const tc = { x: 6 + r() * 32, y: 10 + r() * 40 };
  const ang = r() * Math.PI * 2, d = 4 + r() * 6;
  placeUnit(s, t, formationAt(t, tc));
  placeUnit(s, a, formationAt(a, { x: tc.x + Math.cos(ang) * (d + 3), y: tc.y + Math.sin(ang) * (d + 3) }));
  a.declaredCharge = true; a.chargeTargets = [t.id]; a.chargeRoll = Math.ceil(unitDistance(a, t)) + 1;
  return { s, a, t };
}

it.each([['Assault Intercessor Squad', 10, 22], ['Terminator Squad', 5, 111]] as [string, number, number][])(
  '%s makes a charge the dice allow (setup %i, seed %i)', (att, n, seed) => {
    const { s, a, t } = setup(att, n, seed);
    expect(autoCharge(s, a, [t.id])).toBe(true);
    expect(alive(a).some((m) => alive(t).some((e) => Math.hypot(m.x - e.x, m.y - e.y) - m.r - e.r <= 1.01))).toBe(true);
  });
