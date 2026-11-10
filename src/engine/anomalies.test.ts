import { describe, expect, it } from 'vitest';
import { checkAnomalyTriggers, spawnBattlefieldAnomalies, triggerAnomaly } from './anomalies';
import { initCombatState } from './combatEngine';
import type { BattlefieldAnomaly, GameState, ModelState, UnitState } from './types';

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
      InSv: null,
      W: maxWounds,
      Ld: 7,
      OC: 1,
      base: { w: 32, h: 32, text: '32mm' },
    },
    weapons: [],
    keywords: ['INFANTRY'],
    x,
    y,
    r: 0.6,
    dead: false,
    source: 'mock',
    isCharacter: false,
    isBodyguard: false,
  };
}

function createMockUnit(name: string, owner: 0 | 1 = 0, x = 10, y = 10): UnitState {
  const m1 = createMockModel(`${name} 1`, 3, 3, x, y);
  const u = {
    id: `u-${Math.random().toString(36).slice(2, 7)}`,
    name,
    owner,
    sources: [name],
    status: 'board',
    models: [m1],
    abilities: [],
    keywords: ['INFANTRY'],
    combatRole: 'VANGUARD',
    combatState: initCombatState('VANGUARD'),
  } as unknown as UnitState;
  return u;
}

function createMockState(): GameState {
  return {
    players: [
      { id: 0, name: 'Player 1', cp: 2, vp: 0, secVp: 0, armyRules: [], stratagems: [] } as any,
      { id: 1, name: 'Player 2', cp: 2, vp: 0, secVp: 0, armyRules: [], stratagems: [] } as any,
    ],
    units: [],
    table: { width: 44, height: 30 },
    round: 1,
    turn: 1,
    active: 0,
    phase: 'movement',
    log: [],
    markers: [],
    objectives: [],
    terrain: [],
    anomalies: [],
    campaignScrap: 0,
  } as unknown as GameState;
}

