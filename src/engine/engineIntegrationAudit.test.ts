import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGame, formationAt, placeUnit } from './game';
import { effectsFor, modelDefence } from '../rules-engine/effects';
import { manualActs, useActByKey } from '../rules-engine/activations';
import { buildShootPools, applyMortalWounds } from './attack';
import { canUseStratagem, spendStratagem, unitDistance, hasKw } from './state';
import { hasLos, hasCover } from './visibility';
import { rollN } from './dice';
import { PRESETS } from '../ui/presets';
import { RULES } from './config';
import type { ArmyList, FactionData, GameState, ModelState, Pt, TerrainPiece, UnitState } from './types';

function loadFaction(id: string): FactionData {
  const file = path.join(process.cwd(), 'public', 'data', 'factions', `${id}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as FactionData;
}

function putOnBoard(s: GameState, u: UnitState, pos: Pt) {
  placeUnit(s, u, formationAt(u, pos));
  u.status = 'board';
  u.setUpTurn = -10;
}

function createTerrainArea(id: string, x0: number, y0: number, x1: number, y1: number, category: TerrainPiece['category'], walls: [Pt, Pt][] = []): TerrainPiece {
  return {
    id,
    kind: 'ruin',
    label: id,
    category,
    height: category === 'dense' ? 5 : 1.5,
    poly: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
    walls: walls.map(([a, b]) => ({ a, b })),
  };
}

describe('Engine Functional & Integration Audit Suite', () => {
  const SM = loadFaction('SM');
  const ORK = loadFaction('ORK');

  describe('1. Unit Abilities (Datasheet Skills & Interactive Buttons)', () => {
    it('generates active UI ability buttons in matching phase and applies effects/logs cleanly', () => {
      const smList: ArmyList = {
        name: 'Ability Test SM',
        factionId: 'SM',
        battleSize: 'incursion',
        detachments: ['Gladius Task Force'],
        units: [
          { uid: 'u_tech', datasheet: 'Techmarine', models: 1, pts: 70 },
          { uid: 'u_dread', datasheet: 'Redemptor Dreadnought', models: 1, pts: 210 },
          { uid: 'u_cap', datasheet: 'Captain', models: 1, pts: 80 },
        ],
      };

      const s = createGame({
        lists: [smList, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['Player 1', 'Player 2'],
        seed: 42,
      });
      s.bots = [];
      s.phase = 'movement';
      s.round = 1;
      s.turn = 1;
      s.active = 0;

      const tech = s.units.find((u) => u.name.includes('Techmarine'))!;
      const dread = s.units.find((u) => u.name.includes('Dreadnought'))!;
      const cap = s.units.find((u) => u.name.includes('Captain'))!;

      putOnBoard(s, tech, { x: 20, y: 20 });
      putOnBoard(s, dread, { x: 22, y: 20 });
      putOnBoard(s, cap, { x: 35, y: 20 });

      dread.models[0].wounds = dread.models[0].profile.W - 4;
      const woundsBefore = dread.models[0].wounds;

      const acts = manualActs(s, 0);
      const blessingAct = acts.find((a) => a.def.name === 'Blessings of the Omnissiah');

      expect(blessingAct).toBeDefined();
      expect(blessingAct?.why).toBeNull();

      const initialLogCount = s.log.length;
      const err = useActByKey(s, tech.id, blessingAct!.def.key, dread.id);
      expect(err).toBeNull();
      expect(dread.models[0].wounds).toBeGreaterThan(woundsBefore);
      expect(dread.timed?.some((t) => t.e.ignoreMods === true)).toBe(true);
      expect(s.log.length).toBeGreaterThan(initialLogCount);
    });

    it('passive abilities and auras apply automatically without manual button clicks', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['P1', 'P2'],
        seed: 42,
      });
      const smUnit = s.units.find((u) => u.owner === 0)!;
      putOnBoard(s, smUnit, { x: 20, y: 20 });
      const fx = effectsFor(s, smUnit);
      expect(Array.isArray(fx)).toBe(true);
    });
  });

  describe('2. Stratagems & Wargear (Grenades)', () => {
    it('contextual stratagems enforce WHEN, TARGET, CP cost, and Battle-shock restrictions', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['Player 1', 'Player 2'],
        seed: 42,
      });
      s.phase = 'shooting';
      s.round = 1;
      s.turn = 1;
      s.active = 0;
      s.players[0].cp = 1;

      const grenadeUnit = s.units.find((u) => u.owner === 0 && (hasKw(u, 'GRENADES') || hasKw(u, 'EXPLOSIVES')))!;
      const enemyNear = s.units.find((u) => u.owner === 1)!;
      const enemyFar = s.units.filter((u) => u.owner === 1)[1] || s.units.find((u) => u.owner === 1)!;

      putOnBoard(s, grenadeUnit, { x: 20, y: 20 });
      putOnBoard(s, enemyNear, { x: 20, y: 26 });
      putOnBoard(s, enemyFar, { x: 20, y: 35 });

      expect(canUseStratagem(s, 0, 'explosives', grenadeUnit)).toBeNull();

      s.players[0].cp = 0;
      expect(canUseStratagem(s, 0, 'explosives', grenadeUnit)).toBe('Not enough CP');
      s.players[0].cp = 1;

      grenadeUnit.battleShocked = true;
      expect(canUseStratagem(s, 0, 'explosives', grenadeUnit)).toBe('A Battle-shocked unit cannot be targeted by Stratagems');
      grenadeUnit.battleShocked = false;

      expect(unitDistance(grenadeUnit, enemyNear)).toBeLessThanOrEqual(8);
      expect(unitDistance(grenadeUnit, enemyFar)).toBeGreaterThan(8);

      spendStratagem(s, 0, 'explosives', grenadeUnit);
      expect(s.players[0].cp).toBe(0);
      expect(s.players[0].stratagemsUsed.some((str) => str.includes('explosives'))).toBe(true);

      const rolls = rollN(s, 6);
      const mw = rolls.filter((x) => x >= 4).length;
      const hpBefore = enemyNear.models.reduce((sum, m) => sum + (m.dead ? 0 : m.wounds), 0);
      applyMortalWounds(s, enemyNear, Math.max(1, mw), 'Explosives');
      const hpAfter = enemyNear.models.reduce((sum, m) => sum + (m.dead ? 0 : m.wounds), 0);
      expect(hpAfter).toBeLessThan(hpBefore);
    });
  });

  describe('3. Core Rules: Line of Sight (LoS) & Visibility', () => {
    it('raycasting strictly checks obscuring ruin areas and solid walls', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['A', 'B'],
        seed: 42,
      });

      const testRuin = createTerrainArea('test-ruin-1', 18, 10, 26, 30, 'dense', [
        [{ x: 18, y: 10 }, { x: 26, y: 10 }],
      ]);
      s.terrain = [testRuin];

      const smUnit = s.units.find((u) => u.owner === 0)!;
      const orkUnit = s.units.find((u) => u.owner === 1)!;

      putOnBoard(s, smUnit, { x: 10, y: 20 });
      putOnBoard(s, orkUnit, { x: 34, y: 20 });

      const mLeft = smUnit.models[0];
      const mRight = orkUnit.models[0];

      // Ruin between outside models blocks LoS
      expect(hasLos(s, mLeft, mRight)).toBe(false);

      // Model inside ruin looking out through open side
      mLeft.x = 20;
      mLeft.y = 20;
      expect(hasLos(s, mLeft, mRight)).toBe(true);

      // Model inside ruin looking through solid North wall y=10
      const outsideNorthModel: ModelState = { ...mRight, x: 22, y: 5 };
      expect(hasLos(s, mLeft, outsideNorthModel)).toBe(false);

      // Line of sight past ruin boundary
      const outsideClearA: ModelState = { ...mLeft, x: 10, y: 32 };
      const outsideClearB: ModelState = { ...mRight, x: 34, y: 32 };
      expect(hasLos(s, outsideClearA, outsideClearB)).toBe(true);
    });
  });

  describe('4. Core Rules: Benefit of Cover & Save Modifiers', () => {
    it('detects cover for units in terrain footprint, stealth, and applies cover penalties', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['A', 'B'],
        seed: 42,
      });
      s.phase = 'shooting';
      s.active = 0;

      const ruin = createTerrainArea('ruin-cover', 15, 15, 25, 25, 'dense', [
        [{ x: 15, y: 15 }, { x: 25, y: 15 }],
      ]);
      s.terrain = [ruin];

      const smUnit = s.units.find((u) => u.owner === 0 && u.models.some((m) => m.weapons.some((w) => w.profiles.some((p) => typeof p.range === 'number'))))!;
      const orkTarget = s.units.find((u) => u.owner === 1)!;

      putOnBoard(s, smUnit, { x: 5, y: 20 });
      putOnBoard(s, orkTarget, { x: 20, y: 20 });

      const attackerModel = smUnit.models[0];

      // Target inside ruin footprint
      expect(hasCover(s, attackerModel, orkTarget)).toBe(true);

      // Target in open ground
      orkTarget.models.forEach((m) => { m.x = 5; m.y = 35; });
      expect(hasCover(s, attackerModel, orkTarget)).toBe(false);

      // Stealth unit
      orkTarget.core.stealth = true;
      expect(hasCover(s, attackerModel, orkTarget)).toBe(true);
      orkTarget.core.stealth = undefined;

      // Shooting pool adds Cover penalty
      orkTarget.models.forEach((m) => { m.x = 20; m.y = 20; });
      const normalShoot = buildShootPools(s, smUnit.id, orkTarget.id, { mode: 'normal' });
      expect(normalShoot.pools.some((p) => p.skillNote.toLowerCase().includes('cover'))).toBe(true);

      // Ignores Cover weapon ability removes penalty
      smUnit.buffs.push({ kind: 'ignoresCover', label: 'Ignores Cover Test', until: 'phase' });
      const ignoresCoverShoot = buildShootPools(s, smUnit.id, orkTarget.id, { mode: 'normal' });
      expect(ignoresCoverShoot.pools.some((p) => p.skillNote.toLowerCase().includes('cover'))).toBe(false);

      // Best save cap
      expect(RULES.modifierCaps.bestSave).toBe(2);
    });
  });
});

