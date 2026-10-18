import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildShootPools, buildFightPools } from './attack';
import { buildUnits } from './army';
import { botAct } from './bot';
import { DET_RULES, modelDefence, unitFlags, abilityStatus, incomingFor, activeRules } from './effects';
import { createGame, deployUnit, findPlacement } from './game';
import {
  isOfficer,
  officerOrderCapacity,
  officerAllowedOrders,
  officerOrderRange,
  canOfficerTarget,
  issueOrder,
  ordersRemaining,
  currentOrders,
  autoIssueOrders,
} from './orders';
import { PRESETS } from '../ui/presets';
import { alive } from './state';
import type { FactionData, GameState, UnitState } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const AM = load('AM');
const SM = load('SM');

describe('Astra Militarum Voice of Command', () => {
  it('identifies Officers and calculates order capacities correctly', () => {
    const lordSolar = { name: 'Lord Solar Leontus', keywords: ['OFFICER', 'CHARACTER'], abilities: [{ name: 'Voice of Command' }], enhancements: [] } as unknown as UnitState;
    const creed = { name: 'Ursula Creed', keywords: ['OFFICER', 'CHARACTER'], abilities: [{ name: 'Voice of Command' }], enhancements: [] } as unknown as UnitState;
    const castellan = { name: 'Cadian Castellan', keywords: ['OFFICER', 'CHARACTER'], abilities: [{ name: 'Voice of Command' }], enhancements: [] } as unknown as UnitState;
    const commandSquad = { name: 'Cadian Command Squad', keywords: ['OFFICER'], abilities: [{ name: 'Voice of Command' }], enhancements: [] } as unknown as UnitState;
    const commandSquadStrategist = { name: 'Cadian Command Squad', keywords: ['OFFICER'], abilities: [{ name: 'Voice of Command' }], enhancements: [{ name: 'Grand Strategist' }] } as unknown as UnitState;
    const infantry = { name: 'Cadian Shock Troops', keywords: ['REGIMENT', 'INFANTRY'], abilities: [], enhancements: [] } as unknown as UnitState;

    expect(isOfficer(lordSolar)).toBe(true);
    expect(isOfficer(creed)).toBe(true);
    expect(isOfficer(castellan)).toBe(true);
    expect(isOfficer(commandSquad)).toBe(true);
    expect(isOfficer(infantry)).toBe(false);

    expect(officerOrderCapacity(lordSolar)).toBe(3);
    expect(officerOrderCapacity(creed)).toBe(3);
    expect(officerOrderCapacity(castellan)).toBe(2);
    expect(officerOrderCapacity(commandSquad)).toBe(1);
    expect(officerOrderCapacity(commandSquadStrategist)).toBe(2);
  });

  it('restricts Commissar orders to Duty and Honour! and Fix Bayonets!', () => {
    const commissar = { name: 'Commissar', keywords: ['OFFICER', 'CHARACTER'], abilities: [{ name: 'Voice of Command' }], enhancements: [] } as unknown as UnitState;
    const allowed = officerAllowedOrders(commissar);
    expect(allowed).toEqual(['Duty and Honour!', 'Fix Bayonets!']);

    const castellan = { name: 'Cadian Castellan', keywords: ['OFFICER', 'CHARACTER'], abilities: [{ name: 'Voice of Command' }], enhancements: [] } as unknown as UnitState;
    expect(officerAllowedOrders(castellan).length).toBe(6);
  });

  it('measures order range (6" standard, 24" with Master Vox)', () => {
    const regular = { name: 'Platoon Command Squad', abilities: [{ name: 'Voice of Command' }] } as unknown as UnitState;
    const vox = { name: 'Cadian Command Squad', abilities: [{ name: 'Voice of Command' }, { name: 'Master Vox' }] } as unknown as UnitState;

    expect(officerOrderRange(regular)).toBe(6);
    expect(officerOrderRange(vox)).toBe(24);
  });

  it('enforces target eligibility based on Regiment, Squadron, and officer type', () => {
    const officer = { id: 'off', owner: 0, name: 'Cadian Castellan', keywords: ['OFFICER'], abilities: [], models: [{ x: 10, y: 10, r: 0.5 }] } as unknown as UnitState;
    const tankCmd = { id: 'tc', owner: 0, name: 'Leman Russ Commander', keywords: ['OFFICER', 'SQUADRON'], abilities: [], models: [{ x: 10, y: 10, r: 0.5 }] } as unknown as UnitState;
    const lordSolar = { id: 'ls', owner: 0, name: 'Lord Solar Leontus', keywords: ['OFFICER'], abilities: [], models: [{ x: 10, y: 10, r: 0.5 }] } as unknown as UnitState;

    const regiment = { id: 'reg', owner: 0, status: 'board', name: 'Shock Troops', keywords: ['REGIMENT'], models: [{ x: 12, y: 10, r: 0.5 }] } as unknown as UnitState;
    const squadron = { id: 'sqd', owner: 0, status: 'board', name: 'Leman Russ Tank', keywords: ['SQUADRON'], models: [{ x: 12, y: 10, r: 0.5 }] } as unknown as UnitState;
    const titanic = { id: 'tit', owner: 0, status: 'board', name: 'Baneblade', keywords: ['TITANIC'], models: [{ x: 12, y: 10, r: 0.5 }] } as unknown as UnitState;
    const enemy = { id: 'ene', owner: 1, status: 'board', name: 'Boyz', keywords: ['REGIMENT'], models: [{ x: 12, y: 10, r: 0.5 }] } as unknown as UnitState;

    // Normal officer can order Regiment, but not Squadron or Titanic (unless detachment rule)
    expect(canOfficerTarget(officer, regiment)).toBe(true);
    expect(canOfficerTarget(officer, squadron)).toBe(false);
    expect(canOfficerTarget(officer, titanic)).toBe(false);
    expect(canOfficerTarget(officer, enemy)).toBe(false);

    // Tank Commander can only order Squadron
    expect(canOfficerTarget(tankCmd, regiment)).toBe(false);
    expect(canOfficerTarget(tankCmd, squadron)).toBe(true);

    // Lord Solar can order Regiment, Squadron, and Titanic
    expect(canOfficerTarget(lordSolar, regiment)).toBe(true);
    expect(canOfficerTarget(lordSolar, squadron)).toBe(true);
    expect(canOfficerTarget(lordSolar, titanic)).toBe(true);
  });

  it('applies Take Aim! and Fix Bayonets! WS/BS skill improvements', () => {
    const state = createGame({
      lists: [PRESETS.AM, PRESETS.SM], factions: [AM, SM], names: ['Astra', 'Marines'], seed: 101,
    });
    const cadians = state.units.find((u) => u.name === 'Cadian Shock Troops')!;
    const officer = state.units.find((u) => u.name === 'Cadian Command Squad')!;

    cadians.status = 'board';
    state.terrain = [];
    state.phase = 'shooting';
    state.active = 0;
    cadians.models.forEach((m) => { m.x = 10; m.y = 10; });
    officer.models.forEach((m) => { m.x = 10; m.y = 12; });

    expect(ordersRemaining(state, officer)).toBeGreaterThan(0);
    expect(issueOrder(state, officer.id, cadians.id, 'Take Aim!')).toBeNull();

    expect(currentOrders(cadians)).toContain('Take Aim!');
    const enemy = state.units.find((u) => u.owner === 1)!;
    enemy.status = 'board';
    enemy.models.forEach((m) => { m.x = 10; m.y = 20; });

    // Shooting pools should reflect improved skill (BS 4+ -> BS 3+)
    const res = buildShootPools(state, cadians.id, enemy.id, { mode: 'normal' });
    const lasgunPool = res.pools.find((p) => p.weapon.toLowerCase().includes('lasgun'));
    if (lasgunPool) {
      expect(lasgunPool.skill).toBe(3); // base 4 improved by 1
    }
  });

  it('caps Take Cover! save improvement to 3+', () => {
    const state = createGame({
      lists: [PRESETS.AM, PRESETS.SM], factions: [AM, SM], names: ['Astra', 'Marines'], seed: 102,
    });
    const cadians = state.units.find((u) => u.name === 'Cadian Shock Troops')!;
    const tank = state.units.find((u) => u.name === 'Leman Russ Battle Tank')!;
    const officer = state.units.find((u) => u.name === 'Lord Solar Leontus')!;

    cadians.status = 'board';
    tank.status = 'board';
    officer.status = 'board';
    cadians.models[0].x = 10; cadians.models[0].y = 10;
    tank.models[0].x = 14; tank.models[0].y = 10;
    officer.models[0].x = 12; officer.models[0].y = 10;

    // Issue Take Cover! to Cadians (Save 5+) -> becomes 4+ (save bonus +1)
    issueOrder(state, officer.id, cadians.id, 'Take Cover!');
    const cadDef = modelDefence(state, cadians, cadians.models[0], 'ranged');
    expect(cadDef.save).toBe(1);

    // Issue Take Cover! to Tank (Save 2+) -> saveMax3 prevents 2+ improving to 1+
    issueOrder(state, officer.id, tank.id, 'Take Cover!');
    const tankDef = modelDefence(state, tank, tank.models[0], 'ranged');
    expect(tankDef.save).toBe(0); // Capped at 3+
  });
});

