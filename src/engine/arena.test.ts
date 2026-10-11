// Bot arena: the live bot (src/engine/bot*.ts) plays the frozen baseline (src/engine/baseline, made by
// scripts/bot-baseline/snapshot.mjs) over many games, both sides of every matchup. Only runs with ARENA=1:
//   ARENA=1 ARENA_GAMES=12 npx vitest run src/engine/arena.test.ts
import fs from 'node:fs';
import { describe, it } from 'vitest';
import * as live from './bot';
import * as base from './baseline/bot';
import { createGame } from './game';
import type { DispositionId } from './config';
import type { ArmyList, FactionData, GameState, PlayerId } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const FACTIONS: Record<string, FactionData> = { SM: load('SM'), ORK: load('ORK') };
type Row = [string, number, number];
const list = (f: string, u: Row[]): ArmyList => ({ name: 't', factionId: f, battleSize: 'incursion', detachments: [], units: u.map(([d, n, p], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts: p })) });

const ARMIES: Record<string, () => ArmyList> = {
  'SM gunline': () => list('SM', [['Intercessor Squad', 10, 150], ['Hellblaster Squad', 5, 110], ['Redemptor Dreadnought', 1, 195], ['Eliminator Squad', 3, 85], ['Captain', 1, 80], ['Infiltrator Squad', 5, 100]]),
  'SM assault': () => list('SM', [['Assault Intercessor Squad', 10, 150], ['Bladeguard Veteran Squad', 3, 80], ['Infernus Squad', 5, 85], ['Ballistus Dreadnought', 1, 140], ['Chaplain', 1, 75], ['Scout Squad', 5, 70]]),
  'ORK horde': () => list('ORK', [['Boyz', 20, 180], ['Boyz', 10, 90], ['Warboss', 1, 100], ['Deff Dread', 1, 130], ['Mek Gunz', 1, 55], ['Stormboyz', 5, 65]]),
  'ORK mixed': () => list('ORK', [['Boyz', 10, 90], ['Nobz', 5, 105], ['Flash Gitz', 5, 80], ['Battlewagon', 1, 160], ['Big Mek', 1, 65], ['Gretchin', 10, 40]]),
};

/** Play one game: `liveSide` is run by the live bot, the other side by the baseline. */
export function playArena(armyA: string, armyB: string, seed: number, liveSide: PlayerId): { vp: [number, number]; steps: number } {
  const lists: [ArmyList, ArmyList] = [ARMIES[armyA](), ARMIES[armyB]()];
  // every pair of Force Dispositions (so every primary mission and all 45 layouts) comes up across seeds
  const D: DispositionId[] = ['take-and-hold', 'purge-the-foe', 'disruption', 'reconnaissance', 'priority-assets'];
  const dispositions: [DispositionId, DispositionId] = [D[seed % 5], D[Math.floor(seed / 5) % 5]];
  const s: GameState = createGame({ lists, factions: [FACTIONS[lists[0].factionId], FACTIONS[lists[1].factionId]], names: ['A', 'B'], seed, secondaryMode: 'tactical', dispositions });
  s.bots = [0, 1];
  let steps = 0;
  while (s.phase !== 'gameover' && steps < 12000) {
    steps++;
    const who = ([0, 1] as PlayerId[]).find((p) => live.botShouldAct(s, p));
    if (who === undefined) { live.botAct(s); continue; }
    const mod = who === liveSide ? live : base;
    if (!mod.botStep(s, who)) live.botAct(s);
  }
  const vp = ([0, 1] as PlayerId[]).map((p) => s.players[p].vp + s.players[p].secVp) as [number, number];
  return { vp, steps };
}

describe.skipIf(!process.env.ARENA)('bot arena', () => {
  it('live bot vs baseline', () => {
    const n = Number(process.env.ARENA_GAMES ?? 6);
    const names = Object.keys(ARMIES);
    let win = 0, loss = 0, draw = 0;
    const margins: number[] = [];
    const t0 = Date.now();
    for (let g = 0; g < n; g++) {
      for (const a of names) for (const b of names) {
        if (names.indexOf(b) < names.indexOf(a)) continue;
        for (const liveSide of [0, 1] as PlayerId[]) {
          const seed = Number(process.env.ARENA_SEED ?? 1000) + g * 37 + names.indexOf(a) * 7 + names.indexOf(b);
          const { vp } = playArena(a, b, seed, liveSide);
          const m = vp[liveSide] - vp[1 - liveSide];
          margins.push(m);
          if (m > 0) win++; else if (m < 0) loss++; else draw++;
        }
      }
    }
    const mean = margins.reduce((x, y) => x + y, 0) / margins.length;
    const sd = Math.sqrt(margins.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, margins.length - 1));
    const out = `games ${margins.length} · live W${win} D${draw} L${loss} · win rate ${((win + draw / 2) / margins.length * 100).toFixed(1)}% · VP margin ${mean.toFixed(1)} ± ${(1.96 * sd / Math.sqrt(margins.length)).toFixed(1)} (95%) · ${((Date.now() - t0) / 1000).toFixed(0)}s`;
    fs.writeFileSync(process.env.ARENA_OUT ?? 'arena-result.txt', out + '\n');
    if (process.env.ARENA_OUT) fs.writeFileSync(`${process.env.ARENA_OUT}.json`, JSON.stringify(margins));
  }, 3_600_000);
});
