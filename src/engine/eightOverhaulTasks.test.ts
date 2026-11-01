import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { autoList } from './autoList';
import { createGame } from './game';
import type { DatasheetData, FactionData } from './types';
import {
  applyCampaign,
  buyEnhancementForUnit,
  canBuyEnhancementForUnit,
  detachmentScrapCost,
  enhancementScrapCost,
  newRun,
  recruitScrapCost,
  recruitUnit,
  takeReward,
  unitRarity,
} from './campaign';
import { buildUnits } from './army';
import { sectionOf } from '../ui/ArmyBuilder';

function loadFaction(id: string): FactionData {
  const file = path.join(process.cwd(), 'public', 'data', 'factions', `${id}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const SM = loadFaction('SM');
const ORK = loadFaction('ORK');

describe('Comprehensive Validation of All 8 Overhaul Categories', () => {
  // Category 1: Enhancement Purchase Rules
  describe('Category 1: Enhancement Rules on Same Model', () => {
    it('disallows purchasing duplicate of the exact same enhancement on the same character model', () => {
      let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
      run.scrap = 500;
      const char = run.list.units.find((u) => {
        const d = SM.datasheets.find((x) => x.name === u.datasheet);
        return d?.keywords.includes('CHARACTER') && !d?.keywords.includes('EPIC HERO');
      })!;
      expect(char).toBeDefined();

      const enhName = 'Artificer Armour';
      const pts = 10;
      expect(canBuyEnhancementForUnit(run, SM, char.uid, enhName)).toBe(true);

      run = buyEnhancementForUnit(run, SM, char.uid, enhName, pts);
      const updatedChar = run.list.units.find((u) => u.uid === char.uid)!;
      expect(updatedChar.enhancements).toBeDefined();
      expect(updatedChar.enhancements!.length).toBe(1);
      expect(updatedChar.enhancements![0].name).toBe(enhName);

      // Attempting to buy the SAME enhancement again on the SAME character model must fail
      expect(canBuyEnhancementForUnit(run, SM, char.uid, enhName)).toBe(false);
      const runAfterDup = buyEnhancementForUnit(run, SM, char.uid, enhName, pts);
      expect(runAfterDup.list.units.find((u) => u.uid === char.uid)!.enhancements!.length).toBe(1);
    });

    it('allows purchasing a different enhancement on the same character with escalating scrap cost', () => {
      let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
      run.scrap = 500;
      const char = run.list.units.find((u) => {
        const d = SM.datasheets.find((x) => x.name === u.datasheet);
        return d?.keywords.includes('CHARACTER') && !d?.keywords.includes('EPIC HERO');
      })!;

      // 1st slot cost: base (40 min for 10pts)
      const cost1 = enhancementScrapCost(10, 0);
      expect(cost1).toBe(40);
      run = buyEnhancementForUnit(run, SM, char.uid, 'Artificer Armour', 10);

      // 2nd slot cost: base * 1.5 = 60
      const cost2 = enhancementScrapCost(10, 1);
      expect(cost2).toBe(60);

      // Can buy a DIFFERENT enhancement on the same character
      expect(canBuyEnhancementForUnit(run, SM, char.uid, 'The Honour Vehement')).toBe(true);
      run = buyEnhancementForUnit(run, SM, char.uid, 'The Honour Vehement', 15);

      const updated = run.list.units.find((u) => u.uid === char.uid)!;
      expect(updated.enhancements!.length).toBe(2);
      expect(updated.enhancements!.map((e) => e.name)).toEqual(['Artificer Armour', 'The Honour Vehement']);
    });
  });

  // Category 2: Auto-Upgrade Unit Preview & Execution

  // Category 3: Section Separation
  describe('Category 3: Character Separation', () => {

    it('lists EPIC HERO units in the characters section with the standard leaders', () => {
      const epicHeroSheet = {
        id: 'calgar',
        name: 'Marneus Calgar',
        role: 'Character',
        keywords: ['INFANTRY', 'CHARACTER', 'EPIC HERO'],
        models: [{ name: 'Calgar', M: 6, T: 6, Sv: 2, InSv: null, W: 6, Ld: 6, OC: 2, base: { w: 50, h: 50, text: '50mm' } }],
        composition: [{ text: '1 Marneus Calgar' }],
        loadout: {},
        loadoutText: '',
      } as unknown as DatasheetData;
      const standardLeaderSheet = {
        id: 'captain',
        name: 'Captain in Gravis Armour',
        role: 'Character',
        keywords: ['INFANTRY', 'CHARACTER', 'LEADER'],
        models: [{ name: 'Captain', M: 5, T: 6, Sv: 3, InSv: null, W: 6, Ld: 6, OC: 1, base: { w: 40, h: 40, text: '40mm' } }],
        composition: [{ text: '1 Captain' }],
        loadout: {},
        loadoutText: '',
      } as unknown as DatasheetData;

      expect(sectionOf(epicHeroSheet, 'SM')).toBe('characters');
      expect(sectionOf(standardLeaderSheet, 'SM')).toBe('characters');
    });
  });

  // Category 4: boss and elite battles are won on VP like the others
  describe('Category 4: Boss battles', () => {
    it('no longer needs a total wipeout to end', () => {
      const run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
      const bossNode = run.map.find((n) => n.kind === 'boss')!;
      run.fighting = bossNode.id;
      const s = createGame({ names: ['Player', 'Enemy'], factions: [SM, ORK], lists: [run.list, autoList(ORK, 500, 1)] });
      applyCampaign(s, run, bossNode.enemy?.rules ?? []);
      expect(s.phase).not.toBe('gameover');
    });
  });

  // Category 5: Reinforcement Rarity Tiers and Legendary Bundled Leaders
  describe('Category 5: Reinforcement Rarity and Bundles', () => {
    it('correctly categorizes datasheets into rarity tiers', () => {
      const basicInfantry = {
        id: 'inf',
        name: 'Guardsmen',
        role: 'Battleline',
        keywords: ['INFANTRY', 'BATTLELINE'],
        points: [{ label: '10 models', options: [{ models: 10, pts: 60 }] }],
        models: [{ name: 'Guardsman', M: 6, T: 3, Sv: 5, InSv: null, W: 1, Ld: 7, OC: 2, base: { w: 25, h: 25, text: '25mm' } }],
        composition: [{ text: '10 Guardsmen' }],
        loadout: {},
        loadoutText: '',
      } as unknown as DatasheetData;
      const eliteUnit = {
        id: 'kasrkin',
        name: 'Kasrkin',
        role: 'Other',
        keywords: ['INFANTRY', 'GRENADIERS'],
        points: [{ label: '10 models', options: [{ models: 10, pts: 110 }] }],
        models: [{ name: 'Kasrkin', M: 6, T: 3, Sv: 4, InSv: null, W: 1, Ld: 7, OC: 1, base: { w: 28, h: 28, text: '28mm' } }],
        composition: [{ text: '10 Kasrkin' }],
        loadout: {},
        loadoutText: '',
      } as unknown as DatasheetData;
      const heavyTank = {
        id: 'leman_russ',
        name: 'Leman Russ Battle Tank',
        role: 'Other',
        keywords: ['VEHICLE', 'SMOKE'],
        points: [{ label: '1 model', options: [{ models: 1, pts: 170 }] }],
        models: [{ name: 'Leman Russ', M: 10, T: 11, Sv: 2, InSv: null, W: 13, Ld: 7, OC: 3, base: { w: 150, h: 100, text: 'Vehicle' } }],
        composition: [{ text: '1 Leman Russ' }],
        loadout: {},
        loadoutText: '',
      } as unknown as DatasheetData;
      const titanicTitan = {
        id: 'baneblade',
        name: 'Baneblade',
        role: 'Lord of War',
        keywords: ['VEHICLE', 'TITANIC', 'TOWERING'],
        points: [{ label: '1 model', options: [{ models: 1, pts: 480 }] }],
        models: [{ name: 'Baneblade', M: 9, T: 13, Sv: 2, InSv: null, W: 24, Ld: 7, OC: 8, base: { w: 200, h: 150, text: 'Titanic' } }],
        composition: [{ text: '1 Baneblade' }],
        loadout: {},
        loadoutText: '',
      } as unknown as DatasheetData;

      expect(unitRarity(basicInfantry)).toBe('common');
      expect(unitRarity(eliteUnit)).toBe('rare');
      expect(unitRarity(heavyTank)).toBe('epic');
      expect(unitRarity(titanicTitan)).toBe('legendary');
    });

    it('attaches bonus leader when taking a legendary reinforcement with bonusLeader', () => {
      let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
      const initialCount = run.list.units.length;

      run = takeReward(
        run,
        {
          kind: 'unit',
          datasheet: 'Intercessor Squad',
          models: 5,
          pts: 80,
          rarity: 'legendary',
          bonusLeader: {
            datasheet: 'Captain in Gravis Armour',
            models: 1,
            pts: 80,
          },
        },
        SM
      );

      // Both the bodyguard and leader must have been added
      expect(run.list.units.length).toBe(initialCount + 2);
      const leader = run.list.units.find((u) => u.datasheet === 'Captain in Gravis Armour');
      expect(leader).toBeDefined();
      expect(leader!.attachTo).toBeDefined();
    });
  });

  // Category 6: Duplicate Scrap Cost Escalation & Detachment Pricing
  describe('Category 6: Duplicate Unit Cost Escalation & Detachment Tiers', () => {
    it('scales scrap cost when recruiting duplicate copies of the same datasheet; Battleline climbs half as fast', () => {
      let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
      run.scrap = 5000;
      run.list.units = run.list.units.filter((u) => u.datasheet !== 'Intercessor Squad' && u.datasheet !== 'Hellblaster Squad');
      const sheet = (n: string) => SM.datasheets.find((d) => d.name === n)!;
      const inter = sheet('Intercessor Squad'), hell = sheet('Hellblaster Squad');
      expect(inter.keywords).toContain('BATTLELINE');
      expect(hell.keywords).not.toContain('BATTLELINE');
      // Battleline: copies 1-4 at the base price, then x1.5, x1.5, x2
      const seenI: number[] = [];
      for (let i = 0; i < 7; i++) { seenI.push(recruitScrapCost(run, inter, 80)); run = recruitUnit(run, SM, inter.name, 5); }
      expect(seenI).toEqual([80, 80, 80, 80, 120, 120, 160]);
      // any other unit: copies 1-2 at the base price, then x1.5, x2, x3
      const seenH: number[] = [];
      for (let i = 0; i < 5; i++) { seenH.push(recruitScrapCost(run, hell, 100)); run = recruitUnit(run, SM, hell.name, 5); }
      expect(seenH).toEqual([100, 100, 150, 200, 300]);
    });

    it('prices detachments by their Detachment Points', () => {
      expect(detachmentScrapCost({ dp: 1 })).toBe(60);
      expect(detachmentScrapCost({ dp: 2 })).toBe(110);
      expect(detachmentScrapCost({ dp: 3 })).toBe(170);
      expect(new Set(SM.detachments.map((d) => detachmentScrapCost(d))).size).toBeGreaterThan(1);
    });
  });

  // Category 7: Expanded Command Tech Tree

  // Category 8: Attached Unit Battle Honor Sync
  describe('Category 8: Attached Unit Battle Honor Sync & Move Upgrades', () => {
    it('synchronizes movement between leader and attached bodyguard to prevent slowdowns', () => {
      const bodyguardSheet = {
        id: 'bodyguard',
        name: 'Upgraded Bodyguards',
        role: 'Battleline',
        keywords: ['INFANTRY'],
        points: [{ label: '5 models', options: [{ models: 5, pts: 100 }] }],
        models: [{ name: 'Bodyguard', M: 8, T: 4, Sv: 3, InSv: null, W: 2, Ld: 6, OC: 2, base: { w: 32, h: 32, text: '32mm' } }],
        composition: [{ text: '5 Bodyguards' }],
        loadout: {},
        loadoutText: '',
        weapons: [],
        factionKeywords: [],
        abilities: [],
      } as unknown as DatasheetData;
      const slowLeaderSheet = {
        id: 'slow_leader',
        name: 'Slow Veteran Leader',
        role: 'Character',
        keywords: ['INFANTRY', 'CHARACTER', 'LEADER'],
        points: [{ label: '1 model', options: [{ models: 1, pts: 90 }] }],
        models: [{ name: 'Leader', M: 5, T: 5, Sv: 2, InSv: null, W: 6, Ld: 5, OC: 1, base: { w: 40, h: 40, text: '40mm' } }],
        composition: [{ text: '1 Leader' }],
        loadout: {},
        loadoutText: '',
        weapons: [],
        factionKeywords: [],
        abilities: [],
      } as unknown as DatasheetData;

      const testFac: any = {
        id: 'CUSTOM',
        name: 'Custom',
        datasheets: [bodyguardSheet, slowLeaderSheet],
        detachments: [],
      };

      const units = buildUnits(
        {
          name: 'Custom Army',
          battleSize: 'Incursion',
          detachments: [],
          factionId: 'CUSTOM',
          units: [
            { uid: 'u_bg', datasheet: 'Upgraded Bodyguards', models: 5, pts: 100 },
            { uid: 'u_lead', datasheet: 'Slow Veteran Leader', models: 1, pts: 90, attachTo: 'u_bg' },
          ],
        },
        testFac,
        0
      );

      expect(units.length).toBe(1);
      const combinedUnit = units[0];
      // Leader model M was 5, Bodyguard was 8. Both must now have M = 8!
      for (const m of combinedUnit.models) {
        expect(m.profile.M).toBe(8);
      }
    });

  });
});