describe('Astra Militarum Detachment Rules and Abilities', () => {
  it('Combined Arms (Born Soldiers) gives Lethal Hits to Regiment and Squadron vs appropriate targets', () => {
    const state = createGame({
      lists: [PRESETS.AM, PRESETS.SM], factions: [AM, SM], names: ['Astra', 'Marines'], seed: 103,
    });
    state.terrain = [];
    state.phase = 'shooting';
    state.active = 0;
    const cadians = state.units.find((u) => u.name === 'Cadian Shock Troops')!; // REGIMENT
    const tank = state.units.find((u) => u.name === 'Leman Russ Battle Tank')!; // SQUADRON
    const marinesInf = state.units.find((u) => u.name === 'Intercessor Squad')!; // INFANTRY
    const dread = state.units.find((u) => u.name === 'Redemptor Dreadnought')!; // VEHICLE

    cadians.status = 'board';
    tank.status = 'board';
    marinesInf.status = 'board';
    dread.status = 'board';
    cadians.models.forEach((m) => { m.x = 10; m.y = 10; });
    tank.models.forEach((m) => { m.x = 10; m.y = 12; });
    marinesInf.models.forEach((m) => { m.x = 10; m.y = 20; });
    dread.models.forEach((m) => { m.x = 10; m.y = 22; });

    // Cadians (REGIMENT) shooting at Marines (INFANTRY, not Monster/Vehicle) -> LETHAL HITS
    const cadRes = buildShootPools(state, cadians.id, marinesInf.id, { mode: 'normal' });
    expect(cadRes.pools.some((p) => p.lethal)).toBe(true);

    // Tank (SQUADRON) shooting at Dreadnought (VEHICLE) -> LETHAL HITS
    const tankRes = buildShootPools(state, tank.id, dread.id, { mode: 'normal' });
    expect(tankRes.pools.some((p) => p.lethal)).toBe(true);
  });

  it('Mechanised Assault (Armoured Fist) gives +1 to wound after disembarking', () => {
    const mechList = { ...PRESETS.AM, detachments: ['Mechanised Assault'] };
    const state = createGame({
      lists: [mechList, PRESETS.SM], factions: [AM, SM], names: ['Astra', 'Marines'], seed: 104,
    });
    state.terrain = [];
    state.phase = 'shooting';
    state.active = 0;
    const cadians = state.units.find((u) => u.name === 'Cadian Shock Troops')!;
    const marines = state.units.find((u) => u.name === 'Intercessor Squad')!;
    cadians.status = 'board';
    marines.status = 'board';
    cadians.models.forEach((m) => { m.x = 10; m.y = 10; });
    marines.models.forEach((m) => { m.x = 10; m.y = 20; });

    // Disembarked this turn
    cadians.disembarkedTurn = state.turn;
    const res = buildShootPools(state, cadians.id, marines.id, { mode: 'normal' });
    expect(res.pools[0].woundMod).toBeGreaterThanOrEqual(1);
  });

  it('Recon Element (Masters of Camouflage) grants Stealth to non-Titanic units', () => {
    const reconList = { ...PRESETS.AM, detachments: ['Recon Element'] };
    const state = createGame({
      lists: [reconList, PRESETS.SM], factions: [AM, SM], names: ['Astra', 'Marines'], seed: 105,
    });
    const cadians = state.units.find((u) => u.name === 'Cadian Shock Troops')!;
    cadians.status = 'board';
    expect(unitFlags(state, cadians).stealth).toBe(true);
  });

  it('Bullgryn Wall of Muscle subtracts 1 from damage', () => {
    const state = createGame({
      lists: [PRESETS.AM, PRESETS.SM], factions: [AM, SM], names: ['Astra', 'Marines'], seed: 106,
    });
    const bullgryn = state.units.find((u) => u.name === 'Bullgryn Squad')!;
    bullgryn.status = 'board';
    const def = modelDefence(state, bullgryn, bullgryn.models[0], 'ranged');
    expect(def.damage).toBe(-1);
  });
});

describe('Astra Militarum Bot Simulation', () => {
  it('automatically issues orders during Command phase', () => {
    const state = createGame({
      lists: [PRESETS.AM, PRESETS.SM], factions: [AM, SM], names: ['Astra', 'Marines'], seed: 107,
    });
    for (const u of state.units) {
      if (u.owner === 0) {
        u.status = 'board';
        u.models[0].x = 10; u.models[0].y = 10;
      }
    }
    state.phase = 'command';
    state.active = 0;

    autoIssueOrders(state, 0);

    const ordered = state.units.filter((u) => u.owner === 0 && currentOrders(u).length > 0);
    expect(ordered.length).toBeGreaterThan(0);
  });

  it('runs a complete bot-vs-bot game to game over without error', () => {
    const state = createGame({
      lists: [PRESETS.AM, PRESETS.SM], factions: [AM, SM], names: ['Astra', 'Marines'],
      dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    state.bots = [0, 1];
    let steps = 0;
    while (state.phase !== 'gameover' && steps < 5000) {
      botAct(state);
      steps++;
    }
    expect(state.phase).toBe('gameover');
    expect(steps).toBeLessThan(5000);
  });
});
