// Bot self-play worker: plays the games of one job file, side A with one set of weights against side B with another,
// and writes each game's VP margin (A minus B). Run by scripts/tune.mjs; only runs with TUNE_JOB set.
import fs from 'node:fs';
import { describe, it } from 'vitest';
import * as live from './bot';
import * as base from './baseline/bot';
const { botAct } = live;
import { setBotWeights, type BotW } from './botWeights';
import { resetLookahead, setLookahead } from './botLook';
import type { DispositionId } from './config';
import { createGame } from './game';
import { autoList } from './autoList';
import { PRESETS } from '../ui/presets';
import type { ArmyList, FactionData, GameState, PlayerId } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
type Row = [string, number, number];
const list = (f: string, det: string, u: Row[]): ArmyList => ({ name: 't', factionId: f, battleSize: 'incursion', detachments: [det], units: u.map(([d, n, p], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts: p })) });

export const TUNE_ARMIES: Record<string, () => ArmyList> = {
  'SM gunline': () => list('SM', 'Gladius Task Force', [['Intercessor Squad', 10, 150], ['Hellblaster Squad', 5, 110], ['Redemptor Dreadnought', 1, 195], ['Eliminator Squad', 3, 85], ['Captain', 1, 80], ['Infiltrator Squad', 5, 100], ['Intercessor Squad', 5, 80]]),
  'SM assault': () => list('SM', 'Gladius Task Force', [['Assault Intercessor Squad', 10, 150], ['Bladeguard Veteran Squad', 3, 80], ['Infernus Squad', 5, 85], ['Ballistus Dreadnought', 1, 140], ['Chaplain', 1, 75], ['Scout Squad', 5, 70], ['Terminator Squad', 5, 170]]),
  'ORK horde': () => list('ORK', 'War Horde', [['Boyz', 20, 180], ['Boyz', 10, 90], ['Warboss', 1, 100], ['Deff Dread', 1, 130], ['Mek Gunz', 1, 55], ['Stormboyz', 5, 65], ['Nobz', 5, 105]]),
  'ORK mixed': () => list('ORK', 'War Horde', [['Boyz', 10, 90], ['Nobz', 5, 105], ['Flash Gitz', 5, 80], ['Battlewagon', 1, 160], ['Big Mek', 1, 65], ['Gretchin', 10, 40], ['Deff Dread', 1, 130]]),
};

export interface TuneGame { a: string; b: string; seed: number; sideA: PlayerId }
export interface TuneJob { games: TuneGame[]; wA: Partial<BotW>; wB: Partial<BotW>; out: string; baselineB?: boolean; look?: boolean }

const FACTIONS: Record<string, FactionData> = {};
const fac = (id: string) => (FACTIONS[id] ??= load(id));

/** An army by name: a hand-made tuning list, "auto:NEC" (a list made from the faction's data) or "preset:TS". */
function armyFor(key: string, seed: number): ArmyList {
  if (key.startsWith('auto:')) return autoList(fac(key.slice(5)), 1000, seed);
  if (key.startsWith('preset:')) return PRESETS[key.slice(7)];
  return TUNE_ARMIES[key]();
}

/** One game: the weights wA play `a` on side sideA, wB play `b` on the other side. Returns A's VP minus B's. */
export function playTune(g: TuneGame, wA: Partial<BotW>, wB: Partial<BotW>, baselineB = false, look = true): number {
  const sideB = (1 - g.sideA) as PlayerId;
  const lists = [] as ArmyList[];
  lists[g.sideA] = armyFor(g.a, g.seed); lists[sideB] = armyFor(g.b, g.seed);
  const D: DispositionId[] = ['take-and-hold', 'purge-the-foe', 'disruption', 'reconnaissance', 'priority-assets'];
  const s: GameState = createGame({
    lists: lists as [ArmyList, ArmyList], factions: [fac(lists[0].factionId), fac(lists[1].factionId)], names: ['A', 'B'], seed: g.seed,
    secondaryMode: 'tactical', dispositions: [D[g.seed % 5], D[Math.floor(g.seed / 5) % 5]],
  });
  s.bots = [0, 1];
  resetLookahead();
  setLookahead(look);
  setBotWeights(g.sideA, wA);
  setBotWeights(sideB, wB);
  try {
    let steps = 0;
    if (!baselineB) while (s.phase !== 'gameover' && steps < 12000) { botAct(s); steps++; }
    // A/B against the frozen baseline bot (src/engine/baseline): side B's decisions come from the old code
    else while (s.phase !== 'gameover' && steps < 12000) {
      steps++;
      const who = ([0, 1] as PlayerId[]).find((p) => live.botShouldAct(s, p));
      if (who === undefined) { botAct(s); continue; }
      const mod = who === g.sideA ? live : base;
      if (!mod.botStep(s, who)) botAct(s);
    }
  } finally { setBotWeights(0); setBotWeights(1); }
  const vp = (p: PlayerId) => s.players[p].vp + s.players[p].secVp;
  return vp(g.sideA) - vp(sideB);
}

describe.skipIf(!process.env.TUNE_JOB)('tune worker', () => {
  it('plays the job', () => {
    const job = JSON.parse(fs.readFileSync(process.env.TUNE_JOB!, 'utf8')) as TuneJob;
    const margins: (number | { error: string })[] = [];
    for (const g of job.games) {
      try { margins.push(playTune(g, job.wA, job.wB, job.baselineB, job.look ?? true)); } catch (e) { margins.push({ error: String(e) }); }
      fs.writeFileSync(`${job.out}.part`, JSON.stringify(margins)); // progress, for a long run
    }
    fs.writeFileSync(job.out, JSON.stringify(margins));
  }, 7_200_000);
});
