import { describe, expect, it } from 'vitest';
import { inSynapse, unleashShadowInTheWarp, shouldUnleashShadow } from './tyranids';
import { createGame, rollBattleShock, endPhase } from '../engine/game';
import { botShouldAct, botStep } from '../ai/bot';
import { PRESETS } from '../ui/presets';
import { buildFightPools } from '../engine/attack';
import fs from 'node:fs';

const TYR_FACTION = JSON.parse(fs.readFileSync('public/data/factions/TYR.json', 'utf8'));
const SM_FACTION = JSON.parse(fs.readFileSync('public/data/factions/SM.json', 'utf8'));

function makeGame() {
  const s = createGame({
    names: ['Tyranids', 'Space Marines'],
    lists: [PRESETS.TYR, PRESETS.SM],
    factions: [TYR_FACTION, SM_FACTION]
  });
  s.units.forEach((u) => { u.status = 'board'; });
  return s;
}

describe('Tyranids Synapse rule', () => {
  it('correctly detects Synapse on SYNAPSE units and units within 6" aura', () => {
    const s = makeGame();

    const tyrant = s.units.find((u) => u.name === 'Hive Tyrant' && u.owner === 0)!;
    const termagants = s.units.find((u) => u.name === 'Termagants' && u.owner === 0)!;
    const smIntercessors = s.units.find((u) => u.name === 'Intercessor Squad' && u.owner === 1)!;

    expect(tyrant).toBeDefined();
    expect(termagants).toBeDefined();

    // Hive Tyrant has SYNAPSE keyword
    expect(inSynapse(s, tyrant)).toBe(true);

    // Position Termagants 4" away from Hive Tyrant (within 6")
    const tm = tyrant.models[0];
    termagants.models.forEach((m) => {
      m.x = tm.x + 4;
      m.y = tm.y;
    });
    expect(inSynapse(s, termagants)).toBe(true);

    // Position Termagants 15" away (outside 6" aura)
    termagants.models.forEach((m) => {
      m.x = tm.x + 15;
      m.y = tm.y;
    });
    expect(inSynapse(s, termagants)).toBe(false);

    // Enemy units are never in friendly Synapse
    expect(inSynapse(s, smIntercessors)).toBe(false);
  });

  it('rolls 3D6 for Battle-shock when in Synapse range', () => {
    const s = makeGame();

    const tyrant = s.units.find((u) => u.name === 'Hive Tyrant' && u.owner === 0)!;
    expect(inSynapse(s, tyrant)).toBe(true);

    s.shockTests = [{ unitId: tyrant.id, result: null, passed: null }];
    rollBattleShock(s, tyrant.id);

    const testResult = s.shockTests[0];
    expect(testResult.passed).not.toBeNull();
    // 3D6 rolls sum between 3 and 18
    expect(testResult.result).toBeGreaterThanOrEqual(3);
  });

  it('adds +1 Strength to melee attacks while in Synapse', () => {
    const s = makeGame();

    const tyrant = s.units.find((u) => u.name === 'Hive Tyrant' && u.owner === 0)!;
    const enemy = s.units.find((u) => u.name === 'Intercessor Squad' && u.owner === 1)!;

    // Put enemy in engagement range
    const tm = tyrant.models[0];
    enemy.models.forEach((m) => {
      m.x = tm.x + 0.5;
      m.y = tm.y;
    });

    const res = buildFightPools(s, tyrant.id, enemy.id);
    expect(res.pools.length).toBeGreaterThan(0);
    // Synapse should apply to effective strength
    expect(res.pools[0].effS).toBe((res.pools[0].profile.S ?? 1) + 1);
    expect(res.pools[0].woundNote).toContain('Synapse +1 S');
  });
});

describe('Tyranids Shadow in the Warp', () => {
  it('unleashes Shadow in the Warp forcing Battle-shock on all enemy units', () => {
    const s = makeGame();

    expect(s.players[0].shadowInTheWarpUsed).toBeFalsy();
    const result = unleashShadowInTheWarp(s, 0);

    expect(result.tested).toBeGreaterThan(0);
    expect(s.players[0].shadowInTheWarpUsed).toBe(true);

    // Bot decision logic
    expect(shouldUnleashShadow(s, 0)).toBe(false); // Already used
  });
});

describe('Tyranids Datasheet Coverage', () => {
  it('contains all 52 non-legends datasheets with required properties', () => {
    expect(TYR_FACTION.datasheets.length).toBe(52);

    const names = TYR_FACTION.datasheets.map((d: { name: string }) => d.name);
    expect(names).toContain('Harridan');
    expect(names).toContain('Hierophant');
    expect(names).toContain('The Red Terror');
    expect(names).toContain('Tyranid Prime with Lash Whip');
    expect(names).toContain('Hyperadapted Raveners');

    // No Legends units
    expect(names).not.toContain('Dimachaeron');
    expect(names).not.toContain('Malanthrope');
    expect(names).not.toContain('Barbed Hierodule');
    expect(names).not.toContain('Scythed Hierodule');
    expect(names).not.toContain('Sky-slasher Swarms');
  });

  it('runs bot vs bot simulation with Tyranids successfully', () => {
    const s = createGame({
      names: ['Tyranids', 'Space Marines'],
      lists: [PRESETS.TYR, PRESETS.SM],
      factions: [TYR_FACTION, SM_FACTION],
      seed: 42,
      secondaryMode: 'tactical',
      maxRounds: 2
    });
    s.bots = [0, 1];
    let steps = 0;
    while (s.phase !== 'gameover' && steps < 2000) {
      steps++;
      const p = s.window?.player ?? (s.phase === 'deploy' || s.phase === 'scouts' ? s.deployTurn : s.active);
      if (botShouldAct(s, p)) botStep(s, p); else endPhase(s);
    }
    expect(steps).toBeGreaterThan(10);
    expect(s.round).toBeGreaterThanOrEqual(1);
  });
});
