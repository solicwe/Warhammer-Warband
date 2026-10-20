import { describe, it, expect } from 'vitest';
import { activateReanimation, necCommandEnd, reanimateWounds, resurrect } from './necrons';
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
        name: 'Player 0 (Necrons)',
        role: 'attacker',
        factionId: 'NEC',
        detachments: [{ name: 'Awakened Dynasty', dp: 3 }],
        armyRules: [{ name: 'Reanimation Protocols' }],
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
    y: 10,
    r: 0.63,
    wounds: woundsPerModel,
    dead: false,
    profile: { M: 5, T: 4, Sv: 4, W: woundsPerModel, Ld: 7, OC: 1 },
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

describe('Necrons Reanimation Protocols', () => {
  it('heals wounded models first, then returns destroyed models with 1 wound each', () => {
    const u = makeMockUnit('u1', 0, 'Lokhust Destroyers', ['MOUNTED'], ['NECRONS'], 3, 3);
    u.models[0].wounds = 2;
    u.models[2].dead = true;
    u.models[2].wounds = 0;
    expect(reanimateWounds(u, 3)).toBe(3);
    expect(u.models[0].wounds).toBe(3);
    expect(u.models[2].dead).toBe(false);
    expect(u.models[2].wounds).toBe(2);
  });

  it('activates at the end of the Command phase for units with the ability only', () => {
    const s = makeMockState();
    const warriors = makeMockUnit('u1', 0, 'Necron Warriors', ['INFANTRY', 'BATTLELINE'], ['NECRONS'], 10, 1);
    warriors.abilities = [{ name: 'Reanimation Protocols' }] as unknown as UnitState['abilities'];
    const other = makeMockUnit('u2', 0, 'Necron Warriors', ['INFANTRY'], ['NECRONS'], 10, 1);
    for (const u of [warriors, other]) { u.models[0].dead = true; u.models[1].dead = true; }
    s.units.push(warriors, other);
    necCommandEnd(s, 0);
    expect(warriors.models.filter((m) => !m.dead).length).toBeGreaterThan(8);
    expect(other.models.filter((m) => !m.dead).length).toBe(8);
  });

  it('Resurrection Orb: one unit per turn heals D6', () => {
    const s = makeMockState();
    const a = makeMockUnit('u1', 0, 'Lychguard', ['INFANTRY'], ['NECRONS'], 5, 2);
    const b = makeMockUnit('u2', 0, 'Lychguard', ['INFANTRY'], ['NECRONS'], 5, 2);
    a.models[0].dead = true; b.models[0].dead = true;
    s.units.push(a, b);
    expect(activateReanimation(s, a, 'D6')).toBeGreaterThan(0);
    expect(resurrect(s, a)).toBe(true);
    expect(resurrect(s, b)).toBe(false);
  });
});
