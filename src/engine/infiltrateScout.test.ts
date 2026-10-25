// Infiltrators and Scouts don't stack: a unit set up outside its deployment zone by Infiltrators gets no Scout move.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, deployUnit, findPlacement, scoutsOf, zoneOf } from './game';
import { bodyWhollyInPoly } from './geometry';
import type { ArmyList, FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const list = (factionId: string, datasheet: string, models: number): ArmyList =>
  ({ name: 't', factionId, battleSize: 'incursion', detachments: [], units: [{ uid: 'x0', datasheet, models, pts: 70 }] });

it('a Scout Squad keeps its Scout move only when it deploys inside its zone', () => {
  const mk = () => {
    const s = createGame({ lists: [list('SM', 'Scout Squad', 5), list('ORK', 'Boyz', 10)], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 7 });
    const u = s.units.find((x) => x.owner === 0)!;
    s.deployTurn = 0;
    return { s, u, zone: zoneOf(s, 0) };
  };
  expect(scoutsOf(mk().s, mk().u)).toBeGreaterThan(0);

  // inside its own zone, even through the infiltrate path: still scouts
  {
    const { s, u, zone } = mk();
    const pos = findPlacement(s, u, 'deploy')!;
    expect(deployUnit(s, u.id, pos, 'infiltrate').ok).toBe(true);
    expect([...pos.values()].length).toBeGreaterThan(0);
    expect(u.models.every((m) => bodyWhollyInPoly(m, zone))).toBe(true);
    expect(scoutsOf(s, u)).toBeGreaterThan(0);
  }
  // set up outside it with Infiltrators: no Scout move
  {
    const { s, u, zone } = mk();
    const pos = findPlacement(s, u, 'infiltrate', undefined, (p) => [...p.values()].some((q) => !bodyWhollyInPoly({ ...u.models[0], ...q }, zone)))!;
    expect(pos).toBeTruthy();
    expect(deployUnit(s, u.id, pos, 'infiltrate').ok).toBe(true);
    expect(u.infiltrated).toBe(true);
    expect(scoutsOf(s, u)).toBe(0);
  }
});
