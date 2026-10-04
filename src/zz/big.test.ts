import fs from 'node:fs';
import { it } from 'vitest';
import * as live from '../engine/bot';
import { createGame } from '../engine/game';
import { autoAttach } from '../engine/army';
import { alive, onBoard, isEngaged } from '../engine/state';
import type { ArmyList, FactionData, GameState } from '../engine/types';
const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const F: Record<string, FactionData> = { SM: load('SM'), ORK: load('ORK') };
const list = (f: string, size: string, d: string[], u: [string, number, number][]): ArmyList => ({ name: 't', factionId: f, battleSize: size, detachments: d, units: u.map(([x, n, p], i) => ({ uid: `x${i}`, datasheet: x, models: n, pts: p })) });
it('big vs small', () => {
  const out: string[] = [];
  for (const seed of [3, 8, 13]) {
    const big = autoAttach(list('SM', 'strike-force', ['Gladius Task Force'], [['Intercessor Squad', 10, 150], ['Hellblaster Squad', 10, 220], ['Redemptor Dreadnought', 1, 195], ['Brutalis Dreadnought', 1, 160], ['Terminator Squad', 5, 170], ['Captain', 1, 80], ['Reiver Squad', 5, 80], ['Land Raider', 1, 240], ['Eliminator Squad', 3, 85], ['Assault Intercessor Squad', 10, 150], ['Gladiator Lancer', 1, 160], ['Lieutenant', 1, 65]]), F.SM);
    const small = autoAttach(list('ORK', 'incursion', ['War Horde'], [['Boyz', 20, 180], ['Warboss', 1, 100], ['Deff Dread', 1, 130], ['Stormboyz', 5, 65], ['Nobz', 10, 210], ['Mek Gunz', 3, 165], ['Lootas', 10, 160]]), F.ORK);
    const s: GameState = createGame({ lists: [big, small], factions: [F.SM, F.ORK], names: ['BIG', 'small'], seed, secondaryMode: 'tactical' });
    s.bots = [0, 1];
    let steps = 0;
    const idle = new Map<string, number>();
    let lastTurn = -1;
    while (s.phase !== 'gameover' && steps < 15000) {
      const before = new Map(s.units.map((u) => [u.id, alive(u).map((m) => `${m.x.toFixed(1)},${m.y.toFixed(1)}`).join(';')]));
      steps++; live.botAct(s);
      if (s.turn !== lastTurn && s.phase === 'command') {
        lastTurn = s.turn;
      }
      void before;
    }
    // per unit, how many of its own movement phases it stayed put while not engaged
    const pts = (p: 0 | 1) => s.units.filter((u) => u.owner === p).reduce((a, u) => a + u.pts, 0);
    out.push(`seed ${seed}: BIG(${pts(0)}) ${s.players[0].vp}+${s.players[0].secVp} vs small(${pts(1)}) ${s.players[1].vp}+${s.players[1].secVp} | big alive ${s.units.filter((u) => u.owner === 0 && alive(u).length).length}/${s.units.filter((u) => u.owner === 0).length} small alive ${s.units.filter((u) => u.owner === 1 && alive(u).length).length}/${s.units.filter((u) => u.owner === 1).length}`);
    out.push(...s.log.filter((l) => /ไม่ขยับ|อยู่กับที่|Remain|stationary|ค้าง/i.test(l.text) && l.player === 0).slice(0, 8).map((l) => '   ' + l.text));
    void idle; void onBoard; void isEngaged;
  }
  fs.writeFileSync('/tmp/claude-0/-home-user-Warhammer/4cd9d03b-1b09-5099-a597-52fb329d0ba9/scratchpad/big.txt', out.join('\n'));
}, 900000);
