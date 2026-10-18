// Faction rules reached through the event bus (factionHooks.ts) from every path of the game loop.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFightPools } from './attack';
import { createGame, formationAt, placeUnit, rollBattleShock } from './game';
import { daemonsCommandStart } from './daemons';
import { PRESETS } from '../ui/presets';
import type { FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;

describe('faction hooks', () => {
  it('Power from Pain: an enemy failing a Command phase Battle-shock test gives the Drukhari a Pain token', () => {
    const s = createGame({ lists: [PRESETS.DRU, PRESETS.SM], factions: [load('DRU'), load('SM')], names: ['A', 'B'], seed: 3 });
    const u = s.units.find((x) => x.owner === 1)!;
    u.status = 'board';
    s.players[0].painTokens = 0;
    s.shockTests.push({ unitId: u.id, mod: -20, passed: null, result: null });
    rollBattleShock(s, u.id);
    expect(s.shockTests.find((t) => t.unitId === u.id)!.passed).toBe(false);
    expect(s.players[0].painTokens).toBe(1);
  });

  it('Melancholic Miasma: the Daemonic Terror modifier is not added to the queued test (it is added when rolled)', () => {
    const s = createGame({ lists: [{ ...PRESETS.CD, detachments: ['Plague Legion'] }, PRESETS.SM], factions: [load('CD'), load('SM')], names: ['A', 'B'], seed: 3 });
    for (const u of s.units) u.status = 'board';
    daemonsCommandStart(s);
    expect(s.shockTests.length).toBeGreaterThan(0);
    for (const t of s.shockTests) expect(t.mod).toBe(0);
  });

  it('Channelled Force (Banishers): Grey Knights melee attacks against a DAEMON unit have +1 Damage', () => {
    const run = (det: string) => {
      const s = createGame({ lists: [{ ...PRESETS.GK, detachments: [det] }, PRESETS.CD], factions: [load('GK'), load('CD')], names: ['A', 'B'], seed: 3 });
      s.terrain = [];
      const A = s.units.find((u) => u.owner === 0)!;
      const T = s.units.find((u) => u.owner === 1 && u.keywords.includes('DAEMON'))!;
      placeUnit(s, A, formationAt(A, { x: 20, y: 22 }));
      placeUnit(s, T, formationAt(T, { x: 20 + A.models[0].r + T.models[0].r + 0.5, y: 22 }));
      A.status = 'board'; T.status = 'board';
      s.phase = 'fight'; s.active = 0;
      return buildFightPools(s, A.id, T.id).pools;
    };
    const plain = run('Warpbane Task Force');
    const banishers = run('Banishers');
    expect(plain.length).toBeGreaterThan(0);
    expect(banishers.map((p) => p.damage)).not.toEqual(plain.map((p) => p.damage));
    expect(banishers.every((p) => /\+1$|^\d+$/.test(p.damage))).toBe(true);
  });
});

