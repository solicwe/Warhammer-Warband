import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createGame } from './game';
import { botAct } from './bot';
import { PRESETS } from '../ui/presets';
import {
  canPerformActOfFaith,
  gainMiracleDice,
  getMiracleDice,
  isSororitasArmy,
  performActOfFaith,
  sororitasCommandEnd,
  sororitasTurnStart,
  sororitasUnitDestroyed,
} from './sororitas';
import { buildFightPools, buildShootPools } from './attack';
import type { FactionData } from './types';

const asFaction = JSON.parse(fs.readFileSync('public/data/factions/AS.json', 'utf8')) as FactionData;
const smFaction = JSON.parse(fs.readFileSync('public/data/factions/SM.json', 'utf8')) as FactionData;

describe('Adepta Sororitas: Acts of Faith & Miracle Dice', () => {
  it('correctly identifies Sororitas army and initializes Miracle dice pool', () => {
    const state = createGame({
      lists: [PRESETS.AS, PRESETS.SM],
      factions: [asFaction, smFaction],
      names: ['Sisters', 'Marines'],
      seed: 42,
    });
    expect(isSororitasArmy(state, 0)).toBe(true);
    expect(isSororitasArmy(state, 1)).toBe(false);

    gainMiracleDice(state, 0, 1);
    const dice = getMiracleDice(state, 0);
    expect(dice.length).toBeGreaterThanOrEqual(1);
    expect(dice[0]).toBeGreaterThanOrEqual(1);
    expect(dice[0]).toBeLessThanOrEqual(6);
  });

  it('gains Miracle dice on turn start and unit destruction', () => {
    const state = createGame({
      lists: [PRESETS.AS, PRESETS.SM],
      factions: [asFaction, smFaction],
      names: ['Sisters', 'Marines'],
      seed: 101,
    });
    state.players[0].miracleDice = [];

    // Turn start
    sororitasTurnStart(state, 0);
    expect(state.players[0].miracleDice.length).toBe(1);

    // Unit destroyed (Seraphim Squad has no Saintly Example, so exactly 1 die)
    const seraphim = state.units.find((u) => u.name.includes('Seraphim Squad'))!;
    sororitasUnitDestroyed(state, seraphim);
    expect(state.players[0].miracleDice.length).toBe(2);
  });

  it('performs Act of Faith substituting a die and respects per-phase limits', () => {
    const state = createGame({
      lists: [PRESETS.AS, PRESETS.SM],
      factions: [asFaction, smFaction],
      names: ['Sisters', 'Marines'],
      seed: 202,
    });
    state.players[0].miracleDice = [6, 4, 2];
    const seraphim = state.units.find((u) => u.name.includes('Seraphim Squad'))!;

    expect(canPerformActOfFaith(state, seraphim)).toBe(true);

    // Perform Act of Faith (requesting at least a 4)
    const val = performActOfFaith(state, seraphim, undefined, 4, 'Saving throw');
    expect(val).toBe(4); // picks lowest die that meets minVal (4) to conserve 6
    expect(state.players[0].miracleDice).toEqual([6, 2]);

    // Unit cannot perform another Act of Faith in the same phase
    expect(canPerformActOfFaith(state, seraphim)).toBe(false);
  });

  it('Dialogus boosts substituted Miracle die to 6', () => {
    const state = createGame({
      lists: [PRESETS.AS, PRESETS.SM],
      factions: [asFaction, smFaction],
      names: ['Sisters', 'Marines'],
      seed: 303,
    });
    state.players[0].miracleDice = [2];
    const squadWithDialogus = state.units.find((u) => u.name.includes('Battle Sisters Squad'))!;
    // In our preset, Dialogus is attached to Battle Sisters Squad!
    expect(squadWithDialogus.models.some((m) => m.name.includes('Dialogus'))).toBe(true);

    const val = performActOfFaith(state, squadWithDialogus, undefined, undefined, 'Hit roll');
    expect(val).toBe(6);
  });

  it('Cherub grants 1 Miracle die after performing an Act of Faith', () => {
    const state = createGame({
      lists: [PRESETS.AS, PRESETS.SM],
      factions: [asFaction, smFaction],
      names: ['Sisters', 'Marines'],
      seed: 404,
    });
    state.players[0].miracleDice = [5];
    const battleSisters = state.units.find((u) => u.name.includes('Battle Sisters Squad'))!;
    expect(battleSisters.abilities.some((a) => a.name.includes('Cherub'))).toBe(true);

    performActOfFaith(state, battleSisters, 5, undefined, 'Advance roll');
    // Spent 1 die, but Cherub granted 1 die right back!
    expect(state.players[0].miracleDice.length).toBe(1);
    expect(battleSisters.cherubUsed).toBe(true);
  });

  it('Hallowed Martyrs grants +1 to hit below starting and +1 to wound below half', () => {
    const state = createGame({
      lists: [PRESETS.AS, PRESETS.SM],
      factions: [asFaction, smFaction],
      names: ['Sisters', 'Marines'],
      seed: 505,
    });
    const sisters = state.units.find((u) => u.name.includes('Battle Sisters Squad'))!;
    const enemy = state.units.find((u) => u.owner === 1)!;
    sisters.status = 'board';
    enemy.status = 'board';
    state.phase = 'shooting';
    state.active = 0;
    state.terrain = [];

    sisters.models.forEach((m) => { m.x = 10; m.y = 10; });
    enemy.models.forEach((m) => { m.x = 10; m.y = 18; });

    // Full strength: normal hit mod
    let pools = buildShootPools(state, sisters.id, enemy.id, { mode: 'normal' }).pools;
    let boltgunPool = pools.find((p) => p.weapon.toLowerCase().includes('boltgun'));
    expect(boltgunPool?.hitMod).toBe(0);

    // Below starting strength (kill 2 models)
    sisters.models[0].dead = true;
    sisters.models[1].dead = true;
    pools = buildShootPools(state, sisters.id, enemy.id, { mode: 'normal' }).pools;
    boltgunPool = pools.find((p) => p.weapon.toLowerCase().includes('boltgun'));
    expect(boltgunPool?.hitMod).toBe(1); // +1 to hit from The Blood of Martyrs

    // Below half strength (kill 8 of 12 models in squad, leaving models 6 and 7 alive with boltguns)
    [2, 3, 4, 5, 8, 9, 10].forEach((idx) => { sisters.models[idx].dead = true; });
    pools = buildShootPools(state, sisters.id, enemy.id, { mode: 'normal' }).pools;
    boltgunPool = pools.find((p) => p.weapon.toLowerCase().includes('boltgun'));
    expect(boltgunPool).toBeDefined();
    expect(boltgunPool?.hitMod).toBe(1);
    expect(boltgunPool?.woundMod).toBe(1); // +1 to wound from The Blood of Martyrs
  });

  it('runs a complete Adepta Sororitas bot-vs-bot game to game over without error', () => {
    const state = createGame({
      lists: [PRESETS.AS, PRESETS.SM],
      factions: [asFaction, smFaction],
      names: ['Sisters', 'Marines'],
      dispositions: ['take-and-hold', 'take-and-hold'],
      seed: 88,
    });
    state.bots = [0, 1];
    let steps = 0;
    while (state.phase !== 'gameover' && steps < 5000) {
      botAct(state);
      steps++;
    }
    expect(state.phase).toBe('gameover');
    expect(steps).toBeLessThan(5000);
  });
});
