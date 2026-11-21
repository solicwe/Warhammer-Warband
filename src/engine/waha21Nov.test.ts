import fs from 'node:fs';
import { expect, it } from 'vitest';
import { answerRoleChoice, counteroffensiveCandidates, createGame, endBattle, zoneOf } from './game';
import { coreAbilities } from './army';
import { modelOc } from '../rules-engine/effects';
import { alive } from './state';
import type { ArmyList } from './types';

// Owner, 21 Nov 2026: "as Wahapedia, 11th edition only"
const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));
const list = (f: string, units: [string, number, number][]): ArmyList => ({ name: 't', factionId: f, battleSize: 'strike', detachments: [], units: units.map(([d, n, pts], i) => ({ uid: 'x' + i, datasheet: d, models: n, pts })) } as never);
const game = () => createGame({ lists: [list('QI', [['Knight Paladin', 1, 375]]), list('ORK', [['Boyz', 10, 85]])], factions: [load('QI'), load('ORK')], names: ['A', 'B'], seed: 4 } as never);

it('a Damaged Knight loses the OC its card says (Knight Paladin: 5)', () => {
  const s = game();
  const K = s.units.find((u) => u.owner === 0)!, m = alive(K)[0];
  expect(K.core.damagedOc).toBe(5);
  const full = modelOc(s, K, m);
  m.wounds = K.core.damaged!;
  expect(modelOc(s, K, m)).toBe(Math.max(0, full - 5));
});

it('a Damaged card that only says -1 to hit keeps its OC; one without -1 to hit gets none', () => {
  const tyr = load('TYR').datasheets.find((d: { damaged?: unknown }) => d.damaged);
  const c = coreAbilities([tyr]);
  expect(c.damagedHit).toBe(true);
  expect(c.damagedOc).toBeUndefined();
  const we = load('WE').datasheets.find((d: { damaged?: { text: string } }) => /add 2 to the Attacks/.test(d.damaged?.text ?? ''));
  if (we) { const w = coreAbilities([we]); expect(w.damagedHit).toBe(false); expect(w.damagedMeleeA).toBe(2); }
});

it('Counteroffensive is never offered to the player whose turn it is (15.12)', () => {
  const s = game();
  s.phase = 'fight'; s.active = 0;
  s.fight = { step: 'fight', stepPlayer: 0, chooser: 0, eligible: [], fought: [], pendingConsolidate: null, consolidated: [], forcedNext: null, movedThisStep: [] } as never;
  expect(counteroffensiveCandidates(s, 0)).toEqual([]);
});

it('an attached unit has Infiltrators / Scouts only if every datasheet does', () => {
  const sm = load('SM');
  const withInf = sm.datasheets.find((d: { abilities?: { name: string; type?: string }[] }) => d.abilities?.some((a) => a.name === 'Infiltrators' && a.type === 'Core'));
  const without = sm.datasheets.find((d: { name: string }) => d.name === 'Captain');
  expect(coreAbilities([withInf]).infiltrators).toBe(true);
  expect(coreAbilities([withInf, without]).infiltrators).toBeUndefined();
});

it('the roll-off winner can choose to be the Defender', () => {
  const s = game();
  const w = s.attackerPlayer;
  const zoneBefore = zoneOf(s, w);
  s.window = { kind: 'roleChoice', player: w };
  expect(answerRoleChoice(s, false)).toBeNull();
  expect(s.attackerPlayer).toBe(w === 0 ? 1 : 0);
  expect(s.players[w].role).toBe('defender');
  expect(s.deployTurn).toBe(w); // the Defender deploys first
  expect(zoneOf(s, w)).not.toEqual(zoneBefore);
});

it('each player scores 10VP for a Battle Ready army at the end of the battle', () => {
  const s = game();
  const [a, b] = [s.players[0].vp, s.players[1].vp];
  endBattle(s);
  expect([s.players[0].vp, s.players[1].vp]).toEqual([a + 10, b + 10]);
});

it('Space Marine datasheets match Wahapedia (19 Nov 2026), e.g. Death Company Captain', () => {
  const dc = load('SM').datasheets.find((d: { name: string }) => d.name === 'Death Company Captain');
  expect(dc.weapons.find((w: { name: string }) => w.name === 'Master-crafted Chainsword').profiles[0].A).toBe('8');
});
