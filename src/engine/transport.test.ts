// Transports (18): starting the battle embarked, Dedicated Transports, embark / disembark distances, and the bot.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { transportLoads, validateList } from './army';
import { botAct, botMoveOne } from '../ai/bot';
import { createGame, disembarkMode, embarkUnit, formationAt, hullSpots, placeUnit, ringFormation, validateDisembark } from './game';
import { baseDist } from './geometry';
import { alive } from './state';
import { buildShootPools } from './attack';
import type { ArmyList, FactionData, GameState, Pt, UnitState } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');
const SIZE = { points: 1000, dp: 2, unitLimit: 3, enhancements: 2 };

type Row = [string, number, number, Partial<{ embarkIn: string; attachTo: string; warlord: boolean }>?];
const list = (factionId: string, units: Row[]): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments: [],
  units: units.map(([d, n, pts, extra], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts, ...extra })),
});

/** How far the farthest model of `u` is from `t` (edge to edge). */
const baseDistOf = (u: UnitState, t: UnitState) => Math.max(...alive(u).map((m) => Math.min(...alive(t).map((n) => baseDist(m, n)))));

function put(s: GameState, unitId: string, c: Pt) {
  const u = s.units.find((x) => x.id === unitId)!;
  placeUnit(s, u, formationAt(u, c));
  u.setUpTurn = -10;
  return u;
}

describe('army builder: who starts in which transport', () => {
  it('checks what each transport can carry and its capacity', () => {
    const ok = list('SM', [['Impulsor', 1, 75], ['Intercessor Squad', 5, 80, { embarkIn: 'x0' }], ['Captain', 1, 80, { attachTo: 'x1', warlord: true }]]);
    const load0 = transportLoads(ok, SM)[0];
    expect(load0.problems).toEqual([]);
    expect(load0.used).toBe(6); // the Captain rides with the squad he leads
    // GRAVIS models can't ride a Rhino; an empty Dedicated Transport is flagged
    const bad = list('SM', [['Rhino', 1, 70], ['Heavy Intercessor Squad', 5, 100, { embarkIn: 'x0' }], ['Rhino', 1, 70], ['Captain', 1, 80, { warlord: true }]]);
    const errs = validateList(bad, SM, SIZE);
    expect(errs.some((e) => /Heavy Intercessor Squad cannot embark in Rhino/.test(e))).toBe(true);
    expect(errs.some((e) => /Dedicated Transport\) is empty/.test(e))).toBe(true);
    // too many models
    const full = list('ORK', [['Trukk', 1, 60], ['Boyz', 20, 180, { embarkIn: 'x0' }], ['Warboss', 1, 100, { warlord: true }]]);
    expect(transportLoads(full, ORK)[0].problems.some((p) => /not enough room/.test(p))).toBe(true);
  });

  it('the units start the battle embarked; a Dedicated Transport left empty is lost when deployment ends', () => {
    const s = createGame({
      lists: [list('SM', [['Impulsor', 1, 75], ['Intercessor Squad', 5, 80, { embarkIn: 'x0' }], ['Impulsor', 1, 75], ['Captain', 1, 80, { warlord: true }]]), list('ORK', [['Boyz', 10, 90], ['Warboss', 1, 100, { warlord: true }]])],
      factions: [SM, ORK], names: ['A', 'B'], seed: 4,
    });
    const ints = s.units.find((u) => u.id === 'p0-x1')!;
    expect(ints.status).toBe('embarked');
    expect(ints.embarkedIn).toBe('p0-x0');
    let steps = 0;
    while (s.phase === 'deploy' && steps < 200) { botAct(s); steps++; }
    expect(s.units.find((u) => u.id === 'p0-x0')!.status).not.toBe('destroyed');
    // the second Impulsor: the bot puts the Captain in it rather than lose it (Captains are TACTICUS INFANTRY)
    const second = s.units.find((u) => u.id === 'p0-x2')!;
    expect(second.status === 'destroyed' || s.units.some((u) => u.embarkedIn === second.id)).toBe(true);
  });
});

