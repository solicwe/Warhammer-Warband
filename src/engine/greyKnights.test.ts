import { describe, it, expect } from 'vitest';
import {
  teleportAssaultLimit,
  gkEndOpponentTurn,
  gkAttackModifiers,
  gkDefenseModifiers,
} from './greyKnights';
import type { GameState, ObjectiveState, PlayerId, UnitState, WeaponProfileData } from './types';

function makeMockState(): GameState {
  return {
    turn: 1,
    round: 1,
    phase: 'fight',
    active: 1 as PlayerId, // Opponent's turn ending
    firstPlayer: 0 as PlayerId,
    attackerPlayer: 0 as PlayerId,
    deploymentId: 'dawnOfWar',
    primaryId: 'takeAndHold',
    players: [
      {
        id: 0,
        name: 'Player 0 (Grey Knights)',
        role: 'attacker',
        factionId: 'GK',
        detachments: [{ name: 'Teleport Strike Force', dp: 3 }],
        armyRules: [{ name: 'Teleport Assault' }],
        cp: 2,
        vp: 0,
        secVp: 0,
      },
      {
        id: 1,
        name: 'Player 1 (Enemy)',
        role: 'defender',
        factionId: 'CD',
        detachments: [{ name: 'Daemonic Incursion', dp: 3 }],
        armyRules: [],
        cp: 2,
        vp: 0,
        secVp: 0,
      },
    ],
    units: [],
    objectives: [
      { id: 'obj1', label: '1', x: 10, y: 10, controller: 0 } as unknown as ObjectiveState,
      { id: 'obj2', label: '2', x: 22, y: 30, controller: 0 } as unknown as ObjectiveState,
      { id: 'obj3', label: '3', x: 34, y: 50, controller: 1 } as unknown as ObjectiveState,
    ],
    terrain: [],
    shockTests: [],
    log: [],
  } as unknown as GameState;
}

function makeMockUnit(
  id: string,
  owner: PlayerId,
  name: string,
  keywords: string[],
  factionKeywords: string[],
  modelCount = 5,
  woundsPerModel = 2
): UnitState {
  const models = Array.from({ length: modelCount }, (_, i) => ({
    id: `${id}_m${i}`,
    name,
    x: 10 + i * 2,
    y: 10,
    r: 0.63,
    wounds: woundsPerModel,
    dead: false,
    profile: { M: 5, T: 4, Sv: 2, W: woundsPerModel, Ld: 6, OC: 2 },
    keywords: [...keywords],
  }));

  return {
    id,
    owner,
    name,
    status: 'board',
    sources: [name],
    startingStrength: modelCount,
    models,
    keywords,
    factionKeywords,
    core: {},
    abilities: [],
    buffs: [],
    rules: [],
    enhancements: [],
    weapons: [],
  } as unknown as UnitState;
}

