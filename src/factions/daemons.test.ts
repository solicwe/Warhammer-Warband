import { describe, it, expect } from 'vitest';
import {
  isUnderShadowOfChaos,
  daemonBattleShockMod,
  daemonsOnBattleShockResult,
  daemonsDeepStrikeDist,
  daemonsBattleStart,
  spendFluxToken,
  daemonsUnitDestroyed,
} from './daemons';
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
        name: 'Player 0 (Daemons)',
        role: 'attacker',
        factionId: 'CD',
        detachments: [{ name: 'Daemonic Incursion', dp: 3 }],
        armyRules: [{ name: 'The Shadow of Chaos' }],
        cp: 2,
        vp: 0,
        secVp: 0,
        corruptedObjectives: [],
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
        corruptedObjectives: [],
      },
    ],
    units: [],
    objectives: [
      { id: 'obj1', label: '1', x: 22, y: 15, controller: 0 } as unknown as ObjectiveState,
      { id: 'obj2', label: '2', x: 22, y: 30, controller: 0 } as unknown as ObjectiveState,
      { id: 'obj3', label: '3', x: 22, y: 45, controller: 1 } as unknown as ObjectiveState,
    ],
    terrain: [],
    shockTests: [],
    log: [],
  } as unknown as GameState;
}

function makeMockUnit(id: string, owner: PlayerId, name: string, keywords: string[], wounds = 10, maxW = 10): UnitState {
  return {
    id,
    owner,
    name,
    sources: [name],
    keywords,
    factionKeywords: owner === 0 ? ['LEGIONES DAEMONICA'] : ['ADEPTUS ASTARTES'],
    models: [
      {
        id: `${id}-m1`,
        name,
        dead: false,
        wounds,
        profile: { M: 6, T: 4, Sv: 4, W: maxW, Ld: 7, OC: 1 },
        x: 10,
        y: 10,
        r: 1,
      },
    ],
    abilities: [],
    buffs: [],
    status: 'board',
    core: {},
  } as unknown as UnitState;
}

