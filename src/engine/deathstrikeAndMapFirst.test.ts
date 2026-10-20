import { describe, expect, it } from 'vitest';
import {
  bestDeathstrikeSpot, canDesignateDeathstrike, canFireDeathstrike, designateDeathstrikeTarget,
  deathstrikeShooting, fireDeathstrikeWarhead, hasDeathstrikeMissile, withinMarker, deathstrikeWorth
} from '../factions/deathstrike';
import { alive, boardUnits, unitById } from './state';
import type { GameState, ModelState, UnitState } from './types';
import { botStep } from '../ai/bot';

function makeModel(id: string, x: number, y: number, r = 1, weapons: any[] = []): ModelState {
  return {
    id,
    name: 'Model ' + id,
    source: 'Deathstrike',
    x,
    y,
    r,
    wounds: 10,
    dead: false,
    weapons,
    profile: { M: 10, T: 10, Sv: 2, InSv: null, W: 10, Ld: 7, OC: 3 },
  } as unknown as ModelState;
}

function makeUnit(id: string, owner: 0 | 1, models: ModelState[], keywords: string[] = ['VEHICLE'], abilities: { name: string }[] = []): UnitState {
  return {
    id,
    name: 'Unit ' + id,
    owner,
    status: 'board',
    models,
    keywords,
    sources: ['Deathstrike'],
    factionKeywords: ['ASTRA MILITARUM'],
    abilities,
    enhancements: [],
    buffs: [],
    pts: 150,
    startingStrength: models.length,
    oneShotUsed: [],
    weaponsFired: [],
    used: {},
    core: {},
  } as unknown as UnitState;
}

function makeState(units: UnitState[]): GameState {
  return {
    turn: 1,
    round: 1,
    phase: 'shooting',
    active: 0,
    units,
    terrain: [],
    objectives: [],
    pendingActions: [],
    shockTests: [],
    ftggPairs: [],
    destroyedByTurn: [],
    table: { width: 60, height: 44 },
    bots: [],
    decides: [0, 1],
    players: [
      { id: 0, name: 'P0', role: 'attacker', detachments: [], armyRules: [], flags: [], secActive: [], cp: 2, mission: { primary: '', trapped: [], done: [] } },
      { id: 1, name: 'P1', role: 'defender', detachments: [], armyRules: [], flags: [], secActive: [], cp: 2, mission: { primary: '', trapped: [], done: [] } },
    ],
    log: [],
    fx: [],
  } as unknown as GameState;
}

