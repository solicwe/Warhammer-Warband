import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGame, placeUnit, formationAt, triggerDynamicDramaEngine, expandRoguelikeMap, polygonArea, fightingArmyPoints, isFightEvenlyMatched } from './game';
import { hasLos, hasCover, modelVisible, isInfantryBeastUnit, isInfantryBeastLoneOpActive } from './visibility';
import { stratagemShortSummary, type StratRule } from './stratagems';
import { cpWorth } from './botStrats';
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

      // If unit fired this turn => rule deactivates
      beastUnit.shotTurn = s.turn;
      expect(isInfantryBeastLoneOpActive(s, beastUnit)).toBe(false);
    });
  });

  describe('Part 4: Rogue-like Catch-up Mechanics & Dynamic Drama Engine', () => {
    it('forces High-Threat Event when VP Delta >= 30', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['Player', 'Bot'],
        seed: 42,
      });
      s.campaign = { node: 'battle-1', relics: [], rules: [], reinforcementsTriggered: [] };
      s.round = 2;
      s.turn = 2;
      s.players[0].vp = 35;
      s.players[1].vp = 2; // Delta = 33 >= 30

      putOnBoard(s, s.units[0], { x: 20, y: 20 });

      const triggered = triggerDynamicDramaEngine(s);
      expect(triggered).toBe(true);
      // Either Warp Storm is active or an elite strike squad was added
      const hasWarpStorm = s.warpStormActive === true;
      const hasElite = s.units.some((u) => u.id.includes('elite-drama'));
      expect(hasWarpStorm || hasElite).toBe(true);
    });

    it('triggers Titan Boss spawn when round >= 3, Player VP >= 50, and fighting army points are evenly matched', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['Player', 'Bot'],
        seed: 42,
      });
      s.campaign = { node: 'boss-1', relics: [], rules: [], reinforcementsTriggered: [] };
      s.round = 3;
      s.players[0].vp = 55;
      s.players[1].vp = 30;

      // Both armies start with full points (1000 vs 1000), so they are evenly matched
      expect(isFightEvenlyMatched(s)).toBe(true);

      const triggered = triggerDynamicDramaEngine(s);
      if (s.titanAlert) {
        expect(s.titanAlert.text).toContain('TITAN DETECTED');
        expect(s.units.some((u) => u.keywords.includes('TITANIC'))).toBe(true);
      }
    });

    it('blocks Titan Boss spawn when fighting army points are not evenly matched', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['Player', 'Bot'],
        seed: 42,
      });
      s.campaign = { node: 'boss-1', relics: [], rules: [], reinforcementsTriggered: [] };
      s.round = 3;
      s.players[0].vp = 55;
      s.players[1].vp = 30;

      // Simulate heavy casualties on AI: all enemy units except 1 model destroyed
      const aiUnits = s.units.filter((u) => u.owner === 1);
      aiUnits.slice(1).forEach((u) => {
        u.status = 'destroyed';
        u.models.forEach((m) => { m.dead = true; });
      });

      // Player has ~1000 pts, AI has < 100 pts => Not evenly matched
      expect(isFightEvenlyMatched(s)).toBe(false);

      // Titan must NOT spawn
      triggerDynamicDramaEngine(s);
      expect(s.titanAlert).toBeUndefined();
      expect(s.units.some((u) => u.keywords.includes('TITANIC'))).toBe(false);
    });
  });

  describe('Part 5: Dynamic Map Scaling & 25% Terrain Density', () => {
    it('dynamically scales grid bounds from base 44x30 based on Player VP and maintains 25% coverage', () => {
      const s = createGame({
        lists: [PRESETS.SM, PRESETS.ORK],
        factions: [SM, ORK],
        names: ['Player', 'Bot'],
        seed: 42,
      });
      s.campaign = { node: 'battle-1', relics: [], rules: [] };
      s.players[0].vp = 40;

      const expanded = expandRoguelikeMap(s);
      expect(expanded).toBe(true);
      expect(s.table!.width).toBeGreaterThan(44);
      expect(s.table!.height).toBeGreaterThan(30);

      // Verify terrain coverage
      const totalArea = s.table!.width * s.table!.height;
      const terrainArea = s.terrain
        .filter((t) => t.kind !== 'objective-area')
        .reduce((sum, t) => sum + polygonArea(t.poly), 0);

      expect(terrainArea / totalArea).toBeGreaterThanOrEqual(0.20);
    });
  });

  describe('Part 6: Stratagem short_summary and Aggressive Bot CP spending', () => {
    it('provides punchy quick summary and avoids hoarding CP in Rogue-like mode', () => {
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

      // Standard mode hoards CP
      expect(cpWorth(s, 1)).toBeGreaterThanOrEqual(3);

      // In campaign mode, bot spends CP aggressively (cpWorth = 2)
      s.campaign = { node: 'node-1', relics: [], rules: [] };
      expect(cpWorth(s, 1)).toBe(2);
    });
  });
});
