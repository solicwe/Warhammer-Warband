import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  BATTLE_HONORS,
  battleHonorById,
  buyDatasheetHonor,
  canBuyDatasheetHonor,
  honorMinXp,
  honorRequiredRank,
  autoUpgradeAll,
  newRun,
  recruitUnit,
  datasheetHonorCost,
  type Run,
} from './campaign';
import { autoList } from './autoList';
import { KINDS, unitKind } from '../ui/ArmyBuilder';
import type { FactionData, ArmyList } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync('public/data/factions/' + id + '.json', 'utf8')) as FactionData;
const SM = load('SM');

describe('Campaign Exp Requirements & Character Categorization Audit', () => {
  describe('1. Character & Epic Hero Categorization', () => {
    it('accurately categorizes datasheets into Epic Hero and Character using unitKind', () => {
      expect(KINDS[0]).toBe('Epic Hero');
      expect(KINDS[1]).toBe('Character');

      const guilliman = SM.datasheets.find((d) => d.name === 'Roboute Guilliman');
      if (guilliman) {
        expect(unitKind(guilliman)).toBe('Epic Hero');
        expect(guilliman.keywords).toContain('EPIC HERO');
      }

      const captain = SM.datasheets.find((d) => d.name === 'Captain');
      if (captain) {
        expect(unitKind(captain)).toBe('Character');
        expect(captain.keywords).toContain('CHARACTER');
        expect(captain.keywords).not.toContain('EPIC HERO');
      }

      const intercessors = SM.datasheets.find((d) => d.name === 'Intercessor Squad');
      if (intercessors) {
        expect(unitKind(intercessors)).toBe('Infantry');
      }
    });
  });

  describe('2. Battle Honor EXP Requirements & Rank Helper', () => {
    it('defines minXp thresholds correctly per tier', () => {
      const hardened = battleHonorById('hardened')!;
      expect(hardened.tier).toBe('veteran');
      expect(honorMinXp(hardened)).toBe(0);
      expect(honorRequiredRank(honorMinXp(hardened))).toBe('Recruit');

      const masterCrafted = battleHonorById('master_crafted')!;
      expect(masterCrafted.tier).toBe('heroic');
      expect(honorMinXp(masterCrafted)).toBe(1);
      expect(honorRequiredRank(honorMinXp(masterCrafted))).toBe('Blooded');

      const devastatingWrath = battleHonorById('devastating_wrath')!;
      expect(devastatingWrath.tier).toBe('legendary');
      expect(honorMinXp(devastatingWrath)).toBe(2);
      expect(honorRequiredRank(honorMinXp(devastatingWrath))).toBe('Veteran');
    });

    it('enforces canBuyDatasheetHonor locks when unit XP is insufficient', () => {
      const list: ArmyList = {
        name: 'Crusade Strike Force',
        factionId: 'SM',
        battleSize: 'incursion',
        detachments: ['Gladius Task Force'],
        units: [
          { uid: 'u1', datasheet: 'Captain', models: 1, pts: 80, xp: 0 },
        ],
      };
      let run = newRun(SM, list, ['ORK']);
      run.scrap = 1000;

      const tier1Honor = battleHonorById('hardened')!;
      const tier2Honor = battleHonorById('master_crafted')!;
      const tier3Honor = battleHonorById('devastating_wrath')!;

      // 0 XP: Tier 1 allowed, Tier 2 locked, Tier 3 locked
      expect(canBuyDatasheetHonor(run, 'Captain', tier1Honor, 'u1').ok).toBe(true);

      const checkTier2At0Xp = canBuyDatasheetHonor(run, 'Captain', tier2Honor, 'u1');
      expect(checkTier2At0Xp.ok).toBe(false);
      expect(checkTier2At0Xp.isXpLocked).toBe(true);
      expect(checkTier2At0Xp.neededXp).toBe(1);

      const checkTier3At0Xp = canBuyDatasheetHonor(run, 'Captain', tier3Honor, 'u1');
      expect(checkTier3At0Xp.ok).toBe(false);
      expect(checkTier3At0Xp.isXpLocked).toBe(true);
      expect(checkTier3At0Xp.neededXp).toBe(2);

      // Unit gains 1 XP (Blooded): Tier 2 unlocked, Tier 3 still locked
      run.list.units[0].xp = 1;
      expect(canBuyDatasheetHonor(run, 'Captain', tier2Honor, 'u1').ok).toBe(true);
      expect(canBuyDatasheetHonor(run, 'Captain', tier3Honor, 'u1').ok).toBe(false);

      // Unit gains 2 XP (Veteran): Tier 3 unlocked
      run.list.units[0].xp = 2;
      expect(canBuyDatasheetHonor(run, 'Captain', tier3Honor, 'u1').ok).toBe(true);
    });

    it('prevents buyDatasheetHonor if XP is insufficient and allows once XP is gained', () => {
      const list: ArmyList = {
        name: 'Crusade Strike Force',
        factionId: 'SM',
        battleSize: 'incursion',
        detachments: ['Gladius Task Force'],
        units: [
          { uid: 'u1', datasheet: 'Captain', models: 1, pts: 80, xp: 0 },
        ],
      };
      let run = newRun(SM, list, ['ORK']);
      run.scrap = 500;

      // Try buying Tier 2 honor with 0 XP -> rejected, scrap untouched
      const runAfterFail = buyDatasheetHonor(run, SM, 'Captain', 'master_crafted', 'u1');
      expect(runAfterFail.scrap).toBe(500);
      expect(runAfterFail.datasheetHonors?.['Captain']).toBeUndefined();

      // Give unit 1 XP -> succeeds
      run.list.units[0].xp = 1;
      const runAfterSuccess = buyDatasheetHonor(run, SM, 'Captain', 'master_crafted', 'u1');
      expect(runAfterSuccess.scrap).toBeLessThan(500);
      expect(runAfterSuccess.datasheetHonors?.['Captain']).toContain('master_crafted');
    });

    it('autoUpgradeAll respects unit XP and does not purchase locked higher-tier honors for green units', () => {
      const list = autoList(SM, 500, 999);
      // Ensure all units start at 0 XP
      list.units = list.units.map((u) => ({ ...u, xp: 0 }));
      let run = newRun(SM, list, ['ORK'], 999);
      run.scrap = 1000;

      const upgraded = autoUpgradeAll(run, SM);
      expect(upgraded.scrap).toBeLessThan(1000);

      // Verify that every honor purchased by autoUpgradeAll for 0 XP units is Tier 1 (minXp <= 0)
      for (const [dname, honors] of Object.entries(upgraded.datasheetHonors ?? {})) {
        for (const hid of honors) {
          const h = battleHonorById(hid);
          expect(h).toBeDefined();
          expect(honorMinXp(h!)).toBeLessThanOrEqual(0);
        }
      }
    });
  });
});
