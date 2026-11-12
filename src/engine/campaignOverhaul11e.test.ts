import { describe, expect, it } from 'vitest';
import {
  newRun,
  enter,
  afterBattle,
  applyCampaign,
  canCompressSquad,
  compressSquad,
  canBuyMunitorumAmmo,
  buyMunitorumAmmo,
  setApexDesignation,
  setTacticalClock,
  hireAdvisor,
  unlockAdvisorSlot,
  upgradeOrbitalModule,
  selectOrbitalModule,
  absorbBossRule,
  fortifyGarrisonNode,
  selectPatronContract,
  autoOptimizePreBattle,
} from './campaign';
import { autoList } from './autoList';
import { createGame } from './game';
import { effectsFor } from '../rules-engine/effects';
import type { FactionData } from './types';

import fs from 'node:fs';
const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

describe('11th Edition Campaign Overhaul Systems', () => {
  it('initializes a run with 100 Fleet Integrity HP, High-Scrap economy and defaults', () => {
    const list = autoList(SM, 500, 1);
    const run = newRun(SM, list, ['ORK'], 1);

    expect(run.fleetIntegrityHP).toBe(100);
    expect(run.maxFleetIntegrityHP).toBe(100);
    expect(run.winLossStreak).toBe(0);
    expect(run.scrap).toBe(120);
    expect(run.maxInterestCap).toBe(50);
    expect(run.unlockedAdvisorSlots).toBe(1);
    expect(run.activeAdvisors).toContain('ADV_ORDNANCE');
    expect(run.tacticalClock).toHaveLength(5);
    expect(run.orbitalModules?.activeModule).toBe('LANCE_BATTERY');
    expect(run.secondaryMasteryRanks?.takeAndHold).toBe(1);
  });

  it('handles defeat integrity damage, consolation salvage, and streak tracking', () => {
    let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    const node = run.map.find((n) => n.enemy)!;
    run = enter(run, node.id, SM);

    // Battle defeat: 3 surviving enemy units, 20 VP difference on layer 0
    // Expected dmg = Base(3) + 2*3(6) + floor(20/10)(2) = 11 HP
    const lost = afterBattle(run, 1, SM, 'Orks', 40, { survivingEnemyUnits: 3, enemyVP: 30, playerVP: 10 });

    expect(lost.fleetIntegrityHP).toBe(89); // 100 - 11
    expect(lost.winLossStreak).toBe(-1);
    // Consolation salvage = base(120) + 11*3(33) + 40 loot + 0 streak + 10 interest (from 120 scrap) = 203
    expect(lost.scrap).toBeGreaterThan(120 + 150);
    expect(lost.story.at(-1)).toMatch(/Integrity HP \[89\/100\]/);
  });

  it('triggers comeback supply drops when HP drops below 75, 50, and 25 HP', () => {
    let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    run.fleetIntegrityHP = 74; // below 75
    const node = run.map.find((n) => n.enemy)!;
    run = { ...run, fighting: node.id };

    const lost = afterBattle(run, 1, SM, 'Orks', 0, { survivingEnemyUnits: 1, enemyVP: 10, playerVP: 10 });
    expect(lost.triggeredComebackThresholds?.hp75).toBe(true);
    expect(lost.scrap).toBeGreaterThan(200); // awarded +100 bonus scrap
  });

  it('supports Rank Compression (Tier I -> Tier II -> Tier III)', () => {
    let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    // Add 2 duplicate units to test compression
    run.list.units = [
      { uid: 'u1', datasheet: 'Intercessor Squad', models: 5, pts: 80, compressionTier: 1 },
      { uid: 'u2', datasheet: 'Intercessor Squad', models: 5, pts: 80, compressionTier: 1 },
    ];

    expect(canCompressSquad(run, 'u1')).toBe(true);
    const compressed = compressSquad(run, 'u1', 'u2');

    expect(compressed.list.units).toHaveLength(1);
    expect(compressed.list.units[0].compressionTier).toBe(2);
    expect(compressed.list.units[0].pts).toBe(160);
    expect(compressed.story.at(-1)).toMatch(/Rank Compression/);
  });

  it('manages Munitorum Ammo loadout purchase and single-battle consumption', () => {
    let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    run.list.units = [{ uid: 'u1', datasheet: 'Intercessor Squad', models: 5, pts: 80 }];
    run.scrap = 100;

    expect(canBuyMunitorumAmmo(run, 'u1', 'KRAKEN_BOLTS')).toBe(true);
    const equipped = buyMunitorumAmmo(run, 'u1', 'KRAKEN_BOLTS');

    expect(equipped.scrap).toBe(65); // 100 - 35
    expect(equipped.list.units[0].tempAmmoLoadout).toBe('KRAKEN_BOLTS');

    // After battle, consumable ammo expires
    const node = equipped.map.find((n: any) => n.enemy)!;
    const postBattle = afterBattle({ ...equipped, fighting: node.id }, 0, SM, 'Orks');
    expect(postBattle.list.units[0].tempAmmoLoadout).toBeUndefined();
  });

  it('assigns Apex Designations uniquely across the army', () => {
    let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    run.list.units = [
      { uid: 'u1', datasheet: 'Intercessor Squad', models: 5, pts: 80 },
      { uid: 'u2', datasheet: 'Predator Destructor', models: 1, pts: 130 },
    ];

    let updated = setApexDesignation(run, 'u1', 'VANGUARD_SPEARHEAD');
    expect(updated.list.units[0].apexDesignation).toBe('VANGUARD_SPEARHEAD');

    // Assigning same designation to u2 transfers it from u1
    updated = setApexDesignation(updated, 'u2', 'VANGUARD_SPEARHEAD');
    expect(updated.list.units[0].apexDesignation).toBeUndefined();
    expect(updated.list.units[1].apexDesignation).toBe('VANGUARD_SPEARHEAD');
  });

  it('hires High Command Advisors and unlocks slots', () => {
    let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    run.scrap = 300;
    run.unlockedAdvisorSlots = 1;
    run.activeAdvisors = ['ADV_ORDNANCE'];

    // Unlock slot 2
    const unlocked = unlockAdvisorSlot(run);
    expect(unlocked.unlockedAdvisorSlots).toBe(2);
    expect(unlocked.scrap).toBe(200); // 300 - 100

    // Hire Chief Apothecary
    const hired = hireAdvisor(unlocked, 'ADV_APOTHECARY');
    expect(hired.activeAdvisors).toContain('ADV_APOTHECARY');
    expect(hired.scrap).toBe(80); // 200 - 120
  });

  it('upgrades Orbital Strike Modules and absorbs Boss Rules', () => {
    let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    run.scrap = 200;

    const upgraded = upgradeOrbitalModule(run, 'LANCE_BATTERY');
    expect(upgraded.orbitalModules.levels.LANCE_BATTERY).toBe(2);

    // Absorb Boss Rule
    const absorbed1 = absorbBossRule(upgraded, 'void-shields');
    expect(absorbed1.absorbedBossRules).toEqual([{ ruleId: 'void-shields', level: 1 }]);

    // Absorb duplicate -> Ascends to Lv.2
    const ascended = absorbBossRule(absorbed1, 'void-shields');
    expect(ascended.absorbedBossRules).toEqual([{ ruleId: 'void-shields', level: 2 }]);
  });

  it('signs Patronage Contracts and fortifies Sector Garrison nodes', () => {
    let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    const contracted = selectPatronContract(run, 'PATRON_ROGUE_TRADER');
    expect(contracted.activePatronContract).toBe('PATRON_ROGUE_TRADER');
    expect(contracted.maxInterestCap).toBe(100);

    contracted.scrap = 100;
    const fortified = fortifyGarrisonNode(contracted, 'n0-0');
    expect(fortified.fortifiedNodeIds).toContain('n0-0');
    expect(fortified.scrap).toBe(40); // 100 - 60
  });

  it('applies Tactical Clock, Gilded Arsenal, and Compression stats in battle', () => {
    const list = autoList(SM, 500, 1);
    list.units = [
      { uid: 'u1', datasheet: 'Intercessor Squad', models: 5, pts: 80, compressionTier: 2 },
    ];
    let run = newRun(SM, list, ['ORK'], 1);
    run.scrap = 500; // triggers +15% damage and +2 Shield
    run.tacticalClock = [
      'SHROUD_OF_NIGHT',
      'BLITZKRIEG_SURGE',
      'ANNIHILATION_VOLLEY',
      'AEGIS_OF_IRON',
      'WARMASTER_ASCENDANCY',
    ];

    const orkList = autoList(ORK, 500, 1);
    const s = createGame({
      lists: [run.list, orkList],
      factions: [SM, ORK],
      names: ['Player', 'Enemies'],
      seed: 10,
    });

    applyCampaign(s, run, []);

    // Gilded Arsenal active
    expect(s.gildedBonus?.damagePercent).toBe(15);
    expect(s.gildedBonus?.shieldBonus).toBe(2);

    // Tactical Clock set
    expect(s.tacticalClockDirective).toBe('SHROUD_OF_NIGHT');

    // Compressed unit Tier II has scaled Wounds and +1 Save
    const unit = s.units.find((u) => u.owner === 0);
    expect(unit?.compressionTier).toBe(2);
    // Base W was 2, Tier II +1 Wound bonus = 3 Wounds per model
    expect(unit?.models[0].wounds).toBe(3);
    // Base Sv was 3, save bonus +1 -> Sv 2+
    expect(unit?.models[0].profile.Sv).toBe(2);
  });
  it('auto-optimizes Tactical Clock battle directives based on army profile', () => {
    let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    const optimized = autoOptimizePreBattle(run, SM);

    expect(optimized.tacticalClock).toBeDefined();
    expect(optimized.tacticalClock).toHaveLength(5);
  });

  it('populates pendingBossTrophyRules on boss victory and absorbs into Trophy Rack', () => {
    let run = newRun(SM, autoList(SM, 500, 1), ['ORK'], 1);
    const bossNode = run.map.find((n) => n.kind === 'boss')!;
    run = enter(run, bossNode.id, SM);

    const won = afterBattle(run, 0, SM, 'Boss Warboss', 50);
    expect(won.pendingBossTrophyRules).toBeDefined();
    expect(won.pendingBossTrophyRules!.length).toBeGreaterThan(0);

    const ruleToAbsorb = won.pendingBossTrophyRules![0];
    const afterAbsorption = absorbBossRule(won, ruleToAbsorb);
    expect(afterAbsorption.absorbedBossRules.some((r: any) => r.ruleId === ruleToAbsorb)).toBe(true);
  });
});
