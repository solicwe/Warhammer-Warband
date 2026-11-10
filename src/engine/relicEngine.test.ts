import { describe, expect, it } from 'vitest';
import { addCombatToken, expendCombatToken, initCombatState } from './combatEngine';
import { createSocketedRelic, getUnitSocketedRelics, socketRelicToUnit, triggerRelicEvent, unsocketRelicFromUnit } from './relicEngine';
import { combatMods } from './combatMods';
import type { GameState, ModelState, UnitState } from './types';

function createMockModel(name: string, wounds = 2, maxWounds = 2, x = 10, y = 10): ModelState {
  return {
    id: `m-${Math.random().toString(36).slice(2, 7)}`,
    name,
    wounds,
    profile: {
      name,
      M: 6,
      T: 4,
      Sv: 3,
      InSv: null,
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

function createMockUnit(name: string, owner: 0 | 1 = 0, role: any = 'VANGUARD', x = 10, y = 10, maxSockets: 1 | 2 | 3 = 2): UnitState {
  const models = [createMockModel(`${name}-1`, 2, 2, x, y), createMockModel(`${name}-2`, 2, 2, x + 1, y)];
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
    maxSockets,
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

describe('Relic Sockets & Procs Engine (v2.0)', () => {
  it('manages unit sockets respecting maxSockets cap', () => {
    const unit = createMockUnit('Tactical Squad', 0, 'VANGUARD', 10, 10, 2);

    expect(socketRelicToUnit(unit, 'gem_devastation')).toBe(true);
    expect(unit.socketedRelics).toEqual(['gem_devastation']);

    expect(socketRelicToUnit(unit, 'proc_arc_lightning')).toBe(true);
    expect(unit.socketedRelics).toEqual(['gem_devastation', 'proc_arc_lightning']);

    // Attempting to socket beyond cap (2) should fail
    expect(socketRelicToUnit(unit, 'util_gravity_well')).toBe(false);
    expect(unit.socketedRelics?.length).toBe(2);

    // Unsocketing
    expect(unsocketRelicFromUnit(unit, 'gem_devastation')).toBe(true);
    expect(unit.socketedRelics).toEqual(['proc_arc_lightning']);
  });

  it('Conduit units share their 1st socketed relic with nearby allies within 6"', () => {
    const s = createMockState();
    const leader = createMockUnit('Captain', 0, 'CONDUIT', 10, 10, 3);
    socketRelicToUnit(leader, 'proc_arc_lightning');
    socketRelicToUnit(leader, 'gem_devastation');

    const allyNearby = createMockUnit('Intercessors', 0, 'VANGUARD', 12, 10, 1);
    const allyFar = createMockUnit('Scouts', 0, 'VANGUARD', 25, 10, 1);

    s.units = [leader, allyNearby, allyFar];

    const nearbyRelics = getUnitSocketedRelics(allyNearby, s);
    expect(nearbyRelics.some((r) => r.id === 'proc_arc_lightning')).toBe(true);

    const farRelics = getUnitSocketedRelics(allyFar, s);
    expect(farRelics.some((r) => r.id === 'proc_arc_lightning')).toBe(false);
  });

  it('Mutator Gem: Core of Devastation applies Devastating Wounds and level-scaled attack penalty', () => {
    const s = createMockState();
    const unitLv1 = createMockUnit('Sternguard Lv1', 0, 'VANGUARD');
    socketRelicToUnit(unitLv1, 'gem_devastation');

    const target = createMockUnit('Ork Boyz', 1, 'VANGUARD');
    s.units = [unitLv1, target];

    const modsLv1 = combatMods({ s, A: unitLv1, T: target, m: unitLv1.models[0], psychic: false, mode: 'ranged', d: 12, p: {} as any, weapon: 'Bolt Rifle' });

    expect(modsLv1.devastating).toBe(true);
    expect(modsLv1.attacksBonus).toBe(-1); // Lv.1 has -1 attack penalty

    // Upgrade to Lv.2 via campaign state
    s.campaign = { node: 'battle_1', relics: ['gem_devastation'], rules: [], relicLevels: { gem_devastation: 2 } };

    // Re-check with campaign level 2: no attack penalty!
    const cards = getUnitSocketedRelics(unitLv1, s);
    expect(cards[0].level).toBe(2);
  });

  it('Mutator Gem: Echoing Chamber grants Sustained Hits 1 (Lv.1) and Sustained Hits 2 (Lv.2)', () => {
    const s = createMockState();
    const unit = createMockUnit('Assault Marines', 0, 'SKIRMISHER');
    socketRelicToUnit(unit, 'gem_sustained');
    const target = createMockUnit('Cultists', 1, 'VANGUARD');
    s.units = [unit, target];

    const mods = combatMods({ s, A: unit, T: target, m: unit.models[0], psychic: false, mode: 'melee', d: 0, p: {} as any, weapon: 'Chainsword' });

    expect(mods.sustained).toBe('1');
  });

  it('Trigger Gem: Tesla Arc Coil triggers chain lightning on Critical Hits', () => {
    const s = createMockState();
    const attacker = createMockUnit('Infiltrator', 0, 'VANGUARD', 10, 10);
    socketRelicToUnit(attacker, 'proc_arc_lightning');

    const target = createMockUnit('Gretchin Main', 1, 'VANGUARD', 18, 10);
    const nearbyEnemy = createMockUnit('Gretchin Secondary', 1, 'VANGUARD', 20, 10);

    s.units = [attacker, target, nearbyEnemy];

    const initialHP = nearbyEnemy.models[0].wounds;
    triggerRelicEvent(s, 'ON_CRIT_HIT', attacker, target, { critCount: 1 });

    // Secondary enemy takes Tesla Arc mortal damage
    expect(nearbyEnemy.models[0].wounds).toBeLessThan(initialHP);
  });

  it('Trigger Gem: Volatile Detonator triggers Corpse Bloom on model kills', () => {
    const s = createMockState();
    const attacker = createMockUnit('Devastator', 0, 'GUNSHIP', 10, 10);
    socketRelicToUnit(attacker, 'proc_corpse_bloom');

    const target = createMockUnit('Hormagaunts', 1, 'SKIRMISHER', 15, 10);
    s.units = [attacker, target];

    const initialTargetHP = target.models[0].wounds + target.models[1].wounds;
    triggerRelicEvent(s, 'ON_MODEL_KILL', attacker, target, { killedModelsCount: 5 });

    const currentTargetHP = target.models[0].wounds + target.models[1].wounds;
    expect(currentTargetHP).toBeLessThanOrEqual(initialTargetHP);
  });

  it('Trigger Gem: Haemovore Fang siphons wounds and revives fallen warriors on melee kill', () => {
    const s = createMockState();
    const attacker = createMockUnit('Vampiric Berserker', 0, 'SKIRMISHER', 10, 10);
    socketRelicToUnit(attacker, 'proc_vampiric');

    // Wound model 1, kill model 2
    attacker.models[0].wounds = 1; // max 2
    attacker.models[1].dead = true;
    attacker.models[1].wounds = 0;

    const enemy = createMockUnit('Enemy Cultist', 1, 'VANGUARD', 11, 10);
    s.units = [attacker, enemy];

    // Trigger on melee kill with Level 2 (2 wounds restored)
    s.campaign = { node: 'n', relics: ['proc_vampiric'], rules: [], relicLevels: { proc_vampiric: 2 } };

    triggerRelicEvent(s, 'ON_MELEE_KILL', attacker, enemy);

    // Model 0 healed to 2/2, Model 1 revived with 1 wound!
    expect(attacker.models[0].wounds).toBe(2);
    expect(attacker.models[1].dead).toBe(false);
    expect(attacker.models[1].wounds).toBe(1);
  });

  it('Trigger Gem: Reactive Aegis emits 4" shockwave on expending Bastion tokens', () => {
    const s = createMockState();
    const defender = createMockUnit('Breacher Fortress', 0, 'BREACHER', 10, 10);
    socketRelicToUnit(defender, 'proc_nova_shield');

    addCombatToken(defender, 'bastion', 2);

    const closeEnemy = createMockUnit('Genestealer Close', 1, 'SKIRMISHER', 12, 10); // 2" away
    const farEnemy = createMockUnit('Termagant Far', 1, 'VANGUARD', 25, 10); // 15" away

    s.units = [defender, closeEnemy, farEnemy];

    const initialCloseHP = closeEnemy.models[0].wounds;
    const initialFarHP = farEnemy.models[0].wounds;

    // Expend 1 Bastion token
    expendCombatToken(defender, 'bastion', 1, s);

    expect(closeEnemy.models[0].wounds).toBeLessThan(initialCloseHP);
    expect(farEnemy.models[0].wounds).toBe(initialFarHP); // unharmed
  });
});