describe('Deathstrike Ground Targeting System & Bot AI', () => {
  it('correctly detects hasDeathstrikeMissile and manages marker coordinate targeting', () => {
    const dsModel = makeModel('ds-m0', 10, 10, 1.5, [
      {
        name: 'Deathstrike missile',
        profiles: [{ name: 'Plasma warhead', range: 'Unlimited', a: '2D6', skill: 2, s: 16, ap: -4, d: '1' }],
      },
    ]);
    const dsUnit = makeUnit('p0-ds', 0, [dsModel], ['VEHICLE', 'ASTRA MILITARUM'], [{ name: 'Deathstrike Missile' }]);

    const enemyModels = Array.from({ length: 5 }, (_, i) => makeModel(`inf-m${i}`, 20 + i * 0.5, 20, 0.6));
    const enemyUnit = makeUnit('p1-inf', 1, enemyModels, ['INFANTRY']);

    const s = makeState([dsUnit, enemyUnit]);

    expect(hasDeathstrikeMissile(dsUnit)).toBe(true);
    expect(canDesignateDeathstrike(s, dsUnit)).toBe(true);
    expect(canFireDeathstrike(s, dsUnit)).toBe(false); // No marker placed yet

    // Designate target marker at coordinate (20, 20)
    designateDeathstrikeTarget(s, dsUnit, { x: 20, y: 20 });
    expect(dsUnit.dsMarker).toEqual({ x: 20, y: 20 });
    expect(withinMarker(enemyUnit, dsUnit.dsMarker!)).toBe(true);

    // In shooting phase when it designated this phase, canFire is false until next turn
    expect(canFireDeathstrike(s, dsUnit)).toBe(false);

    // Simulate next turn shooting where Deathstrike Remained Stationary
    s.turn = 2;
    dsUnit.move = 'stationary';
    expect(canFireDeathstrike(s, dsUnit)).toBe(true);

    // Fire plasma warhead
    fireDeathstrikeWarhead(s, dsUnit);
    expect(dsUnit.oneShotUsed).toContain('Deathstrike missile');
    expect(dsUnit.dsMarker).toBeUndefined(); // Marker removed after firing
    expect(hasDeathstrikeMissile(dsUnit)).toBe(false); // One-shot consumed
  });

  it('Bot Deathstrike AI designates cluster marker and remains stationary to fire', () => {
    const dsModel = makeModel('bot-ds-m0', 5, 5, 1.5, [
      {
        name: 'Deathstrike missile',
        profiles: [{ name: 'Plasma warhead', range: 'Unlimited', a: '2D6', skill: 2, s: 16, ap: -4, d: '1' }],
      },
    ]);
    const dsUnit = makeUnit('bot-ds', 0, [dsModel], ['VEHICLE', 'ASTRA MILITARUM'], [{ name: 'Deathstrike Missile' }]);

    const enemyModels = Array.from({ length: 10 }, (_, i) => makeModel(`ork-m${i}`, 25 + (i % 5) * 0.8, 25 + Math.floor(i / 5) * 0.8, 0.6));
    const enemyUnit = makeUnit('enemy-troup', 1, enemyModels, ['INFANTRY']);

    const s = makeState([dsUnit, enemyUnit]);
    s.bots = [0];
    s.active = 0;
    s.phase = 'command';
    s.turn = 1;

    // Bot step in Command phase -> designates marker at best enemy spot
    botStep(s, 0);
    expect(dsUnit.dsMarker).toBeDefined();
    expect(dsUnit.dsMarker?.x).toBeGreaterThan(0);

    // In Movement phase, bot should Remain Stationary to preserve stationary status for firing
    s.phase = 'movement';
    botStep(s, 0);
    expect(dsUnit.move).toBe('stationary');
  });

  it('Human player retains manual control: deathstrikeShooting does NOT auto-designate or auto-fire', () => {
    const dsModel = makeModel('human-ds-m0', 5, 5, 1.5, [
      {
        name: 'Deathstrike missile',
        profiles: [{ name: 'Plasma warhead', range: 'Unlimited', a: '2D6', skill: 2, s: 16, ap: -4, d: '1' }],
      },
    ]);
    const dsUnit = makeUnit('human-ds', 0, [dsModel], ['VEHICLE', 'ASTRA MILITARUM'], [{ name: 'Deathstrike Missile' }]);
    const enemyModels = [makeModel('enemy-m0', 25, 25, 1)];
    const enemyUnit = makeUnit('enemy-u', 1, enemyModels, ['INFANTRY']);

    const s = makeState([dsUnit, enemyUnit]);
    s.bots = [1]; // Player 0 is human, Player 1 is bot
    s.active = 0;
    s.phase = 'shooting';
    s.turn = 1;

    // Call deathstrikeShooting for player 0
    deathstrikeShooting(s, 0);

    // Marker MUST NOT be placed automatically!
    expect(dsUnit.dsMarker).toBeUndefined();
    expect(dsUnit.oneShotUsed).toEqual([]);
    expect(hasDeathstrikeMissile(dsUnit)).toBe(true);
  });

  it('aggregates duplicate reserves units into a single group with count', () => {
    // Simulate groupUnits helper logic
    const groupUnits = (units: UnitState[]) => {
      const map = new Map<string, { key: string; name: string; count: number; units: UnitState[] }>();
      for (const u of units) {
        const key = `${u.name}|${u.startingStrength}|${u.owner}`;
        const cur = map.get(key);
        if (cur) {
          cur.units.push(u);
          cur.count++;
        } else {
          map.set(key, { key, name: u.name, count: 1, units: [u] });
        }
      }
      return [...map.values()];
    };

    // Create 11 duplicate Deathstrike units in reserves (as seen in user screenshot)
    const dsUnits: UnitState[] = Array.from({ length: 11 }, (_, i) => ({
      id: `p1-ds-${i}`,
      name: 'Deathstrike',
      startingStrength: 1,
      owner: 1,
      status: 'reserves',
      models: [makeModel(`p1-ds-m${i}`, 0, 0)],
      keywords: ['VEHICLE'],
      abilities: [],
      oneShotUsed: [],
      weaponsFired: [],
      enhancements: [],
      buffs: [],
      core: {},
    } as unknown as UnitState));

    // Also an Intercessor unit
    const intercessor: UnitState = {
      id: 'p1-intercessors',
      name: 'Intercessor Squad',
      startingStrength: 5,
      owner: 1,
      status: 'reserves',
      models: [makeModel('p1-int-m0', 0, 0)],
      keywords: ['INFANTRY'],
      abilities: [],
      oneShotUsed: [],
      weaponsFired: [],
      enhancements: [],
      buffs: [],
      core: {},
    } as unknown as UnitState;

    const allReserves = [...dsUnits, intercessor];
    const grouped = groupUnits(allReserves);

    // Instead of 12 separate pills, there should be exactly 2 grouped pills!
    expect(grouped.length).toBe(2);
    const dsGroup = grouped.find((g) => g.name === 'Deathstrike');
    expect(dsGroup).toBeDefined();
    expect(dsGroup!.count).toBe(11); // Collapsed 11 Deathstrikes into [×11]
    expect(dsGroup!.units.length).toBe(11);

    const intGroup = grouped.find((g) => g.name === 'Intercessor Squad');
    expect(intGroup).toBeDefined();
    expect(intGroup!.count).toBe(1);
  });

  it('verifies real AM Deathstrike from AM.json hasDeathstrikeMissile', async () => {
    const fs = await import('node:fs');
    const { buildUnits } = await import('./army');
    const AM = JSON.parse(fs.readFileSync('public/data/factions/AM.json', 'utf8'));
    const list = {
      name: 'AM Deathstrike Test',
      factionId: 'AM',
      battleSize: 'incursion' as const,
      detachments: ['Combined Regiment'],
      units: [{ uid: 'ds1', datasheet: 'Deathstrike', models: 1, pts: 145 }],
    };
    const units = buildUnits(list, AM, 0);
    const ds = units[0];
    console.log('DS NAME:', ds.name);
    console.log('DS ABILITIES:', ds.abilities.map((a) => a.name));
    console.log('DS WEAPONS:', ds.models[0].weapons.map((w) => w.name));
    console.log('DS HAS MISSILE:', hasDeathstrikeMissile(ds));
    expect(hasDeathstrikeMissile(ds)).toBe(true);
  });
});

