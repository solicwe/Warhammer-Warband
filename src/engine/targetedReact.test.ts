// "Just after an enemy unit has selected its targets": the defender's reactions answer before any dice.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildShootPools, startAttack } from './attack';
import { createGame, formationAt, placeUnit } from './game';
import '../rules-engine/stratagems';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const list = (factionId: string, units: [string, number, number][], detachments: string[] = []): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments, units: units.map(([d, n, pts], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts })),
});

function game(): GameState {
  const s = createGame({
    lists: [list('TYR', [['Termagants', 20, 120]], ['Unending Swarm']), list('ORK', [['Boyz', 10, 90]])], factions: [load('TYR'), load('ORK')], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 7,
  });
  s.terrain = [];
  s.round = 2; s.turn = 2; s.phase = 'shooting'; s.active = 1;
  s.players[0].cp = 10; s.players[1].cp = 10;
  s.bots = [0];
  return s;
}
const put = (s: GameState, id: string, c: Pt) => { const u = s.units.find((x) => x.id === id)!; placeUnit(s, u, formationAt(u, c)); u.setUpTurn = -10; return u; };

describe('targeted reactions', () => {
  it('Preservation Imperative: the bot answers when its Termagants are selected as a target', () => {
    const s = game();
    const T = put(s, 'p0-x0', { x: 20, y: 30 });
    put(s, 'p1-x0', { x: 34, y: 30 });
    const r = buildShootPools(s, 'p1-x0', T.id, { mode: 'normal' });
    expect(r.error).toBeUndefined();
    startAttack(s, 'shoot', 'p1-x0', T.id, r.pools);
    expect((T.timed ?? []).some((t) => t.label === 'PRESERVATION IMPERATIVE')).toBe(true);
    expect(s.lastAct?.unitId).toBe('p1-x0'); // the attacker is the last enemy unit to act from target selection on
  });
});
