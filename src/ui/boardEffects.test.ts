import { describe, expect, it } from 'vitest';
import { getObjectiveEffects } from './Board';
import type { GameState, ObjectiveState, PlayerState } from '../engine/types';

function mockGameState(): GameState {
  const p0: Partial<PlayerState> = {
    name: 'Player 1',
    factionId: 'SM',
    detachments: [],
  };
  const p1: Partial<PlayerState> = {
    name: 'Player 2',
    factionId: 'ORK',
    detachments: [],
  };

  return {
    players: [p0 as PlayerState, p1 as PlayerState],
    objectives: [],
    terrain: [],
    units: [],
    markers: [],
    pendingActions: [],
    round: 1,
    turn: 1,
    active: 0,
    phase: 'command',
    stratagems: [],
    rollLog: [],
  } as unknown as GameState;
}

describe('getObjectiveEffects', () => {
  it('detects Chaos Daemons Shadow of Chaos 6" aura when controlling or corrupted', () => {
    const s = mockGameState();
    s.players[0].factionId = 'CD';
    s.players[0].detachments = [{ name: 'Daemonic Incursion', dp: 0 }] as any;

    const o: ObjectiveState = {
      id: 'obj-1',
      x: 10,
      y: 10,
      terrainId: 't-1',
      controller: 0,
      type: 'central',
    };

    const effects = getObjectiveEffects(s, o);
    const soc = effects.find((e) => e.id === 'shadow-of-chaos');
    expect(soc).toBeDefined();
    expect(soc?.radius).toBe(6.0);
    expect(soc?.title).toContain('SHADOW OF CHAOS');
  });

  it('detects Grey Knights Warpbane Task Force Hallowed Ground 3" zone', () => {
    const s = mockGameState();
    s.players[0].factionId = 'GK';
    s.players[0].detachments = [{ name: 'Warpbane Task Force', dp: 0 }] as any;

    const o: ObjectiveState = {
      id: 'obj-2',
      x: 15,
      y: 15,
      terrainId: 't-2',
      controller: 0,
      type: 'central',
    };

    const effects = getObjectiveEffects(s, o);
    const hg = effects.find((e) => e.id === 'hallowed-ground');
    expect(hg).toBeDefined();
    expect(hg?.radius).toBe(3.0);
    expect(hg?.title).toContain('HALLOWED GROUND');
    expect(hg?.desc).toContain('+1 to Hit');
  });

  it('detects Necrons Canoptek Court Power Matrix 6" aura', () => {
    const s = mockGameState();
    s.players[1].factionId = 'NEC';
    s.players[1].detachments = [{ name: 'Canoptek Court', dp: 0 }] as any;

    const o: ObjectiveState = {
      id: 'obj-3',
      x: 20,
      y: 20,
      terrainId: 't-3',
      controller: 1,
      type: 'central',
    };

    const effects = getObjectiveEffects(s, o);
    const pm = effects.find((e) => e.id === 'power-matrix');
    expect(pm).toBeDefined();
    expect(pm?.radius).toBe(6.0);
    expect(pm?.title).toContain('POWER MATRIX');
    expect(pm?.desc).toContain('Re-roll All Hits');
  });

  it('detects Leagues of Votann Fortified Position 3" zone', () => {
    const s = mockGameState();
    s.players[0].factionId = 'LOV';

    const o: ObjectiveState = {
      id: 'obj-4',
      x: 22,
      y: 22,
      terrainId: 't-4',
      controller: 0,
      type: 'central',
    };

    const effects = getObjectiveEffects(s, o);
    const fort = effects.find((e) => e.id === 'fortified-position');
    expect(fort).toBeDefined();
    expect(fort?.radius).toBe(3.0);
    expect(fort?.title).toContain('FORTIFIED POSITION');
  });

  it('detects Dark Angels Vowed Objective 3" zone', () => {
    const s = mockGameState();
    s.players[0].vowed = ['obj-5'];

    const o: ObjectiveState = {
      id: 'obj-5',
      x: 25,
      y: 25,
      terrainId: 't-5',
      controller: null,
      type: 'central',
    };

    const effects = getObjectiveEffects(s, o);
    const vowed = effects.find((e) => e.id === 'vowed-objective');
    expect(vowed).toBeDefined();
    expect(vowed?.radius).toBe(3.0);
    expect(vowed?.title).toContain('VOWED OBJECTIVE');
  });

  it('detects Sticky Secured objectives', () => {
    const s = mockGameState();
    const o: ObjectiveState = {
      id: 'obj-6',
      x: 12,
      y: 12,
      terrainId: 't-6',
      controller: 0,
      secured: 0,
      type: 'central',
    };

    const effects = getObjectiveEffects(s, o);
    const sticky = effects.find((e) => e.id === 'secured-sticky');
    expect(sticky).toBeDefined();
    expect(sticky?.title).toContain('SECURED (STICKY)');
  });

  it('detects Warded 6" anti-daemon aura and Sabotaged hazard', () => {
    const s = mockGameState();
    const o: ObjectiveState = {
      id: 'obj-7',
      x: 18,
      y: 18,
      terrainId: 't-7',
      controller: 0,
      warded: 0,
      sabotaged: 0,
      type: 'central',
    };

    const effects = getObjectiveEffects(s, o);
    const ward = effects.find((e) => e.id === 'warded-zone');
    const sab = effects.find((e) => e.id === 'sabotaged-hazard');
    expect(ward).toBeDefined();
    expect(ward?.radius).toBe(6.0);
    expect(sab).toBeDefined();
    expect(sab?.radius).toBe(3.0);
  });

  it('detects Roguelike Supply Cache when campaign and uncaptured', () => {
    const s = mockGameState();
    (s as any).campaign = { node: 'battle-1', relics: [], rules: [] };
    const o: ObjectiveState = {
      id: 'obj-8',
      x: 30,
      y: 30,
      terrainId: 't-8',
      controller: null,
      type: 'central',
    };

    const effects = getObjectiveEffects(s, o);
    const supply = effects.find((e) => e.id === 'supply-cache');
    expect(supply).toBeDefined();
    expect(supply?.radius).toBe(3.0);
    expect(supply?.title).toContain('SUPPLY CACHE');
  });
});
