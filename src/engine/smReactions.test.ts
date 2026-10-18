// Space Marine abilities that act at a moment of the game: Blackstar Cluster Launcher, Drop Pod Assault, Seeker of the
// Unfound, Teleport Homer, redeploys (Strategium Command …), Combat Embarkation and Miraculous Savior.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botAct } from '../ai/bot';
import { commitMove, createGame, declareCharge, deployUnit, endPhase, endRedeploy, findPlacement, formationAt, ingressUnit, placeUnit, redeployCandidates, redeployUnit, validatePlacement } from './game';
import { baseDist, pointInPoly, polyCentroid } from './geometry';
import { alive, isEngaged } from './state';
import { zonePoly } from './missions';
import { RULES } from './config';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

type Row = [string, number, number, Partial<{ embarkIn: string; attachTo: string }>?];
const list = (factionId: string, units: Row[], sub?: string): ArmyList => ({
  name: 't', factionId, subfaction: sub, battleSize: 'incursion', detachments: [],
  units: units.map(([d, n, pts, extra], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts, ...extra })),
});

function game(sm: Row[], ork: Row[], sub?: string, seed = 7): GameState {
  const s = createGame({
    lists: [list('SM', sm, sub), list('ORK', ork)], factions: [SM, ORK], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed,
  });
  s.terrain = s.terrain.filter((t) => t.objectiveId);
  s.terrain.forEach((t) => { t.walls = []; t.category = 'exposed'; });
  for (const u of s.units) if (u.status === 'pending') u.status = 'reserves';
  s.round = 2; s.turn = 2; s.phase = 'movement'; s.active = 0;
  return s;
}
const put = (s: GameState, id: string, c: Pt) => { const u = s.units.find((x) => x.id === id)!; placeUnit(s, u, formationAt(u, c)); u.setUpTurn = -10; return u; };
const gap = (a: { x: number; y: number; r: number }[], b: { x: number; y: number; r: number }[]) => Math.min(...a.flatMap((m) => b.map((n) => baseDist(m, n))));

