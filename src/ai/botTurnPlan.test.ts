// The expert bot's turn plan (botTurnPlan.ts): just enough OC to each objective, the models that must die for one to
// change hands, the screen in front of a charge, secondaries from the units the plan left free, and the home screen
// against Deep Strike. Every other level has no plan and plays as before.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botMoveOne, cardIsDead } from './bot';
import { objPoint, shotValue, unitPunch } from './botEval';
import { cardJobs, ctxFor } from './botMove';
import { armyPlan } from './botPlan';
import { setBotWeights } from './botWeights';
import { turnPlan } from './botTurnPlan';
import { autoList } from '../engine/autoList';
import { botAct } from './bot';
import { createGame, formationAt, levelOfControl, placeUnit } from '../engine/game';
import { alive, boardUnits, unitDistance } from '../engine/state';
import { dist } from '../engine/geometry';
import type { ArmyList, FactionData, GameState, ObjectiveState, Pt } from '../engine/types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

type Row = [string, number, number];
const list = (factionId: string, units: Row[]): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments: [],
  units: units.map(([d, n, pts], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts })),
});

/** Open ground (only the objective areas), every unit off the table until put down, round 2, player 0's Movement. */
function game(sm: Row[], ork: Row[], level: 'expert' | 'normal' = 'expert'): GameState {
  const s = createGame({
    lists: [list('SM', sm), list('ORK', ork)], factions: [SM, ORK], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
  });
  s.terrain = s.terrain.filter((t) => t.objectiveId);
  s.terrain.forEach((t) => { t.walls = []; t.category = 'exposed'; });
  for (const u of s.units) u.status = 'reserves';
  s.round = 2; s.turn = 3; s.active = 0; s.phase = 'movement';
  s.botLevel = level;
  return s;
}
function put(s: GameState, unitId: string, c: Pt) {
  const u = s.units.find((x) => x.id === unitId)!;
  placeUnit(s, u, formationAt(u, c));
  u.setUpTurn = -10;
  return u;
}
const unitOf = (s: GameState, owner: 0 | 1, i: number) => s.units.filter((u) => u.owner === owner)[i];
/** A field objective and the point of it, with the board corner furthest from it. */
function field(s: GameState): { o: ObjectiveState; at: Pt; far: Pt } {
  const o = s.objectives.find((x) => x.type !== 'home')!;
  const at = objPoint(s, o);
  const corners = [{ x: 3, y: 3 }, { x: 57, y: 3 }, { x: 3, y: 41 }, { x: 57, y: 41 }];
  return { o, at, far: corners.sort((a, b) => dist(b, at) - dist(a, at))[0] };
}
const postedTo = (s: GameState, at: Pt) => [...(turnPlan(s, 0)?.post ?? new Map()).entries()].filter(([, q]) => dist(q, at) < 0.5).map(([id]) => id);