describe('Chaos Daemons Engine', () => {
  it('identifies Shadow of Chaos in deployment zone and through objective control', () => {
    const s = makeMockState();
    // In dawnOfWar, x in [0, 44], y in [0, 60]
    // Player 0 zone is near bottom (e.g. y <= 12 or y >= 48 depending on role)
    // Corrupted objective gives a 6" aura of shadow anywhere
    const obj = s.objectives[0];
    obj.corrupted = 0;
    expect(isUnderShadowOfChaos(s, 0, { x: obj.x + 2, y: obj.y + 2 })).toBe(true);
    expect(isUnderShadowOfChaos(s, 0, { x: obj.x + 20, y: obj.y + 20 })).toBe(false);
  });

  it('applies Battle-shock modifiers: +1 for friendly Daemons in Shadow, -1 for enemy', () => {
    const s = makeMockState();
    const daemonUnit = makeMockUnit('u1', 0, 'Bloodletters', ['BATTLELINE', 'INFANTRY', 'KHORNE']);
    const enemyUnit = makeMockUnit('u2', 1, 'Intercessors', ['BATTLELINE', 'INFANTRY']);

    // Place both near a corrupted objective so they are in Shadow of Chaos
    s.objectives[0].corrupted = 0;
    daemonUnit.models[0].x = s.objectives[0].x + 1;
    daemonUnit.models[0].y = s.objectives[0].y + 1;
    enemyUnit.models[0].x = s.objectives[0].x + 2;
    enemyUnit.models[0].y = s.objectives[0].y + 2;
    s.units.push(daemonUnit, enemyUnit);

    expect(daemonBattleShockMod(s, daemonUnit)).toBe(1);
    expect(daemonBattleShockMod(s, enemyUnit)).toBe(-1);
  });

  it('triggers Daemonic Manifestation (healing / model return) on pass in Shadow', () => {
    const s = makeMockState();
    const bloodletters = makeMockUnit('u1', 0, 'Bloodletters', ['BATTLELINE', 'INFANTRY', 'KHORNE']);
    // Add 2 dead models
    bloodletters.models.push(
      { id: 'u1-m2', name: 'Bloodletter', dead: true, wounds: 0, profile: { M: 6, T: 4, Sv: 4, W: 1, Ld: 7, OC: 1 }, x: 10, y: 10, r: 1 } as never,
      { id: 'u1-m3', name: 'Bloodletter', dead: true, wounds: 0, profile: { M: 6, T: 4, Sv: 4, W: 1, Ld: 7, OC: 1 }, x: 10, y: 10, r: 1 } as never,
    );
    s.objectives[0].corrupted = 0;
    bloodletters.models[0].x = s.objectives[0].x;
    bloodletters.models[0].y = s.objectives[0].y;
    s.units.push(bloodletters);

    daemonsOnBattleShockResult(s, bloodletters, true);
    // At least 1 model should be revived
    const revived = bloodletters.models.filter((m) => !m.dead);
    expect(revived.length).toBeGreaterThanOrEqual(2);
  });

  it('triggers Daemonic Terror (mortal wounds) on enemy Battle-shock failure in Shadow', () => {
    const s = makeMockState();
    const enemyUnit = makeMockUnit('u2', 1, 'Intercessors', ['BATTLELINE', 'INFANTRY'], 10, 10);
    s.objectives[0].corrupted = 0;
    s.objectives[0].controller = 0;
    enemyUnit.models[0].x = s.objectives[0].x;
    enemyUnit.models[0].y = s.objectives[0].y;
    s.units.push(enemyUnit);

    daemonsOnBattleShockResult(s, enemyUnit, false);
    // Enemy model should have suffered D3 mortals
    expect(enemyUnit.models[0].wounds).toBeLessThan(10);
  });

  it('calculates Deep Strike distance: 6" in Shadow or near matching Greater Daemon, 9" otherwise', () => {
    const s = makeMockState();
    const flamer = makeMockUnit('u1', 0, 'Flamers', ['INFANTRY', 'TZEENTCH']);
    // Enemy controls all objectives except obj0 is corrupted by daemons
    s.objectives.forEach((o) => { o.controller = 1; });
    s.objectives[0].corrupted = 0;
    s.objectives[0].controller = 0;

    // Within 6" of corrupted objective (in Shadow of Chaos)
    const inShadowPt = { x: s.objectives[0].x + 1, y: s.objectives[0].y + 1 };
    expect(daemonsDeepStrikeDist(s, flamer, inShadowPt)).toBe(6);

    // Far from shadow
    const outShadowPt = { x: s.objectives[0].x + 30, y: s.objectives[0].y + 30 };
    expect(daemonsDeepStrikeDist(s, flamer, outShadowPt)).toBe(9);
  });

  it('handles Scintillating Legion Flux token economy', () => {
    const s = makeMockState();
    s.players[0].detachments = [{ name: 'Scintillating Legion', dp: 2 }] as never;
    daemonsBattleStart(s);

    expect(s.players[0].fluxTokens).toBe(3);
    const spent = spendFluxToken(s, 0);
    expect(spent).toBe(true);
    expect(s.players[0].fluxTokens).toBe(2);
    expect(s.players[1].fluxTokens).toBe(1);
  });

  it('Blood Tainted: an objective both units were on stays under the Daemons player control', () => {
    const s = makeMockState();
    s.players[0].detachments = [{ name: 'Blood Legion', dp: 2 }] as never;
    const bloodletters = makeMockUnit('u1', 0, 'Bloodletters', ['BATTLELINE', 'INFANTRY', 'KHORNE', 'LEGIONES DAEMONICA']);
    const victim = makeMockUnit('u2', 1, 'Intercessors', ['INFANTRY']);
    for (const u of [victim, bloodletters]) { u.models[0].x = s.objectives[1].x; u.models[0].y = s.objectives[1].y; }
    daemonsUnitDestroyed(s, victim, bloodletters);
    expect(s.objectives[1].secured).toBe(0);
  });

  it('Heldrake with DAEMON keyword in CSM is not treated as Legiones Daemonica unit', async () => {
    const { isDaemonUnit } = await import('./daemons');
    const heldrake: UnitState = {
      id: 'h1',
      owner: 0,
      name: 'Heldrake',
      sources: ['Heldrake'],
      keywords: ['DAEMON', 'CHAOS', 'HELDRAKE', 'FLY', 'VEHICLE'],
      factionKeywords: ['HERETIC ASTARTES'],
      models: [{ id: 'm1', name: 'Heldrake', dead: false, wounds: 12, profile: { M: 12, T: 9, Sv: 3, W: 12, Ld: 6, OC: 2 }, x: 10, y: 10, r: 2 }],
      abilities: [],
      status: 'board',
      core: {},
    } as unknown as UnitState;

    expect(isDaemonUnit(heldrake)).toBe(false);

    const s = makeMockState();
    s.players[0].factionId = 'CSM';
    s.players[0].armyRules = [{ name: 'Dark Pacts' }] as never;
    s.players[0].detachments = [{ name: 'Veterans of the Long War', dp: 3 }] as never;
    expect(isUnderShadowOfChaos(s, 0, heldrake)).toBe(false);
  });
});
