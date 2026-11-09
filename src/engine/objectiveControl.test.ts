import { describe, expect, it } from 'vitest';
import { levelOfControl, updateControl, assignedObjective, unitTouchedObjectives } from './game';
import type { GameState, UnitState } from './types';

function makeMockGame(): GameState {
  return {
    version: 3,
    round: 1,
    turn: 1,
    active: 0,
    phase: 'command',
    players: [
      { name: 'P1', score: 0, cp: 0, vp: 0, secVp: 0, secActive: [], secDone: [] },
      { name: 'P2', score: 0, cp: 0, vp: 0, secVp: 0, secActive: [], secDone: [] },
    ],
    units: [],
    terrain: [
      { id: 't1', kind: 'objective-area', poly: [{ x: 10, y: 10 }, { x: 16, y: 10 }, { x: 16, y: 16 }, { x: 10, y: 16 }] },
      { id: 't2', kind: 'objective-area', poly: [{ x: 20, y: 10 }, { x: 26, y: 10 }, { x: 26, y: 16 }, { x: 20, y: 16 }] },
    ],
    objectives: [
      { id: 'obj1', type: 'central', x: 13, y: 13, terrainId: 't1', terrainIds: ['t1'], controller: null },
      { id: 'obj2', type: 'central', x: 23, y: 13, terrainId: 't2', terrainIds: ['t2'], controller: null },
    ],
    rng: 12345,
    controlAtTurnStart: [null, null],
    log: [],
    winner: null,
  } as unknown as GameState;
}

function makeUnit(id: string, owner: 0 | 1, models: { x: number; y: number; oc?: number }[]): UnitState {
  return {
    id,
    owner,
    name: `Unit ${id}`,
    status: 'board',
    keywords: ['INFANTRY'],
    factionKeywords: [],
    abilities: [],
    core: {},
    pts: 100,
    startingStrength: models.length,
    weaponsFired: [],
    cantCharge: false,
    models: models.map((m, idx) => ({
      id: `${id}_m${idx}`,
      name: 'Model',
      x: m.x,
      y: m.y,
      r: 0.6,
      wounds: 1,
      dead: false,
      profile: { M: 6, T: 4, Sv: 3, W: 1, Ld: 7, OC: m.oc ?? 2 },
      weapons: [],
      source: 'Datasheet',
    })),
  } as unknown as UnitState;
}

describe('Single-objective contesting when spanning multiple objectives', () => {
  it('assigns to the objective with strictly more models', () => {
    const s = makeMockGame();
    // 3 models on obj1 (x=13), 1 model on obj2 (x=23)
    const u = makeUnit('u1', 0, [
      { x: 13, y: 13 },
      { x: 14, y: 13 },
      { x: 15, y: 13 },
      { x: 23, y: 13 },
    ]);
    s.units = [u];

    const touched = unitTouchedObjectives(s, u);
    expect(touched).toHaveLength(2);

    // Should choose obj1 because it has 3 models vs 1
    const chosen = assignedObjective(s, u);
    expect(chosen).toBe('obj1');

    // Level of control: obj1 gets OC (3 models * 2 OC = 6), obj2 gets 0
    const [a1, b1] = levelOfControl(s, s.objectives[0]);
    const [a2, b2] = levelOfControl(s, s.objectives[1]);
    expect(a1).toBe(6);
    expect(b1).toBe(0);
    expect(a2).toBe(0);
    expect(b2).toBe(0);

    updateControl(s);
    expect(s.objectives[0].controller).toBe(0);
    expect(s.objectives[1].controller).toBeNull();
  });

  it('if model counts are tied, but our side already controls one (secured), it assigns to the other', () => {
    const s = makeMockGame();
    // obj1 is sticky/secured by player 0
    s.objectives[0].secured = 0;
    s.objectives[0].controller = 0;

    // Unit has 2 models on obj1 and 2 models on obj2 (tied at 2 models each)
    const u = makeUnit('u1', 0, [
      { x: 13, y: 13 },
      { x: 14, y: 13 },
      { x: 23, y: 13 },
      { x: 24, y: 13 },
    ]);
    s.units = [u];

    // Tied models: should pick obj2 because player 0 already secured obj1
    const chosen = assignedObjective(s, u);
    expect(chosen).toBe('obj2');

    const [a2, b2] = levelOfControl(s, s.objectives[1]);
    expect(a2).toBe(4); // 2 models * 2 OC

    updateControl(s);
    // Now player 0 controls both: obj1 was sticky secured, and u1 captures obj2!
    expect(s.objectives[0].controller).toBe(0);
    expect(s.objectives[1].controller).toBe(0);
  });

  it('if model counts are tied, but another friendly unit is holding obj1, it assigns to obj2', () => {
    const s = makeMockGame();
    // Another friendly squad is on obj1
    const ally = makeUnit('ally', 0, [{ x: 13, y: 13 }]);
    // u1 has 2 models on obj1 and 2 models on obj2 (tied)
    const u1 = makeUnit('u1', 0, [
      { x: 12, y: 12 },
      { x: 13, y: 12 },
      { x: 23, y: 13 },
      { x: 24, y: 13 },
    ]);
    s.units = [ally, u1];

    const chosen = assignedObjective(s, u1);
    expect(chosen).toBe('obj2');

    updateControl(s);
    expect(s.objectives[0].controller).toBe(0);
    expect(s.objectives[1].controller).toBe(0);
  });

  it('if there is only one squad on neutral objectives with equal models, it only controls ONE', () => {
    const s = makeMockGame();
    const u = makeUnit('u1', 0, [
      { x: 13, y: 13 },
      { x: 23, y: 13 },
    ]);
    s.units = [u];

    const chosen = assignedObjective(s, u);
    expect(['obj1', 'obj2']).toContain(chosen);

    updateControl(s);
    const controlledCount = s.objectives.filter((o) => o.controller === 0).length;
    // Exactly ONE objective controlled! Not both!
    expect(controlledCount).toBe(1);
  });

  it('respects manual assignedObjective override by player', () => {
    const s = makeMockGame();
    // 3 models on obj1, 1 model on obj2
    const u = makeUnit('u1', 0, [
      { x: 13, y: 13 },
      { x: 14, y: 13 },
      { x: 15, y: 13 },
      { x: 23, y: 13 },
    ]);
    // Player manually overrides to obj2
    u.assignedObjective = 'obj2';
    s.units = [u];

    const chosen = assignedObjective(s, u);
    expect(chosen).toBe('obj2');

    const [a1] = levelOfControl(s, s.objectives[0]);
    const [a2] = levelOfControl(s, s.objectives[1]);
    expect(a1).toBe(0);
    expect(a2).toBe(2); // 1 model on obj2
  });
});
