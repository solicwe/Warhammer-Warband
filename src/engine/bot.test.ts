// The bot: movement planning (routes around walls, no dead ends), Command Points (re-rolls, reactions, defensive
// stratagems) and attacks that wait for the player's saves in a game against the bot.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botAct, botMoveOne, botShootOne, botStep, botWindow } from './bot';
import { attackRerollGap, buildShootPools, hazardTest, rerollAttackCount, resolveAll, resolveReroll, rollHits, startAttack, stepAttack, toggleRerollPick } from './attack';
import { autoCharge, autoPileMove, createGame, declareCharge, formationAt, placeUnit } from './game';
import { alive, engagedEnemies, unitDistance } from './state';
import { planStratagem } from './stratagems';
import type { ArmyList, FactionData, GameState, Pt, TerrainPiece } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

type Row = [string, number, number];
const list = (factionId: string, units: Row[]): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments: [],
  units: units.map(([d, n, pts], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts })),
});

function game(sm: Row[], ork: Row[]): GameState {
  const s = createGame({
    lists: [list('SM', sm), list('ORK', ork)], factions: [SM, ORK], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
  });
  s.terrain = s.terrain.filter((t) => t.objectiveId);
  s.terrain.forEach((t) => (t.walls = []));
  for (const u of s.units) u.status = 'reserves';
  s.round = 2; s.turn = 3; s.active = 0;
  return s;
}

function put(s: GameState, unitId: string, c: Pt) {
  const u = s.units.find((x) => x.id === unitId)!;
  placeUnit(s, u, formationAt(u, c));
  u.setUpTurn = -10;
  return u;
}

/** A ruin with walls on three sides, open towards the bottom of the board. */
function uRuin(x0: number, y0: number, x1: number, y1: number): TerrainPiece {
  const P = (x: number, y: number) => ({ x, y });
  return {
    id: 'u-ruin', kind: 'ruin', label: 'ruin', category: 'dense', height: 5,
    poly: [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)],
    walls: [{ a: P(x0, y0), b: P(x1, y0) }, { a: P(x0, y0), b: P(x0, y1) }, { a: P(x1, y0), b: P(x1, y1) }],
  };
}

