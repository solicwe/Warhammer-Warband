import fs from 'node:fs';
import { expect, it } from 'vitest';
import { autoApproach, chargeReach, createGame, formationAt, placeUnit, validateMove } from './game';
import { PRESETS } from '../ui/presets';
import { unitDistance } from './state';

// Owner decision (20 Nov 2026): a charge reaches base contact first, and only then is Engagement Range counted. A roll
// that stops 2" short of the target (the Engagement Range) does not make the charge.
it('a charge needs the rolled distance to reach the target\'s base, not only its Engagement Range', () => {
  const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));
  const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 5 });
  s.round = 2; s.turn = 2; s.phase = 'charge'; s.active = 0;
  s.terrain = s.terrain.filter((t) => t.objectiveId); s.terrain.forEach((t) => (t.walls = []));
  const A = s.units.find((u) => u.owner === 0)!, T = s.units.find((u) => u.owner === 1)!;
  placeUnit(s, T, formationAt(T, { x: 22, y: 20 }));
  placeUnit(s, A, formationAt(A, { x: 22, y: 20 + 7.93 + 8.2 }));
  const gap = unitDistance(A, T);
  const tries = (roll: number) => {
    A.chargeRoll = roll; A.declaredCharge = true;
    const paths = new Map(A.models.filter((m) => !m.dead).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y }]]));
    for (const [k, v] of autoApproach(s, A, [T], chargeReach(s, A, [T]))) paths.set(k, v);
    return validateMove(s, A, 'charge', paths, { targets: [T.id] });
  };
  expect(tries(Math.floor(gap) - 2).ok).toBe(false);
  expect(tries(Math.floor(gap) - 1).ok).toBe(false); // inside Engagement Range but not touching
  expect(tries(Math.ceil(gap) + 1).ok).toBe(true);
});
