// Deployment: the bot (and the player's "place for me") picks spots that make sense instead of packing units in a row.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botAct } from './bot';
import { armyPlan } from './botPlan';
import { baitUnit } from './deploy';
import { createGame } from './game';
import { baseDist } from './geometry';
import { alive, onBoard } from './state';
import type { ArmyList, FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const list = (f: string, u: [string, number, number][]): ArmyList => ({ name: 't', factionId: f, battleSize: 'incursion', detachments: [], units: u.map(([d, n, p], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts: p })) });

describe('smart deployment', () => {
  it('a last unit that fits nowhere is dropped and deployment still ends (no hang)', () => {
    const s = createGame({
      lists: [list('SM', [['Intercessor Squad', 5, 80], ['Captain', 1, 80]]), list('ORK', [['Boyz', 10, 80]])],
      factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 2,
    });
    s.bots = [0, 1];
    // too big for the board and too costly for Strategic Reserves
    const cap = s.units.find((u) => u.owner === 0 && u.name === 'Captain')!;
    cap.pts = 99999;
    for (const m of cap.models) m.r = 40;
    let steps = 0;
    while (s.phase === 'deploy' && steps < 200) { botAct(s); steps++; }
    expect(s.phase).not.toBe('deploy');
    expect(cap.status).toBe('destroyed');
  });

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
    expect(took).toBeLessThan(45000); // ~30s on a slow shared runner (the same before and after the army plan)
  });

  it('Gretchin are never sent out as bait: a sturdier squad is, and the Gretchin are kept on the home objective', () => {
    const s = createGame({
      lists: [
        list('SM', [['Intercessor Squad', 10, 150], ['Hellblaster Squad', 5, 110], ['Eliminator Squad', 3, 85], ['Captain', 1, 80]]),
        list('ORK', [['Gretchin', 10, 45], ['Boyz', 10, 85], ['Deff Dread', 1, 130], ['Nobz', 5, 105], ['Warboss', 1, 100]]),
      ],
      factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 5,
    });
    s.bots = [0, 1];
    expect(baitUnit(s, 1)?.name).toBe('Boyz');
    let steps = 0;
    while (s.phase === 'deploy' && steps < 200) { botAct(s); steps++; }
    const grots = s.units.find((u) => u.owner === 1 && u.name === 'Gretchin')!;
    const job = armyPlan(s, 1).jobs.get(grots.id);
    expect(job?.role).toBe('home');
    expect(job?.keep).toBe(true);
  });
});
