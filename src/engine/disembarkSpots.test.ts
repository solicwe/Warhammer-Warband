import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, disembarkSpots, embarkUnit, formationAt, placeUnit, validateDisembark } from './game';
import { pointSegDist } from './geometry';
import { alive } from './state';
import type { ArmyList } from './types';

// Owner, 21 Nov 2026: getting out next to walls was slow and could not turn round the transport. The legal spots are
// worked out once (`disembarkSpots`), none of them through a wall, in order round the hull.
const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));
const list = (f: string, units: [string, number, number][]): ArmyList => ({ name: 't', factionId: f, battleSize: 'strike', detachments: [], units: units.map(([d, n, pts], i) => ({ uid: 'x' + i, datasheet: d, models: n, pts })) } as never);

it('a squad boxed in by walls on three sides gets out on the open side, never through a wall', () => {
  const s = createGame({ lists: [list('SM', [['Impulsor', 1, 70], ['Intercessor Squad', 5, 85]]), list('ORK', [['Boyz', 10, 85]])], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 4 } as never);
  s.round = 2; s.turn = 2; s.phase = 'movement'; s.active = 0;
  const t = s.units.find((u) => u.transport)!, u = s.units.find((x) => x.owner === 0 && !x.transport)!, e = s.units.find((x) => x.owner === 1)!;
  t.status = 'board'; e.status = 'board';
  placeUnit(s, t, formationAt(t, { x: 20, y: 30 }));
  placeUnit(s, e, formationAt(e, { x: 20, y: 50 }));
  u.status = 'pending'; embarkUnit(s, u, t, true);
  const tm = alive(t)[0];
  const hw = (tm.hw ?? tm.r) + 1, hl = (tm.hl ?? tm.r) + 1;
  const walls = [{ a: { x: tm.x - 9, y: tm.y - hw }, b: { x: tm.x + 9, y: tm.y - hw } }, { a: { x: tm.x - 9, y: tm.y + hw }, b: { x: tm.x + 9, y: tm.y + hw } }, { a: { x: tm.x + hl, y: tm.y - 9 }, b: { x: tm.x + hl, y: tm.y + 9 } }];
  s.terrain = [{ id: 'w', kind: 'ruin', label: 'Ruin', category: 'dense', height: 4, walls, poly: [{ x: tm.x - 10, y: tm.y - 10 }, { x: tm.x + 10, y: tm.y - 10 }, { x: tm.x + 10, y: tm.y + 10 }, { x: tm.x - 10, y: tm.y + 10 }] }] as never;
  const spots = disembarkSpots(s, u, t);
  expect(spots.length).toBeGreaterThan(0);
  for (const pos of spots) {
    expect(validateDisembark(s, u, t, pos).ok).toBe(true);
    for (const m of alive(u)) for (const w of walls) expect(pointSegDist(pos.get(m.id)!, w)).toBeGreaterThan(m.r * 0.8);
  }
});
