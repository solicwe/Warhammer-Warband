import { describe, expect, it } from 'vitest';
import { combatMods } from './combatMods';
import {
  applyKeystoneBattleSetup,
  checkMachineInstability,
  handleBloodPactSpend,
  hasActiveKeystone,
  processKeystoneTurnStart,
  TRANSFORMATIVE_KEYSTONES,
} from './keystones';
import { applyMortalWounds, loseWoundsForTest } from './attack';
import { initCombatState } from './combatEngine';
import type { GameState, ModelState, UnitState } from './types';

function createMockModel(name: string, wounds = 3, maxWounds = 3, x = 10, y = 10): ModelState {
  return {
    id: `m-${Math.random().toString(36).slice(2, 7)}`,
    name,
    wounds,
    profile: {
      name,
      M: 6,
      T: 4,
      Sv: 3,
      InSv: 4,
      W: maxWounds,
      Ld: 7,
      OC: 1,
      base: { w: 1, h: 1, text: '32mm' },
    },
    r: 0.6,
    x,
    y,
    dead: wounds <= 0,
    keywords: [],
    gear: [],
    source: name,
    isCharacter: false,
    isBodyguard: false,
    weapons: [],
  };
}

function createMockUnit(name: string, owner: 0 | 1 = 0, role: any = 'VANGUARD', x = 10, y = 10): UnitState {
  const models = [createMockModel(`${name}-1`, 3, 3, x, y), createMockModel(`${name}-2`, 3, 3, x + 1, y)];
  return {
    id: `u-${name.toLowerCase().replace(/\s+/g, '-')}`,
    owner,
    name,
    sources: [name],
    keywords: ['INFANTRY'],
    factionKeywords: ['IMPERIUM'],
    models,
    startingStrength: 2,
    pts: 100,
    status: 'board',
    embarkedIn: null,
    transport: null,
    weaponsFired: [],
    cantCharge: false,
    scoutDone: false,
    battleShocked: false,
    isWarlordUnit: false,
    enhancements: [],
    move: null,
    advanceRoll: null,
    maxMoved: 0,
    setUpTurn: 0,
    shotTurn: -10,
    selectedToShoot: false,
    declaredCharge: false,
    chargeRoll: null,
    chargedTurn: -10,
    chargeTargets: [],
    fought: false,
    foughtFirstUntilTurn: -10,
    stratagemPhase: null,
    oneShotUsed: [],
    buffs: [],
    combatRole: role,
    combatState: initCombatState(role),
    maxSockets: 2,
    socketedRelics: [],
    veterancyTraits: [],
    abilities: [],
    core: {},
  };
}

function createMockState(): GameState {
  return {
    turn: 1,
    round: 1,
    active: 0,
    phase: 'shooting',
    units: [],
    players: [
      { id: 0, name: 'Player 1', factionId: 'SM', cp: 2, vp: 0, stratagemsUsed: [], secondaries: [] },
      { id: 1, name: 'Player 2', factionId: 'ORK', cp: 2, vp: 0, stratagemsUsed: [], secondaries: [] },
    ],
    terrain: [],
    objectives: [],
    rng: 42,
    log: [],
    fx: [],
    destroyedByTurn: [],
  } as unknown as GameState;
}

