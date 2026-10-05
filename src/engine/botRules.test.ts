// The bot plays the decision rules nobody tells it about: stratagems at the start of the Fight phase, when mortal
// wounds come in, in its Command phase, and abilities that take a unit back into Strategic Reserves.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMortalWounds } from './attack';
import { botCharacterStratagem, botFightStartStratagems, botRedeployActs } from './botPlus';
import { createGame, formationAt, placeUnit } from './game';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');
type Row = [string, number, number];
const list = (factionId: string, units: Row[]): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments: [],
  units: units.map(([d, n, pts], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts })),
});
const detWith = (strat: string) => SM.detachments.find((d) => d.stratagems.some((x) => x.name === strat))!;

function game(sm: Row[], ork: Row[], strat: string): GameState {
  const s = createGame({
    lists: [list('SM', sm), list('ORK', ork)], factions: [SM, ORK], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
  });
  s.terrain = s.terrain.filter((t) => t.objectiveId);
  s.terrain.forEach((t) => { t.walls = []; t.category = 'exposed'; });
  for (const u of s.units) u.status = 'reserves';
  s.round = 2; s.turn = 3; s.active = 0;
  s.players[0].detachments = [detWith(strat)];
  s.players[0].cp = 5;
  s.bots = [0, 1];
  return s;
}
function put(s: GameState, unitId: string, c: Pt) {
  const u = s.units.find((x) => x.id === unitId)!;
  placeUnit(s, u, formationAt(u, c));
  u.setUpTurn = -10;
  return u;
}
const used = (s: GameState, name: string) => s.log.some((l) => l.kind === 'cp' && l.text.includes(name));

describe('the bot uses the rest of the decision rules', () => {
  it('Adamantine Terror at the start of the Fight phase, for a Dreadnought in combat', () => {
    const s = game([['Redemptor Dreadnought', 1, 195]], [['Boyz', 20, 180]], 'ADAMANTINE TERROR');
    put(s, 'p0-x0', { x: 20, y: 20 });
    put(s, 'p1-x0', { x: 20, y: 23.5 });
    s.phase = 'fight';
    botFightStartStratagems(s, 0);
    expect(used(s, 'ADAMANTINE TERROR')).toBe(true);
  });

  it('Layered Ceramite when a vehicle is about to take a pile of mortal wounds', () => {
    const s = game([['Redemptor Dreadnought', 1, 195]], [['Boyz', 10, 90]], 'LAYERED CERAMITE');
    const dread = put(s, 'p0-x0', { x: 20, y: 20 });
    put(s, 'p1-x0', { x: 20, y: 40 });
    s.active = 1; s.phase = 'shooting';
    applyMortalWounds(s, dread, 6, 'test');
    expect(used(s, 'LAYERED CERAMITE')).toBe(true);
  });

  it('Instant of Grace on a valuable squad about to fight, when CP is plentiful', () => {
    const s = game([['Assault Intercessor Squad', 10, 150]], [['Boyz', 10, 90]], 'INSTANT OF GRACE');
    put(s, 'p0-x0', { x: 20, y: 20 });
    put(s, 'p1-x0', { x: 20, y: 32 });
    s.phase = 'command';
    botCharacterStratagem(s, 0);
    expect(used(s, 'INSTANT OF GRACE')).toBe(true);
  });

  it('Echo of the Ravenspire: Shrike swarmed at the end of the enemy Fight phase goes back into reserves', () => {
    const s = game([['Kayvaan Shrike', 1, 100]], [['Boyz', 10, 90], ['Boyz', 10, 90]], 'ADAMANTINE TERROR');
    const shrike = put(s, 'p0-x0', { x: 20, y: 30 });
    put(s, 'p1-x0', { x: 13, y: 30 });
    put(s, 'p1-x1', { x: 27, y: 30 });
    s.active = 1; s.phase = 'fight';
    s.fight = { step: 'consolidate', stepPlayer: 1, fought: [], eligible: [], movedThisStep: [] } as unknown as GameState['fight'];
    botRedeployActs(s, 0);
    expect(shrike.status).toBe('reserves');
  });
});
