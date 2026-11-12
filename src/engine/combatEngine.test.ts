import { describe, expect, it } from 'vitest';
import {
  addCombatToken,
  applyAilment,
  checkBehemothRampage,
  clearCombatTokens,
  determineCombatRole,
  ensureCombatState,
  expendCombatToken,
  getSkirmisherVelocityBonus,
  initCombatState,
  onBreacherChargeComplete,
  onBreacherSavePassed,
  onVanguardHit,
  processCommandPhaseAilments,
  processMovementAilments,
} from './combatEngine';
import { combatMods } from './combatMods';
import type { GameState, ModelState, UnitState, WeaponProfileData } from './types';

function makeMockUnit(
  id: string,
  name: string,
  owner: 0 | 1,
  keywords: string[],
  role?: string,
  modelStats: Partial<{ M: number; T: number; Sv: number; W: number }> = {}
): UnitState {
  const profile = {
    name,
    M: modelStats.M ?? 6,
    T: modelStats.T ?? 4,
    Sv: modelStats.Sv ?? 3,
    InSv: null,
    W: modelStats.W ?? 2,
    Ld: 6,
    OC: 1,
    base: { w: 32, h: 32, text: '32mm' },
  };

  const model: ModelState = {
    id: `${id}-m1`,
    name,
    profile,
    source: name,
    isCharacter: keywords.includes('CHARACTER'),
    isBodyguard: false,
    keywords,
    weapons: [],
    x: 10,
    y: 10,
    r: 0.6,
    wounds: profile.W,
    dead: false,
  };

  const unit = {
    id,
    owner,
    name,
    sources: [name],
    keywords,
    factionKeywords: ['SPACE MARINES'],
    models: [model],
    startingStrength: 1,
    abilities: [],
    core: {},
    pts: 100,
    status: 'board' as const,
    embarkedIn: null,
    transport: null,
    weaponsFired: [],
    cantCharge: false,
  } as unknown as UnitState;

  unit.combatRole = determineCombatRole(keywords, profile, role);
  unit.combatState = initCombatState(unit.combatRole);
  return unit;
}

function makeMockGame(units: UnitState[]): GameState {
  return {
    turn: 1,
    round: 1,
    active: 0,
    rng: 42,
    phase: 'command',
    units,
    log: [],
    fx: [],
    objectives: [],
    players: [
      { id: 0, factionId: 'SM', cp: 1, vp: 0 },
      { id: 1, factionId: 'ORK', cp: 1, vp: 0 },
    ],
  } as unknown as GameState;
}

describe('Warhammer Warband v2.0 — Combat Roles & Archetypes', () => {
  it('correctly maps datasheets to 6 Combat Roles based on keywords and profiles', () => {
    // Conduit: Character / Psyker
    expect(determineCombatRole(['INFANTRY', 'CHARACTER', 'CAPTAIN'])).toBe('CONDUIT');
    expect(determineCombatRole(['INFANTRY', 'PSYKER'])).toBe('CONDUIT');

    // Behemoth: Monster / Titanic
    expect(determineCombatRole(['MONSTER', 'TYRANIDS'])).toBe('BEHEMOTH');
    expect(determineCombatRole(['VEHICLE', 'TITANIC', 'IMPERIAL KNIGHTS'])).toBe('BEHEMOTH');

    // Breacher: Terminator / Gravis / 2+ save anchors
    expect(determineCombatRole(['INFANTRY', 'TERMINATOR'])).toBe('BREACHER');
    expect(determineCombatRole(['INFANTRY', 'GRAVIS'])).toBe('BREACHER');
    expect(determineCombatRole(['INFANTRY'], { M: 5, T: 5, Sv: 2, W: 3 })).toBe('BREACHER');

    // Skirmisher: Jump Pack / Fly / Mounted
    expect(determineCombatRole(['INFANTRY', 'JUMP PACK', 'FLY'])).toBe('SKIRMISHER');
    expect(determineCombatRole(['MOUNTED', 'OUTRIDERS'])).toBe('SKIRMISHER');

    // Gunship: Vehicles, Walkers, Artillery
    expect(determineCombatRole(['VEHICLE', 'DREADNOUGHT'])).toBe('GUNSHIP');
    expect(determineCombatRole(['VEHICLE', 'TANK'])).toBe('GUNSHIP');

    // Vanguard: Line infantry / Battleline
    expect(determineCombatRole(['INFANTRY', 'BATTLELINE'])).toBe('VANGUARD');
    expect(determineCombatRole(['INFANTRY'])).toBe('VANGUARD');
  });
});

