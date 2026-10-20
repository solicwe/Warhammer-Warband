// An old save whose objectives were moved onto 3" circles gets them back on the terrain plate under each marker.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, sanitizeGameState } from './game';
import type { ArmyList, FactionData } from './types';

const SM = JSON.parse(fs.readFileSync('public/data/factions/SM.json', 'utf8')) as FactionData;
const list: ArmyList = { name: 't', factionId: 'SM', battleSize: 'strike', detachments: [], units: [] };

it('rebinds circle objectives to their plate on load', () => {
  const s = createGame({ lists: [list, list], factions: [SM, SM], names: ['A', 'B'], seed: 3 });
  const onPlate = s.objectives.filter((o) => s.terrain.find((t) => t.id === o.terrainId)?.kind !== 'objective-area');
  expect(onPlate.length).toBeGreaterThan(0);
  const want = new Map(onPlate.map((o) => [o.id, o.terrainId]));
  // what the old migration did: a 3" circle for every objective, plates unlinked
  for (const o of onPlate) {
    const t = s.terrain.find((x) => x.id === o.terrainId)!;
    delete t.objectiveId;
    s.terrain.push({ id: `obj-old-${o.id}`, kind: 'objective-area', label: 'old', category: 'exposed', height: 0, walls: [], obstacles: [], poly: [{ x: o.x - 3, y: o.y - 3 }, { x: o.x + 3, y: o.y - 3 }, { x: o.x + 3, y: o.y + 3 }, { x: o.x - 3, y: o.y + 3 }], objectiveId: o.id } as never);
    o.terrainId = `obj-old-${o.id}`;
  }
  sanitizeGameState(s);
  for (const o of onPlate) {
    expect(o.terrainId).toBe(want.get(o.id));
    expect(s.terrain.find((t) => t.id === o.terrainId)!.objectiveId).toBe(o.id);
  }
});
