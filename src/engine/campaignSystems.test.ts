import { describe, expect, it } from 'vitest';
import {
  calculateDefeatDamage,
  calculateStreakBonus,
  calculateConsolationScrap,
  calculateHoardInterest,
  calculateGildedBonus,
  getCompressionStatScaling,
  calculateGarrisonBuffs,
  checkComebackThresholds,
  createDefaultCampaignOverhaulState,
  HIGH_COMMAND_ADVISORS,
  TACTICAL_CLOCK_DIRECTIVES,
  APEX_DESIGNATIONS,
  MUNITORUM_AMMO,
  ORBITAL_MODULES,
  PATRON_CONTRACTS,
} from './campaignSystems';

describe('Campaign Systems: Zero-Collision Rule Engine & 10 Features', () => {
  it('correctly calculates defeat damage with layer scaling and VP differential', () => {
    // Normal battle layer 0, 2 surviving enemies, 15 VP difference:
    // Base = 3, 2 * 2 = 4, floor(15 / 10) = 1 => 3 + 4 + 1 = 8 HP
    const dmg1 = calculateDefeatDamage(0, 2, 25, 10, false);
    expect(dmg1).toBe(8);

    // Layer 5, 5 surviving enemies, 40 VP diff => Base = 10, 2*5 = 10, 4 => 24 HP
    const dmg2 = calculateDefeatDamage(5, 5, 50, 10, false);
    expect(dmg2).toBe(24);

    // Normal battle damage capped at 25 HP
    const dmgCapped = calculateDefeatDamage(6, 10, 100, 0, false);
    expect(dmgCapped).toBe(25);

    // Boss battle is not capped at 25
    const dmgBoss = calculateDefeatDamage(6, 10, 100, 0, true);
    expect(dmgBoss).toBe(15 + 20 + 10); // 45 HP
  });

  it('calculates streak bonus for both win and loss streaks', () => {
    expect(calculateStreakBonus(1)).toEqual({ scrap: 0, freeReroll: false });
    expect(calculateStreakBonus(2)).toEqual({ scrap: 20, freeReroll: false });
    expect(calculateStreakBonus(-2)).toEqual({ scrap: 20, freeReroll: false });
    expect(calculateStreakBonus(3)).toEqual({ scrap: 40, freeReroll: false });
    expect(calculateStreakBonus(-3)).toEqual({ scrap: 40, freeReroll: false });
    expect(calculateStreakBonus(4)).toEqual({ scrap: 70, freeReroll: true });
    expect(calculateStreakBonus(-5)).toEqual({ scrap: 70, freeReroll: true });
  });

  it('calculates consolation salvage on defeat', () => {
    // Base 120 + 10 damage * 3 scrap = 150 scrap
    const salvage = calculateConsolationScrap(120, 10);
    expect(salvage).toBe(150);
  });

  it('calculates Munitorum Hoard interest and respect caps', () => {
    expect(calculateHoardInterest(80)).toBe(0);
    expect(calculateHoardInterest(150)).toBe(10);
    expect(calculateHoardInterest(490)).toBe(40);
    expect(calculateHoardInterest(550)).toBe(50); // Capped at 50 default
    expect(calculateHoardInterest(1200, 50)).toBe(50);
    expect(calculateHoardInterest(1200, 100)).toBe(100); // Expanded cap
  });

  it('calculates Gilded Arsenal wealth-to-power bonuses', () => {
    const b0 = calculateGildedBonus(50);
    expect(b0.damagePercent).toBe(0);
    expect(b0.shieldBonus).toBe(0);
    expect(b0.critThresholdBonus).toBe(false);

    const b200 = calculateGildedBonus(250);
    expect(b200.damagePercent).toBe(6); // 2 * 3%
    expect(b200.shieldBonus).toBe(0);

    const b500 = calculateGildedBonus(520);
    expect(b500.damagePercent).toBe(15); // 5 * 3%
    expect(b500.shieldBonus).toBe(2);

    const b1000 = calculateGildedBonus(1100);
    expect(b1000.damagePercent).toBe(30); // Max 30%
    expect(b1000.shieldBonus).toBe(2);
    expect(b1000.critThresholdBonus).toBe(true);
  });

  it('scales stats properly for Rank Compression Tier I, II, and III', () => {
    const t1 = getCompressionStatScaling(1);
    expect(t1.woundsMult).toBe(1.0);
    expect(t1.attacksMult).toBe(1.0);
    expect(t1.damageBonus).toBe(0);

    const t2 = getCompressionStatScaling(2);
    expect(t2.woundsMult).toBe(1.8);
    expect(t2.attacksMult).toBe(1.6);
    expect(t2.ocBonus).toBe(1);
    expect(t2.saveBonus).toBe(1);

    const t3 = getCompressionStatScaling(3);
    expect(t3.woundsMult).toBe(2.6);
    expect(t3.attacksMult).toBe(2.3);
    expect(t3.damageBonus).toBe(1);
    expect(t3.fnp).toBe(5);
  });

  it('triggers comeback thresholds correctly when Fleet Integrity drops', () => {
    const triggered = { hp75: false, hp50: false, hp25: false };
    
    // Drop to 80 - nothing
    const r80 = checkComebackThresholds(80, triggered);
    expect(r80.scrapReward).toBe(0);

    // Drop to 70 - trigger hp75
    const r70 = checkComebackThresholds(70, triggered);
    expect(r70.updated.hp75).toBe(true);
    expect(r70.scrapReward).toBe(100);
    expect(r70.grantAmmo).toBe(true);

    // Drop to 40 - triggers hp50 (with hp75 already triggered)
    const r40 = checkComebackThresholds(40, r70.updated);
    expect(r40.updated.hp50).toBe(true);
    expect(r40.renownReward).toBe(2);
    expect(r40.grantEpicCard).toBe(true);

    // Drop to 20 - triggers Desperate Crusade
    const r20 = checkComebackThresholds(20, r40.updated);
    expect(r20.updated.hp25).toBe(true);
    expect(r20.grantDesperateCrusade).toBe(true);
  });

  it('calculates sector garrison buffs from visited nodes', () => {
    const visited = [
      { id: 'n1', kind: 'battle' },
      { id: 'n2', kind: 'elite' },
      { id: 'n3', kind: 'armory' },
      { id: 'n4', kind: 'medicae' },
    ];
    const buffs = calculateGarrisonBuffs(visited, ['n1']); // n1 is fortified (double)
    expect(buffs.scrapDropPercent).toBe(16); // 8 * 2
    expect(buffs.startingShield).toBe(2);
    expect(buffs.startingCP).toBe(1);
    expect(buffs.critDamagePercent).toBe(5);
    expect(buffs.earlyRoundsAP).toBe(1);
    expect(buffs.turnStartHeal).toBe(1);
  });

  it('has all 10 core systems registered with valid configurations', () => {
    expect(Object.keys(HIGH_COMMAND_ADVISORS)).toHaveLength(8);
    expect(Object.keys(TACTICAL_CLOCK_DIRECTIVES)).toHaveLength(5);
    expect(Object.keys(APEX_DESIGNATIONS)).toHaveLength(4);
    expect(Object.keys(MUNITORUM_AMMO)).toHaveLength(5);
    expect(Object.keys(ORBITAL_MODULES)).toHaveLength(3);
    expect(Object.keys(PATRON_CONTRACTS)).toHaveLength(4);

    const defaultState = createDefaultCampaignOverhaulState();
    expect(defaultState.fleetIntegrityHP).toBe(100);
    expect(defaultState.tacticalClock).toHaveLength(5);
  });
});
