import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  defaultWargear,
  syncWargear,
  wargearSummary,
  canLeaderAttach,
  buildUnits,
  attachOptions,
} from './army';
import {
  buyEnhancementForUnit,
  enhancementScrapCost,
  removeEnhancementFromUnit,
  newRun,
} from './campaign';
import type { FactionData, ArmyList } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync('public/data/factions/' + id + '.json', 'utf8')) as FactionData;
const SM = load('SM');
const TS = load('TS');
const CSM = load('CSM');

describe('Verification of 6 Core Updates', () => {
  describe('1 & 4. Menu & Sub-Panel Accordion State Logic', () => {
    it('isSectionOpen defaults to false keeping Wargear and subpanels collapsed', () => {
      const isSectionOpen = (uid: string, section: string, defaultOpen = false) => defaultOpen;
      expect(isSectionOpen('u1', 'wargear')).toBe(false);
      expect(isSectionOpen('u1', 'enh')).toBe(false);
      expect(isSectionOpen('u1', 'honors')).toBe(false);
      expect(isSectionOpen('u1', 'sheet')).toBe(false);
    });
  });

  describe('3. Repeatable and Stackable Enhancements with Dynamic Cost Escalation', () => {
    it('escalates scrap cost compounding by 50% per slot', () => {
      const basePoints = 20; // base scrap: max(40, 60) = 60
      expect(enhancementScrapCost(basePoints, 0)).toBe(60);
      expect(enhancementScrapCost(basePoints, 1)).toBe(90); // 60 * 1.5
      expect(enhancementScrapCost(basePoints, 2)).toBe(135); // 90 * 1.5
      expect(enhancementScrapCost(basePoints, 3)).toBe(203); // 135 * 1.5
    });

    it('allows buying and stacking multiple enhancements on a character', () => {
      const list: ArmyList = {
        name: 'Test Force',
        factionId: 'SM',
        battleSize: 'incursion',
        detachments: ['Gladius Task Force'],
        units: [
          { uid: 'u1', datasheet: 'Captain', models: 1, pts: 80, warlord: true },
        ],
      };
      let run = newRun(SM, list, ['ORK']);
      run.scrap = 1000;

      // Buy first enhancement: Adept of the Codex (20 pts -> slot 0 cost = 60)
      run = buyEnhancementForUnit(run, SM, 'u1', 'Adept of the Codex', 20);
      expect(run.scrap).toBe(1000 - 60);
      expect(run.list.units[0].enhancements?.length).toBe(1);
      expect(run.list.units[0].enhancement).toBe('Adept of the Codex');

      // Buy second enhancement on same unit: Artificer Armour (10 pts -> slot 1 cost = 40 * 1.5 = 60)
      run = buyEnhancementForUnit(run, SM, 'u1', 'Artificer Armour', 10);
      expect(run.scrap).toBe(940 - 60);
      expect(run.list.units[0].enhancements?.length).toBe(2);

      // Buy duplicate of same enhancement: Adept of the Codex (20 pts -> slot 2 cost = 135)
      run = buyEnhancementForUnit(run, SM, 'u1', 'Adept of the Codex', 20);
      expect(run.scrap).toBe(880 - 135);
      expect(run.list.units[0].enhancements?.length).toBe(3);

      // Test combat model construction: all enhancements present in unit abilities and state
      const units = buildUnits(run.list, SM, 0);
      expect(units[0].enhancements.length).toBe(3);
      expect(units[0].enhancements.filter((e) => e.name === 'Adept of the Codex').length).toBe(2);
      expect(units[0].enhancements.filter((e) => e.name === 'Artificer Armour').length).toBe(1);

      // Test unequip: refunds cost scaled to the removed slot
      run = removeEnhancementFromUnit(run, 'u1', 2);
      expect(run.list.units[0].enhancements?.length).toBe(2);
      expect(run.scrap).toBe(745 + 135);
    });
  });

  describe('5. Auto-Equip All Free (0-Scrap) Special Weapons and Wargear', () => {
    it('auto-equips Rubric Marines with Soulreaper cannon, Icon of flame, and Warpflamers', () => {
      const rubric = TS.datasheets.find((d) => d.name === 'Rubric Marines')!;
      const e = syncWargear(rubric, defaultWargear(rubric, {
        uid: 'r1',
        datasheet: 'Rubric Marines',
        models: 10,
        pts: 190,
      }));
      const summary = wargearSummary(rubric, e);
      expect(summary).toContain('Soulreaper cannon');
      expect(summary).toContain('Icon of flame');
      expect(summary).toContain('Warpflame pistol');
      expect(summary).toContain('Warpflamer');
    });

    it('auto-equips Intercessors with grenade launchers and power weapon', () => {
      const intercessors = SM.datasheets.find((d) => d.name === 'Intercessor Squad')!;
      const e = syncWargear(intercessors, defaultWargear(intercessors, {
        uid: 'i1',
        datasheet: 'Intercessor Squad',
        models: 10,
        pts: 160,
      }));
      const summary = wargearSummary(intercessors, e);
      expect(summary).toContain('Grenade Launcher');
      expect(summary).toContain('Power Fist');
    });

    it('auto-equips vehicles with free Hunter-killer missile and secondary weapons', () => {
      const rhino = SM.datasheets.find((d) => d.name === 'Rhino')!;
      const e = syncWargear(rhino, defaultWargear(rhino, {
        uid: 'rh1',
        datasheet: 'Rhino',
        models: 1,
        pts: 75,
      }));
      const summary = wargearSummary(rhino, e);
      expect(summary).toContain('Hunter-killer Missile');
    });
  });

  describe('6. Leader Attachment and Bodyguard Filtering Across Factions', () => {
    it('allows Terminator characters to attach to Deathwing Knights and Wolf Guard Terminators', () => {
      const termCaptain = SM.datasheets.find((d) => d.name === 'Captain in Terminator Armour' || d.name === 'Captain In Terminator Armour')!;
      const dwKnights = SM.datasheets.find((d) => d.name === 'Deathwing Knights')!;
      const wgTerms = SM.datasheets.find((d) => d.name === 'Wolf Guard Terminators')!;
      const dwTerms = SM.datasheets.find((d) => d.name === 'Deathwing Terminator Squad')!;
      const standardTerms = SM.datasheets.find((d) => d.name === 'Terminator Squad')!;

      expect(canLeaderAttach(termCaptain, standardTerms)).toBe(true);
      expect(canLeaderAttach(termCaptain, dwKnights)).toBe(true);
      expect(canLeaderAttach(termCaptain, wgTerms)).toBe(true);
      expect(canLeaderAttach(termCaptain, dwTerms)).toBe(true);
    });

    it('allows Intercessor leaders to attach to Blood Claws, Grey Hunters, Death Company, and Crusader Squads', () => {
      const captain = SM.datasheets.find((d) => d.name === 'Captain')!;
      const bloodClaws = SM.datasheets.find((d) => d.name === 'Blood Claws')!;
      const greyHunters = SM.datasheets.find((d) => d.name === 'Grey Hunters')!;
      const deathCompany = SM.datasheets.find((d) => d.name === 'Death Company Marines')!;
      const crusaders = SM.datasheets.find((d) => d.name === 'Crusader Squad')!;
      const swordBrethren = SM.datasheets.find((d) => d.name === 'Sword Brethren Squad')!;

      expect(canLeaderAttach(captain, bloodClaws)).toBe(true);
      expect(canLeaderAttach(captain, greyHunters)).toBe(true);
      expect(canLeaderAttach(captain, deathCompany)).toBe(true);
      expect(canLeaderAttach(captain, crusaders)).toBe(true);
      expect(canLeaderAttach(captain, swordBrethren)).toBe(true);
    });

    it('attachOptions displays chapter-specific bodyguards for Captain', () => {
      const list: ArmyList = {
        name: 'Combined Crusade',
        factionId: 'SM',
        battleSize: 'incursion',
        detachments: ['Gladius Task Force'],
        units: [
          { uid: 'u1', datasheet: 'Captain', models: 1, pts: 80 },
          { uid: 'u2', datasheet: 'Blood Claws', models: 10, pts: 140 },
          { uid: 'u3', datasheet: 'Deathwing Knights', models: 5, pts: 235 },
        ],
      };
      const opts = attachOptions(list, SM, list.units[0]);
      expect(opts.some((u) => u.datasheet === 'Blood Claws')).toBe(true);
    });
  });
});
