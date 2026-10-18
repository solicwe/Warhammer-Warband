import { describe, it, expect } from 'vitest';
import {
  activateReanimation,
  necCommandStart,
  necBattleStart,
  necAttackModifiers,
  necDefenseModifiers,
} from './necrons';
import type { GameState, ObjectiveState, PlayerId, UnitState } from '../engine/types';

function makeMockState(): GameState {
  return {
    turn: 1,
    round: 1,
    phase: 'command',
    active: 0 as PlayerId,
    firstPlayer: 0 as PlayerId,
    attackerPlayer: 0 as PlayerId,
    deploymentId: 'dawnOfWar',
    primaryId: 'takeAndHold',
    players: [
      {
        id: 0,
        name: 'Player 0 (Necrons)',
        role: 'attacker',
        factionId: 'NEC',
        detachments: [{ name: 'Awakened Dynasty', dp: 3 }],
        armyRules: [{ name: 'Reanimation Protocols' }],
        cp: 2,
        vp: 0,
        secVp: 0,
      },
      {
        id: 1,
        name: 'Player 1 (Enemy)',
        role: 'defender',
        factionId: 'SM',
        detachments: [{ name: 'Gladius Task Force', dp: 3 }],
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
  woundsPerModel = 1
): UnitState {
  const models = Array.from({ length: modelCount }, (_, i) => ({
    id: `${id}_m${i}`,
    name,
    x: 10 + i * 2,
    y: 10,
    r: 0.63,
    wounds: woundsPerModel,
    dead: false,
    profile: { M: 5, T: 4, Sv: 4, W: woundsPerModel, Ld: 7, OC: 1 },
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
    abilities: [],
    buffs: [],
    rules: [],
    enhancements: [],
    weapons: [],
  } as unknown as UnitState;
}

describe('Necrons Reanimation Protocols & Detachments', () => {
  it('heals damaged models and revives dead models', () => {
    const s = makeMockState();
    const lychguard = makeMockUnit('u1', 0, 'Lychguard', ['INFANTRY'], ['NECRONS'], 5, 2);
    // Model 0 damaged (1/2 W)
    lychguard.models[0].wounds = 1;
    // Model 1 dead
    lychguard.models[1].dead = true;
    lychguard.models[1].wounds = 0;
    s.units.push(lychguard);

    // Guaranteed bonus 3 to test healing and reviving
    const result = activateReanimation(s, lychguard, 3);

    expect(result).toBeGreaterThan(0);
    expect(lychguard.models[0].wounds).toBe(2); // Healed back to full
    expect(lychguard.models[1].dead).toBe(false); // Revived
  });

  it('runs Reanimation Protocols during Command phase for all board units', () => {
    const s = makeMockState();
    const warriors = makeMockUnit('u1', 0, 'Necron Warriors', ['INFANTRY', 'BATTLELINE'], ['NECRONS'], 10, 1);
    warriors.models[0].dead = true;
    warriors.models[1].dead = true;
    s.units.push(warriors);

    necCommandStart(s, 0);

    const aliveCount = warriors.models.filter((m) => !m.dead).length;
    expect(aliveCount).toBeGreaterThan(8);
  });

  it('Awakened Dynasty adds +1 to Hit when led by a Character', () => {
    const s = makeMockState();
    const warriors = makeMockUnit('u1', 0, 'Necron Warriors', ['INFANTRY'], ['NECRONS'], 10);
    const target = makeMockUnit('e1', 1, 'Intercessors', ['INFANTRY'], ['ADEPTUS ASTARTES'], 5);

    // Unled
    const unledMods = necAttackModifiers(s, warriors, target, 12, 'ranged');
    expect(unledMods.hitMod).toBe(0);

    // Led
    warriors.models.push({
      id: 'char1',
      name: 'Overlord',
      x: 10,
      y: 10,
      r: 0.63,
      wounds: 5,
      dead: false,
      isCharacter: true,
      profile: { name: 'Overlord', M: 5, T: 5, Sv: 2, InSv: 4, W: 5, Ld: 6, OC: 1, base: { w: 40, h: 40, text: '40mm' } },
      keywords: ['CHARACTER', 'INFANTRY', 'NOBLE', 'OVERLORD'],
    } as unknown as any);
    const ledMods = necAttackModifiers(s, warriors, target, 12, 'ranged');
    expect(ledMods.hitMod).toBe(1);
    expect(ledMods.notes.some((n) => n.includes('Command Protocols'))).toBe(true);
  });

  it('Canoptek Court grants re-rolls to Cryptek and Canoptek units', () => {
    const s = makeMockState();
    s.players[0].detachments = [{ name: 'Canoptek Court', dp: 3 }] as unknown as any[];

    const wraiths = makeMockUnit('u1', 0, 'Canoptek Wraiths', ['BEAST', 'CANOPTEK'], ['NECRONS'], 3, 3);
    const target = makeMockUnit('e1', 1, 'Intercessors', ['INFANTRY'], ['ADEPTUS ASTARTES'], 5);

    // Far from objectives: re-roll 1s
    wraiths.models.forEach((m) => { m.x = 50; m.y = 50; });
    const farMods = necAttackModifiers(s, wraiths, target, 12, 'ranged');
    expect(farMods.rerollHits1).toBe(true);
    expect(farMods.rerollHits).toBe(false);

    // Near friendly controlled objective: re-roll all
    wraiths.models[0].x = 10;
    wraiths.models[0].y = 10;
    const nearMods = necAttackModifiers(s, wraiths, target, 12, 'ranged');
    expect(nearMods.rerollHits).toBe(true);
  });

  it('Obeisance Phalanx gives +1 to Wound against Worthy Foe', () => {
    const s = makeMockState();
    s.players[0].detachments = [{ name: 'Obeisance Phalanx', dp: 3 }] as unknown as any[];

    const lychguard = makeMockUnit('u1', 0, 'Lychguard', ['INFANTRY', 'LYCHGUARD'], ['NECRONS'], 5, 2);
    const boss = makeMockUnit('e1', 1, 'Captain in Gravis Armour', ['INFANTRY', 'CHARACTER'], ['ADEPTUS ASTARTES'], 1, 6);
    const regular = makeMockUnit('e2', 1, 'Intercessors', ['INFANTRY'], ['ADEPTUS ASTARTES'], 5, 2);
    s.units.push(boss, regular);

    necBattleStart(s);
    expect(s.players[0].worthyFoeUnitId).toBe(boss.id);

    const vsBoss = necAttackModifiers(s, lychguard, boss, 0, 'melee');
    expect(vsBoss.woundMod).toBe(1);

    const vsRegular = necAttackModifiers(s, lychguard, regular, 0, 'melee');
    expect(vsRegular.woundMod).toBe(0);
  });

  it('Pantheon of Woe grants 4+ FNP against mortal wounds for C\'tan', () => {
    const s = makeMockState();
    s.players[0].detachments = [{ name: 'Pantheon of Woe', dp: 3 }] as unknown as any[];

    const ctan = makeMockUnit('u1', 0, 'C\'tan Shard of the Void Dragon', ['MONSTER', "C'TAN SHARD"], ['NECRONS'], 1, 12);
    const attacker = makeMockUnit('e1', 1, 'Intercessors', ['INFANTRY'], ['ADEPTUS ASTARTES'], 5);

    const def = necDefenseModifiers(s, attacker, ctan, 'ranged');
    expect(def.fnp).toBe(4);
  });
});
