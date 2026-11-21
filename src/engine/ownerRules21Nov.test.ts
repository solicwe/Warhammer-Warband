import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, discardCards, formationAt, placeUnit, validateMove } from './game';
import { gainCp } from './state';
import { PRESETS } from '../ui/presets';
import { alive } from './state';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));
const game = () => createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 3, secondaryMode: ['tactical', 'tactical'] } as never);

// Event Companion: apart from Core CP a player gains at most 1CP per battle round
it('CP gained besides Core CP is capped at 1 per battle round', () => {
  const s = game();
  s.round = 2;
  const cp = s.players[0].cp;
  expect(gainCp(s, 0, 1)).toBe(1);
  expect(gainCp(s, 0, 2)).toBe(0);
  expect(s.players[0].cp).toBe(cp + 1);
  s.round = 3;
  expect(gainCp(s, 0, 2)).toBe(1);
});

// Event Companion: at the end of your own turn, after scoring, discarding Tactical cards gains 1CP once
it('discarding several cards gains 1CP once, and only in your own turn', () => {
  const s = game();
  s.round = 2; s.active = 0;
  s.players[0].secMode = 'tactical';
  s.players[0].secActive = ['assassination', 'behind-enemy-lines'].filter(Boolean);
  const cp = s.players[0].cp;
  expect(discardCards(s, 1, ['assassination'])).toMatch(/own turn/);
  expect(discardCards(s, 0, [...s.players[0].secActive])).toBeNull();
  expect(s.players[0].secActive).toEqual([]);
  expect(s.players[0].cp).toBe(cp + 1);
});

// Core Rules 21.02: a surge move may end engaged with the surge target (the closest enemy unit), not with another one
it('a surge move can end engaged with the closest enemy unit only', () => {
  const s = game();
  s.round = 2; s.turn = 1; s.phase = 'movement'; s.active = 0; s.terrain = [];
  const A = s.units.find((u) => u.owner === 0 && alive(u).length)!;
  const [T1, T2] = s.units.filter((u) => u.owner === 1);
  for (const u of s.units) if (![A, T1, T2].includes(u)) u.status = 'reserves';
  for (const u of [A, T1, T2]) { u.status = 'board'; }
  placeUnit(s, A, formationAt(A, { x: 10, y: 10 }));
  placeUnit(s, T1, formationAt(T1, { x: 10, y: 17 }));
  placeUnit(s, T2, formationAt(T2, { x: 30, y: 40 }));
  A.extraMove = { max: 20, label: 'test', kind: 'surge' };
  const first = alive(T1)[0];
  const toward = (target: { x: number; y: number }) => new Map(alive(A).map((m, i) => [m.id, [{ x: m.x, y: m.y }, { x: target.x + (i % 5) * 1.2 - 2, y: target.y - 3 - Math.floor(i / 5) * 1.2 }]]));
  const res = validateMove(s, A, 'surge', toward(first));
  expect(res.errors.filter((e) => /surge target|Engagement/i.test(e))).toEqual([]);
});

// Core Rules 24.31: a Scouts unit in Strategic Reserves can be set up wholly within its deployment zone before the battle
it('a Scouts unit in Reserves is set up in the deployment zone in the Scouts step; elsewhere is refused', async () => {
  const { scoutFromReserves, scoutReserves, zoneOf } = await import('./game');
  const s = game();
  const u = s.units.find((x) => x.owner === 0 && alive(x).length)!;
  u.status = 'reserves'; u.core.scouts = 6;
  s.phase = 'scouts'; s.deployTurn = 0; s.turn = -1;
  expect(scoutReserves(s, 0)).toContain(u);
  const zone = zoneOf(s, 0);
  const cx = zone.reduce((a, p) => a + p.x, 0) / zone.length, cy = zone.reduce((a, p) => a + p.y, 0) / zone.length;
  const far = scoutFromReserves(s, u, formationAt(u, { x: 22, y: 30 }));
  expect(far.ok).toBe(false);
  const ok = scoutFromReserves(s, u, formationAt(u, { x: cx, y: cy }));
  expect(ok.errors).toEqual([]);
  expect(u.status).toBe('board');
  expect(scoutReserves(s, 0)).not.toContain(u);
});

// Core Rules 15.11: the player chooses the mode of Heroic Intervention (Leap to Defend 1CP, Into the Fray 2CP)
it('both Heroic Intervention modes are offered when both apply', async () => {
  const { heroicModes } = await import('./game');
  const s = game();
  s.round = 2; s.turn = 2; s.phase = 'charge'; s.active = 1; s.terrain = [];
  s.players[0].cp = 5;
  const A = s.units.find((u) => u.owner === 0 && alive(u).length)!;
  const E = s.units.find((u) => u.owner === 1 && alive(u).length)!;
  for (const u of s.units) if (u !== A && u !== E) u.status = 'reserves';
  A.status = 'board'; E.status = 'board';
  placeUnit(s, A, formationAt(A, { x: 22, y: 20 }));
  placeUnit(s, E, formationAt(E, { x: 22, y: 26 }));
  E.chargedTurn = s.turn;
  expect(heroicModes(s, 0, A).sort()).toEqual(['fray', 'leap']);
  E.chargedTurn = -1;
  expect(heroicModes(s, 0, A)).toEqual(['fray']);
});

// Riptide Nova Charge: "select one ranged weapon": the buff goes to the weapon the player picked
it('an ability with a picked weapon buffs that weapon only', async () => {
  const { runActions } = await import('../rules-engine/activations');
  const s = game();
  const A = s.units.find((u) => u.owner === 0 && alive(u).length)!;
  runActions(s, 'Nova Charge', A, [{ on: 'self', buff: [{ attack: 'ranged', abilities: ['devastating wounds'] }], until: 'phase' }], null, { weapon: 'Bolt Rifle' });
  const t = (A.timed ?? []).find((x) => /Nova Charge/.test(x.label));
  expect(t?.e.weapon).toBe('Bolt Rifle');
});

// Core Rules 16.01: a TITANIC unit can start an action while engaged and can still shoot afterwards
it('a TITANIC unit may start an action (not refused for being TITANIC)', async () => {
  const { actionBlock } = await import('./missions');
  const s = game();
  s.round = 2; s.phase = 'shooting'; s.active = 0;
  const A = s.units.find((u) => u.owner === 0 && alive(u).length)!;
  A.status = 'board';
  placeUnit(s, A, formationAt(A, { x: 22, y: 20 }));
  A.keywords = [...A.keywords, 'TITANIC'];
  expect(actionBlock(s, A) ?? '').not.toMatch(/TITANIC/);
});

// 24.31 for the bot: a Scouts unit it kept in Reserves (no Deep Strike) is set up in its zone before the battle
it('the bot sets up a Scouts unit from Reserves in the Scouts step', async () => {
  const { botScouts } = await import('../ai/bot');
  const s = game();
  const u = s.units.find((x) => x.owner === 0 && alive(x).length && !x.core.deepStrike)!;
  u.status = 'reserves'; u.core.scouts = 6;
  s.phase = 'scouts'; s.deployTurn = 0; s.turn = -1; s.bots = [0, 1];
  botScouts(s, 0);
  expect(u.status).toBe('board');
});
