import { describe, expect, it } from 'vitest';
import { rotateUnit, validateMove } from './game';
import { canDesignateDeathstrike, canFireDeathstrike, bestDeathstrikeSpot, deathstrikeWorth } from '../factions/deathstrike';
import { getUnitLoneOpRange, isHidden, modelVisible } from './visibility';
import type { GameState, ModelState, Pt, TerrainPiece, UnitState } from './types';

const P = (x: number, y: number): Pt => ({ x, y });

function makeModel(id: string, x: number, y: number, r = 1, keywords: string[] = ['VEHICLE'], hl = 1.5, hw = 0.8): ModelState {
  return {
    id,
    name: 'Model ' + id,
    x,
    y,
    r,
    hl,
    hw,
    rot: 0,
    wounds: 10,
    dead: false,
    keywords,
    weapons: [],
    profile: { M: 10, T: 10, Sv: 3, InSv: null, W: 10, Ld: 7, OC: 3 },
  } as unknown as ModelState;
}

function makeUnit(id: string, owner: 0 | 1, models: ModelState[], keywords: string[] = ['VEHICLE'], abilities: { name: string }[] = []): UnitState {
  return {
    id,
    name: 'Unit ' + id,
    owner,
    status: 'board',
    models,
    keywords,
    factionKeywords: ['ASTRA MILITARUM'],
    abilities,
    enhancements: [],
    buffs: [],
    pts: 150,
    startingStrength: models.length,
    oneShotUsed: [],
    used: {},
    core: {},
  } as unknown as UnitState;
}

function makeTerrain(id: string, poly: Pt[], height = 5, category: TerrainPiece['category'] = 'dense', walls: [Pt, Pt][] = []): TerrainPiece {
  return {
    id,
    kind: 'ruin',
    label: id,
    category,
    height,
    poly,
    walls: walls.map(([a, b]) => ({ a, b })),
  } as TerrainPiece;
}

function makeState(units: UnitState[], terrain: TerrainPiece[] = []): GameState {
  return {
    turn: 2,
    phase: 'shooting',
    active: 0,
    units,
    terrain,
    table: { width: 60, height: 44 },
    players: [
      { id: 0, name: 'P0', role: 'attacker', detachments: [], armyRules: [], flags: [] },
      { id: 1, name: 'P1', role: 'defender', detachments: [], armyRules: [], flags: [] },
    ],
  } as unknown as GameState;
}

describe('Vehicle and Oval Base Rotation (Pivot)', () => {
  it('rotates a vehicle hull by 45 degrees successfully', () => {
    const m = makeModel('m1', 20, 20, 1.2, ['VEHICLE'], 2, 1);
    const u = makeUnit('u1', 0, [m]);
    const s = makeState([u]);
    s.phase = 'movement';

    const res = rotateUnit(s, u.id, Math.PI / 4);
    expect(res.ok).toBe(true);
    expect(m.rot).toBeCloseTo(Math.PI / 4);
  });

  it('rejects rotation that causes overlap with another model', () => {
    const m1 = makeModel('m1', 20, 20, 1.5, ['VEHICLE'], 2.5, 1);
    const m2 = makeModel('m2', 20, 22.8, 1, ['INFANTRY'], 0, 0); // close above m1
    const u1 = makeUnit('u1', 0, [m1]);
    const u2 = makeUnit('u2', 1, [m2], ['INFANTRY']);
    const s = makeState([u1, u2]);
    s.phase = 'movement';

    // Initially facing 0 (horizontal), does not collide with m2 above
    // Turning 90 degrees (facing vertical) will collide with m2
    const res = rotateUnit(s, u1.id, Math.PI / 2);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('overlap');
  });
});

