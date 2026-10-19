import { describe, it, expect, beforeEach } from 'vitest';
import { canBeObserver, ftggMods, ftggTargetChosen, guidedVs, hasMarkerlight, isTauArmy, spotOf } from './tau';
import type { GameState, ModelState, PlayerState, UnitState, WeaponData } from '../engine/types';

function createDummyModel(id: string, name: string, keywords: string[] = [], gear: string[] = [], x = 10, y = 10): ModelState {
  return {
    id,
    name,
    source: name,
    wounds: 3,
    dead: false,
    keywords,
    gear,
    x,
    y,
    profile: { name, M: 10, T: 4, Sv: 3, W: 3, Ld: 7, OC: 1, base: '32mm', InSv: null } as any,
    weapons: [
      {
        name: 'Pulse Rifle',
        profiles: [
          {
            name: 'Pulse Rifle',
            range: 30,
            A: '1',
            skill: 4,
            S: 5,
            AP: 0,
            D: '1',
            abilities: [],
          },
        ],
      },
    ],
    r: 1.2,
    isCharacter: false,
    isBodyguard: false,
  } as unknown as ModelState;
}

function createDummyUnit(id: string, name: string, owner: 0 | 1, kw: string[], abilities: string[] = [], gear: string[] = [], x = 10, y = 10): UnitState {
  const model = createDummyModel(`${id}-m1`, name, kw, gear, x, y);
  return {
    id,
    owner,
    name,
    sources: [name],
    keywords: kw,
    factionKeywords: ['T’AU EMPIRE'],
    models: [model],
    startingStrength: 1,
    abilities: abilities.map((n) => ({ name: n, type: 'Datasheet', text: '' })),
    core: {},
    pts: 100,
    status: 'board',
    embarkedIn: null,
    weaponsFired: [],
    oneShotUsed: [],
    buffs: [],
    selectedToShoot: false,
    shotTurn: -1,
    maxMoved: 0,
  } as unknown as UnitState;
}

function createMockGameState(): GameState {
  return {
    version: 3,
    rng: 42,
    round: 1,
    turn: 0,
    firstPlayer: 0,
    active: 0,
    phase: 'shooting',
    deployTurn: 0,
    attackerPlayer: 0,
    window: null,
    attack: null,
    fight: null,
    shockTests: [],
    destroyedByTurn: [],
    markers: [],
    modelDeaths: [],
    pendingActions: [],
    turnStart: null,
    controlAtTurnStart: [],
    log: [],
    winner: null,
    terrain: [],
    objectives: [],
    deploymentId: 'dawn_of_war',
    players: [
      {
        name: 'Tau Commander',
        factionId: 'TAU',
        factionName: "T'au Empire",
        cp: 2,
        vp: 0,
        secondaries: [],
        reserves: [],
        detachments: [{ id: '1', name: 'Mont’ka', dp: 1, forceDisposition: '', rules: [], enhancements: [], stratagems: [] }],
        armyRules: [{ name: 'For the Greater Good', text: '' }],
        miracleDice: [],
        oathTarget: null,
        oathWoundBonus: false,
        stratLimits: {},
        mission: {} as any,
        sec: {} as any,
        disposition: '',
        primaryId: '',
      },
      {
        name: 'Enemy Opponent',
        factionId: 'SM',
        factionName: 'Space Marines',
        cp: 2,
        vp: 0,
        secondaries: [],
        reserves: [],
        detachments: [],
        armyRules: [],
        miracleDice: [],
        oathTarget: null,
        oathWoundBonus: false,
        stratLimits: {},
        mission: {} as any,
        sec: {} as any,
        disposition: '',
        primaryId: '',
      },
    ] as unknown as [PlayerState, PlayerState],
    units: [],
    ftggPairs: [],
  };
}

describe('T’au Empire Army Rule: For the Greater Good', () => {
  let s: GameState;
  let stealthSuits: UnitState;
  let fireWarriors: UnitState;
  let enemyIntercessors: UnitState;

  beforeEach(() => {
    s = createMockGameState();
    stealthSuits = createDummyUnit('u-stealth', 'Stealth Battlesuits', 0, ['INFANTRY', 'BATTLESUIT', 'MARKERLIGHT'], ['For the Greater Good', 'Forward Observers'], [], 10, 15);
    fireWarriors = createDummyUnit('u-firewarriors', 'Strike Team', 0, ['INFANTRY'], ['For the Greater Good'], [], 10, 10);
    enemyIntercessors = createDummyUnit('u-enemy', 'Intercessor Squad', 1, ['INFANTRY'], [], [], 25, 10);
    enemyIntercessors.factionKeywords = ['ADEPTUS ASTARTES'];
    s.units = [stealthSuits, fireWarriors, enemyIntercessors];
  });

  it('detects the army rule and the MARKERLIGHT keyword', () => {
    expect(isTauArmy(s, 0)).toBe(true);
    expect(isTauArmy(s, 1)).toBe(false);
    expect(hasMarkerlight(stealthSuits)).toBe(true);
    expect(hasMarkerlight(fireWarriors)).toBe(false);
  });

  it('a unit that has shot or is Battle-shocked cannot be an Observer', () => {
    expect(canBeObserver(s, stealthSuits)).toBe(true);
    stealthSuits.battleShocked = true;
    expect(canBeObserver(s, stealthSuits)).toBe(false);
    stealthSuits.battleShocked = false;
    stealthSuits.shotTurn = s.turn;
    expect(canBeObserver(s, stealthSuits)).toBe(false);
  });

  it('a Guided shot gets +1 BS, [IGNORES COVER] from a MARKERLIGHT Observer and Forward Observers re-rolls; the target stays Spotted', () => {
    const m = ftggMods(s, fireWarriors, enemyIntercessors)!;
    expect(m.skillBonus).toBe(1);
    expect(m.ignoresCover).toBe(true);
    expect(m.rerollHits1).toBe(true);
    expect(guidedVs(s, fireWarriors, enemyIntercessors)).toBe(true);
    ftggTargetChosen(s, fireWarriors, enemyIntercessors);
    expect(spotOf(s, enemyIntercessors)?.observerId).toBe(stealthSuits.id);
    // the Observer itself is not Guided
    expect(ftggMods(s, stealthSuits, enemyIntercessors)).toBeNull();
  });

  it('no Observer that could see the target: no bonus (and no penalty)', () => {
    stealthSuits.battleShocked = true;
    expect(ftggMods(s, fireWarriors, enemyIntercessors)).toBeNull();
  });
});
