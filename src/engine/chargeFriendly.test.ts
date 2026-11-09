import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGame, placeUnit, formationAt, validateMove, commitCharge, autoApproach } from './game';
import { isEngaged, alive } from './state';
import { buildFightPools } from './attack';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

function list(factionId: string, units: [string, number, number, string?][]): ArmyList {
  return {
    name: 't', factionId, battleSize: 'incursion', detachments: [],
    units: units.map(([d, n, pts, attachTo], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts, attachTo })),
  };
}

function game(): GameState {
  const s = createGame({
    lists: [list('SM', [['Intercessor Squad', 5, 80], ['Captain', 1, 80]]), list('ORK', [['Boyz', 10, 90], ['Warboss', 1, 100]])],
    factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
  });
  s.terrain = s.terrain.filter((t) => t.objectiveId);
  s.terrain.forEach((t) => (t.walls = []));
  return s;
}

function put(s: GameState, unitId: string, c: Pt) {
  const u = s.units.find((x) => x.id === unitId)!;
  placeUnit(s, u, formationAt(u, c));
  return u;
}

describe('charging behind friendly models in base contact with enemy', () => {
  it('allows a unit to charge behind a friendly model locked in base contact, and fight', () => {
    const s = game();
    s.round = 1; s.turn = 1; s.active = 0; s.phase = 'charge';
    const ork = put(s, 'p1-x0', { x: 30, y: 20 });
    const captain = put(s, 'p0-x1', { x: 28.5, y: 20 });
    const intercessors = put(s, 'p0-x0', { x: 20, y: 20 });
    intercessors.declaredCharge = true; intercessors.chargeRoll = 10;
    
    // Front intercessor placed in base contact behind Captain (x: ~27.1)
    const add = autoApproach(s, intercessors, [ork], 10);
    const paths = new Map(alive(intercessors).map((m) => [m.id, add.get(m.id) ?? [{ x: m.x, y: m.y }, { x: m.x, y: m.y }]]));
    const chk = validateMove(s, intercessors, 'charge', paths, { targets: [ork.id] });
    expect(chk.ok).toBe(true);
    expect(chk.errors).toEqual([]);
    
    commitCharge(s, intercessors, paths, [ork.id]);
    expect(isEngaged(s, intercessors)).toBe(true);
    
    // Verify fight pool eligibility
    const pools = buildFightPools(s, intercessors.id, ork.id);
    expect(pools.pools.length).toBeGreaterThan(0);
    expect(pools.error).toBeUndefined();
  });
});
