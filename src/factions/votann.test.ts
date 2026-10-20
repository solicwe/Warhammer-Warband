import { describe, expect, it, beforeEach } from 'vitest';
import {
  isVotannArmy,
  gainYieldPoints,
  spendYieldPoints,
  votannBattleStart,
  votannCommandEnd,
  votannUnitDestroyed,
  tryUtharAncestralFortune,
} from './votann';
import { validateList } from '../engine/army';
import { rollMods } from '../rules-engine/effects';
import type { GameState, UnitState, PlayerState, FactionData, ArmyList } from '../engine/types';
import lovFaction from '../../public/data/factions/LoV.json';
import smFaction from '../../public/data/factions/SM.json';

function mockGameState(): GameState {
  const p0 = {
    name: 'Votann Player',
    factionId: 'LoV',
    armyRules: [{ name: 'Prioritised Efficiency' }],
    factionName: 'Leagues of Votann',
    role: 'attacker',
    cp: 2,
    vp: 0,
    vpByRound: [0, 0, 0, 0, 0],
    stratagemsUsed: [],
    insaneBraveryUsed: false,
    oathTarget: null,
    oathWoundBonus: false,
    waaaghUsed: false,
    riledUntilTurn: 0,
    secMode: 'none',
    secDeck: [],
    secActive: [],
    secVp: 0,
    secByRound: [0, 0, 0, 0, 0],
    secFixedVp: {},
    secSwapUsed: false,
    yieldPoints: 0,
    votannAbility: 'Hostile Acquisition',
    detachments: [{ id: 'hb', name: 'Hearthband', dp: 3, forceDisposition: 'Priority Assets', rules: [], enhancements: [], stratagems: [] }],
  } as unknown as PlayerState;

  const p1 = {
    name: 'Enemy Player',
    factionId: 'SM',
    factionName: 'Space Marines',
    role: 'defender',
    cp: 2,
    vp: 0,
    vpByRound: [0, 0, 0, 0, 0],
    stratagemsUsed: [],
    insaneBraveryUsed: false,
    oathTarget: null,
    oathWoundBonus: false,
    waaaghUsed: false,
    riledUntilTurn: 0,
    secMode: 'none',
    secDeck: [],
    secActive: [],
    secVp: 0,
    secByRound: [0, 0, 0, 0, 0],
    secFixedVp: {},
    secSwapUsed: false,
  } as unknown as PlayerState;

  return {
    deploymentId: 'take-and-hold-vs-purge-the-foe-3',
    round: 1,
    turn: 0,
    phase: 'command',
    active: 0,
    firstPlayer: 0,
    players: [p0, p1],
    units: [],
    objectives: [
      { id: 'obj-home-0', x: 10, y: 10, controller: 0, type: 'home', terrainId: 't1' }, // in P0 DZ (y <= 18)
      { id: 'obj-mid', x: 22, y: 25, controller: null, type: 'central', terrainId: 't2' }, // not in DZ (y > 18)
      { id: 'obj-home-1', x: 34, y: 45, controller: 1, type: 'home', terrainId: 't3' }, // in P1 DZ (y > 18)
    ],
    terrain: [],
    log: [],
    dispositions: ['priority-assets', 'take-and-hold'],
    primaryMode: 'standard',
    secondaryMode: 'none',
    controlAtTurnStart: [null, null, null],
    destroyedByTurn: [],
  } as unknown as GameState;
}

function makeVotannUnit(id: string, name: string, keywords: string[], owner: 0 | 1 = 0, x = 10, y = 10): UnitState {
  return {
    id,
    owner,
    name,
    sources: [name],
    keywords: ['INFANTRY', ...keywords],
    factionKeywords: ['LEAGUES OF VOTANN'],
    startingStrength: 5,
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
    foughtFirstUntilTurn: 0,
    stratagemPhase: null,
    oneShotUsed: [],
    buffs: [],
    abilities: [],
    core: {},
    models: [
      {
        id: `${id}-m1`,
        source: name,
        x,
        y,
        r: 0.63,
        dead: false,
        wounds: 3,
        profile: { M: 5, T: 5, Sv: 3, W: 3, Ld: 7, OC: 1 },
        weapons: [
          {
            name: 'Autoch-pattern bolter',
            profiles: [{ name: 'Autoch-pattern bolter', range: 24, A: '2', skill: 4, S: 4, AP: 0, D: '1', abilities: [] }],
          },
          {
            name: 'Close combat weapon',
            profiles: [{ name: 'Close combat weapon', range: 'Melee', A: '2', skill: 4, S: 4, AP: 0, D: '1', abilities: [] }],
          },
        ],
        gear: [],
        keywords: ['INFANTRY', ...keywords],
      },
    ],
  } as unknown as UnitState;
}

