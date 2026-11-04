import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildShootPools } from './attack';
import { createGame } from './game';
import { clearLosCache } from './visibility';
import { PRESETS } from '../ui/presets';
import type { FactionData, GameState, Pt, TerrainPiece } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const at = (s: GameState, t: TerrainPiece[]) => { s.terrain = t; clearLosCache(); };
const ruin = (id: string, x0: number, y0: number, x1: number, y1: number, walls: [Pt, Pt][] = []) =>
  ({
    id,
    kind: 'ruin',
    label: id,
    category: 'dense',
    height: 5,
    poly: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
    walls: walls.map(([a, b]) => ({ a, b })),
  }) as unknown as TerrainPiece;

describe('Model-by-model Line of Sight shooting (10th Edition Core Rules)', () => {
  function setupTestGame() {
    const s = createGame({
      lists: [PRESETS.SM, PRESETS.ORK],
      factions: [load('SM'), load('ORK')],
      names: ['Shooters', 'Targets'],
      seed: 42,
    });
    s.phase = 'shooting';
    s.active = 0;
    for (const u of s.units) u.status = 'reserves';

    // Attacker: Intercessor squad (range 24")
    const shooter = s.units.find((u) => u.owner === 0 && u.keywords.includes('INFANTRY') && u.models.length >= 2)!;
    shooter.status = 'board';
    shooter.setUpTurn = -10;

    // Target: Ork Boyz squad
    const target = s.units.find((u) => u.owner === 1 && u.keywords.includes('INFANTRY'))!;
    target.status = 'board';
    target.setUpTurn = -10;

    // Place single target model at x = 15, y = 10
    target.models[0].x = 15;
    target.models[0].y = 10;
    target.models[0].dead = false;
    for (let i = 1; i < target.models.length; i++) target.models[i].dead = true;

    // By default, leave only model 0 and model 1 alive on shooter
    for (let i = 2; i < shooter.models.length; i++) shooter.models[i].dead = true;

    return { s, shooter, target };
  }

  it('only models with Line of Sight shoot: models behind an obscuring footprint cannot shoot', () => {
    const { s, shooter, target } = setupTestGame();

    // Obscuring ruin between y = 18 and y = 26 across x = 5 to 25
    const obsRuin = ruin('ruin1', 5, 18, 25, 26);
    at(s, [obsRuin]);

    // Model 0: at (15, 28) - directly behind ruin footprint (18" from target, within 24" range), not standing on it -> BLOCKED
    shooter.models[0].x = 15;
    shooter.models[0].y = 28;
    shooter.models[0].dead = false;

    // Model 1: at (28, 10) - in the open at y = 10 (13" from target), completely clear LoS -> CLEAR
    shooter.models[1].x = 28;
    shooter.models[1].y = 10;
    shooter.models[1].dead = false;

    const res = buildShootPools(s, shooter.id, target.id, { mode: 'normal' });
    expect(res.error).toBeUndefined();
    expect(res.pools.length).toBeGreaterThan(0);

    // Only Model 1 should be firing
    const firingModelIds = new Set(res.pools.flatMap((p) => p.fromIds ?? []));
    expect(firingModelIds.size).toBe(1);
    expect(firingModelIds).toContain(shooter.models[1].id);
    expect(firingModelIds).not.toContain(shooter.models[0].id);
  });

  it('when all models are behind obscuring footprint, unit cannot shoot', () => {
    const { s, shooter, target } = setupTestGame();
    const obsRuin = ruin('ruin1', 5, 18, 25, 26);
    at(s, [obsRuin]);

    // Both models behind footprint
    shooter.models[0].x = 12;
    shooter.models[0].y = 28;
    shooter.models[0].dead = false;

    shooter.models[1].x = 18;
    shooter.models[1].y = 28;
    shooter.models[1].dead = false;

    const res = buildShootPools(s, shooter.id, target.id, { mode: 'normal' });
    expect(res.pools).toHaveLength(0);
    expect(res.notes).toContain('No weapon in range with the target visible');
  });

  it('stepping onto the ruin footprint grants LoS out of the ruin', () => {
    const { s, shooter, target } = setupTestGame();
    const obsRuin = ruin('ruin1', 5, 18, 25, 26);
    at(s, [obsRuin]);

    // Model 0 steps inside the ruin footprint at x = 15, y = 22 (inside poly 5..25, 18..26)
    shooter.models[0].x = 15;
    shooter.models[0].y = 22;
    shooter.models[0].dead = false;

    // Model 1 remains in the open at x = 28, y = 10
    shooter.models[1].x = 28;
    shooter.models[1].y = 10;
    shooter.models[1].dead = false;

    const res = buildShootPools(s, shooter.id, target.id, { mode: 'normal' });
    expect(res.error).toBeUndefined();

    // Now BOTH models have LoS and can shoot!
    const firingModelIds = new Set(res.pools.flatMap((p) => p.fromIds ?? []));
    expect(firingModelIds.size).toBe(2);
    expect(firingModelIds).toContain(shooter.models[0].id);
    expect(firingModelIds).toContain(shooter.models[1].id);
  });

  it('stepping onto footprint still requires Line of Sight (solid walls still block)', () => {
    const { s, shooter, target } = setupTestGame();
    // Ruin with a solid wall across the entire north edge: from (5, 18) to (25, 18)
    const obsRuinWithWall = ruin('ruin1', 5, 18, 25, 26, [[{ x: 5, y: 18 }, { x: 25, y: 18 }]]);
    at(s, [obsRuinWithWall]);

    // Model 0 is inside the ruin footprint at x = 15, y = 22, directly behind the solid wall at y = 18
    // Target is at x = 15, y = 10, so the line of sight crosses the wall at (15, 18)
    shooter.models[0].x = 15;
    shooter.models[0].y = 22;
    shooter.models[0].dead = false;

    // Model 1 is in the open at x = 28, y = 10 with clear LoS to target
    shooter.models[1].x = 28;
    shooter.models[1].y = 10;
    shooter.models[1].dead = false;

    const res = buildShootPools(s, shooter.id, target.id, { mode: 'normal' });
    expect(res.error).toBeUndefined();

    // Model 0 is blocked by the solid wall, so only Model 1 can shoot!
    const firingModelIds = new Set(res.pools.flatMap((p) => p.fromIds ?? []));
    expect(firingModelIds.size).toBe(1);
    expect(firingModelIds).toContain(shooter.models[1].id);
    expect(firingModelIds).not.toContain(shooter.models[0].id);
  });
});
