// Faction rules reached through the event bus (factionHooks.ts) from every path of the game loop.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGame, rollBattleShock } from './game';
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
});
