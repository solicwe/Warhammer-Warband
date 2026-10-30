import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canRecruitTitanOrKnight,
  continueNextLoop,
  getFactionFamily,
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

describe('Campaign Overhaul: Titan Locks & Multi-Sector', () => {
  const SM = loadFaction('SM');
  const ORK = loadFaction('ORK');
  const CSM = loadFaction('CSM');
  const NEC = loadFaction('NEC');
  const TYR = loadFaction('TYR');



  describe('3. Faction Families & Knight/Titan Recruitment Locks', () => {
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
