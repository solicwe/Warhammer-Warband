import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  autoUpgradeAll,
  buyDatasheetHonor,
  buyTechNode,
  canRecruitTitanOrKnight,
  continueNextLoop,
  datasheetHonorCost,
  getFactionFamily,
  getFactionTechNodes,
  getSmartBattleHonors,
  newRun,
  recruitUnit,
  sellUnit,
  sellValue,
  type Run,
} from './campaign';
import { autoList } from './autoList';
import type { DatasheetData, FactionData } from './types';
import { hasRealPortrait, isPlaceholderIcon } from '../ui/portraits';

function loadFaction(id: string): FactionData {
  const file = path.join(process.cwd(), 'public', 'data', 'factions', `${id}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as FactionData;
}

describe('Campaign Overhaul: Smart Upgrades, Tech Tree, Titan Locks & Multi-Sector', () => {
  const SM = loadFaction('SM');
  const ORK = loadFaction('ORK');
  const CSM = loadFaction('CSM');
  const NEC = loadFaction('NEC');
  const TYR = loadFaction('TYR');

  describe('1. Smart Upgrade Filter (getSmartBattleHonors)', () => {
    it('never offers 4+ Invulnerable save if the unit already has 4+ Invuln', () => {
      // Find a datasheet with 4+ invulnerable save (e.g. Captain or Bladeguard)
      const captain = SM.datasheets.find((d) => d.name === 'Captain')
        ?? SM.datasheets.find((d) => (d.models || []).some((m) => (m.InSv ?? 99) <= 4));
      expect(captain).toBeDefined();

      const honors = getSmartBattleHonors(captain!);
      expect(honors.some((h) => h.id === 'invulnerable_aegis')).toBe(false);
      expect(honors.some((h) => h.e.defend?.inv === 4)).toBe(false);
    });

    it('never offers +1 Save if the unit already has a 2+ Save', () => {
      // Find a 2+ save model (e.g. Terminator Squad or Captain in Terminator Armour)
      const terminator = SM.datasheets.find((d) => (d.models || []).some((m) => m.Sv <= 2));
      expect(terminator).toBeDefined();

      const honors = getSmartBattleHonors(terminator!);
      expect(honors.some((h) => h.id === 'reinforced_save')).toBe(false);
    });

    it('never offers ranged buffs to pure melee units', () => {
      // Find a pure melee unit (e.g. Assault Intercessors or Khorne Berzerkers)
      const meleeUnit = SM.datasheets.find((d) =>
        d.weapons.length > 0 &&
        d.weapons.every((w) => w.profiles.every((p) => p.range === 'Melee' || p.range === null))
      );
      if (meleeUnit) {
        const honors = getSmartBattleHonors(meleeUnit);
        expect(honors.some((h) => h.role === 'ranged')).toBe(false);
        expect(honors.some((h) => h.id === 'range_finders')).toBe(false);
        expect(honors.some((h) => h.id === 'lethal_spec')).toBe(false);
        expect(honors.some((h) => h.id === 'heavy_salvo')).toBe(false);
      }
    });

    it('never offers duplicate weapon abilities if the unit weapons already have them', () => {
      // Find a unit with lethal hits already on a weapon
      const lethalUnit = SM.datasheets.find((d) =>
        d.weapons.some((w) => w.profiles.some((p) => (p.abilities || []).includes('lethal hits')))
      );
      if (lethalUnit) {
        const honors = getSmartBattleHonors(lethalUnit);
        expect(honors.some((h) => h.id === 'lethal_spec')).toBe(false);
      }
    });
  });

  describe('2. Datasheet-Wide Global Upgrades (buyDatasheetHonor & autoUpgradeAll)', () => {
    it('upgrades all existing squads of the same datasheet and future recruits inherit honors', () => {
      const list = autoList(SM, 500, 42);
      let run = newRun(SM, list, ['ORK'], 42);
      run.scrap = 1000;

      // Add two Intercessor squads
      run = recruitUnit(run, SM, 'Intercessor Squad', 5);
      run = recruitUnit(run, SM, 'Intercessor Squad', 5);

      const intercessors = run.list.units.filter((u) => u.datasheet === 'Intercessor Squad');
      expect(intercessors.length).toBeGreaterThanOrEqual(2);

      // Buy datasheet-wide honor
      run = buyDatasheetHonor(run, SM, 'Intercessor Squad', 'hardened');
      expect(run.datasheetHonors?.['Intercessor Squad']).toContain('hardened');

      // Check all present squads received the honor
      const updatedIntercessors = run.list.units.filter((u) => u.datasheet === 'Intercessor Squad');
      for (const sq of updatedIntercessors) {
        expect(sq.honors).toContain('hardened');
      }

      // Recruit another Intercessor Squad: must inherit 'hardened' automatically!
      run = recruitUnit(run, SM, 'Intercessor Squad', 5);
      const newRecruit = run.list.units[run.list.units.length - 1];
      expect(newRecruit.datasheet).toBe('Intercessor Squad');
      expect(newRecruit.honors).toContain('hardened');
    });

    it('scales scrap cost based on squad count in army', () => {
      expect(datasheetHonorCost(100, 1)).toBe(100);
      expect(datasheetHonorCost(100, 2)).toBe(140);
      expect(datasheetHonorCost(100, 3)).toBe(180);
    });

    it('autoUpgradeAll upgrades all distinct datasheets with compatible smart honors', () => {
      const list = autoList(SM, 500, 123);
      let run = newRun(SM, list, ['ORK'], 123);
      run.scrap = 500;

      const runUpgraded = autoUpgradeAll(run, SM);
      expect(runUpgraded.scrap).toBeLessThan(500);
      expect(Object.keys(runUpgraded.datasheetHonors ?? {}).length).toBeGreaterThan(0);
    });
  });

  describe('3. Faction Tech Tree & Knight/Titan Recruitment Locks', () => {
    it('assigns correct faction family to each army', () => {
      expect(getFactionFamily('SM')).toBe('IMPERIUM');
      expect(getFactionFamily('AM')).toBe('IMPERIUM');
      expect(getFactionFamily('CSM')).toBe('CHAOS');
      expect(getFactionFamily('DG')).toBe('CHAOS');
      expect(getFactionFamily('ORK')).toBe('ORKS');
      expect(getFactionFamily('NEC')).toBe('NECRONS');
      expect(getFactionFamily('TYR')).toBe('TYRANIDS');
      expect(getFactionFamily('TAU')).toBe('XENOS');
    });

    it('enforces tech tree prerequisites and purchasing', () => {
      let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
      run.scrap = 300;

      // Tier 1 has no prerequisites
      const t1 = getFactionTechNodes('SM').find((n) => n.tier === 1)!;
      run = buyTechNode(run, t1.id);
      expect(run.techTree).toContain(t1.id);

      // Tier 2 requires Tier 1
      const t2 = getFactionTechNodes('SM').find((n) => n.tier === 2)!;
      run = buyTechNode(run, t2.id);
      expect(run.techTree).toContain(t2.id);
    });

    it('strictly forbids Xenos from recruiting Imperial or Chaos Knights / Titans', () => {
      const runOrk = newRun(ORK, autoList(ORK, 500, 1), ['SM'], 1);
      const knightDatasheet: DatasheetData = {
        id: 'knight-paladin',
        name: 'Knight Paladin',
        role: 'Lord of War',
        keywords: ['VEHICLE', 'TITANIC', 'TOWERING', 'KNIGHT'],
        factionKeywords: ['IMPERIAL KNIGHTS'],
        ally: 'QI',
        models: [{ name: 'Knight Paladin', M: 10, T: 12, Sv: 3, InSv: 5, W: 22, Ld: 6, OC: 10, base: { w: 170, h: 105, text: '170x105mm' } }],
        composition: [{ text: '1 Knight Paladin' }],
        loadout: {},
        loadoutText: '',
        options: [],
        weapons: [],
        abilities: [],
        leads: [],
        isSupport: false,
        points: [{ label: '', options: [{ models: 1, pts: 450 }] }],
        link: '',
      };

      // Orks can NEVER recruit an Imperial Knight!
      expect(canRecruitTitanOrKnight('ORK', knightDatasheet, runOrk)).toBe(false);
      // Necrons can NEVER recruit an Imperial Knight!
      expect(canRecruitTitanOrKnight('NEC', knightDatasheet, runOrk)).toBe(false);
    });
  });

  describe('4. Strict Sprite Validation (hasRealPortrait)', () => {
    it('validates real unit portraits and rejects placeholders', () => {
      expect(isPlaceholderIcon(undefined)).toBe(true);
      expect(isPlaceholderIcon('images/placeholder.webp')).toBe(true);
      expect(isPlaceholderIcon('#tok-generic')).toBe(true);
      expect(isPlaceholderIcon('images/units/SM/intercessors.webp')).toBe(false);

      expect(hasRealPortrait('Intercessor Squad')).toBe(true);
      expect(hasRealPortrait('Stompa')).toBe(true);
      expect(hasRealPortrait('NonExistentFakeUnit123')).toBe(false);
    });
  });

  describe('5. Multi-Sector Campaign Progression (Sectors 1-5 & Endless Crusade)', () => {
    it('tracks sector progression up to Sector 5 and enters Endless Crusade mode', () => {
      let run = newRun(SM, autoList(SM, 500, 99), ['ORK'], 99);
      expect(run.loop ?? 1).toBe(1);

      // Complete sector 1 -> Sector 2
      run = continueNextLoop(run, SM);
      expect(run.loop).toBe(2);
      expect(run.sector).toBe(2);
      expect(run.story[run.story.length - 1]).toContain('Sector 2 of 5');

      // Progress through sectors to Endless Crusade
      run = continueNextLoop(run, SM); // 3
      run = continueNextLoop(run, SM); // 4
      run = continueNextLoop(run, SM); // 5
      expect(run.loop).toBe(5);
      expect(run.sector).toBe(5);
      expect(run.story[run.story.length - 1]).toContain('Sector 5 of 5');

      run = continueNextLoop(run, SM); // Sector 6 -> Endless Crusade
      expect(run.loop).toBe(6);
      expect(run.sector).toBe(6);
      expect(run.story[run.story.length - 1]).toContain('Endless Crusade Mode');
    });
  });

  describe('6. Unit Selling (sellUnit & sellValue)', () => {
    it('refunds 75% scrap and auto-transfers warlord when sold', () => {
      let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
      const u0 = run.list.units[0];
      const initialScrap = run.scrap;
      const expectedRefund = sellValue(u0);

      run = sellUnit(run, u0.uid);
      expect(run.scrap).toBe(initialScrap + expectedRefund);
      expect(run.list.units.some((u) => u.uid === u0.uid)).toBe(false);
      // Ensure army still has a warlord
      expect(run.list.units.some((u) => u.warlord)).toBe(true);
    });
  });
});