describe('Battlefield Anomalies Engine (v2.0)', () => {
  it('spawnBattlefieldAnomalies generates 2 distinct anomalies within table bounds', () => {
    const s = createMockState();
    spawnBattlefieldAnomalies(s);

    expect(s.anomalies).toHaveLength(2);
    expect(s.anomalies![0].triggered).toBe(false);
    expect(s.anomalies![0].activeRound).toBe(1);
    expect(s.anomalies![1].activeRound).toBe(2);

    expect(s.anomalies![0].position.x).toBeGreaterThan(0);
    expect(s.anomalies![0].position.x).toBeLessThan(44);
    expect(s.anomalies![0].position.y).toBeGreaterThan(0);
    expect(s.anomalies![0].position.y).toBeLessThan(30);
  });

  it('checkAnomalyTriggers: does not trigger if round is earlier than activeRound', () => {
    const s = createMockState();
    s.round = 1;
    const anomaly: BattlefieldAnomaly = {
      id: 'anom-dormant',
      type: 'WARP_BREACH',
      position: { x: 10, y: 10 },
      radius: 4,
      triggered: false,
      activeRound: 2, // dormant until round 2
    };
    s.anomalies = [anomaly];

    const u = createMockUnit('Scout Squad', 0, 10, 10);
    s.units = [u];

    checkAnomalyTriggers(s, u);
    expect(anomaly.triggered).toBe(false);
  });

  it('checkAnomalyTriggers: does not trigger if unit is beyond radius', () => {
    const s = createMockState();
    s.round = 1;
    const anomaly: BattlefieldAnomaly = {
      id: 'anom-far',
      type: 'ARCHEOTECH_SHRINE',
      position: { x: 20, y: 20 },
      radius: 3,
      triggered: false,
      activeRound: 1,
    };
    s.anomalies = [anomaly];

    const u = createMockUnit('Scout Squad', 0, 10, 10); // dist is ~14"
    s.units = [u];

    checkAnomalyTriggers(s, u);
    expect(anomaly.triggered).toBe(false);
  });

  it('ARCHEOTECH_SHRINE (Goliath): enhances unit Toughness and Wounds permanently', () => {
    const s = createMockState();
    const anomaly: BattlefieldAnomaly = {
      id: 'shrine-goliath',
      type: 'ARCHEOTECH_SHRINE',
      position: { x: 10, y: 10 },
      radius: 3,
      triggered: false,
      activeRound: 1,
      effectPayload: { shrineBuff: 'GOLIATH' },
    };

    const u = createMockUnit('Terminator Squad', 0, 10, 10);
    expect(u.models[0].profile.T).toBe(4);
    expect(u.models[0].profile.W).toBe(3);

    triggerAnomaly(s, anomaly, u);

    expect(anomaly.triggered).toBe(true);
    expect(u.models[0].profile.T).toBe(5); // +1 Toughness
    expect(u.models[0].profile.W).toBe(5); // +2 Wounds
  });

  it('ARCHEOTECH_SHRINE (Lightning): grants timed attack and strength buff', () => {
    const s = createMockState();
    const anomaly: BattlefieldAnomaly = {
      id: 'shrine-lightning',
      type: 'ARCHEOTECH_SHRINE',
      position: { x: 10, y: 10 },
      radius: 3,
      triggered: false,
      activeRound: 1,
      effectPayload: { shrineBuff: 'LIGHTNING' },
    };

    const u = createMockUnit('Assault Intercessors', 0, 10, 10);
    triggerAnomaly(s, anomaly, u);

    expect(anomaly.triggered).toBe(true);
    expect(u.timed?.some((t) => t.label.includes('Lightning Shrine'))).toBe(true);
  });

  it('WARP_BREACH: yields +60 Scrap and blasts nearby enemy units with MW shock', () => {
    const s = createMockState();
    s.campaignScrap = 100;

    const anomaly: BattlefieldAnomaly = {
      id: 'warp-rift',
      type: 'WARP_BREACH',
      position: { x: 10, y: 10 },
      radius: 3,
      triggered: false,
      activeRound: 1,
    };

    const friendly = createMockUnit('Infiltrators', 0, 10, 10);
    const nearbyEnemy = createMockUnit('Chaos Marines', 1, 12, 10); // 2" away
    s.units = [friendly, nearbyEnemy];

    const initialEnemyWounds = nearbyEnemy.models[0].wounds;
    triggerAnomaly(s, anomaly, friendly);

    expect(anomaly.triggered).toBe(true);
    expect(s.campaignScrap).toBe(160); // +60 Scrap
    expect(nearbyEnemy.models[0].wounds).toBeLessThan(initialEnemyWounds);
  });

  it('ELDRITCH_ALTAR: yields +120 Salvage Scrap upon activation', () => {
    const s = createMockState();
    s.campaignScrap = 50;

    const anomaly: BattlefieldAnomaly = {
      id: 'eldritch-altar',
      type: 'ELDRITCH_ALTAR',
      position: { x: 10, y: 10 },
      radius: 3,
      triggered: false,
      activeRound: 1,
    };

    const u = createMockUnit('Chaos Chosen', 0, 10, 10);
    triggerAnomaly(s, anomaly, u);

    expect(anomaly.triggered).toBe(true);
    expect(s.campaignScrap).toBe(170); // 50 + 120
  });

  it('PROMETHIUM_HAZARD: inflicts 2 stacks of Soulfire to units in range', () => {
    const s = createMockState();
    const anomaly: BattlefieldAnomaly = {
      id: 'hazard-promethium',
      type: 'PROMETHIUM_HAZARD',
      position: { x: 10, y: 10 },
      radius: 3,
      triggered: false,
      activeRound: 1,
    };

    const u = createMockUnit('Scouts', 0, 11, 10); // 1" away
    s.units = [u];

    triggerAnomaly(s, anomaly, u);

    expect(anomaly.triggered).toBe(true);
    expect(u.combatState?.ailments.soulfire).toBe(2);
  });
});