describe('Rules 13.06 - 13.11: Terrain, Movement, Hidden and Sight', () => {
  it('13.09 Hidden: restricts visibility beyond 15 inches', () => {
    const t = makeTerrain('t1', [P(10, 10), P(30, 10), P(30, 30), P(10, 30)], 5, 'dense');
    const hiddenModel = makeModel('m_inf', 15, 20, 0.63, ['INFANTRY'], 0, 0);
    const uTarget = makeUnit('u_inf', 1, [hiddenModel], ['INFANTRY']);
    uTarget.shotTurn = -10;

    const s = makeState([uTarget], [t]);

    expect(isHidden(s, uTarget, hiddenModel)).toBe(true);

    // Observer at 16 inches away (> 15")
    const observerFar = makeModel('obs_far', 31.5, 20, 0.63, ['INFANTRY'], 0, 0);
    expect(modelVisible(s, observerFar, uTarget, hiddenModel)).toBe(false);

    // Observer moves within 14 inches (<= 15")
    const observerNear = makeModel('obs_near', 28, 20, 0.63, ['INFANTRY'], 0, 0);
    expect(modelVisible(s, observerNear, uTarget, hiddenModel)).toBe(true);

    // Shooting removes Hidden status immediately
    uTarget.weaponsFired = ['Boltgun'];
    expect(isHidden(s, uTarget, hiddenModel)).toBe(false);
    expect(modelVisible(s, observerFar, uTarget, hiddenModel)).toBe(true);

    // Phobos Shadow Masters detachment rule (unshot: true -> shotTurn = -99) allows unit to remain Hidden although it shot
    uTarget.shotTurn = -99;
    expect(isHidden(s, uTarget, hiddenModel)).toBe(true);
    expect(modelVisible(s, observerFar, uTarget, hiddenModel)).toBe(false);

    // Lone Operative is NOT removed when unit shoots
    const loneOpModel = makeModel('m_lone', 50, 50, 0.63, ['INFANTRY', 'CHARACTER'], 0, 0);
    const uLoneOp = makeUnit('u_lone', 1, [loneOpModel], ['INFANTRY', 'CHARACTER', 'Lone Operative']);
    expect(getUnitLoneOpRange(s, uLoneOp)).toBe(12);
    uLoneOp.weaponsFired = ['Pistol'];
    uLoneOp.shotTurn = s.turn;
    expect(getUnitLoneOpRange(s, uLoneOp)).toBe(12);
  });

  it('a vehicle may end inside a ruin footprint to hold an objective, but not drive through its wall', () => {
    const ruin = makeTerrain('t_ruin', [P(10, 10), P(20, 10), P(20, 20), P(10, 20)], 4, 'dense', [[P(10, 10), P(10, 20)]]);
    const vehModel = makeModel('m_veh', 15, 15, 1.5, ['VEHICLE'], 2, 1);
    const uVeh = makeUnit('u_veh', 0, [vehModel], ['VEHICLE']);

    const s = makeState([uVeh], [ruin]);
    s.phase = 'movement';

    expect(validateMove(s, uVeh, 'normal', new Map([[vehModel.id, [P(15, 25), P(15, 15)]]])).ok).toBe(true);
    expect(validateMove(s, uVeh, 'normal', new Map([[vehModel.id, [P(5, 15), P(15, 15)]]])).ok).toBe(false);
  });
});

describe('Deathstrike Missile Targeting Logic', () => {
  it('allows designation in both command and shooting phases', () => {
    const dsModel = {
      id: 'ds1',
      name: 'Deathstrike',
      x: 10,
      y: 10,
      r: 1.5,
      weapons: [{ name: 'Deathstrike missile', profiles: [] }],
      profile: { M: 10, T: 10, Sv: 3, InSv: null, W: 11, Ld: 7, OC: 3 },
    } as unknown as ModelState;

    const uDs = makeUnit('u_ds', 0, [dsModel], ['VEHICLE'], [{ name: 'Deathstrike Missile' }]);

    const s = makeState([uDs]);
    s.phase = 'command';

    expect(canDesignateDeathstrike(s, uDs)).toBe(true);

    s.phase = 'shooting';
    expect(canDesignateDeathstrike(s, uDs)).toBe(true);
  });

  it('evaluates cluster centroids and heavy armour bonuses in deathstrikeWorth', () => {
    const foeHeavy = makeUnit('u_heavy', 1, [makeModel('m_tank', 20, 20, 1.5, ['VEHICLE'], 2, 1)], ['VEHICLE']);
    foeHeavy.pts = 200;

    const foeSwarm = makeUnit('u_swarm', 1, Array.from({ length: 15 }, (_, i) => makeModel('m_swarm' + i, 22, 21, 0.5, ['INFANTRY'], 0, 0)), ['INFANTRY']);
    foeSwarm.pts = 120;

    const s = makeState([foeHeavy, foeSwarm]);

    // Both units fall under a 6" radius blast centred at (21, 20.5)
    const blastCenter = { x: 21, y: 20.5 };
    const worth = deathstrikeWorth(s, 0, blastCenter);
    expect(worth).toBeGreaterThan(200);

    const best = bestDeathstrikeSpot(s, 0);
    expect(best).not.toBeNull();
  });
});