describe('Combat Tokens Engine', () => {
  it('adds, caps, and expends Auspex, Fervour, and Bastion tokens', () => {
    const u = makeMockUnit('u1', 'Intercessors', 0, ['INFANTRY']);
    const cs = ensureCombatState(u);

    expect(cs.tokens.auspex).toBe(0);
    expect(addCombatToken(u, 'auspex', 2)).toBe(2);
    expect(cs.tokens.auspex).toBe(2);

    // Capping at 3
    expect(addCombatToken(u, 'auspex', 5)).toBe(1); // 2 + 1 = 3 cap
    expect(cs.tokens.auspex).toBe(3);

    // Expending
    expect(expendCombatToken(u, 'auspex', 2)).toBe(true);
    expect(cs.tokens.auspex).toBe(1);
    expect(expendCombatToken(u, 'auspex', 2)).toBe(false); // only 1 left
    expect(cs.tokens.auspex).toBe(1);
  });

  it('clears all tokens when battle-shocked', () => {
    const u = makeMockUnit('u1', 'Intercessors', 0, ['INFANTRY']);
    addCombatToken(u, 'auspex', 3);
    addCombatToken(u, 'fervour', 2);
    addCombatToken(u, 'bastion', 1);

    clearCombatTokens(u);
    const cs = ensureCombatState(u);
    expect(cs.tokens.auspex).toBe(0);
    expect(cs.tokens.fervour).toBe(0);
    expect(cs.tokens.bastion).toBe(0);
  });

  it('Auspex 3+ tokens expand Critical Hit threshold to 5+ in combatMods', () => {
    const attacker = makeMockUnit('a1', 'Eliminators', 0, ['INFANTRY']);
    const target = makeMockUnit('t1', 'Boyz', 1, ['INFANTRY']);
    const s = makeMockGame([attacker, target]);

    const weaponProfile: WeaponProfileData = {
      name: 'Sniper Rifle',
      range: 36,
      A: '1',
      skill: 3,
      S: 5,
      AP: 2,
      D: '2',
      abilities: [],
    };

    // Before tokens
    let mods = combatMods({
      s,
      A: attacker,
      T: target,
      m: attacker.models[0],
      psychic: false,
      mode: 'ranged',
      d: 12,
      p: weaponProfile,
      weapon: 'Sniper Rifle',
    });
    expect(mods.critHitOn).toBe(6);

    // Add 3 Auspex tokens
    addCombatToken(attacker, 'auspex', 3);
    mods = combatMods({
      s,
      A: attacker,
      T: target,
      m: attacker.models[0],
      psychic: false,
      mode: 'ranged',
      d: 12,
      p: weaponProfile,
      weapon: 'Sniper Rifle',
    });
    expect(mods.critHitOn).toBe(5);
  });

  it('Fervour max tokens grant +1 Attack in combatMods', () => {
    const attacker = makeMockUnit('a1', 'Assault Intercessors', 0, ['INFANTRY']);
    const target = makeMockUnit('t1', 'Boyz', 1, ['INFANTRY']);
    const s = makeMockGame([attacker, target]);

    const weaponProfile: WeaponProfileData = {
      name: 'Astartes Chainsword',
      range: 'Melee',
      A: '4',
      skill: 3,
      S: 4,
      AP: 1,
      D: '1',
      abilities: [],
    };

    // Before max tokens
    let mods = combatMods({
      s,
      A: attacker,
      T: target,
      m: attacker.models[0],
      psychic: false,
      mode: 'melee',
      d: 0,
      p: weaponProfile,
      weapon: 'Astartes Chainsword',
    });
    expect(mods.attacksBonus).toBe(0);

    // Add 3 Fervour tokens (max)
    addCombatToken(attacker, 'fervour', 3);
    mods = combatMods({
      s,
      A: attacker,
      T: target,
      m: attacker.models[0],
      psychic: false,
      mode: 'melee',
      d: 0,
      p: weaponProfile,
      weapon: 'Astartes Chainsword',
    });
    expect(mods.attacksBonus).toBe(1);
  });
});

describe('Tactical Ailments Engine', () => {
  it('applies Soulfire and deals DoT in Command Phase', () => {
    const target = makeMockUnit('t1', 'Boyz', 1, ['INFANTRY'], undefined, { W: 10 });
    const s = makeMockGame([target]);

    applyAilment(s, target, 'soulfire', 2);
    expect(target.combatState?.ailments.soulfire).toBe(2);

    processCommandPhaseAilments(s, 1);
    expect(target.models[0].wounds).toBe(8); // 10 - 2 MW
  });

  it('triggers Conflagration explosion at 5 Soulfire stacks without cascading spread', () => {
    const target = makeMockUnit('t1', 'Boyz', 1, ['INFANTRY'], undefined, { W: 10 });
    target.models[0].x = 10;
    target.models[0].y = 10;

    const nearbyAlly = makeMockUnit('t2', 'Nobz', 1, ['INFANTRY'], undefined, { W: 10 });
    nearbyAlly.models[0].x = 12; // 2" away
    nearbyAlly.models[0].y = 10;

    const s = makeMockGame([target, nearbyAlly]);

    applyAilment(s, target, 'soulfire', 5);

    // Target suffers 3 MW from Conflagration and resets soulfire
    expect(target.models[0].wounds).toBe(7); // 10 - 3 MW
    expect(target.combatState?.ailments.soulfire).toBe(0);

    // Conflagration does NOT spread to nearby units (prevents infinite recursive chain-wipes)
    expect(nearbyAlly.combatState?.ailments.soulfire).toBe(0);
  });

  it('applies Bleeding and deals damage on movement (doubled on fast move)', () => {
    const u = makeMockUnit('u1', 'Boyz', 1, ['INFANTRY'], undefined, { W: 10 });
    const s = makeMockGame([u]);

    applyAilment(s, u, 'bleeding', 1);

    // Move 4" -> 1 MW
    processMovementAilments(s, u, 4);
    expect(u.models[0].wounds).toBe(9);

    // Move 8" (>6") -> 2x MW = 2 MW
    processMovementAilments(s, u, 8);
    expect(u.models[0].wounds).toBe(7);
  });
});

