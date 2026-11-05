
import { describe, expect, it } from 'vitest';
import { hasLos } from './visibility';
import type { GameState, ModelState, TerrainPiece, UnitState } from './types';

// Helper to build minimal terrain piece (rectangle as poly)
function rect(x0: number, y0: number, x1: number, y1: number, category: 'light' | 'dense' | 'exposed' = 'light'): TerrainPiece {
  return {
    id: `t-${x0}-${y0}`,
    category,
    poly: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
    walls: [],
    bounds: { x0, y0, x1, y1 },
  } as unknown as TerrainPiece;
}

function model(id: string, x: number, y: number, r = 0.5, keywords: string[] = ['INFANTRY']): ModelState {
  return { id, x, y, r, keywords, dead: false } as unknown as ModelState;
}

describe('Unit-aware standsIn / LoS (10th Ed "within" rule)', () => {
  it('squad mate touching ruin allows Sorcerer model to see through that ruin', () => {
    // Ruin 4 sits between x=10..20, y=10..20
    const ruin = rect(10, 10, 20, 20, 'light');

    // Sorcerer is behind the ruin (not inside)
    const sorc = model('sorc', 8, 15);
    // Squad mate IS inside the ruin footprint
    const squadMate = model('mate', 12, 15);

    // Enemy target is on the other side of the ruin
    const enemy = model('enemy', 25, 15);
    const enemyUnit = {
      id: 'eu',
      owner: 1 as const,
      status: 'board',
      models: [enemy],
      keywords: [],
      factionKeywords: [],
      buffs: [],
    } as unknown as UnitState;

    const sorcerorUnit = {
      id: 'su',
      owner: 0 as const,
      status: 'board',
      models: [sorc, squadMate],
      keywords: [],
      factionKeywords: [],
      buffs: [],
    } as unknown as UnitState;

    const s: GameState = {
      terrain: [ruin],
      units: [sorcerorUnit, enemyUnit],
    } as unknown as GameState;

    // With unit-aware standsIn: squadMate is in ruin, so sorc's unit counts as "in" the ruin.
    // The ruin should NOT block LoS from sorc to enemy.
    expect(hasLos(s, sorc, enemy)).toBe(true);
  });

  it('no model in unit touches ruin => ruin still blocks LoS', () => {
    const ruin = rect(10, 10, 20, 20, 'light');

    const sorc = model('sorc', 8, 15);
    const squadMate = model('mate', 6, 15); // also outside ruin

    const enemy = model('enemy', 25, 15);
    const enemyUnit = {
      id: 'eu',
      owner: 1 as const,
      status: 'board',
      models: [enemy],
      keywords: [],
      factionKeywords: [],
      buffs: [],
    } as unknown as UnitState;

    const sorcerorUnit = {
      id: 'su',
      owner: 0 as const,
      status: 'board',
      models: [sorc, squadMate],
      keywords: [],
      factionKeywords: [],
      buffs: [],
    } as unknown as UnitState;

    const s: GameState = {
      terrain: [ruin],
      units: [sorcerorUnit, enemyUnit],
    } as unknown as GameState;

    // No model touches ruin => ruin blocks LoS
    expect(hasLos(s, sorc, enemy)).toBe(false);
  });
});
