// Mechanics added for the last text-only rules: Deathstrike marker, timed keywords, setting a unit up away from the enemy.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGame, formationAt, placeUnit, setUpAway } from './game';
import { emit } from './events';
import { addTimed, expireTimed } from '../rules-engine/effects';
import { alive, unitDistance } from './state';
import '../factions';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const list = (factionId: string, units: [string, number, number][]): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments: [], units: units.map(([d, n, pts], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts })),
});
function game(a: [string, number, number][], b: [string, number, number][]): GameState {
  const s = createGame({ lists: [list('AM', a), list('ORK', b)], factions: [load('AM'), load('ORK')], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 3 });
  s.terrain = [];
  s.round = 2; s.turn = 2; s.phase = 'shooting'; s.active = 0;
  return s;
}
const put = (s: GameState, id: string, c: Pt) => { const u = s.units.find((x) => x.id === id)!; placeUnit(s, u, formationAt(u, c)); u.setUpTurn = -10; return u; };

describe('Deathstrike', () => {
  it('places its marker on the enemy, then fires the warhead on it a turn later if it stayed put', () => {
    const s = game([['Deathstrike', 1, 150]], [['Boyz', 10, 90]]);
    const ds = put(s, 'p0-x0', { x: 10, y: 22 });
    const boyz = put(s, 'p1-x0', { x: 40, y: 22 });
    emit(s, 'shootingStart', { p: 0 });
    expect(ds.dsMarker).toBeDefined();
    expect(Math.hypot(ds.dsMarker!.x - alive(boyz)[0].x, ds.dsMarker!.y - alive(boyz)[0].y)).toBeLessThan(6);
    s.turn = 4; ds.move = 'stationary';
    const before = alive(boyz).length;
    emit(s, 'shootingStart', { p: 0 });
    expect(ds.oneShotUsed).toContain('Deathstrike missile');
    expect(ds.dsMarker).toBeUndefined();
    expect(alive(boyz).length).toBeLessThan(before);
  });
});

describe('keywords for a while', () => {
  it('a timed addKeywords effect adds the keyword and takes it away when it ends', () => {
    const s = game([['Cadian Shock Troops', 10, 65]], [['Boyz', 10, 90]]);
    const u = put(s, 'p0-x0', { x: 10, y: 22 });
    addTimed(s, u, { e: { addKeywords: ['SYNAPSE'] }, label: 't', until: 'phase', by: 0 });
    expect(u.keywords).toContain('SYNAPSE');
    expireTimed(s, 'phaseEnd', 0);
    expect(u.keywords).not.toContain('SYNAPSE');
  });
});

describe('setUpAway', () => {
  it('sets a unit up more than the given distance from every enemy unit', () => {
    const s = game([['Cadian Shock Troops', 10, 65]], [['Boyz', 10, 90]]);
    const u = put(s, 'p0-x0', { x: 30, y: 22 });
    const boyz = put(s, 'p1-x0', { x: 34, y: 22 });
    expect(setUpAway(s, u, 8, { x: 30, y: 22 })).toBe(true);
    expect(unitDistance(u, boyz)).toBeGreaterThan(8);
  });
});
