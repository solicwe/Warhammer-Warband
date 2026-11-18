import { actsOfUnit } from '../rules-engine/activations';
// Faction rules reached through the event bus (src/factions/index.ts) from every path of the game loop.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFightPools } from './attack';
import { createGame, formationAt, placeUnit, rerollBattleShock, rollBattleShock } from './game';
import { daemonsCommandStart } from '../factions/daemons';
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

  it('Channelled Force (Banishers): a Grey Knights unit selected to fight can take a Leadership test for [LETHAL HITS] / [SUSTAINED HITS 1]', () => {
    const acts = (det: string) => {
      const s = createGame({ lists: [{ ...PRESETS.GK, detachments: [det] }, PRESETS.CD], factions: [load('GK'), load('CD')], names: ['A', 'B'], seed: 3 });
      const A = s.units.find((u) => u.owner === 0)!;
      return actsOfUnit(s, A).filter((d) => d.spec.when === 'selectedToFight' && d.spec.ldTest);
    };
    expect(acts('Warpbane Task Force').length).toBe(0);
    expect(acts('Banishers').length).toBe(2);
  });
});


describe('Command Re-roll on a Battle-shock test', () => {
  it('re-rolls a failed test once for 1CP', () => {
    const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 5 } as never);
    const u = s.units.find((x) => x.owner === 0)!;
    s.shockTests = [{ unitId: u.id, result: null, passed: null }];
    s.players[0].cp = 3;
    u.models.forEach((m) => { m.profile.Ld = 13; }); // 2D6 can never reach 13: the first roll fails
    rollBattleShock(s, u.id);
    const t = s.shockTests[0];
    expect(t.passed).toBe(false);
    expect(rerollBattleShock(s, u.id)).toBeNull();
    expect(t.rerolled).toBe(true);
    expect(s.players[0].cp).toBe(2);
    expect(rerollBattleShock(s, u.id)).not.toBeNull();
  });
});

describe('Command Re-roll on one-click tests: the player chooses', () => {
  const setup = (bots: 0[] | []) => {
    const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 9 } as never);
    const u = s.units.find((x) => x.owner === 0)!;
    u.models.forEach((m) => { m.profile.Ld = 13; }); // never reachable on 2D6: the test fails
    s.players[0].cp = 3;
    s.bots = bots as never;
    return { s, u };
  };
  it('a person gets a window, taps one die, carries on', async () => {
    const { makeDarkPact } = await import('../factions/darkPacts');
    const { crTestDone, crTestReroll } = await import('../factions/crTests');
    const { s, u } = setup([]);
    makeDarkPact(s, u, 'lethal hits');
    expect(s.window?.kind).toBe('crTest');
    expect(s.players[0].cp).toBe(3); // nothing is spent until the player taps
    expect((u.timed ?? []).some((t) => t.mark === 'darkPact')).toBe(false); // the pact waits for the dice
    expect(crTestReroll(s, 1)).toBeNull();
    expect(s.players[0].cp).toBe(2);
    expect(crTestReroll(s, 0)).not.toBeNull(); // once
    crTestDone(s);
    expect(s.window).toBeNull();
    expect((u.timed ?? []).some((t) => t.mark === 'darkPact')).toBe(true);
  });
  it('a bot never waits: it re-rolls by itself when a CP can be spared', async () => {
    const { makeDarkPact } = await import('../factions/darkPacts');
    const { s, u } = setup([0]);
    makeDarkPact(s, u, 'lethal hits');
    expect(s.window).toBeNull();
    expect(s.players[0].cp).toBe(2);
  });
});

describe('Malefic Surge waits for the player too', () => {
  it('opens the window on a failed Leadership test and applies the wounds after Carry on', async () => {
    const { maleficSurge } = await import('../factions/knights');
    const { crTestDone } = await import('../factions/crTests');
    const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 4 } as never);
    s.bots = [] as never;
    s.players[0].cp = 3;
    const u = s.units.find((x) => x.owner === 0)!;
    u.models.forEach((m) => { m.profile.Ld = 13; });
    const before = u.models.reduce((a, m) => a + m.wounds, 0);
    maleficSurge(s, u);
    expect(s.window?.kind).toBe('crTest');
    expect(u.models.reduce((a, m) => a + m.wounds, 0)).toBe(before); // no mortal wounds yet
    crTestDone(s);
    expect(u.models.reduce((a, m) => a + m.wounds, 0)).toBeLessThan(before);
  });
});
