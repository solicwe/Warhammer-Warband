import { describe, it, expect } from 'vitest';
import {
  cultBattleStart,
  cultAmbushCost,
  cultAmbushUnitDestroyed,
  cultAmbushCheckEnemyMoved,
  cultAmbushArrival,
} from './cult';
import type { GameState, ObjectiveState, PlayerId, UnitState } from '../engine/types';

function makeMockState(): GameState {
  return {
    turn: 1,
    round: 1,
    phase: 'command',
    active: 0 as PlayerId,
    firstPlayer: 0 as PlayerId,
    attackerPlayer: 0 as PlayerId,
    deploymentId: 'dawnOfWar',
    primaryId: 'takeAndHold',
    players: [
      {
        id: 0,
        name: 'Player 0 (Cult)',
        role: 'attacker',
        factionId: 'GC',
        detachments: [{ name: 'Host of Ascension', dp: 3 }],
        armyRules: [{ name: 'Cult Ambush' }],
        cp: 2,
        vp: 0,
        secVp: 0,
      },
      {
        id: 1,
        name: 'Player 1 (Enemy)',
        role: 'defender',
        factionId: 'SM',
        detachments: [{ name: 'Gladius Task Force', dp: 3 }],
        armyRules: [],
        cp: 2,
        vp: 0,
        secVp: 0,
      },
    ],
    units: [],
    objectives: [
      { id: 'obj1', label: '1', x: 10, y: 10, controller: 0 } as unknown as ObjectiveState,
      { id: 'obj2', label: '2', x: 22, y: 30, controller: 0 } as unknown as ObjectiveState,
      { id: 'obj3', label: '3', x: 34, y: 50, controller: 1 } as unknown as ObjectiveState,
    ],
    terrain: [],
    shockTests: [],
    log: [],
  } as unknown as GameState;
}

function makeMockUnit(
  id: string,
  owner: PlayerId,
  name: string,
  keywords: string[],
  factionKeywords: string[],
  modelCount = 5,
  woundsPerModel = 1
): UnitState {
  const models = Array.from({ length: modelCount }, (_, i) => ({
    id: `${id}_m${i}`,
    name,
    x: 10 + i * 2,
    r: 0.5,
    y: 10,
    wounds: woundsPerModel,
    dead: false,
    profile: { M: 6, T: 4, Sv: 5, W: woundsPerModel, Ld: 7, OC: 1 },
    keywords: [...keywords],
  }));

  return {
    id,
    owner,
    name,
    status: 'board',
    sources: [name],
    startingStrength: modelCount,
    models,
    keywords,
    factionKeywords,
    abilities: [],
    buffs: [],
    rules: [],
    enhancements: [],
    weapons: [],
  } as unknown as UnitState;
}

describe('Genestealer Cults mechanics', () => {
  it('initializes Resurgence points at battle start', () => {
    const s = makeMockState();
    cultBattleStart(s);
    expect(s.players[0].resurgencePoints).toBeGreaterThan(0);
    expect(s.players[0].cultAmbushMarkers).toEqual([]);
  });

  it('calculates resurgence point cost correctly', () => {
    const neo = makeMockUnit('u1', 0, 'Neophyte Hybrids', ['INFANTRY'], ['GENESTEALER CULTS'], 20);
    expect(cultAmbushCost(neo)).toBe(6);

    const neoSmall = makeMockUnit('u2', 0, 'Neophyte Hybrids', ['INFANTRY'], ['GENESTEALER CULTS'], 10);
    expect(cultAmbushCost(neoSmall)).toBe(3);

    const aberrants = makeMockUnit('u3', 0, 'Aberrants', ['INFANTRY'], ['GENESTEALER CULTS'], 5);
    expect(cultAmbushCost(aberrants)).toBe(4);
  });

  it('handles cult ambush when a unit is destroyed', () => {
    const s = makeMockState();
    cultBattleStart(s);
    const initialPts = s.players[0].resurgencePoints!;

    const neo = makeMockUnit('u1', 0, 'Neophyte Hybrids', ['INFANTRY'], ['GENESTEALER CULTS'], 10);
    neo.abilities.push({ name: 'Cult Ambush', type: 'Faction', text: '' } as never);
    neo.models.forEach((m) => { m.dead = true; m.wounds = 0; });
    s.units.push(neo);

    cultAmbushUnitDestroyed(s, neo);

    expect(s.players[0].resurgencePoints).toBe(initialPts - 3);
    expect(neo.status).toBe('reserves');
    expect(neo.models.every((m) => !m.dead)).toBe(true);
    expect(s.players[0].cultAmbushMarkers?.length).toBe(1);
  });

  it('removes cult ambush markers when enemy models move within 8"', () => {
    const s = makeMockState();
    s.players[0].cultAmbushMarkers = [{ x: 20, y: 20 }];

    const enemy = makeMockUnit('e1', 1, 'Intercessors', ['INFANTRY'], ['ADEPTUS ASTARTES'], 5);
    enemy.models[0].x = 24;
    enemy.models[0].y = 20; // 4" away, <= 8"

    cultAmbushCheckEnemyMoved(s, enemy);
    expect(s.players[0].cultAmbushMarkers?.length).toBe(0);
  });

  it('arrives from cult ambush marker at end of opponent movement', () => {
    const s = makeMockState();
    s.active = 1 as PlayerId; // Opponent turn
    s.players[0].cultAmbushMarkers = [{ x: 22, y: 30 }];

    const neo = makeMockUnit('u1', 0, 'Neophyte Hybrids', ['INFANTRY', 'CULT AMBUSH'], ['GENESTEALER CULTS'], 10);
    neo.status = 'reserves';
    neo.cultAmbush = true;
    s.units.push(neo);

    cultAmbushArrival(s);

    expect(neo.status).toBe('board');
    expect(neo.models[0].x).toBe(22);
    expect(neo.models[0].y).toBe(30);
    expect(s.players[0].cultAmbushMarkers?.length).toBe(0);
  });

});