describe('Space Marine abilities with their own moment', () => {
  it('Blackstar Cluster Launcher: a Normal move over an enemy unit rolls 6D6 against it', () => {
    const s = game([['Corvus Blackstar', 1, 180]], [['Boyz', 10, 90]], 'DEATHWATCH');
    const c = put(s, 'p0-x0', { x: 8, y: 30 });
    put(s, 'p1-x0', { x: 22, y: 30 });
    const m = alive(c)[0];
    commitMove(s, c, 'normal', new Map([[m.id, [{ x: m.x, y: m.y }, { x: 36, y: 30 }]]]));
    expect(s.log.some((l) => l.text.startsWith('Blackstar Cluster Launcher: Corvus Blackstar flies over Boyz'))).toBe(true);
  });

  it('Drop Pod Assault: the squad inside gets out at once, more than 8" from the enemy', () => {
    const s = game([['Drop Pod', 1, 60], ['Intercessor Squad', 5, 80, { embarkIn: 'x0' }]], [['Boyz', 10, 90]]);
    const pod = s.units.find((u) => u.id === 'p0-x0')!;
    const ints = s.units.find((u) => u.id === 'p0-x1')!;
    pod.status = 'reserves'; ints.status = 'embarked'; ints.embarkedIn = pod.id;
    const boyz = put(s, 'p1-x0', { x: 22, y: 52 });
    const pos = findPlacement(s, pod, 'deepStrike', { x: 22, y: 20 })!;
    expect(ingressUnit(s, pod, pos).ok).toBe(true);
    expect(ints.status).toBe('board');
    expect(gap(alive(ints), alive(boyz))).toBeGreaterThan(8);
  });

  it('Seeker of the Unfound: Vulkan picks an objective out in the field when first set up, and holds it with OC 10', () => {
    const s = game([['Vulkan He’stan', 1, 100]], [['Boyz', 10, 90]], 'SALAMANDERS');
    const v = s.units.find((u) => u.id === 'p0-x0')!;
    const field = s.objectives.filter((o) => o.type !== 'home');
    put(s, v.id, { x: field[0].x, y: field[0].y });
    expect(v.seekerObjective).toBe(field[0].id);
  });

  it('Teleport Homer: a token at the start of the battle; arriving in the opponent\'s turn is within 3" of it', () => {
    const s = game([['Terminator Squad', 5, 170]], [['Boyz', 10, 90]]);
    const t = s.units.find((u) => u.id === 'p0-x0')!;
    expect(t.homer).toBeDefined();
    expect(pointInPoly(t.homer!, zonePoly(s, t.owner))).toBe(true);
    const edgeDistance = (p: Pt) => Math.min(p.x, p.y, RULES.battlefield.width - p.x, RULES.battlefield.height - p.y);
    expect(edgeDistance(t.homer!)).toBeLessThan(edgeDistance(polyCentroid(zonePoly(s, t.owner))));
    t.status = 'reserves';
    s.active = 1;
    const far = formationAt(t, { x: t.homer!.x > 22 ? 6 : 38, y: t.homer!.y });
    expect(validatePlacement(s, t, far, 'deepStrike').errors.join()).toMatch(/Teleport Homer/);
    const near = findPlacement(s, t, 'deepStrike', t.homer);
    expect(near && validatePlacement(s, t, near, 'deepStrike').ok).toBe(true);
  });

  it('Strategium Command: after deployment the player redeploys a unit into Strategic Reserves', () => {
    const s = createGame({
      lists: [list('SM', [['Wardens of Ultramar', 6, 115], ['Intercessor Squad', 5, 80]], 'ULTRAMARINES'), list('ORK', [['Boyz', 10, 90]])],
      factions: [SM, ORK], names: ['A', 'B'], seed: 3,
    });
    s.bots = [1];
    let steps = 0;
    while (s.phase === 'deploy' && !s.redeploy && steps++ < 50) {
      if (s.deployTurn === 1) { botAct(s); continue; }
      const u = s.units.find((x) => x.owner === 0 && x.status === 'pending')!;
      deployUnit(s, u.id, findPlacement(s, u, 'deploy')!);
    }
    expect(s.redeploy?.player).toBe(0);
    const ints = redeployCandidates(s).find((u) => u.name === 'Intercessor Squad')!;
    expect(redeployUnit(s, ints.id, true)).toBeNull();
    expect(ints.status).toBe('reserves');
    expect(endRedeploy(s)).toBeNull();
    expect(s.phase).not.toBe('deploy');
  });

  it('Emergency Combat Embarkation: the squad next to the Repulsor gets in when the Orks charge it', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = game([['Repulsor', 1, 180], ['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]], undefined, seed);
      put(s, 'p0-x0', { x: 22, y: 20 });
      const ints = put(s, 'p0-x1', { x: 22, y: 24.5 });
      const boyz = put(s, 'p1-x0', { x: 22, y: 33 });
      s.active = 1; s.phase = 'charge';
      declareCharge(s, boyz);
      if ((boyz.chargeRoll ?? 0) < gap(alive(boyz), alive(ints))) continue;
      expect(ints.status).toBe('embarked');
      return;
    }
    throw new Error('no charge roll reached');
  });

  it('Miraculous Saviour: at the end of the opponent\'s Charge phase the Sanguinor drops in, engaged with the charger', () => {
    const s = game([['The Sanguinor', 1, 130]], [['Boyz', 10, 90]], 'BLOOD ANGELS');
    const sang = s.units.find((u) => u.id === 'p0-x0')!;
    sang.status = 'reserves';
    const boyz = put(s, 'p1-x0', { x: 22, y: 30 });
    s.active = 1; s.phase = 'charge'; boyz.chargedTurn = s.turn;
    endPhase(s);
    while (s.window && s.phase === 'charge') { s.window = null; endPhase(s); }
    expect(sang.status).toBe('board');
    expect(isEngaged(s, sang)).toBe(true);
  });

});