describe('Intrinsic Archetype Mechanics', () => {
  it('Vanguard marks targets [Exposed] on hit, non-Vanguard attacker gains +1 Auspex', () => {
    const vanguard = makeMockUnit('v1', 'Tactical Squad', 0, ['INFANTRY', 'BATTLELINE']);
    const skirmisher = makeMockUnit('s1', 'Assault Squad', 0, ['INFANTRY', 'JUMP PACK']);
    const enemy = makeMockUnit('e1', 'Ork Boyz', 1, ['INFANTRY']);
    const s = makeMockGame([vanguard, skirmisher, enemy]);

    expect(vanguard.combatRole).toBe('VANGUARD');
    expect(skirmisher.combatRole).toBe('SKIRMISHER');

    // Vanguard hits enemy
    onVanguardHit(s, vanguard, enemy);
    expect(enemy.combatState?.isExposed).toBe(true);

    // Skirmisher attacks exposed enemy -> gains +1 Auspex
    const weaponProfile: WeaponProfileData = {
      name: 'Bolt Pistol',
      range: 12,
      A: '1',
      skill: 3,
      S: 4,
      AP: 0,
      D: '1',
      abilities: [],
    };

    combatMods({
      s,
      A: skirmisher,
      T: enemy,
      m: skirmisher.models[0],
      psychic: false,
      mode: 'ranged',
      d: 6,
      p: weaponProfile,
      weapon: 'Bolt Pistol',
    });

    expect(skirmisher.combatState?.tokens.auspex).toBe(1);
  });

  it('Breacher builds Bastion on 3 saves, and discharges kinetic MW on charge', () => {
    const breacher = makeMockUnit('b1', 'Terminators', 0, ['INFANTRY', 'TERMINATOR']);
    const enemy = makeMockUnit('e1', 'Ork Boyz', 1, ['INFANTRY'], undefined, { W: 10 });
    const s = makeMockGame([breacher, enemy]);

    expect(breacher.combatRole).toBe('BREACHER');
    expect(breacher.combatState?.tokens.bastion).toBe(0);

    // Pass 3 saves
    onBreacherSavePassed(s, breacher);
    onBreacherSavePassed(s, breacher);
    onBreacherSavePassed(s, breacher);
    expect(breacher.combatState?.tokens.bastion).toBe(1);

    // Charge completes into enemy
    onBreacherChargeComplete(s, breacher, enemy);
    expect(enemy.models[0].wounds).toBe(9); // 10 - 1 MW discharge
  });

  it('Behemoth triggers Apex Rampage and enrages when HP drops <= 50%', () => {
    const behemoth = makeMockUnit('b1', 'Carnifex', 0, ['MONSTER'], undefined, { W: 10 });
    const nearbyEnemy = makeMockUnit('e1', 'Ork Boyz', 1, ['INFANTRY'], undefined, { W: 10 });
    behemoth.models[0].x = 10;
    behemoth.models[0].y = 10;
    nearbyEnemy.models[0].x = 11; // 1" away
    nearbyEnemy.models[0].y = 10;

    const s = makeMockGame([behemoth, nearbyEnemy]);

    expect(behemoth.combatRole).toBe('BEHEMOTH');

    // Reduce HP to 5 (50%)
    behemoth.models[0].wounds = 5;
    checkBehemothRampage(s, behemoth);

    expect(behemoth.combatState?.enraged).toBe(true);
    expect(behemoth.combatState?.tokens.fervour).toBe(3); // Max fervour
    expect(nearbyEnemy.models[0].wounds).toBeLessThan(10); // Damaged by shockwave
  });

  it('Skirmisher scales AP based on velocity (distance moved)', () => {
    const skirmisher = makeMockUnit('s1', 'Biker Squad', 0, ['MOUNTED', 'BIKER']);
    expect(skirmisher.combatRole).toBe('SKIRMISHER');

    const s = makeMockGame([skirmisher]);

    // Move 8"
    processMovementAilments(s, skirmisher, 8);

    const bonus = getSkirmisherVelocityBonus(skirmisher);
    expect(bonus.apBonus).toBe(2); // 8" / 4" = 2 tiers of AP bonus
  });
});
