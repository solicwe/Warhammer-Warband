import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, formationAt, placeUnit } from './game';
import { buildShootPools } from './attack';
import { alive } from './state';
import type { ArmyList } from './types';

// Core Rules 24.29 [PSYCHIC]: any or all modifiers to the attack's BS and to its hit roll can be ignored. Cover worsens the
// BS (13.08), so a psychic attack does not lose it; a bonus is kept while the penalties are dropped.
const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));
const list = (f: string, units: [string, number, number][]): ArmyList => ({ name: 't', factionId: f, battleSize: 'strike', detachments: [], units: units.map(([d, n, pts], i) => ({ uid: 'x' + i, datasheet: d, models: n, pts })) } as never);

function setup() {
  const s = createGame({ lists: [list('SM', [['Librarian', 1, 75], ['Intercessor Squad', 5, 85]]), list('ORK', [['Boyz', 10, 85]])], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 4 } as never);
  s.round = 2; s.turn = 2; s.phase = 'shooting'; s.active = 0; s.terrain = [];
  const L = s.units.find((u) => u.owner === 0 && alive(u).some((m) => m.weapons.some((w) => w.name === 'Smite')))!;
  const I = s.units.find((u) => u.owner === 0 && u !== L)!;
  const T = s.units.find((u) => u.owner === 1)!;
  for (const u of s.units) u.status = 'reserves';
  for (const u of [L, I, T]) u.status = 'board';
  placeUnit(s, L, formationAt(L, { x: 22, y: 20 }));
  placeUnit(s, I, formationAt(I, { x: 30, y: 20 }));
  placeUnit(s, T, formationAt(T, { x: 22, y: 30 }));
  return { s, L, I, T };
}
const smite = (r: ReturnType<typeof buildShootPools>) => r.pools.find((p) => p.weapon === 'Smite')!;
const bolt = (r: ReturnType<typeof buildShootPools>) => r.pools.find((p) => p.weapon !== 'Smite')!;

it('a psychic attack ignores cover; an ordinary gun does not', () => {
  const { s, L, I, T } = setup();
  const base = smite(buildShootPools(s, L.id, T.id, { mode: 'normal' })).skill;
  const gunBase = bolt(buildShootPools(s, I.id, T.id, { mode: 'normal' })).skill!;
  T.buffs.push({ kind: 'cover', until: 'phase' } as never);
  expect(smite(buildShootPools(s, L.id, T.id, { mode: 'normal' })).skill).toBe(base);
  expect(bolt(buildShootPools(s, I.id, T.id, { mode: 'normal' })).skill).toBe(gunBase + 1);
});

it('a psychic attack drops a -1 to hit but keeps a +1 to hit', () => {
  const { s, L, T } = setup();
  L.buffs.push({ kind: 'hit-1', until: 'phase' } as never);
  expect(smite(buildShootPools(s, L.id, T.id, { mode: 'normal' })).hitMod).toBe(0);
  L.buffs.push({ kind: 'hit+1', until: 'phase' } as never);
  // +1 and -1 add up to 0, but the -1 is ignored: +1 stays
  expect(smite(buildShootPools(s, L.id, T.id, { mode: 'normal' })).hitMod).toBe(1);
});

it('a psychic attack keeps a -1 to wound (24.29 covers BS/WS and hit rolls only)', () => {
  const { s, L, T } = setup();
  L.buffs.push({ kind: 'wound-1', until: 'phase' } as never); // a -1 to wound on the attacker (worked out with the pool)
  expect(smite(buildShootPools(s, L.id, T.id, { mode: 'normal' })).woundMod).toBe(-1);
});
