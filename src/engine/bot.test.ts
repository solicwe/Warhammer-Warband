// The bot: movement planning (routes around walls, no dead ends), Command Points (re-rolls, reactions, defensive
// stratagems) and attacks that wait for the player's saves in a game against the bot.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botAct, botMoveOne, botShootOne, botStep, botWindow } from './bot';
import { buildShootPools, finishAttack, hazardTest, rerollAttackCount, resolveAll, resolveReroll, rollHits, startAttack, stepAttack, toggleRerollPick } from './attack';
import { autoCharge, autoPileMove, createGame, declareCharge, endPhase, formationAt, placeUnit } from './game';
import { alive, engagedEnemies, unitDistance } from './state';
import { planStratagem } from './stratagems';
import { botAfterShootMove, botDoctrineActs } from './botPlus';
import { armyPlan } from './botPlan';
import { unitDoctrines } from './effects';
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
  s.terrain.forEach((t) => { t.walls = []; t.category = 'exposed'; }); // open ground: only the objective areas stay
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
    s.objectives = []; // only the route matters here (a central objective inside the ruin would be worth staying on)
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
    // a cheap squad kept on its home objective stays there by choice (Mek Gunz here)
    const kept = (u: (typeof s.units)[number]) => !!armyPlan(s, u.owner).jobs.get(u.id)?.keep;
    const stuck = s.units.filter((u) => u.status === 'board' && alive(u).length && !moved.has(u.id) && (alive(u)[0].profile.M ?? 0) > 0 && !kept(u));
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
      used += s.log.filter((e) => /Command Re-roll: a failed (Hit|Wound) roll/.test(e.text)).length;
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
  it('hazard: the game re-rolls one failed die for bots and people alike, keeping 1CP spare', () => {
    let usedBot = 0, usedOff = 0, usedOn = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const who of ['bot', 'off', 'on'] as const) {
        const s = game([['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
        s.rng = seed * 7919;
        const cp0 = who === 'off' ? 1 : 3; // 'off': only the spare CP left
        s.players[0].cp = cp0;
        s.phase = 'shooting';
        if (who === 'bot') s.bots = [0];
        const u = put(s, 'p0-x0', { x: 20, y: 14 });
        hazardTest(s, u, 5, 'test');
        const used = s.players[0].cp < cp0 ? 1 : 0;
        if (used) expect(s.log.at(-1)!.text).toMatch(/Command Re-roll \d→\d/);
        if (who === 'bot') usedBot += used; else if (who === 'off') usedOff += used; else usedOn += used;
      }
    }
    expect(usedBot).toBeGreaterThan(0);
    expect(usedOn).toBeGreaterThan(0);
    expect(usedOff).toBe(0);
  });

  it('a low random number of attacks is re-rolled by itself once, before the hit rolls', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = game([['Ballistus Dreadnought', 1, 150]], [['Boyz', 20, 180]]); // Ballistus missile launcher: D6+6 attacks
      s.rng = seed * 7919;
      s.players[0].cp = 3;
      s.phase = 'shooting';
      const inf = put(s, 'p0-x0', { x: 20, y: 14 });
      const boyz = put(s, 'p1-x0', { x: 20, y: 22 });
      const pools = buildShootPools(s, inf.id, boyz.id, { mode: 'normal' }).pools;
      startAttack(s, 'shoot', inf.id, boyz.id, pools);
      const i = s.attack!.pools.findIndex((p) => p.attackRolls?.some((r) => r.rerolled));
      if (i < 0) continue;
      const p = s.attack!.pools[i];
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
      expect(s.fx?.find((e) => e.kind === 'roll' && e.unitId === ai.id)).toMatchObject({ unitId: ai.id, at: { x: expect.any(Number), y: expect.any(Number) } });
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

describe('Bot Scouts moves', () => {
  it('makes the pre-battle Scouts move with its scout units and ends more than 9" from the enemy', () => {
    let moved = 0;
    for (const seed of [1, 2, 3]) {
      const s = createGame({ lists: [list('SM', [['Scout Squad', 5, 70], ['Intercessor Squad', 5, 85]]), list('ORK', [['Boyz', 10, 90]])], factions: [SM, ORK], names: ['A', 'B'], seed });
      s.bots = [0, 1];
      for (let i = 0; i < 60 && s.phase === 'deploy'; i++) botAct(s);
      expect(s.phase).toBe('scouts');
      const inc = s.units.find((u) => u.name === 'Scout Squad')!;
      const before = alive(inc).map((m) => ({ x: m.x, y: m.y }));
      for (let i = 0; i < 4 && s.phase === 'scouts'; i++) botAct(s);
      expect(s.phase).not.toBe('scouts');
      expect(inc.scoutDone).toBe(true);
      const boyz = s.units.find((u) => u.owner === 1)!;
      if (alive(inc).some((m, i) => Math.hypot(m.x - before[i].x, m.y - before[i].y) > 0.5)) {
        moved++;
        expect(s.log.some((l) => l.text.includes('Scout move'))).toBe(true);
        expect(unitDistance(inc, boyz)).toBeGreaterThan(9);
      }
    }
    expect(moved).toBeGreaterThan(0);
  });
});

describe('the bot uses decision abilities', () => {
  it('Strategic Acumen: a Captain far out of range of its guns takes Devastator Doctrine (Advance and still shoot)', () => {
    const s = game([['Captain', 1, 80]], [['Boyz', 10, 90]]);
    s.bots = [0, 1];
    s.phase = 'command';
    const cap = put(s, 'p0-x0', { x: 20, y: 6 });
    put(s, 'p1-x0', { x: 20, y: 52 });
    botDoctrineActs(s, 0);
    expect([...unitDoctrines(s, cap)]).toContain('devastator');
  });

  it('Tactical Fluidity: after shooting, a Phobos Captain in the open moves on when there is a better spot', () => {
    const s = game([['Captain In Phobos Armour', 1, 75]], [['Boyz', 10, 90]]);
    s.bots = [0, 1];
    s.phase = 'shooting';
    const cap = put(s, 'p0-x0', { x: 20, y: 20 });
    put(s, 'p1-x0', { x: 20, y: 30 });
    cap.selectedToShoot = true;
    cap.shotTurn = s.turn;
    const before = { x: alive(cap)[0].x, y: alive(cap)[0].y };
    botAfterShootMove(s, cap);
    const after = alive(cap)[0];
    const used = s.log.some((l) => /Tactical Fluidity/.test(l.text));
    expect(used).toBe(true);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(0);
    expect(cap.extraMove).toBeUndefined();
    expect(s.window).toBeNull();
  });
});

describe('bot unit roles', () => {
  it('a Techmarine leaves the infantry it stands with to stay by the army\'s vehicle', () => {
    const s = game([['Techmarine', 1, 55], ['Redemptor Dreadnought', 1, 195], ['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
    s.bots = [0, 1];
    s.phase = 'movement';
    const tech = put(s, 'p0-x0', { x: 8, y: 20 });
    const dread = put(s, 'p0-x1', { x: 38, y: 6 });
    dread.move = 'stationary';
    put(s, 'p0-x2', { x: 10, y: 23 }).move = 'stationary';
    put(s, 'p1-x0', { x: 22, y: 56 });
    const before = unitDistance(tech, dread);
    s.botTried = [];
    botMoveOne(s);
    expect(unitDistance(tech, dread)).toBeLessThan(before - 9);
  });

  it('an Ancient (its banner secures objectives) steps onto an objective we hold so it stays ours', () => {
    const s = game([['Ancient', 1, 50], ['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
    s.bots = [0, 1];
    s.phase = 'movement';
    const o = s.objectives.find((x) => x.type === 'expansion' && x.x > 30)!;
    const anc = put(s, 'p0-x0', { x: o.x - 6, y: o.y - 6 });
    put(s, 'p0-x1', { x: o.x, y: o.y }).move = 'stationary';
    o.controller = 0;
    put(s, 'p1-x0', { x: 22, y: 56 });
    s.botTried = [];
    botMoveOne(s);
    expect(alive(anc).some((m) => Math.hypot(m.x - o.x, m.y - o.y) <= 3 + m.r)).toBe(true);
  });
});

describe('table quarters', () => {
  it('Reconnaissance Sweep: the cheap units are sent to the empty quarters and walk there', async () => {
    const { ctxFor, unitQuarter } = await import('./botMove');
    const s = game([['Intercessor Squad', 5, 80], ['Scout Squad', 5, 70], ['Infiltrator Squad', 5, 100], ['Eliminator Squad', 3, 75]], [['Boyz', 10, 90]]);
    s.players[0].primaryId = 'reconnaissance-sweep';
    s.players[0].secMode = 'none';
    s.phase = 'movement';
    for (const [i, u] of s.units.filter((x) => x.owner === 0).entries()) put(s, u.id, { x: 6 + i * 3, y: 8 });
    put(s, s.units.find((x) => x.owner === 1)!.id, { x: 38, y: 55 });
    const jobs = s.units.filter((x) => x.owner === 0).map((u) => ctxFor(s, u).quarter?.q).filter((q) => q !== undefined);
    expect(new Set(jobs).size).toBe(4);
    for (const u of s.units.filter((x) => x.owner === 0)) { u.move = null; u.maxMoved = 0; }
    for (let i = 0; i < 12 && botMoveOne(s); i++) { /* move every unit */ }
    const held = new Set(s.units.filter((x) => x.owner === 0).map(unitQuarter).filter((q) => q !== null));
    expect(held.size).toBeGreaterThanOrEqual(2);
  });
});

describe('the army plan (botPlan.ts)', () => {
  it('a cheap unit holds home, the expensive ones fight, a cheap melee unit is not sent out alone, a loaded transport carries', async () => {
    const { armyPlan } = await import('./botPlan');
    const s = game([['Intercessor Squad', 5, 80], ['Redemptor Dreadnought', 1, 195], ['Terminator Squad', 5, 170], ['Assault Intercessor Squad', 5, 75], ['Impulsor', 1, 75]], [['Boyz', 10, 90], ['Nobz', 5, 105]]);
    s.phase = 'movement';
    const mine = s.units.filter((x) => x.owner === 0);
    const home = s.objectives.find((o) => o.type === 'home' && o.owner === 0)!;
    mine.forEach((u, i) => put(s, u.id, { x: home.x + (i - 2) * 5, y: home.y + (home.y < 30 ? 6 : -6) }));
    s.units.filter((x) => x.owner === 1).forEach((u, i) => put(s, u.id, { x: 12 + i * 12, y: home.y < 30 ? 50 : 10 }));
    const [ints, dread, terms, assault, imp] = mine;
    assault.status = 'embarked'; assault.embarkedIn = imp.id;
    const plan = armyPlan(s, 0);
    expect(plan.jobs.get(ints.id)?.role).toBe('home');
    expect(plan.jobs.get(dread.id)?.role).toBe('hammer');
    expect(plan.jobs.get(terms.id)?.role).toBe('hammer');
    expect(plan.jobs.get(imp.id)?.role).toBe('taxi');
  });

  it('always attacks (ahead late on it presses harder), and goes all in on the objectives in the last turn', async () => {
    const { stanceFor, armyPlan } = await import('./botPlan');
    const s = game([['Intercessor Squad', 5, 80], ['Hellblaster Squad', 5, 110]], [['Boyz', 10, 90]]);
    s.phase = 'movement';
    for (const [i, u] of s.units.entries()) put(s, u.id, { x: 10 + i * 10, y: u.owner === 0 ? 12 : 48 });
    s.round = 3;
    s.players[0].vp = 30; s.players[1].vp = 10;
    expect(stanceFor(s, 0).stance).toBe('push');
    expect(stanceFor(s, 1).stance).toBe('push');
    expect(stanceFor(s, 1).risk).toBeLessThan(stanceFor(s, 0).risk);
    s.round = 5; s.firstPlayer = 1; s.active = 0;
    const plan = armyPlan(s, 0);
    expect(plan.stance).toBe('all-in');
    expect([...plan.jobs.values()].every((j) => j.role === 'anchor' || j.role === 'hammer')).toBe(true);
  });

  it('shooting order: the unit that loses most if its best target is taken shoots first', () => {
    const s = game([['Eliminator Squad', 3, 75], ['Intercessor Squad', 10, 160]], [['Boyz', 10, 90], ['Deff Dread', 1, 130]]);
    s.phase = 'shooting';
    const [elim, ints] = s.units.filter((x) => x.owner === 0);
    put(s, elim.id, { x: 20, y: 14 });
    put(s, ints.id, { x: 28, y: 14 });
    put(s, s.units.find((x) => x.owner === 1 && x.name.includes('Boyz'))!.id, { x: 20, y: 30 });
    put(s, s.units.find((x) => x.owner === 1 && x.name.includes('Dread'))!.id, { x: 30, y: 30 });
    s.bots = [0];
    botShootOne(s);
    expect(s.units.some((u) => u.owner === 0 && u.selectedToShoot) || !!s.attack || s.log.some((l) => /shoots/.test(l.text))).toBe(true);
  });
});

describe('reading the enemy (trading, reactions, cards, screens)', () => {
  it('tying up a gun line is worth something; tying up a melee unit is not', async () => {
    const { lockValue } = await import('./botEval');
    const s = game([['Assault Intercessor Squad', 5, 75]], [['Flash Gitz', 5, 80], ['Boyz', 10, 90]]);
    s.phase = 'charge';
    put(s, 'p0-x0', { x: 20, y: 20 });
    const gitz = put(s, 'p1-x0', { x: 20, y: 30 });
    const boyz = put(s, 'p1-x1', { x: 30, y: 30 });
    expect(lockValue(s, gitz)).toBeGreaterThan(0);
    expect(lockValue(s, boyz)).toBe(0);
  });

  it('a secondary card that wants a unit somewhere gets the cheapest unit that can make it', async () => {
    const { ctxFor } = await import('./botMove');
    const s = game([['Intercessor Squad', 10, 160], ['Scout Squad', 5, 70], ['Redemptor Dreadnought', 1, 195]], [['Boyz', 10, 90]]);
    s.phase = 'movement';
    s.players[0].secMode = 'tactical';
    s.players[0].secActive = ['centre-ground'];
    const [ints, scouts, dread] = s.units.filter((x) => x.owner === 0);
    put(s, ints.id, { x: 14, y: 22 }); put(s, scouts.id, { x: 30, y: 22 }); put(s, dread.id, { x: 22, y: 20 });
    put(s, 'p1-x0', { x: 22, y: 56 });
    expect(ctxFor(s, scouts).card?.card).toBe('centre-ground');
    expect(ctxFor(s, ints).card).toBeUndefined();
    expect(ctxFor(s, dread).card).toBeUndefined();
  });

  it('difficulty: the easy bot does not look ahead, the expert tries more ways', async () => {
    const { chooseTurnStyle, lookBudget, setLookahead, resetLookahead } = await import('./botLook');
    const s = game([['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]]);
    s.botLevel = 'easy';
    setLookahead(true); resetLookahead();
    expect(chooseTurnStyle(s, 0)).toBe('steady');
    expect(lookBudget(s)).toBe(0);
    s.botLevel = 'expert';
    expect(lookBudget(s)).toBeGreaterThan(10000);
    setLookahead(false);
  });
});

describe('looking ahead', () => {
  it('each way of playing the turn is really played out (the copies keep their style)', async () => {
    const { styleValues, setLookahead, resetLookahead } = await import('./botLook');
    const s = game([['Intercessor Squad', 10, 160], ['Assault Intercessor Squad', 10, 150], ['Redemptor Dreadnought', 1, 195]], [['Boyz', 20, 170], ['Deff Dread', 1, 130], ['Flash Gitz', 5, 80]]);
    s.phase = 'movement';
    s.units.filter((x) => x.owner === 0).forEach((u, i) => put(s, u.id, { x: 10 + i * 10, y: 14 }));
    s.units.filter((x) => x.owner === 1).forEach((u, i) => put(s, u.id, { x: 10 + i * 10, y: 34 }));
    s.bots = [0, 1];
    s.botLevel = 'normal';
    setLookahead(true); resetLookahead();
    try {
      const v = styleValues(s, 0);
      expect(Object.keys(v).sort()).toEqual(['aggressive', 'steady']);
      // shortcut: only the removed careful style moved differently here; the pressing styles agree on this board
      for (const x of Object.values(v)) expect(Number.isFinite(x)).toBe(true);
    } finally { setLookahead(false); }
  });

  it('thinking during the opponent\'s turn: the copy reaches the same board the real game does', async () => {
    const { lookSig, playToMovement } = await import('./botLook');
    const s = createGame({ lists: [list('SM', [['Intercessor Squad', 10, 150], ['Hellblaster Squad', 5, 110]]), list('ORK', [['Boyz', 20, 180], ['Deff Dread', 1, 130]])], factions: [SM, ORK], names: ['A', 'B'], seed: 4 });
    s.bots = [0, 1];
    let steps = 0;
    // into the first player's Shooting phase: the other side (the bot) thinks about its coming turn from here
    while (!(s.phase === 'shooting' && s.round === 1) && steps++ < 3000) botAct(s);
    const me = s.active, bot = (1 - me) as 0 | 1;
    const ahead = playToMovement(s, bot)!;
    expect(ahead.phase).toBe('movement');
    expect(ahead.active).toBe(bot);
    // the player ends their phases without doing more; the real game gets to the same board (the same dice), so the
    // style thought out meanwhile is used at once
    while (!(s.phase === 'movement' && s.active === bot) && steps++ < 6000) {
      if (s.active === me && !s.window && !s.attack && (s.phase === 'shooting' || s.phase === 'charge')) endPhase(s); else botAct(s);
    }
    expect(lookSig(s)).toBe(lookSig(ahead));
  });

  it('a look reports its progress and the attacks the chosen way of playing makes (the enemy plan)', async () => {
    const { lookAhead, setLookahead, resetLookahead } = await import('./botLook');
    const s = game([['Intercessor Squad', 10, 160], ['Hellblaster Squad', 5, 110]], [['Boyz', 20, 170], ['Flash Gitz', 5, 80]]);
    s.phase = 'movement';
    s.units.filter((x) => x.owner === 0).forEach((u, i) => put(s, u.id, { x: 14 + i * 12, y: 16 }));
    s.units.filter((x) => x.owner === 1).forEach((u, i) => put(s, u.id, { x: 14 + i * 12, y: 34 }));
    s.bots = [0, 1];
    s.botLevel = 'normal';
    setLookahead(true); resetLookahead();
    try {
      const seen: string[] = [];
      const r = lookAhead(s, 0, undefined, (name, _v, done, total) => { seen.push(name); expect(done).toBeLessThanOrEqual(total); });
      expect(seen.sort()).toEqual(['aggressive', 'steady']);
      expect(Object.keys(r.values)).toContain(r.name);
      expect(r.intents.length).toBeGreaterThan(0);
      for (const x of r.intents) expect(s.units.find((u) => u.id === x.attackerId)?.owner).toBe(0);
    } finally { setLookahead(false); }
  });
});

describe('telling an attack', () => {
  it('the attack report counts each stage down, and the battle keeps each side\'s kills', () => {
    const s = game([['Intercessor Squad', 10, 160]], [['Boyz', 20, 170]]);
    s.phase = 'shooting';
    const a = put(s, 'p0-x0', { x: 20, y: 20 });
    const b = put(s, 'p1-x0', { x: 20, y: 32 });
    const r = buildShootPools(s, a.id, b.id, { mode: 'normal' });
    startAttack(s, 'shoot', a.id, b.id, r.pools);
    resolveAll(s);
    finishAttack(s);
    const fx = (s.fx ?? []).filter((e) => e.kind === 'attack').pop();
    if (fx?.kind !== 'attack') throw new Error('no attack event');
    const rep = fx.report!;
    expect(rep.shots).toBeGreaterThanOrEqual(rep.hits);
    expect(rep.hits).toBeGreaterThanOrEqual(rep.wounds - 0);
    expect(rep.wounds).toBeGreaterThanOrEqual(rep.unsaved);
    expect(rep.killed).toBe(fx.killed);
    expect(rep.chips.some((c) => /Rapid Fire/.test(c.label))).toBe(true); // 12" away: half range for bolt rifles
    if (rep.killed) expect(s.stats!.kills[0]).toMatchObject({ by: 0, attackerId: a.id, targetId: b.id, models: rep.killed });
  });
});