describe('Leagues of Votann (LoV) - Prioritised Efficiency', () => {
  let s: GameState;

  beforeEach(() => {
    s = mockGameState();
  });

  it('correctly identifies Leagues of Votann army', () => {
    expect(isVotannArmy(s, 0)).toBe(true);
    expect(isVotannArmy(s, 1)).toBe(false);
  });

  it('gains and spends Yield Points (YP) correctly', () => {
    expect(s.players[0].yieldPoints).toBe(0);
    gainYieldPoints(s, 0, 3, 'Test gain');
    expect(s.players[0].yieldPoints).toBe(3);

    const spendSuccess = spendYieldPoints(s, 0, 2, 'Test spend');
    expect(spendSuccess).toBe(true);
    expect(s.players[0].yieldPoints).toBe(1);

    const spendFail = spendYieldPoints(s, 0, 5, 'Overspend');
    expect(spendFail).toBe(false);
    expect(s.players[0].yieldPoints).toBe(1);
  });

  it('votannBattleStart sets Hostile Acquisition with 0 YP', () => {
    s.players[0].yieldPoints = 5;
    s.players[0].votannAbility = 'Fortify Takeover';
    votannBattleStart(s);
    expect(s.players[0].yieldPoints).toBe(0);
    expect(s.players[0].votannAbility).toBe('Hostile Acquisition');
  });

  it('votannCommandEnd awards 1 YP for controlling objective in DZ in Round 1', () => {
    s.round = 1;
    // P0 controls obj-home-0 (which is in their DZ)
    votannCommandEnd(s, 0);
    expect(s.players[0].yieldPoints).toBe(1);
    // < 7 YP => stays Hostile Acquisition
    expect(s.players[0].votannAbility).toBe('Hostile Acquisition');
  });

  it('votannCommandEnd evaluates extra YP and switches stance at >= 7 YP in Round 2', () => {
    s.round = 2;
    s.players[0].yieldPoints = 4;
    // P0 controls home (in DZ), central (not in DZ), and enemy home (not in DZ)
    s.objectives[0].controller = 0;
    s.objectives[1].controller = 0;
    s.objectives[2].controller = 0; // 3 total vs 0 for P1

    // Expected gains:
    // +1 (1+ in DZ)
    // +1 (1+ not in DZ)
    // +1 (2+ not in DZ)
    // +1 (more than opponent)
    // Total = +4 YP!
    votannCommandEnd(s, 0);
    expect(s.players[0].yieldPoints).toBe(8); // 4 + 4 = 8
    // >= 7 YP => switches to Fortify Takeover!
    expect(s.players[0].votannAbility).toBe('Fortify Takeover');
  });

  it('Mercenary Oathband detachment does not auto-switch stance', () => {
    s.players[0].detachments = [{ id: 'mo', name: 'Mercenary Oathband', dp: 2, forceDisposition: 'Take and Hold', rules: [], enhancements: [], stratagems: [] }];
    s.players[0].yieldPoints = 10;
    s.players[0].votannAbility = 'Hostile Acquisition';
    votannCommandEnd(s, 0);
    // Should NOT auto-switch to Fortify Takeover
    expect(s.players[0].votannAbility).toBe('Hostile Acquisition');
  });

  it('Needgaârd Oathband gains 1 YP when an enemy unit is destroyed (Martial Leverage)', () => {
    s.players[0].detachments = [{ id: 'no', name: 'Needgaârd Oathband', dp: 2, forceDisposition: 'Purge the Foe', rules: [], enhancements: [], stratagems: [] }];
    const enemyUnit = makeVotannUnit('e1', 'Intercessors', ['SM'], 1);
    s.players[0].yieldPoints = 0;

    votannUnitDestroyed(s, enemyUnit);
    expect(s.players[0].yieldPoints).toBe(1);
  });

  it('Mercenary Prospector enhancement grants 2 YP on enemy unit destruction', () => {
    const killer = makeVotannUnit('k1', 'Kâhl', ['CHARACTER', 'KÂHL'], 0);
    killer.enhancements = [{ name: 'Mercenary Prospector', text: '', model: '' }];
    s.units.push(killer);

    const enemyUnit = makeVotannUnit('e1', 'Intercessors', ['SM'], 1);
    s.players[0].yieldPoints = 0;

    votannUnitDestroyed(s, enemyUnit, 'k1');
    expect(s.players[0].yieldPoints).toBe(2);
  });
});

describe('Leagues of Votann - Army Muster Validation', () => {
  it('validates a standard Incursion 1000 pts Hearthband list with 0 errors', () => {
    const list: ArmyList = {
      factionId: 'LoV',
      name: 'Votann Oathband',
      detachments: ['Hearthband'],
      battleSize: 'incursion',
      units: [
        { uid: 'u1', datasheet: 'Ûthar the Destined', models: 1, pts: 100, warlord: true },
        { uid: 'u2', datasheet: 'Hearthkyn Warriors', models: 10, pts: 90 },
        { uid: 'u3', datasheet: 'Einhyr Hearthguard', models: 5, pts: 130 },
        { uid: 'u4', datasheet: 'Einhyr Champion', models: 1, pts: 65, enhancement: 'Bastion Shield', enhancementPts: 25 },
        { uid: 'u5', datasheet: 'Sagitaur', models: 1, pts: 85 },
        { uid: 'u6', datasheet: 'Hernkyn Pioneers', models: 3, pts: 85 },
        { uid: 'u7', datasheet: 'Brôkhyr Thunderkyn', models: 3, pts: 80 },
        { uid: 'u8', datasheet: 'Hekaton Land Fortress', models: 1, pts: 250 },
        { uid: 'u9', datasheet: 'Cthonian Beserks', models: 5, pts: 90, embarkIn: 'u5' },
      ],
    };

    const size = { points: 1000, dp: 2, unitLimit: 3, enhancements: 3 };
    const errs = validateList(list, lovFaction as unknown as FactionData, size);
    expect(errs).toEqual([]);
  });

  it('validates PRESETS.LoV with 0 errors', async () => {
    const { PRESETS } = await import('../ui/presets');
    const size = { points: 1000, dp: 2, unitLimit: 3, enhancements: 3 };
    const errs = validateList(PRESETS.LoV, lovFaction as unknown as FactionData, size);
    expect(errs).toEqual([]);
  });
});

