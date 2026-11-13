import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGame, placeUnit, formationAt, polygonArea, fightingArmyPoints, isFightEvenlyMatched } from './game';
import { hasLos, hasCover, modelVisible, isInfantryBeastUnit, isInfantryBeastLoneOpActive, getUnitLoneOpRange } from './visibility';
import { stratagemShortSummary, type StratRule } from '../rules-engine/stratagems';
import { cpWorth } from '../ai/botStrats';
import { PRESETS } from '../ui/presets';
import { baseDist } from './geometry';
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

function createRuin(id: string, x0: number, y0: number, x1: number, y1: number, category: TerrainPiece['category'] = 'dense'): TerrainPiece {
  return {
    id,
    kind: 'ruin',
    label: id,
    category,
    height: 5,
    poly: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
    walls: [],
  };
}

describe('Core Rules, UI & Rogue-like Comprehensive Overhaul Tests', () => {
  const SM = loadFaction('SM');
  const ORK = loadFaction('ORK');

  describe('Part 2: True LoS & Terrain Footprint Matrix', () => {
    it('strictly enforces the 4-case LoS and Cover matrix', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['Player 1', 'Player 2'],
        seed: 42,
      });

      // Footprint 1 from (15, 10) to (25, 30)
      const ruin1 = createRuin('ruin-1', 15, 10, 25, 30, 'dense');
      s.terrain = [ruin1];

      const sm = s.units.find((u) => u.owner === 0)!;
      const ork = s.units.find((u) => u.owner === 1)!;

      const mSm = sm.models[0];
      const mOrk = ork.models[0];

      // Case 1: Attacker outside + Target outside + Ray crosses Footprint => BLOCKED
      putOnBoard(s, sm, { x: 5, y: 20 });
      putOnBoard(s, ork, { x: 35, y: 20 });
      expect(hasLos(s, mSm, mOrk)).toBe(false);

      // Case 2: Attacker outside + Target inside Footprint => LoS ESTABLISHED, Target gains Benefit of Cover
      putOnBoard(s, sm, { x: 5, y: 20 });
      putOnBoard(s, ork, { x: 20, y: 20 });
      expect(hasLos(s, mSm, mOrk)).toBe(true);
      expect(hasCover(s, mSm, ork)).toBe(true);

      // Case 3: Attacker inside Footprint + Target outside Footprint => LoS ESTABLISHED, Target does NOT gain Cover from that footprint
      putOnBoard(s, sm, { x: 20, y: 20 });
      putOnBoard(s, ork, { x: 5, y: 20 });
      expect(hasLos(s, mSm, mOrk)).toBe(true);
      expect(hasCover(s, mSm, ork)).toBe(false);

      // Case 4: Attacker inside Footprint + Target inside SAME Footprint => LoS ESTABLISHED, Target does NOT gain Cover from shared footprint
      putOnBoard(s, sm, { x: 18, y: 20 });
      putOnBoard(s, ork, { x: 22, y: 20 });
      expect(hasLos(s, mSm, mOrk)).toBe(true);
      expect(hasCover(s, mSm, ork)).toBe(false);
    });
  });

  describe('Part 3: Infantry Beast / 15-inch Lone Operative Custom Logic', () => {
    it('dynamically activates 15" stealth rule only when wholly within terrain and not fired', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['A', 'B'],
        seed: 42,
      });

      const ruin = createRuin('stealth-terrain', 10, 10, 30, 30, 'dense');
      s.terrain = [ruin];

      const sm = s.units.find((u) => u.owner === 0)!;
      const beastUnit = s.units.find((u) => u.owner === 1)!;

      // Assign Infantry Beast type / keywords
      (beastUnit as any).type = 'Infantry Beast';
      beastUnit.keywords = ['INFANTRY', 'BEAST'];
      beastUnit.models.forEach((m) => { m.keywords = ['INFANTRY', 'BEAST']; });
      beastUnit.shotTurn = -10;
      beastUnit.weaponsFired = [];

      expect(isInfantryBeastUnit(beastUnit)).toBe(true);

      // Not in terrain => inactive
      putOnBoard(s, beastUnit, { x: 5, y: 5 });
      expect(isInfantryBeastLoneOpActive(s, beastUnit)).toBe(false);

      // Wholly within terrain and has not fired => active
      putOnBoard(s, beastUnit, { x: 20, y: 20 });
      expect(isInfantryBeastLoneOpActive(s, beastUnit)).toBe(true);
      expect(beastUnit.keywords.includes('Lone Operative')).toBe(true);

      const attacker = sm.models[0];
      const targetModel = beastUnit.models[0];

      // Attacker at > 15" away (center dist 18.125, baseDist ~16.7) => CANNOT target
      attacker.x = 20;
      attacker.y = 0;
      expect(modelVisible(s, attacker, beastUnit, targetModel)).toBe(false);

      // Attacker at <= 15" away (center dist 11.125, baseDist ~9.7) => CAN target
      attacker.x = 20;
      attacker.y = 7;
      expect(modelVisible(s, attacker, beastUnit, targetModel)).toBe(true);

      // Lone Operative range is 15" for Infantry Beast in terrain
      expect(getUnitLoneOpRange(s, beastUnit)).toBe(15);

      // If unit fired this turn => rule deactivates
      beastUnit.shotTurn = s.turn;
      expect(isInfantryBeastLoneOpActive(s, beastUnit)).toBe(false);

      // Standard Lone Operative has 12" range (when not attached to a bodyguard squad)
      const standardLoneOpUnit = s.units.find((u) => u.owner === 0)!;
      standardLoneOpUnit.sources = ['Vindicare Assassin'];
      standardLoneOpUnit.core.loneOperative = 12;
      expect(getUnitLoneOpRange(s, standardLoneOpUnit)).toBe(12);
    });
  });

  describe('Part 4: Stratagem short_summary and Standard CP spending', () => {
    it('provides punchy quick summary and assesses CP worth', () => {
      const rule: StratRule = { buffs: ['fnp5'] };
      const summary = stratagemShortSummary({
        id: 'test-strat',
        name: 'Omnissiah Grace',
        cp: 1,
        type: 'Battle Tactic',
        turn: 'Either',
        phase: 'Any',
        text: 'WHEN: Targeted. EFFECT: Gains 5+ Feel No Pain.',
      }, rule);

      expect(summary).toBe('Gain 5+ FNP vs all damage');

      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['Player', 'Bot'],
        seed: 42,
      });

      // Standard mode evaluates CP carefully
      expect(cpWorth(s, 1)).toBeGreaterThanOrEqual(3);
    });
  });
});