describe('Grey Knights Teleport Assault & Detachments', () => {
  it('calculates Teleport Assault limit based on battle size', () => {
    const s = makeMockState();
    expect(teleportAssaultLimit(s)).toBe(2); // 3 objectives -> Incursion
  });

  it('places unengaged units into Strategic Reserves at end of opponent turn', () => {
    const s = makeMockState();
    const strike = makeMockUnit('u1', 0, 'Strike Squad', ['INFANTRY'], ['GREY KNIGHTS'], 5);
    const interceptors = makeMockUnit('u2', 0, 'Interceptor Squad', ['INFANTRY'], ['GREY KNIGHTS'], 5);
    s.units.push(strike, interceptors);

    gkEndOpponentTurn(s);

    expect(strike.status).toBe('reserves');
    expect(strike.core.deepStrike).toBe(true);
    expect(interceptors.status).toBe('reserves');
    expect(interceptors.core.deepStrike).toBe(true);
  });

  it('Warpbane Task Force adds +1 to Hit and improves invuln save on controlled objectives', () => {
    const s = makeMockState();
    s.players[0].detachments = [{ name: 'Warpbane Task Force', dp: 3 }] as unknown as any[];

    const terminators = makeMockUnit('u1', 0, 'Brotherhood Terminator Squad', ['INFANTRY', 'TERMINATOR'], ['GREY KNIGHTS'], 5);
    const target = makeMockUnit('e1', 1, 'Bloodletters', ['INFANTRY', 'DAEMON'], ['CHAOS DAEMONS'], 10, 1);

    // Positioned on controlled obj1 (x: 10, y: 10)
    terminators.models.forEach((m) => { m.x = 10; m.y = 10; });

    const atk = gkAttackModifiers(s, terminators, target, 12, 'ranged');
    expect(atk.hitMod).toBe(1);
    expect(atk.notes.some((n) => n.includes('Hallowed Ground'))).toBe(true);

    const def = gkDefenseModifiers(s, target, terminators, 'ranged');
    expect(def.invulnSave).toBe(4);
  });

  it('Brotherhood Strike grants re-roll 1s to Hit for Terminators', () => {
    const s = makeMockState();
    s.players[0].detachments = [{ name: 'Brotherhood Strike', dp: 3 }] as unknown as any[];

    const terminators = makeMockUnit('u1', 0, 'Brotherhood Terminator Squad', ['INFANTRY', 'TERMINATOR'], ['GREY KNIGHTS'], 5);
    const target = makeMockUnit('e1', 1, 'Bloodletters', ['INFANTRY', 'DAEMON'], ['CHAOS DAEMONS'], 10, 1);

    const atk = gkAttackModifiers(s, terminators, target, 0, 'melee');
    expect(atk.rerollHits1).toBe(true);
  });

  it('Banishers gives Lethal Hits and +1 Damage vs Daemons', () => {
    const s = makeMockState();
    s.players[0].detachments = [{ name: 'Banishers', dp: 3 }] as unknown as any[];

    const strike = makeMockUnit('u1', 0, 'Strike Squad', ['INFANTRY'], ['GREY KNIGHTS'], 5);
    const daemonTarget = makeMockUnit('e1', 1, 'Bloodletters', ['INFANTRY', 'DAEMON'], ['CHAOS DAEMONS'], 10, 1);
    const normalTarget = makeMockUnit('e2', 1, 'Intercessors', ['INFANTRY'], ['ADEPTUS ASTARTES'], 5, 2);

    const vsDaemon = gkAttackModifiers(s, strike, daemonTarget, 0, 'melee');
    expect(vsDaemon.lethal).toBe(true);
    expect(vsDaemon.damageBonus).toBe(1);

    const vsNormal = gkAttackModifiers(s, strike, normalTarget, 0, 'melee');
    expect(vsNormal.lethal).toBe(true);
    expect(vsNormal.damageBonus).toBe(0);
  });

  it('Argent Assault gives Paladins +1 to Wound when S < T', () => {
    const s = makeMockState();
    s.players[0].detachments = [{ name: 'Argent Assault', dp: 3 }] as unknown as any[];

    const paladins = makeMockUnit('u1', 0, 'Paladin Squad', ['INFANTRY', 'PALADIN SQUAD'], ['GREY KNIGHTS'], 5);
    const toughMonster = makeMockUnit('e1', 1, 'Great Unclean One', ['MONSTER'], ['CHAOS DAEMONS'], 1, 20);
    toughMonster.models[0].profile.T = 12;

    const profile: WeaponProfileData = {
      name: 'Nemesis Force Weapon',
      range: 'Melee',
      A: '4',
      skill: 2,
      S: 6,
      AP: -2,
      D: '2',
      abilities: [],
    };

    const atk = gkAttackModifiers(s, paladins, toughMonster, 0, 'melee', profile);
    expect(atk.woundMod).toBe(1);
    expect(atk.notes.some((n) => n.includes('Dauntless Champions'))).toBe(true);
  });
});
