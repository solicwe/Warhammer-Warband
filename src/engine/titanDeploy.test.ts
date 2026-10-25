// Titans deploy: on a 44" x 90" table (3000+ points) and in a 12" deep long-edge zone, where a Warlord's
// footprint is wider than the zone, the bot still sets every Titan up on the battlefield.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { botAct } from '../ai/bot';
import { createGame, findPlacement } from './game';
import { LAYOUTS } from './config';
import type { ArmyList, FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const TL = load('TL'), ORK = load('ORK');
const titans = ['Warhound Titan', 'Reaver Titan', 'Warlord Titan', 'Warbringer Nemesis Titan'];
const lists = (name: string): [ArmyList, ArmyList] => [
  { name: 't', factionId: 'TL', battleSize: 'onslaught', detachments: [], units: [{ uid: 'x0', datasheet: name, models: 1, pts: 1000 }] },
  { name: 'o', factionId: 'ORK', battleSize: 'onslaught', detachments: [], units: [{ uid: 'y0', datasheet: 'Boyz', models: 10, pts: 90 }] },
];

it('finds a deployment spot for every Titan on every layout', () => {
  const misses: string[] = [];
  for (const name of titans) for (const l of LAYOUTS) {
    const s = createGame({ lists: lists(name), factions: [TL, ORK], names: ['A', 'B'], deploymentId: l.id, seed: 3 });
    if (!findPlacement(s, s.units.find((u) => u.owner === 0)!, 'deploy')) misses.push(`${name} on ${l.id}`);
  }
  expect(misses).toEqual([]);
});

it('the bot deploys a Warlord Titan in a 12" deep zone', () => {
  const s = createGame({ lists: lists('Warlord Titan'), factions: [TL, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-mirror-2', seed: 3 });
  for (let i = 0; i < 40 && s.phase === 'deploy'; i++) botAct(s);
  const titan = s.units.find((u) => u.owner === 0)!;
  expect(titan.status).toBe('board');
});
