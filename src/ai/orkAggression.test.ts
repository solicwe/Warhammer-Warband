import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGame, zoneOf } from '../engine/game';
import { botAct } from './bot';
import { centre } from './botEval';
import { pointInPoly } from '../engine/geometry';
import type { ArmyList, FactionData } from '../engine/types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

type Row = [string, number, number, Partial<{ embarkIn: string; attachTo: string; warlord: boolean }>?];
const list = (factionId: string, units: Row[]): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments: ['War Horde'],
  units: units.map(([d, n, pts, extra], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts, ...extra })),
});

describe('Ork bot aggressive movement and WAAAGH', () => {
  it('Ork bot units move out of their deployment zone towards midfield objectives and trigger Waaagh', () => {
    const s = createGame({
      lists: [
        list('ORK', [['Boyz', 10, 85], ['Nobz', 5, 105], ['Warboss', 1, 90, { attachTo: 'x1', warlord: true }]]),
        list('SM', [['Intercessor Squad', 5, 80], ['Captain', 1, 80, { warlord: true }]])
      ],
      factions: [ORK, SM],
      names: ['OrkBot', 'SpaceMarineBot'],
      deploymentId: 'take-and-hold-vs-purge-the-foe-3',
      dispositions: ['take-and-hold', 'take-and-hold'],
      seed: 42,
    });

    // Deploy both armies
    let steps = 0;
    while (s.phase === 'deploy' && steps < 100) {
      botAct(s);
      steps++;
    }

    expect(s.phase).not.toBe('deploy');

    // Run turns through movement phase of round 1 and round 2
    let orkUnitsMovedOut = false;
    const orkZone = zoneOf(s, 0);

    for (let i = 0; i < 200; i++) {
      if (s.round > 2) break;
      if (s.active === 0 && s.phase === 'movement') {
        botAct(s);
        // Check if any Ork unit has moved outside the deployment zone
        const orkUnits = s.units.filter((u) => u.owner === 0 && u.status === 'board');
        if (orkUnits.some((u) => !pointInPoly(centre(u), orkZone))) {
          orkUnitsMovedOut = true;
        }
      } else {
        botAct(s);
      }
    }

    expect(orkUnitsMovedOut).toBe(true);
    expect(s.players[0].waaaghUsed).toBe(true);
  });
});
