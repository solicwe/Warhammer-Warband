import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, formationAt, placeUnit, concludeFight } from './game';
import { buildFightPools, fightCanSplit, fightRemaining, finishAttack, resolveAll, startAttack } from './attack';
import { PRESETS } from '../ui/presets';
import { alive } from './state';

// Core Rules 04.02 / 04.03: while fighting, a weapon can target one or more enemy units engaged with its model; a unit fights
// in parts, and the models that only reach another enemy unit fight that one.
const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));
function setup() {
  const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 7 });
  s.round = 2; s.turn = 1; s.phase = 'fight'; s.active = 0;
  s.terrain = [];
  const mine = s.units.filter((u) => u.owner === 0 && u.status !== 'reserves' && alive(u).length >= 5);
  const theirs = s.units.filter((u) => u.owner === 1);
  const A = mine[0], T1 = theirs[0], T2 = theirs[1];
  for (const u of [A, T1, T2]) { u.status = 'board'; placeUnit(s, u, formationAt(u, { x: 5, y: 5 })); }
  const ms = alive(A);
  // left half of the line touches T1, right half touches T2; keep the rest of each enemy unit far away
  ms.forEach((m, i) => { m.x = 10 + i * 1.6; m.y = 20; });
  const place = (u: typeof T1, x: number) => alive(u).forEach((m, i) => { m.x = i === 0 ? x : 40 + i; m.y = i === 0 ? 20 + m.r + ms[0].r + 0.5 : 40; });
  place(T1, ms[0].x); place(T2, ms[ms.length - 1].x);
  for (const u of s.units) if (![A, T1, T2].includes(u)) u.status = 'reserves';
  s.fight = { step: 'fight', stepPlayer: 0, chooser: 0, eligible: [A.id], fought: [], pendingConsolidate: null, consolidated: [], forcedNext: null, movedThisStep: [] } as never;
  return { s, A, T1, T2, ms };
}

it('a unit fights its engaged enemy units one after the other; models engaged only with the second fight it', () => {
  const { s, A, T1, T2, ms } = setup();
  expect(fightRemaining(s, A).map((u) => u.id).sort()).toEqual([T1.id, T2.id].sort());
  const first = buildFightPools(s, A.id, T1.id);
  const firstIds = new Set(first.pools.flatMap((p) => p.fromIds ?? []));
  expect(firstIds.has(ms[0].id)).toBe(true);
  expect(firstIds.has(ms[ms.length - 1].id)).toBe(false); // that model only reaches the other unit
  startAttack(s, 'fight', A.id, T1.id, first.pools);
  resolveAll(s); finishAttack(s);
  expect(A.fought).toBe(false);
  expect(concludeFight(s, A.id)).toBe(false);
  const left = fightRemaining(s, A);
  expect(left.map((u) => u.id)).toEqual([T2.id]);
  const second = buildFightPools(s, A.id, T2.id);
  const secondIds = new Set(second.pools.flatMap((p) => p.fromIds ?? []));
  expect(secondIds.has(ms[ms.length - 1].id)).toBe(true);
  for (const id of firstIds) if (!ms.find((m) => m.id === id)!.dead) expect(secondIds.has(id)).toBe(false); // each model attacks once
  startAttack(s, 'fight', A.id, T2.id, second.pools);
  resolveAll(s); finishAttack(s);
  expect(A.fought).toBe(true);
});

it('a model engaged with two units can split its attacks: half now, the rest at the next target', () => {
  const { s, A, T1, T2, ms } = setup();
  // one model touches both enemy units
  const m = ms[1];
  const e1 = alive(T1)[0], e2 = alive(T2)[0];
  e1.x = m.x - 1.2; e1.y = m.y + m.r + e1.r + 0.5;
  e2.x = m.x + 1.2; e2.y = m.y + m.r + e2.r + 0.5;
  expect(fightCanSplit(s, A, T1)).toBe(true);
  const sharedA = buildFightPools(s, A.id, T1.id, { split: true });
  const whole = buildFightPools(s, A.id, T1.id);
  const attacksOf = (r: ReturnType<typeof buildFightPools>, id: string) => r.pools.filter((p) => p.fightUse?.some((u) => u.id === id && !u.extra)).reduce((a, p) => a + (+p.instances[p.fromIds!.indexOf(id)].A || 0), 0);
  const w = attacksOf(whole, m.id);
  expect(w).toBeGreaterThanOrEqual(2);
  expect(attacksOf(sharedA, m.id)).toBe(Math.ceil(w / 2));
  startAttack(s, 'fight', A.id, T1.id, sharedA.pools);
  resolveAll(s); finishAttack(s);
  expect(A.fightPart?.left[m.id]?.n).toBe(Math.floor(w / 2));
  const next = buildFightPools(s, A.id, T2.id);
  expect(attacksOf(next, m.id)).toBe(Math.floor(w / 2));
});