describe('turn plan: objectives', () => {
  it('only the expert plans its turn', () => {
    const s = game([['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]], 'normal');
    put(s, unitOf(s, 0, 0).id, { x: 20, y: 20 });
    put(s, unitOf(s, 1, 0).id, { x: 40, y: 20 });
    expect(turnPlan(s, 0)).toBeNull();
    s.botLevel = 'expert';
    expect(turnPlan(s, 0)).not.toBeNull();
  });

  it('sends one squad to an empty objective three could reach, not all three', () => {
    const s = game([['Intercessor Squad', 5, 80], ['Intercessor Squad', 5, 80], ['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
    const { at, far } = field(s);
    put(s, unitOf(s, 0, 0).id, { x: at.x - 5, y: at.y });
    put(s, unitOf(s, 0, 1).id, { x: at.x + 5, y: at.y });
    put(s, unitOf(s, 0, 2).id, { x: at.x, y: at.y + (at.y < 22 ? 5 : -5) });
    put(s, unitOf(s, 1, 0).id, far);
    expect(postedTo(s, at)).toHaveLength(1);
  });

  it('sends nobody to an objective it secured that no enemy can reach', () => {
    const s = game([['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
    const { o, at, far } = field(s);
    o.secured = 0; o.controller = 0;
    put(s, unitOf(s, 0, 0).id, { x: at.x - 5, y: at.y });
    put(s, unitOf(s, 1, 0).id, far);
    expect(postedTo(s, at)).toHaveLength(0);
    expect(turnPlan(s, 0)!.orders.some((x) => x.o.id === o.id)).toBe(false);
  });

  it('values objectives by what its primary mission pays: no squad for its own home when the mission leaves it out', () => {
    // ten Intercessors: too many points to be the squad the army plan keeps on home all game
    const s = game([['Intercessor Squad', 10, 160]], [['Boyz', 10, 90]]);
    const home = s.objectives.find((o) => o.type === 'home' && o.owner === 0)!;
    const at = objPoint(s, home);
    s.objectives = [home];
    put(s, unitOf(s, 0, 0).id, { x: at.x + 5, y: at.y });
    put(s, unitOf(s, 1, 0).id, { x: 57, y: 41 });
    s.players[0].primaryId = 'immovable-object'; // 5VP per objective, excluding your home
    s.players[1].primaryId = 'immovable-object';
    setBotWeights(0, { planDeny: 0 });
    expect(postedTo(s, at)).toHaveLength(0);
    // the enemy's mission pays for it: holding it keeps those VP from them
    setBotWeights(0, { planDeny: 0.5 });
    expect(postedTo(structuredClone(s), at)).toHaveLength(1);
    setBotWeights(0);
    const t = game([['Intercessor Squad', 10, 160]], [['Boyz', 10, 90]]);
    t.objectives = [t.objectives.find((o) => o.type === 'home' && o.owner === 0)!];
    put(t, unitOf(t, 0, 0).id, { x: at.x + 5, y: at.y });
    put(t, unitOf(t, 1, 0).id, { x: 57, y: 41 });
    t.players[0].primaryId = 'battlefield-dominance'; // 3VP per objective, home included
    expect(postedTo(t, at)).toHaveLength(1);
  });

  it('the squad it sends ends its move on the objective', () => {
    const s = game([['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
    const { o, at, far } = field(s);
    const sq = put(s, unitOf(s, 0, 0).id, { x: at.x - 6, y: at.y });
    put(s, unitOf(s, 1, 0).id, far);
    expect(postedTo(s, at)).toEqual([sq.id]);
    let n = 0;
    while (!sq.move && n++ < 20 && botMoveOne(s)) { /* one unit at a time */ }
    expect(levelOfControl(s, o)[0]).toBeGreaterThan(0);
  });
});

describe('turn plan: kills', () => {
  it('shoots the models that keep an objective theirs, and stops once it is ours', () => {
    const s = game([['Intercessor Squad', 5, 80], ['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
    const { o, at } = field(s);
    put(s, unitOf(s, 0, 0).id, { x: at.x - 1.6, y: at.y });
    const shooter = put(s, unitOf(s, 0, 1).id, { x: at.x - 14, y: at.y });
    const boyz = put(s, unitOf(s, 1, 0).id, { x: at.x + 1.6, y: at.y });
    s.phase = 'shooting';
    const [ours, theirs] = levelOfControl(s, o);
    expect(ours).toBeGreaterThan(0);
    expect(theirs).toBeGreaterThanOrEqual(ours);
    const k = turnPlan(s, 0)!.kills.get(boyz.id)!;
    expect(k.why).toBe('objective');
    expect(k.models).toBe(Math.ceil((theirs - ours + 1) / 2)); // Boyz: OC 2 each
    const expert = shotValue(s, shooter, boyz, 4, unitDistance(shooter, boyz));
    s.botLevel = 'normal';
    expect(shotValue(s, shooter, boyz, 4, unitDistance(shooter, boyz))).toBeLessThan(expert);
    s.botLevel = 'expert';
    // enough of them dead: the objective is ours, nothing more to kill there
    const inside = alive(boyz).sort((a, b) => dist(a, at) - dist(b, at));
    for (const m of inside.slice(0, k.models + 1)) m.dead = true;
    expect(turnPlan(s, 0)!.kills.has(boyz.id)).toBe(false);
  });

  it('a charge it lines up: the unit standing in the way is shot first', () => {
    const s = game([['Assault Intercessor Squad', 5, 75]], [['Gretchin', 10, 40], ['Mek Gunz', 1, 55]]);
    const ai = put(s, unitOf(s, 0, 0).id, { x: 13, y: 22 });
    const grots = put(s, unitOf(s, 1, 0).id, { x: 19.5, y: 22 });
    // two left, across the way: not worth a charge on their own
    for (const m of [...alive(grots)].sort((a, b) => dist(b, { x: 19.5, y: 22 }) - dist(a, { x: 19.5, y: 22 })).slice(0, 8)) m.dead = true;
    const mek = put(s, unitOf(s, 1, 1).id, { x: 23, y: 22 });
    expect(unitDistance(ai, grots)).toBeGreaterThan(2); // not engaged: free to charge
    s.phase = 'shooting';
    const tp = turnPlan(s, 0)!;
    expect(tp.charges.get(ai.id)).toBe(mek.id);
    expect(tp.kills.get(grots.id)?.why).toBe('screen');
  });
});

describe('turn plan: secondaries and screens', () => {
  it('cards go to units the plan has not sent to an objective', () => {
    const s = game([['Intercessor Squad', 5, 80], ['Scout Squad', 5, 70]], [['Boyz', 10, 90]]);
    // one objective, by the middle of the board (the card's spot)
    const o = s.objectives.reduce((a, x) => (dist(objPoint(s, x), { x: 30, y: 22 }) < dist(objPoint(s, a), { x: 30, y: 22 }) ? x : a));
    s.objectives = [o];
    const at = objPoint(s, o);
    put(s, unitOf(s, 0, 0).id, { x: at.x - 4, y: at.y });
    put(s, unitOf(s, 0, 1).id, { x: at.x + 4, y: at.y });
    put(s, unitOf(s, 1, 0).id, { x: 57, y: 41 });
    s.players[0].secMode = 'tactical';
    s.players[0].secActive = ['centre-ground'];
    const posted = turnPlan(s, 0)!.post;
    expect(posted.size).toBe(1); // one squad is enough for the empty objective
    const jobs = [...cardJobs(s, 0).keys()];
    expect(jobs).toHaveLength(1);
    expect(posted.has(jobs[0])).toBe(false);
  });

  it('the expert discards a card it has only a small chance with; the others keep it', () => {
    const s = game([['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
    put(s, unitOf(s, 0, 0).id, { x: 8, y: 8 });
    put(s, unitOf(s, 1, 0).id, { x: 50, y: 36 });
    s.players[0].secMode = 'tactical';
    s.players[0].secActive = ['engage-on-all-fronts']; // one quarter held: a 25% chance
    expect(cardIsDead(s, 0, 'engage-on-all-fronts')).toBe(true);
    s.botLevel = 'normal';
    expect(cardIsDead(s, 0, 'engage-on-all-fronts')).toBe(false);
  });

  it('with Deep Strike waiting, a cheap unit screens the home objective', () => {
    const s = game([['Terminator Squad', 5, 170]], [['Gretchin', 10, 40]]);
    const home = s.objectives.find((o) => o.type === 'home' && o.owner === 1)!;
    const at = objPoint(s, home);
    const grots = put(s, unitOf(s, 1, 0).id, { x: at.x + 3, y: at.y });
    expect(unitOf(s, 0, 0).status).toBe('reserves');
    expect(ctxFor(s, grots).denial).toBeDefined();
    s.botLevel = 'normal';
    expect(ctxFor(s, grots).denial).toBeUndefined();
  });
});

it('plans a 2000-point turn in a few milliseconds', () => {
  const s = createGame({ lists: [autoList(SM, 2000, 3), autoList(ORK, 2000, 3)], factions: [SM, ORK], names: ['A', 'B'], seed: 3 });
  s.bots = [0, 1];
  let n = 0;
  while (s.phase !== 'movement' && n++ < 3000) botAct(s);
  expect(s.phase).toBe('movement');
  s.botLevel = 'expert';
  let best = Infinity;
  for (let k = 0; k < 4; k++) {
    const c = structuredClone(s);
    // what the movement phase works out for every unit anyway (the army's jobs, each unit's damage) is not the plan's
    armyPlan(c, c.active);
    for (const u of boardUnits(c)) unitPunch(c, u);
    const t0 = performance.now();
    turnPlan(c, c.active);
    best = Math.min(best, performance.now() - t0);
  }
  expect(best).toBeLessThan(20);
}, 120000);
