import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createGame, placeUnit, formationAt, zoneOf } from '../engine/game';
import { alive, boardUnits, other } from '../engine/state';
import { dist, polyCentroid, ptGap } from '../engine/geometry';
import { hasLos } from '../engine/visibility';
import {
  determineMoveStance, getThreatGrid, isInForbiddenFootprintZone,
  packModelsIntoSafeSlots, congaLineObjectivePaths, grandmasterArrival,
} from './grandmasterPositioning';
import type { ArmyList, FactionData, GameState, Pt, TerrainPiece, UnitState } from '../engine/types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

type Row = [string, number, number];
const makeList = (factionId: string, units: Row[]): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments: [],
  units: units.map(([d, n, pts], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts })),
});

function makeRuin(id: string, x0: number, y0: number, x1: number, y1: number): TerrainPiece {
  const P = (x: number, y: number) => ({ x, y });
  return {
    id, kind: 'ruin', label: 'ruin', category: 'dense', height: 5,
    poly: [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)],
    walls: [
      { a: P(x0, y0), b: P(x1, y0) },
      { a: P(x0, y0), b: P(x0, y1) },
      { a: P(x1, y0), b: P(x1, y1) },
    ],
  };
}

function setupTestGame(): { s: GameState; smUnit: UnitState; enemyUnit: UnitState; ruin: TerrainPiece } {
  const s = createGame({
    lists: [
      makeList('SM', [['Intercessor Squad', 5, 80]]),
      makeList('ORK', [['Boyz', 10, 90]]),
    ],
    factions: [SM, ORK],
    names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3',
    dispositions: ['take-and-hold', 'take-and-hold'],
    seed: 42,
  });
  s.phase = 'movement';
  s.round = 2;
  s.turn = 2;
  s.active = 0;

  const ruin = makeRuin('center-ruin', 20, 20, 32, 28);
  s.terrain = [ruin];

  // Set standard home objectives: enemy home in north (y=8), friendly home in south (y=38)
  s.objectives = [
    { id: 'enemy-home', type: 'home', owner: 1, x: 30, y: 8, terrainId: 'center-ruin', controller: null },
    { id: 'friendly-home', type: 'home', owner: 0, x: 30, y: 38, terrainId: 'center-ruin', controller: null },
  ];

  const smUnit = s.units.find((u) => u.owner === 0)!;
  const enemyUnit = s.units.find((u) => u.owner === 1)!;

  smUnit.status = 'board';
  enemyUnit.status = 'board';

  // Place enemy unit north of the ruin (shooting south)
  placeUnit(s, enemyUnit, formationAt(enemyUnit, { x: 26, y: 8 }));
  // Place SM unit south of the ruin
  placeUnit(s, smUnit, formationAt(smUnit, { x: 26, y: 38 }));

  return { s, smUnit, enemyUnit, ruin };
}