describe('12 Transformative Keystones Engine (v2.0)', () => {
  it('contains definitions for all 12 Transformative Keystones', () => {
    expect(Object.keys(TRANSFORMATIVE_KEYSTONES).length).toBe(12);
    expect(TRANSFORMATIVE_KEYSTONES.warp_inoculation.poeInspiration).toContain('Chaos Inoculation');
    expect(TRANSFORMATIVE_KEYSTONES.blood_pact.poeInspiration).toContain('Blood Magic');
  });

  it('Warp Inoculation: converts biological HP to 1 and grants 150% Warp Ward Energy Shield', () => {
    const s = createMockState();
    s.campaign = { node: 'n', relics: [], rules: ['Warp Inoculation'] };

    const unit = createMockUnit('Terminators', 0, 'BREACHER');
    // 2 models with 3 wounds each = 6 wounds total
    s.units = [unit];

    applyKeystoneBattleSetup(s, 0);

    // Biological life reduced to 1
    expect(unit.models[0].wounds).toBe(1);
    expect(unit.models[1].wounds).toBe(1);

    // Warp Ward = 6 * 1.5 = 9
    expect(unit.combatState?.warpWardHP).toBe(9);
    expect(unit.combatState?.maxWarpWardHP).toBe(9);

    // Ailment immunity: Soulfire Mortal Wounds deal 0 damage!
    const mwDealt = applyMortalWounds(s, unit, 3, 'Soulfire');
    expect(mwDealt).toBe(0);
    expect(unit.models[0].wounds).toBe(1); // undamaged

    // Recharge at turn start
    unit.combatState!.warpWardHP = 4;
    processKeystoneTurnStart(s, 0);
    expect(unit.combatState?.warpWardHP).toBe(9);
  });

  it('Lone Wolf Protocol: empowers small armies (<= 4 units) with double HP and 3x OC', () => {
    const s = createMockState();
    s.campaign = { node: 'n', relics: [], rules: ['Lone Wolf Protocol'] };

    const unit1 = createMockUnit('Apex Hero', 0, 'BEHEMOTH');
    s.units = [unit1];

    applyKeystoneBattleSetup(s, 0);

    // Initial HP was 3 per model -> now 6
    expect(unit1.models[0].profile.W).toBe(6);
    expect(unit1.models[0].wounds).toBe(6);

    // Initial OC was 1 -> now 3
    expect(unit1.models[0].profile.OC).toBe(3);
  });

  it('Glass Cannon Overdrive: worsens Armor Save by 2 but grants Critical Hit on 4+', () => {
    const s = createMockState();
    s.campaign = { node: 'n', relics: [], rules: ['Glass Cannon Overdrive'] };

    const attacker = createMockUnit('Sniper Team', 0, 'VANGUARD');
    const defender = createMockUnit('Ork Nobz', 1, 'VANGUARD');
    s.units = [attacker, defender];

    // Armor Save check: 3+ worsened to 5+
    applyKeystoneBattleSetup(s, 0);
    expect(attacker.models[0].profile.Sv).toBe(5);

    // Combat mods check: Crit on 4+
    const mods = combatMods({
      s,
      A: attacker,
      T: defender,
      m: attacker.models[0],
      psychic: false,
      mode: 'ranged',
      d: 18,
      p: { range: 36, A: '2', BS: 3, S: 5, AP: -2, D: '2', abilities: [] } as any,
      weapon: 'Sniper Rifle',
    });

    expect(mods.critHitOn).toBe(4);
  });

  it('Point Blank Doctrines: provides +1 AP and +1 Damage within half range', () => {
    const s = createMockState();
    s.campaign = { node: 'n', relics: [], rules: ['Point Blank Doctrines'] };

    const attacker = createMockUnit('Shotgunner', 0, 'SKIRMISHER');
    const defender = createMockUnit('Target Grot', 1, 'VANGUARD');
    s.units = [attacker, defender];

    const weapon = { range: 12, A: '2', BS: 3, S: 4, AP: 0, D: '1', abilities: [] } as any;

    // Within half range (5" <= 6")
    const modsClose = combatMods({
      s,
      A: attacker,
      T: defender,
      m: attacker.models[0],
      psychic: false,
      mode: 'ranged',
      d: 5,
      p: weapon,
      weapon: 'Combat Shotgun',
    });

    expect(modsClose.apBonus).toBe(1);
    expect(modsClose.damageBonus).toBe(1);
  });

  it('Machine Instability: Gunship self-destructs when HP drops <= 25%, dealing massive MW', () => {
    const s = createMockState();
    s.campaign = { node: 'n', relics: [], rules: ['Machine Instability'] };

    const gunship = createMockUnit('Land Raider', 0, 'GUNSHIP', 10, 10);
    const nearbyEnemy = createMockUnit('Enemy Squad', 1, 'VANGUARD', 12, 10); // 2" away
    s.units = [gunship, nearbyEnemy];

    // Total HP = 6 (2 models x 3 wounds). Drop to 1 wound (<= 25%)
    gunship.models[0].wounds = 1;
    gunship.models[1].dead = true;
    gunship.models[1].wounds = 0;

    const initialEnemyHP = nearbyEnemy.models[0].wounds + nearbyEnemy.models[1].wounds;

    checkMachineInstability(s, gunship);

    // Gunship should be destroyed and enemy should suffer mortal wounds
    expect(gunship.status).toBe('destroyed');
    const currentEnemyHP = nearbyEnemy.models[0].wounds + nearbyEnemy.models[1].wounds;
    expect(currentEnemyHP).toBeLessThan(initialEnemyHP);
  });

  it('Blood Pact Munitions: burns 1d3 wounds from friendly unit and grants 3 Fervour instead of CP', () => {
    const s = createMockState();
    s.campaign = { node: 'n', relics: [], rules: ['Blood Pact Munitions'] };

    const unit = createMockUnit('Cultist Zealots', 0, 'VANGUARD');
    s.units = [unit];

    const initialHP = unit.models[0].wounds + unit.models[1].wounds;
    const handled = handleBloodPactSpend(s, unit, 1);

    expect(handled).toBe(true);
    const currentHP = unit.models[0].wounds + unit.models[1].wounds;
    expect(currentHP).toBeLessThan(initialHP);
    expect(unit.combatState?.tokens.fervour).toBe(3);
  });

  it('Unwavering Stance: converts Invuln save to +2 Toughness and disables InSv', () => {
    const s = createMockState();
    s.campaign = { node: 'n', relics: [], rules: ['Unwavering Stance'] };

    const unit = createMockUnit('Shield Custodes', 0, 'BREACHER');
    // Initially T4, InSv 4
    s.units = [unit];

    applyKeystoneBattleSetup(s, 0);

    expect(unit.models[0].profile.T).toBe(6); // 4 + 2
    expect(unit.models[0].profile.InSv).toBeNull();
  });
});
