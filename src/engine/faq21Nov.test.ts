import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, formationAt, placeUnit } from './game';
import { buildShootPools, resolveAll, startAttack, finishAttack } from './attack';
import { hasCover } from './visibility';
import { alive } from './state';
import type { ArmyList } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));
const list = (f: string, units: [string, number, number][]): ArmyList => ({ name: 't', factionId: f, battleSize: 'strike', detachments: [], units: units.map(([d, n, pts], i) => ({ uid: 'x' + i, datasheet: d, models: n, pts })) } as never);
const ruin = (x0: number, y0: number, x1: number, y1: number) => ({ id: 'r', kind: 'ruin', label: 'Ruin', category: 'dense', height: 4, walls: [], poly: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });

// Core Rules 13.08 (owner, 21 Nov 2026: as the text, R9 withdrawn): an INFANTRY model within a terrain area has cover
// wherever the attacker stands, the same terrain area included.
it('infantry in the same ruin as the shooter still has cover', () => {
  const s = createGame({ lists: [list('SM', [['Intercessor Squad', 5, 85]]), list('ORK', [['Boyz', 10, 85]])], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 4 } as never);
  s.round = 2; s.turn = 2; s.phase = 'movement'; s.active = 0; // outside the Shooting phase cover is not cached
  const A = s.units.find((u) => u.owner === 0)!, T = s.units.find((u) => u.owner === 1)!;
  for (const u of [A, T]) u.status = 'board';
  placeUnit(s, A, formationAt(A, { x: 20, y: 20 }));
  placeUnit(s, T, formationAt(T, { x: 20, y: 28 }));
  s.terrain = [ruin(10, 14, 32, 36)] as never;
  expect(hasCover(s, alive(A)[0], T)).toBe(true);
  s.terrain = [];
  expect(hasCover(s, alive(A)[0], T)).toBe(false);
});

// Orks FAQ (Grot Shields): hits of a [TORRENT] weapon are not "hit rolls that result in a hit", so the Gretchin do not take them
it('Grot Shields does not take Torrent hits', () => {
  const s = createGame({ lists: [list('SM', [['Infernus Squad', 5, 95]]), list('ORK', [['Boyz', 10, 85], ['Gretchin', 10, 45]])], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 4 } as never);
  s.round = 2; s.turn = 2; s.phase = 'shooting'; s.active = 0; s.terrain = [];
  const A = s.units.find((u) => u.owner === 0)!, B = s.units.find((u) => u.owner === 1 && u.name.includes('Boyz'))!, G = s.units.find((u) => u.owner === 1 && u.name.includes('Gretchin'))!;
  for (const u of s.units) u.status = 'reserves';
  for (const u of [A, B, G]) u.status = 'board';
  placeUnit(s, A, formationAt(A, { x: 20, y: 16 }));
  placeUnit(s, B, formationAt(B, { x: 20, y: 26 }));
  placeUnit(s, G, formationAt(G, { x: 20, y: 32 }));
  G.timed = [...(G.timed ?? []), { e: { shieldsNear: 3 }, label: 'Grot Shields', until: 'phase', by: 1 } as never];
  const gBefore = alive(G).length;
  const r = buildShootPools(s, A.id, B.id, { mode: 'normal' });
  const torrent = r.pools.filter((p) => p.autoHit);
  if (!torrent.length) console.log(JSON.stringify({ err: r.error, notes: r.notes, pools: r.pools.map((p) => [p.weapon, p.autoHit]) }));
  expect(torrent.length).toBeGreaterThan(0);
  startAttack(s, 'shoot', A.id, B.id, torrent);
  resolveAll(s); finishAttack(s);
  expect(alive(G).length).toBe(gBefore);
});

// World Eaters FAQ: the bearer of Disciple of Khorne cannot be the Warlord
it('Disciple of Khorne on the Warlord is refused', async () => {
  const { validateList } = await import('./army');
  const we = load('WE');
  const l = { name: 'w', factionId: 'WE', battleSize: 'strike', detachments: ['Khorne Daemonkin'], units: [{ uid: 'a', datasheet: 'World Eaters Lord on Juggernaut', models: 1, pts: 100, warlord: true, enhancement: 'Disciple of Khorne' }] } as never;
  expect(validateList(l, we, { points: 2000, dp: 3, unitLimit: 3, enhancements: 3 }).some((e) => /Disciple of Khorne/.test(e))).toBe(true);
});

// Imperial Knights errata (Code Chivalric, reap a great tally): enemy units destroyed this round count even if they come back
it('the great tally counts destroyed enemy units that come back', async () => {
  const { knightsUnitDestroyed, knightsRoundStart } = await import('../factions/knights');
  const s = createGame({ lists: [list('QI', [['Armiger Warglaive', 1, 140]]), list('ORK', [['Boyz', 10, 85]])], factions: [load('QI'), load('ORK')], names: ['A', 'B'], seed: 4 } as never);
  s.players[0].knights = { deeds: ['tally'], qualities: [], fulfilled: 0 };
  s.round = 1;
  knightsRoundStart(s);
  const boyz = s.units.find((u) => u.owner === 1)!;
  knightsUnitDestroyed(s, boyz); knightsUnitDestroyed(s, boyz); // destroyed twice (it came back in between)
  expect(s.players[0].knights!.roundKills).toBe(2);
});