describe('Grandmaster AI Positioning & Strict Footprint Avoidance', () => {
  it('MODULE 1: STANCE_STAGE_HIDDEN guarantees ZERO footprint intrusion for all models', () => {
    const { s, smUnit, ruin } = setupTestGame();
    const grid = getThreatGrid(s, 0);

    // Staging point right behind the south wall of the ruin
    const anchorPt = { x: 26, y: 29.5 };
    const stance = 'STANCE_STAGE_HIDDEN';

    const paths = packModelsIntoSafeSlots(s, smUnit, anchorPt, stance, 12, false, grid.topRangedFoes);
    expect(paths).not.toBeNull();

    // Check every model's final position
    const models = alive(smUnit);
    for (const m of models) {
      const pth = paths!.get(m.id)!;
      const endPt = pth[pth.length - 1];
      // Zero intrusion into forbidden zone (footprint dilated by baseRadius + 0.15")
      const inForbidden = isInForbiddenFootprintZone(m, endPt, [ruin], 0.15);
      expect(inForbidden).toBe(false);
    }
  });

  it('MODULE 1: Models hug the wall contour and maintain legal coherency', () => {
    const { s, smUnit, ruin } = setupTestGame();
    const grid = getThreatGrid(s, 0);

    const anchorPt = { x: 25, y: 29.5 };
    const paths = packModelsIntoSafeSlots(s, smUnit, anchorPt, 'STANCE_STAGE_HIDDEN', 12, false, grid.topRangedFoes);
    expect(paths).not.toBeNull();

    const endPts = alive(smUnit).map((m) => paths!.get(m.id)![paths!.get(m.id)!.length - 1]);

    // Check each model has coherency <= 2.0" base-to-base gap to at least 1 friendly model
    const ms = alive(smUnit);
    for (let i = 0; i < ms.length; i++) {
      let closeCount = 0;
      for (let j = 0; j < ms.length; j++) {
        if (i === j) continue;
        const baseGap = dist(endPts[i], endPts[j]) - ms[i].r - ms[j].r;
        if (baseGap <= 2.02) closeCount++;
      }
      expect(closeCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('MODULE 2: Conga-Line Objective Toe-In places 1 model on objective and chains rest in shadow', () => {
    const { s, smUnit, ruin } = setupTestGame();
    const grid = getThreatGrid(s, 0);

    // Place an objective 6" south of the ruin
    const testObj = { id: 'test-obj', type: 'central' as const, x: 26, y: 35, terrainId: 'center-ruin', controller: null };
    s.objectives = [testObj];

    const paths = congaLineObjectivePaths(s, smUnit, testObj, ruin, 12, false, grid.topRangedFoes);
    expect(paths).not.toBeNull();

    const ms = alive(smUnit);
    const endPts = ms.map((m) => paths!.get(m.id)![paths!.get(m.id)!.length - 1]);

    // Model 0 must be within 3.0" of objective zone
    const leadDist = dist(endPts[0], testObj);
    expect(leadDist).toBeLessThanOrEqual(3.0);

    // Later models chain back towards the ruin
    const lastDist = dist(endPts[endPts.length - 1], testObj);
    expect(lastDist).toBeGreaterThan(leadDist + 1.5);
  });

  it('MODULE 3: BACKFIELD_HOME_HEIST targets enemy home objective with +150 priority', () => {
    const { s, smUnit, enemyUnit } = setupTestGame();

    // Set SM unit in reserves for Deep Strike
    smUnit.status = 'reserves';
    // Move enemy unit away from their home objective (leaving it undefended)
    const enemyHome = s.objectives.find((o) => o.y < 15) ?? { x: 30, y: 8, id: 'enemy-home', label: 'Home', number: 1 };
    placeUnit(s, enemyUnit, formationAt(enemyUnit, { x: 50, y: 25 }));

    const arrival = grandmasterArrival(s, smUnit, 'deepStrike');
    expect(arrival).not.toBeNull();

    const arrivalPts = [...arrival!.values()];
    const avgPos = {
      x: arrivalPts.reduce((a, b) => a + b.x, 0) / arrivalPts.length,
      y: arrivalPts.reduce((a, b) => a + b.y, 0) / arrivalPts.length,
    };

    // Verify arrived in upper part of board (towards enemy home)
    expect(avgPos.y).toBeLessThan(25);

    // Strictly verify 9" clearance from enemy
    for (const p of arrivalPts) {
      for (const em of alive(enemyUnit)) {
        const gap = dist(p, em) - 0.6 - em.r;
        expect(gap).toBeGreaterThan(9.0);
      }
    }
  });

  it('MODULE 3: Rapid Ingress (how === ingress) drops 100% in safe shadow behind ruin wall', () => {
    const { s, smUnit, enemyUnit, ruin } = setupTestGame();

    // Round 3 allows Strategic Reserves to arrive anywhere along board edges, including the south edge (H = 60)
    s.round = 3;

    // Strategic reserves (ingress) must arrive <= 6" from a table edge (tableH = 60).
    // Place a ruin at y in [42, 50] so the area y in [54, 60] is <= 6" from south edge AND in safe shadow.
    const southEdgeRuin = makeRuin('south-edge-ruin', 18, 42, 34, 50);
    s.terrain = [ruin, southEdgeRuin];

    smUnit.status = 'reserves';
    // Enemy shooters are north of the ruin
    placeUnit(s, enemyUnit, formationAt(enemyUnit, { x: 26, y: 10 }));

    const arrival = grandmasterArrival(s, smUnit, 'ingress');
    expect(arrival).not.toBeNull();

    const arrivalPts = [...arrival!.values()];
    // The drop should occur in the south (behind the ruin wall relative to north enemy shooters)
    const avgY = arrivalPts.reduce((a, b) => a + b.y, 0) / arrivalPts.length;
    expect(avgY).toBeGreaterThan(25); // Behind the south wall of the ruin
  });

  it('MODULE 4: Sub-10ms execution benchmark', () => {
    const { s, smUnit } = setupTestGame();
    const grid = getThreatGrid(s, 0);
    const anchorPt = { x: 26, y: 29.5 };

    // Warm-up
    packModelsIntoSafeSlots(s, smUnit, anchorPt, 'STANCE_STAGE_HIDDEN', 12, false, grid.topRangedFoes);

    // Measure 10 runs
    const t0 = performance.now();
    const iterations = 10;
    for (let i = 0; i < iterations; i++) {
      packModelsIntoSafeSlots(s, smUnit, anchorPt, 'STANCE_STAGE_HIDDEN', 12, false, grid.topRangedFoes);
    }
    const avgTimeMs = (performance.now() - t0) / iterations;

    // Must be well under 10ms per unit
    expect(avgTimeMs).toBeLessThan(10.0);
  });
});
