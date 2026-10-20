import { describe, it, expect } from 'vitest';
import { whollyHallowed } from './greyKnights';
import type { GameState, ObjectiveState, PlayerId, UnitState } from '../engine/types';

function makeMockState(): GameState {
  return {
    turn: 1,
    round: 1,
    phase: 'fight',
    active: 1 as PlayerId, // Opponent's turn ending
    firstPlayer: 0 as PlayerId,
    attackerPlayer: 0 as PlayerId,
    deploymentId: 'dawnOfWar',
    primaryId: 'takeAndHold',
    players: [
      {
        id: 0,
        name: 'Player 0 (Grey Knights)',
        role: 'attacker',
        factionId: 'GK',
        detachments: [{ name: 'Warpbane Task Force', dp: 3 }],
        armyRules: [{ name: 'Gate of Infinity' }],
        cp: 2,
        vp: 0,
        secVp: 0,
      },
      {
        id: 1,
        name: 'Player 1 (Enemy)',
        role: 'defender',
        factionId: 'CD',
        detachments: [{ name: 'Daemonic Incursion', dp: 3 }],
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
  woundsPerModel = 2
): UnitState {
  const models = Array.from({ length: modelCount }, (_, i) => ({
    id: `${id}_m${i}`,
    name,
    x: 10 + i * 2,
    y: 10,
    r: 0.63,
    wounds: woundsPerModel,
    dead: false,
    profile: { M: 5, T: 4, Sv: 2, W: woundsPerModel, Ld: 6, OC: 2 },
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
    core: {},
    abilities: [],
    buffs: [],
    rules: [],
    enhancements: [],
    weapons: [],
  } as unknown as UnitState;
}

describe('Grey Knights Hallowed Ground', () => {
  it('No Man\'s Land is Hallowed Ground only with half its objectives; 6" around a Purifier Squad always is', () => {
    const s = makeMockState();
    s.objectives.forEach((o) => { o.controller = 1; });
    const strike = makeMockUnit('u1', 0, 'Strike Squad', ['INFANTRY', 'GREY KNIGHTS'], ['GREY KNIGHTS'], 1);
    strike.models[0].x = 22; strike.models[0].y = 30;
    s.units.push(strike);
    expect(whollyHallowed(s, strike)).toBe(false);
    const purifiers = makeMockUnit('u2', 0, 'Purifier Squad', ['INFANTRY', 'PURIFIER SQUAD'], ['GREY KNIGHTS'], 1);
    purifiers.models[0].x = 24; purifiers.models[0].y = 30;
    s.units.push(purifiers);
    expect(whollyHallowed(s, strike)).toBe(true);
  });
});