describe('bot movement', () => {
  it('a vehicle in a U-shaped ruin drives out of the open side instead of sitting against the closed wall', () => {
    const s = game([['Redemptor Dreadnought', 1, 195]], [['Boyz', 10, 90]]);
    s.terrain.push(uRuin(14, 18, 26, 30));
    s.phase = 'movement';
    const dread = put(s, 'p0-x0', { x: 20, y: 22 });
    put(s, 'p1-x0', { x: 20, y: 6 }); // the enemy is behind the closed wall
    const before = { x: alive(dread)[0].x, y: alive(dread)[0].y };
    s.botTried = [];
    botMoveOne(s);
    const m = alive(dread)[0];
    expect(dread.move === 'normal' || dread.move === 'advance').toBe(true);
    // it heads for the opening (down the board), not up against the wall
    expect(m.y).toBeGreaterThan(before.y + 2);
  });

  it('a bot move is replayed on the board: the move event carries the route from where the models stood', () => {
    const s = game([['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
    s.phase = 'movement';
    const ints = put(s, 'p0-x0', { x: 20, y: 12 });
    put(s, 'p1-x0', { x: 20, y: 40 });
    const start = new Map(alive(ints).map((m) => [m.id, { x: m.x, y: m.y }]));
    const seq = s.fxSeq ?? 0;
    s.botTried = [];
    botMoveOne(s);
    const mv = (s.fx ?? []).find((e) => e.seq > seq && e.kind === 'move');
    expect(mv).toBeTruthy();
    if (mv?.kind !== 'move') return;
    for (const [id, path] of mv.paths) {
      expect(path[0]).toEqual(start.get(id));
      expect(path.length).toBeGreaterThan(1);
    }
  });

  it('every bot unit moves at some point of a whole game (none is left stuck)', () => {
    const s = createGame({ lists: [list('SM', [['Redemptor Dreadnought', 1, 195], ['Intercessor Squad', 10, 150], ['Hellblaster Squad', 5, 110]]), list('ORK', [['Boyz', 20, 180], ['Deff Dread', 1, 130], ['Mek Gunz', 1, 55]])], factions: [SM, ORK], names: ['A', 'B'], seed: 3 });
    const moved = new Set<string>();
    let steps = 0;
    while (s.phase !== 'gameover' && s.round < 4 && steps < 3000) {
      botAct(s); steps++;
      for (const u of s.units) if (u.move && u.move !== 'stationary') moved.add(u.id);
    }
    const stuck = s.units.filter((u) => u.status === 'board' && alive(u).length && !moved.has(u.id) && (alive(u)[0].profile.M ?? 0) > 0);
    expect(stuck.map((u) => u.name)).toEqual([]);
  });
});

describe('re-rolls', () => {
  it('an ability re-roll waits for the dice to be picked: the misses are picked to begin with, only picked dice are re-rolled', () => {
    const s = game([['Intercessor Squad', 10, 150]], [['Boyz', 20, 180]]);
    s.phase = 'shooting';
    s.pickRerolls = true;
    const ints = put(s, 'p0-x0', { x: 20, y: 14 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 26 });
    ints.buffs.push({ kind: 'rerollHits', until: 'phase' });
    startAttack(s, 'shoot', ints.id, boyz.id, buildShootPools(s, ints.id, boyz.id, { mode: 'normal' }).pools);
    rollHits(s);
    const p = s.attack!.pools[0];
    expect(p.reroll?.stage).toBe('hit');
    expect(p.reroll!.picks).toEqual(p.hits.map((d, i) => (d.o === 'miss' ? i : -1)).filter((i) => i >= 0));
    // keep one miss, and pick a hit to fish for a critical
    const hitIdx = p.hits.findIndex((d) => d.o === 'hit');
    const missIdx = p.reroll!.picks[0];
    if (missIdx !== undefined) toggleRerollPick(s, missIdx);
    if (hitIdx >= 0) toggleRerollPick(s, hitIdx);
    const picks = [...p.reroll!.picks];
    const before = p.hits.map((d) => d.v);
    resolveReroll(s);
    expect(p.reroll).toBeUndefined();
    p.hits.forEach((d, i) => expect(!!d.rerolled).toBe(picks.includes(i)));
    if (missIdx !== undefined) expect(p.hits[missIdx].v).toBe(before[missIdx]);
  });

  it('by default an ability re-roll is made at once on every failed die (Oath of Moment and the like)', () => {
    const s = game([['Intercessor Squad', 10, 150]], [['Boyz', 20, 180]]);
    s.phase = 'shooting';
    const ints = put(s, 'p0-x0', { x: 20, y: 14 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 26 });
    ints.buffs.push({ kind: 'rerollHits', until: 'phase' });
    startAttack(s, 'shoot', ints.id, boyz.id, buildShootPools(s, ints.id, boyz.id, { mode: 'normal' }).pools);
    rollHits(s);
    const p = s.attack!.pools[0];
    expect(p.reroll).toBeUndefined();
    // nothing left that failed without being re-rolled
    expect(p.hits.some((d) => d.o === 'miss' && !d.rerolled)).toBe(false);
  });

  it('re-roll 1s only offers the dice that rolled a 1, and resolveAll re-rolls the failures by itself', () => {
    const s = game([['Intercessor Squad', 10, 150]], [['Boyz', 20, 180]]);
    s.pickRerolls = true;
    s.phase = 'shooting';
    const ints = put(s, 'p0-x0', { x: 20, y: 14 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 26 });
    ints.buffs.push({ kind: 'rerollHits1', until: 'phase' });
    startAttack(s, 'shoot', ints.id, boyz.id, buildShootPools(s, ints.id, boyz.id, { mode: 'normal' }).pools);
    stepAttack(s);
    const p = s.attack!.pools[0];
    if (p.reroll) {
      expect(p.reroll.which).toBe('ones');
      for (const i of p.reroll.picks) expect(p.hits[i].v).toBe(1);
    }
    resolveAll(s);
    expect(s.attack!.stage).toBe('done');
    expect(p.hits.filter((d) => d.rerolled).every((d) => d.orig === 1)).toBe(true);
  });
});

describe('the bot spends Command Points', () => {
  it('Command Re-roll on a failed lascannon hit against a tank', () => {
    let used = 0;
    for (let seed = 1; seed <= 30 && !used; seed++) {
      const s = game([['Land Raider', 1, 240]], [['Battlewagon', 1, 160]]);
      s.rng = seed * 7919;
      s.bots = [0, 1];
      s.players[0].cp = 3;
      s.phase = 'shooting';
      const dev = put(s, 'p0-x0', { x: 20, y: 12 });
      const bw = put(s, 'p1-x0', { x: 20, y: 30 });
      const r = buildShootPools(s, dev.id, bw.id, { mode: 'normal' });
      startAttack(s, 'shoot', dev.id, bw.id, r.pools);
      resolveAll(s);
      used += s.log.filter((e) => /Command Re-roll: ทอยลูก (Hit|Wound)/.test(e.text)).length;
    }
    expect(used).toBeGreaterThan(0);
  });

  it('a defensive detachment stratagem when its unit is about to be shot hard', () => {
    const s = game([['Intercessor Squad', 5, 80]], [['Gorkanaut', 1, 255]]);
    // a detachment with a stratagem that only protects (Armour of Contempt …)
    const det = SM.detachments.find((d) => d.stratagems.some((st) => { const p = planStratagem(st); return p.target === 'own' && p.effects.includes('enemyAp-1') && p.turn !== 'your'; }))!;
    s.players[0].detachments = [det];
    s.bots = [0, 1];
    s.players[0].cp = 4;
    s.active = 1; s.phase = 'shooting';
    const ints = put(s, 'p0-x0', { x: 20, y: 14 });
    const gork = put(s, 'p1-x0', { x: 20, y: 28 });
    const cp = s.players[0].cp;
    startAttack(s, 'shoot', gork.id, ints.id, buildShootPools(s, gork.id, ints.id, { mode: 'normal' }).pools);
    expect(s.players[0].cp).toBeLessThan(cp);
    expect(ints.buffs.some((b) => b.kind === 'enemyAp-1')).toBe(true);
  });

  it('Smokescreen on the SMOKE unit that is about to be shot', () => {
    const s = game([['Infernus Squad', 5, 85]], [['Flash Gitz', 10, 160]]);
    const smoke = s.units.find((u) => u.owner === 0)!;
    if (!smoke.keywords.includes('SMOKE')) smoke.keywords.push('SMOKE');
    s.bots = [0];
    s.players[0].cp = 3;
    s.active = 1; s.phase = 'shooting';
    put(s, smoke.id, { x: 20, y: 14 });
    put(s, 'p1-x0', { x: 20, y: 28 });
    s.window = { kind: 'smokescreen', player: 0 };
    botWindow(s);
    expect(smoke.buffs.some((b) => b.kind === 'smoke')).toBe(true);
    expect(s.window).toBeNull();
  });
});

describe('Command Re-roll on hazard, damage and the number of attacks', () => {
  it('hazard: a bot re-rolls one failed die; a person only when they turned it on', () => {
    let usedBot = 0, usedOff = 0, usedOn = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const who of ['bot', 'off', 'on'] as const) {
        const s = game([['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
        s.rng = seed * 7919;
        s.players[0].cp = 3;
        s.phase = 'shooting';
        if (who === 'bot') s.bots = [0];
        if (who === 'on') s.players[0].autoReroll = { hazard: true };
        const u = put(s, 'p0-x0', { x: 20, y: 14 });
        hazardTest(s, u, 5, 'test');
        const used = s.players[0].cp < 3 ? 1 : 0;
        if (used) expect(s.log.at(-1)!.text).toMatch(/Command Re-roll \d→\d/);
        if (who === 'bot') usedBot += used; else if (who === 'off') usedOff += used; else usedOn += used;
      }
    }
    expect(usedBot).toBeGreaterThan(0);
    expect(usedOn).toBeGreaterThan(0);
    expect(usedOff).toBe(0);
  });

  it('a low random number of attacks can be re-rolled once, before the hit rolls', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = game([['Infernus Squad', 5, 85]], [['Boyz', 20, 180]]);
      s.rng = seed * 7919;
      s.players[0].cp = 3;
      s.phase = 'shooting';
      const inf = put(s, 'p0-x0', { x: 20, y: 14 });
      const boyz = put(s, 'p1-x0', { x: 20, y: 22 });
      const pools = buildShootPools(s, inf.id, boyz.id, { mode: 'normal' }).pools;
      startAttack(s, 'shoot', inf.id, boyz.id, pools);
      const i = s.attack!.pools.findIndex((p) => p.attackRolls?.length);
      if (i < 0 || attackRerollGap(s.attack!.pools[i]) < 1) continue;
      const p = s.attack!.pools[i];
      expect(rerollAttackCount(s, i)).toBeNull();
      expect(s.players[0].cp).toBe(2);
      expect(p.attackRolls!.some((r) => r.rerolled)).toBe(true);
      expect(p.attackNote).toMatch(/Command Re-roll/);
      expect(rerollAttackCount(s, i)).not.toBeNull(); // once per phase
      return;
    }
    throw new Error('no low roll found');
  });

  it('damage: with the switch on, the first low damage roll is re-rolled for 1CP', () => {
    let used = 0;
    for (let seed = 1; seed <= 30 && !used; seed++) {
      const s = game([['Land Raider', 1, 240]], [['Battlewagon', 1, 160]]);
      s.rng = seed * 7919;
      s.players[0].cp = 3;
      s.phase = 'shooting';
      const a = put(s, 'p0-x0', { x: 20, y: 12 });
      const t = put(s, 'p1-x0', { x: 20, y: 30 });
      startAttack(s, 'shoot', a.id, t.id, buildShootPools(s, a.id, t.id, { mode: 'normal' }).pools);
      for (const p of s.attack!.pools) { p.crDamage = true; p.rerollDamage = false; } // (its own re-roll ability aside)
      resolveAll(s);
      const lines = s.attack!.pools.flatMap((p) => p.damageLines).filter((l) => /Command Re-roll damage/.test(l));
      expect(lines.length).toBeLessThanOrEqual(1);
      if (lines.length) { used++; expect(s.players[0].cp).toBe(2); }
    }
    expect(used).toBe(1);
  });
});

describe('playing against the bot', () => {
  it('a bot attack on the player\'s unit waits for the player to roll the saves', () => {
    const s = game([['Intercessor Squad', 10, 150]], [['Boyz', 20, 180]]);
    s.bots = [1]; s.botPlayer = 1;
    s.active = 1; s.phase = 'shooting';
    const ints = put(s, 'p0-x0', { x: 20, y: 14 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 30 });
    expect(unitDistance(ints, boyz)).toBeLessThan(18);
    s.botTried = [];
    botStep(s, 1);
    expect(s.attack?.defenderRolls).toBe(true);
    expect(s.attack!.attackerId).toBe(boyz.id);
    // the player resolves it; the bot then carries on
    resolveAll(s);
    expect(s.attack!.stage).toBe('done');
  });

  it('with "roll my saves" off the bot resolves its attacks at once', () => {
    const s = game([['Intercessor Squad', 10, 150]], [['Boyz', 20, 180]]);
    s.bots = [1]; s.botPlayer = 1; s.defenderRolls = false;
    s.active = 1; s.phase = 'shooting';
    put(s, 'p0-x0', { x: 20, y: 14 });
    put(s, 'p1-x0', { x: 20, y: 30 });
    s.botTried = [];
    botShootOne(s);
    expect(s.attack).toBeFalsy();
  });
});

describe('one-tap charge and pile-in (the player taps the target, the models move in by themselves)', () => {
  it('a successful charge roll moves the unit into engagement with the tapped target', () => {
    let done = 0;
    for (let seed = 1; seed <= 12 && !done; seed++) {
      const s = game([['Assault Intercessor Squad', 5, 75]], [['Boyz', 10, 90]]);
      s.rng = seed * 7919;
      s.phase = 'charge';
      const ai = put(s, 'p0-x0', { x: 20, y: 14 });
      const boyz = put(s, 'p1-x0', { x: 20, y: 21 });
      declareCharge(s, ai);
      if ((ai.chargeRoll ?? 0) < unitDistance(ai, boyz)) continue;
      expect(autoCharge(s, ai, [boyz.id])).toBe(true);
      expect(engagedEnemies(s, ai).map((e) => e.id)).toContain(boyz.id);
      expect(ai.chargedTurn).toBe(s.turn);
      done++;
    }
    expect(done).toBe(1);
  });

  it('pile-in moves a unit that is close but not yet in base contact towards the enemy', () => {
    const s = game([['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
    s.phase = 'fight';
    const ints = put(s, 'p0-x0', { x: 20, y: 14 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 18.5 });
    const before = unitDistance(ints, boyz);
    expect(autoPileMove(s, ints, 'pileIn')).toBe(true);
    expect(unitDistance(ints, boyz)).toBeLessThan(before);
  });

  it('pile-in brings models that cannot reach base contact as close as they can (more of them end up fighting)', () => {
    const s = game([['Intercessor Squad', 10, 160]], [['Boyz', 5, 45]]);
    s.phase = 'fight';
    const ints = put(s, 'p0-x0', { x: 20, y: 14 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 19.5 });
    // the models left behind are the ones that count: each should end as near the enemy as it can get
    const gaps = () => alive(ints).map((m) => Math.min(...alive(boyz).map((b) => Math.hypot(m.x - b.x, m.y - b.y) - m.r - b.r))).sort((a, b) => b - a);
    expect(autoPileMove(s, ints, 'pileIn')).toBe(true);
    const g = gaps();
    expect(g[0]).toBeLessThan(3); // the furthest model still closes in (it stayed ~3.8" away before)
  });
});