describe('embark and disembark', () => {
  function rig() {
    const s = createGame({
      lists: [list('SM', [['Impulsor', 1, 75], ['Intercessor Squad', 5, 80], ['Captain', 1, 80, { warlord: true }]]), list('ORK', [['Boyz', 10, 90], ['Warboss', 1, 100, { warlord: true }]])],
      factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
    });
    s.terrain = s.terrain.filter((t) => t.objectiveId);
    s.terrain.forEach((t) => (t.walls = []));
    for (const u of s.units) u.status = 'reserves';
    const imp = put(s, 'p0-x0', { x: 22, y: 20 });
    const ints = s.units.find((u) => u.id === 'p0-x1')!;
    expect(embarkUnit(s, ints, imp, true)).toBeNull();
    s.round = 2; s.turn = 2; s.active = 0; s.phase = 'movement';
    return { s, imp, ints };
  }

  it('Firing Deck: weapons of the squad inside shoot from the transport', () => {
    const { s, imp, ints } = rig();
    s.terrain.forEach((t) => { t.category = 'exposed'; });
    const boyz = put(s, 'p1-x0', { x: 22, y: 34 });
    s.phase = 'shooting';
    expect(imp.core.firingDeck).toBeGreaterThan(0);
    const r = buildShootPools(s, imp.id, boyz.id, { mode: 'normal' });
    const passengerGuns = alive(ints).flatMap((m) => m.weapons.map((w) => w.name));
    const deck = r.pools.filter((p) => passengerGuns.includes(p.weapon));
    expect(deck.length).toBeGreaterThan(0);
    expect(deck.reduce((a, p) => a + p.instances.length, 0)).toBeLessThanOrEqual(imp.core.firingDeck!);
  });

  it('Tactical Disembark: wholly within 3" of the transport, and the unit can still move', () => {
    const { s, imp, ints } = rig();
    expect(disembarkMode(s, imp)).toBe('tactical');
    const tm = alive(imp)[0];
    const near = ringFormation(ints, tm, Math.PI / 2);
    expect(validateDisembark(s, ints, imp, near).errors).toEqual([]);
    // one model a little too far out
    const far = new Map(near);
    const [id, p] = [...far][0];
    far.set(id, { x: p.x + (p.x - tm.x) * 1.0, y: p.y + (p.y - tm.y) * 1.0 });
    expect(validateDisembark(s, ints, imp, far).ok).toBe(false);
  });

  it('a led squad of 6+ models on big bases fits round the hull when it gets out (Captain + Terminators, Lieutenant + 10 Intercessors)', () => {
    for (const [tr, sq, n, ld] of [['Land Raider', 'Terminator Squad', 5, 'Captain In Terminator Armour'], ['Repulsor', 'Intercessor Squad', 10, 'Lieutenant']] as const) {
      const s = createGame({
        lists: [list('SM', [[tr, 1, 200], [sq, n, 170, { embarkIn: 'x0' }], [ld, 1, 80, { attachTo: 'x1' }]]), list('ORK', [['Boyz', 10, 90]])],
        factions: [SM, ORK], names: ['A', 'B'], seed: 1,
      });
      s.terrain = [];
      const t = put(s, 'p0-x0', { x: 22, y: 30 });
      const pas = s.units.find((u) => u.embarkedIn === t.id)!;
      expect(alive(pas).length).toBe(n + 1);
      s.phase = 'movement'; s.round = 2; s.turn = 2; s.active = 0; t.move = null;
      for (const a of [0, 1.5, 3, 4.5]) expect(validateDisembark(s, pas, t, ringFormation(pas, alive(t)[0], a)).errors).toEqual([]);
    }
  });

  it('embarking after a move needs every model within 3" of the transport', () => {
    const { s, imp, ints } = rig();
    const tm = alive(imp)[0];
    placeUnit(s, ints, formationAt(ints, { x: tm.x + tm.r + 8, y: tm.y }));
    ints.status = 'board'; ints.embarkedIn = null; ints.move = 'normal'; ints.setUpTurn = -10;
    expect(embarkUnit(s, ints, imp)).toMatch(/3"/);
    placeUnit(s, ints, ringFormation(ints, tm, 0));
    ints.setUpTurn = -10;
    expect(baseDistOf(ints, imp)).toBeLessThanOrEqual(3);
    expect(embarkUnit(s, ints, imp)).toBeNull();
    expect(ints.status).toBe('embarked');
  });

  it('the bot gets out before its transport moves once the enemy is close, then moves the squad', () => {
    const { s, imp, ints } = rig();
    put(s, 'p1-x0', { x: 22, y: 34 });
    s.botTried = [];
    botMoveOne(s);
    expect(ints.status).toBe('board');
    expect(ints.move).toBeNull(); // Tactical Disembark: it may still make a Normal / Advance move
    expect(baseDistOf(ints, imp)).toBeLessThanOrEqual(3.05);
    // the next steps move the squad and the transport
    for (let i = 0; i < 4; i++) botMoveOne(s);
    expect(ints.move).not.toBeNull();
  });

  it('a squad still gets out when walls, an objective marker and friends crowd the hull', () => {
    const { s, imp, ints } = rig();
    const tm = alive(imp)[0];
    // walls hard against two sides, an objective marker on a third, a friendly squad on the fourth
    s.terrain = [{ ...s.terrain[0], objectiveId: undefined, walls: [
      { a: { x: tm.x - 6, y: tm.y - tm.r - 0.3 }, b: { x: tm.x + 6, y: tm.y - tm.r - 0.3 } },
      { a: { x: tm.x + tm.r + 0.4, y: tm.y - 6 }, b: { x: tm.x + tm.r + 0.4, y: tm.y + 6 } },
    ] } as any];
    s.objectives = [{ ...s.objectives[0], x: tm.x, y: tm.y + tm.r + 1.4 }];
    put(s, 'p0-x2', { x: tm.x - tm.r - 1.2, y: tm.y + 2 });
    const plain = [0, 1, 2, 3, 4, 5].map((k) => ringFormation(ints, tm, (k * Math.PI) / 3));
    expect(plain.every((pos) => !validateDisembark(s, ints, imp, pos).ok)).toBe(true);
    const fit = [...hullSpots(s, ints, tm, Math.PI / 2)].find((pos) => validateDisembark(s, ints, imp, pos).ok);
    expect(fit).toBeTruthy();
  });

  it('passengers of a transport that stays where it is get out and walk', () => {
    const { s, imp, ints } = rig();
    put(s, 'p1-x0', { x: 22, y: 58 });
    s.objectives = [];
    s.botTried = [];
    // a transport that can't go anywhere this turn (nothing to hold, the enemy far off)
    alive(imp).forEach((m) => { m.profile = { ...m.profile, M: 0 }; });
    for (let i = 0; i < 3 && ints.status !== 'board'; i++) botMoveOne(s);
    expect(imp.move).toBe('stationary');
    expect(ints.status).toBe('board');
    expect(ints.move).toBeNull(); // Tactical Disembark: the squad still moves on foot
    for (let i = 0; i < 4 && !ints.move; i++) botMoveOne(s);
    expect(ints.move).not.toBeNull();
  });
});
