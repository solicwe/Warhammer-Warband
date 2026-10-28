// Bikes on long oval bases (Outriders): they set up in the deployment zone and arrive from Strategic Reserves within
// 6" of an edge, laid along the edge in two rows when needed (they used to never arrive: the bot left them in reserve).
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, findPlacement, nudgePlacement, validatePlacement } from './game';
import type { ArmyList, FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM'), ORK = load('ORK');
const list = (factionId: string, datasheet: string, models: number): ArmyList => ({ name: 't', factionId, battleSize: 'strike', detachments: [], units: [{ uid: 'x', datasheet, models, pts: 100 }] });

it.each([[3, 1], [3, 2], [6, 1], [6, 2], [6, 3]])('%i Outriders (seed %i) deploy and arrive from Strategic Reserves', (n, seed) => {
  const s = createGame({ lists: [list('SM', 'Outrider Squad', n), list('ORK', 'Boyz', 10)], factions: [SM, ORK], names: ['A', 'B'], seed });
  const u = s.units.find((x) => x.owner === 0)!;
  const dep = findPlacement(s, u, 'deploy');
  expect(dep && validatePlacement(s, u, dep, 'deploy').ok).toBe(true);
  s.round = 2; s.turn = 3; s.active = 0; s.phase = 'movement'; u.status = 'reserves';
  const ing = findPlacement(s, u, 'ingress');
  expect(ing && validatePlacement(s, u, ing, 'ingress').ok).toBe(true);
});

it('a long base set down across a narrow gap turns to fit instead of being refused', () => {
  const s = createGame({ lists: [list('SM', 'Outrider Squad', 3), list('ORK', 'Boyz', 10)], factions: [SM, ORK], names: ['A', 'B'], seed: 1 });
  const u = s.units.find((x) => x.owner === 0)!;
  const pos = findPlacement(s, u, 'deploy')!;
  const m = u.models[0], p = pos.get(m.id)!, w = m.hw!;
  m.rot = 0;
  const wall = (x: number) => ({ a: { x, y: p.y - 4 }, b: { x, y: p.y + 4 } });
  s.terrain = [{ ...s.terrain[0], id: 'gap', category: 'light', poly: [], walls: [wall(p.x - w), wall(p.x + w)] }];
  expect(validatePlacement(s, u, pos, 'deploy').bad).toContain(m.id);
  const fixed = nudgePlacement(s, u, pos, 'deploy');
  expect(validatePlacement(s, u, fixed, 'deploy').bad).not.toContain(m.id);
  expect(Math.abs(Math.sin(m.rot!))).toBeGreaterThan(0.5);
});
