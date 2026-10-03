// Deployment: the bot (and the player's "place for me") picks spots that make sense instead of packing units in a row.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botAct } from './bot';
import { createGame } from './game';
import { baseDist } from './geometry';
import { alive, onBoard } from './state';
import type { ArmyList, FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const list = (f: string, u: [string, number, number][]): ArmyList => ({ name: 't', factionId: f, battleSize: 'incursion', detachments: [], units: u.map(([d, n, p], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts: p })) });

describe('smart deployment', () => {
  it('every unit is deployed, units are not packed against each other, and it stays quick', () => {
    const s = createGame({
      lists: [
        list('SM', [['Intercessor Squad', 10, 150], ['Hellblaster Squad', 5, 110], ['Redemptor Dreadnought', 1, 195], ['Assault Intercessor Squad', 5, 75], ['Captain', 1, 80]]),
        list('ORK', [['Boyz', 20, 180], ['Deff Dread', 1, 130], ['Mek Gunz', 1, 55], ['Warboss', 1, 100]]),
      ],
      factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 5,
    });
    s.bots = [0, 1];
    const t0 = Date.now();
    let steps = 0;
    while (s.phase === 'deploy' && steps < 200) { botAct(s); steps++; }
    const took = Date.now() - t0;
    expect(s.phase).not.toBe('deploy');
    for (const p of [0, 1] as const) {
      const us = s.units.filter((u) => u.owner === p && onBoard(u));
      expect(us.length).toBeGreaterThan(2);
      // units keep some room between them (not one long packed line)
      let touching = 0;
      for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
        const d = Math.min(...alive(us[i]).flatMap((a) => alive(us[j]).map((b) => baseDist(a, b))));
        if (d < 1) touching++;
      }
      expect(touching).toBeLessThanOrEqual(1);
    }
    expect(took).toBeLessThan(30000);
  });
});
