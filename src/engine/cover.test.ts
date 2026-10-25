// Benefit of cover (13.08): every model must qualify; a vehicle only gets it when terrain hides part of it.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, formationAt, placeUnit } from './game';
import { clearLosCache, hasCover } from './visibility';
import { PRESETS } from '../ui/presets';
import type { FactionData, GameState, Pt, TerrainPiece, UnitState } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
// the cover cache lives for one phase; these cases swap the terrain inside it
const at = (s: GameState, t: TerrainPiece[]) => { s.terrain = t; clearLosCache(); };
const put = (s: GameState, u: UnitState, p: Pt) => { placeUnit(s, u, formationAt(u, p)); u.status = 'board'; u.setUpTurn = -10; };
const ruin = (id: string, x0: number, y0: number, x1: number, y1: number) =>
  ({ id, kind: 'ruin', label: id, category: 'dense', height: 5, poly: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], walls: [] }) as unknown as TerrainPiece;

it('gives cover only when every model qualifies, and vehicles only behind terrain', () => {
  const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 42 });
  s.phase = 'shooting';
  s.active = 1;
  for (const u of s.units) u.status = 'reserves';
  const veh = s.units.find((u) => u.owner === 0 && u.keywords.includes('VEHICLE'))!;
  const inf = s.units.find((u) => u.owner === 0 && u.keywords.includes('INFANTRY') && u.models.length >= 5)!;
  const shooter = s.units.find((u) => u.owner === 1)!;
  put(s, shooter, { x: 22, y: 50 });
  const a = shooter.models[0];

  // a vehicle in the open, or with terrain beside / behind it, has no cover
  put(s, veh, { x: 22, y: 20 });
  at(s, []);
  expect(hasCover(s, a, veh)).toBe(false);
  at(s, [ruin('behind', 15, 5, 30, 14)]);
  expect(hasCover(s, a, veh)).toBe(false);
  at(s, [ruin('beside', 28, 15, 40, 25)]);
  expect(hasCover(s, a, veh)).toBe(false);
  // part of it hidden behind a ruin: cover (unit D in the rules diagram)
  at(s, [ruin('front', 10, 26, 21.5, 40)]);
  expect(hasCover(s, a, veh)).toBe(true);

  // infantry with only some models in a ruin: no cover; all of them in it: cover
  veh.status = 'reserves';
  put(s, inf, { x: 20, y: 20 });
  at(s, [ruin('half', 0, 10, 20, 30)]);
  expect(inf.models.some((m) => m.x < 20) && inf.models.some((m) => m.x > 20)).toBe(true);
  expect(hasCover(s, a, inf)).toBe(false);
  at(s, [ruin('all', 0, 10, 40, 30)]);
  expect(hasCover(s, a, inf)).toBe(true);
});
