// Line of sight through terrain (06.01, 13.10 Obscuring, 13.11 Solid) on the 2D board.
import { describe, expect, it } from 'vitest';
import { hasLos } from './visibility';
import type { GameState, ModelState, Pt, TerrainPiece } from './types';

const P = (x: number, y: number): Pt => ({ x, y });
const model = (x: number, y: number, r = 0.63) => ({ x, y, r, keywords: ['INFANTRY'] }) as unknown as ModelState;
const board = (...terrain: TerrainPiece[]) => ({ terrain }) as unknown as GameState;
function area(x0: number, y0: number, x1: number, y1: number, category: TerrainPiece['category'], walls: [Pt, Pt][] = []): TerrainPiece {
  return { id: `t${x0}-${y0}`, kind: 'ruin', label: '', category, height: category === 'dense' ? 5 : 1.5, poly: [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], walls: walls.map(([a, b]) => ({ a, b })) };
}

describe('obscuring areas (13.10)', () => {
  it('a light or dense area between two models blocks sight; an exposed one does not', () => {
    for (const cat of ['light', 'dense'] as const) expect(hasLos(board(area(18, 10, 26, 30, cat)), model(10, 20), model(34, 20))).toBe(false);
    expect(hasLos(board(area(18, 10, 26, 30, 'exposed')), model(10, 20), model(34, 20))).toBe(true);
  });

  it('a line exactly through two corners of the area is still blocked (it crosses the inside)', () => {
    // centre-to-centre runs along the diagonal of the square footprint
    const s = board(area(14, 14, 16, 16, 'light'));
    const a = model(10, 10, 0.2), b = model(20, 20, 0.2);
    expect(hasLos(s, a, b)).toBe(false);
  });

  it('models standing in an area see out of it and are seen in it — unless a ruin wall is in the way (13.11 Solid)', () => {
    const ruin = area(18, 10, 26, 30, 'dense', [[P(26, 10), P(26, 30)]]);
    expect(hasLos(board(ruin), model(19, 20), model(10, 20))).toBe(true); // in the ruin, open side towards the viewer
    expect(hasLos(board(ruin), model(19, 20), model(34, 20))).toBe(false); // the wall on the far side
  });

  it('two walls meeting in a corner leave no gap at the joint', () => {
    const ruin = area(18, 10, 26, 18, 'dense', [[P(18, 10), P(22, 14)], [P(22, 14), P(26, 10)]]);
    // the observer stands in the area (so the area itself does not block); the only line is through the joint
    const a = model(22, 12, 0.05), b = model(22, 24, 0.05);
    expect(hasLos(board(ruin), a, b)).toBe(false);
  });

  it('a model just outside an area is not "in" it: the area still blocks', () => {
    const s = board(area(18, 10, 26, 30, 'light'));
    expect(hasLos(s, model(10, 20), model(26.7, 20))).toBe(false);
    expect(hasLos(s, model(10, 20), model(26.6, 20))).toBe(true); // base edge over the area: it stands in it
  });

  it('a big base pressed against a ruin wall does not see (or get seen) through it', () => {
    // the token overlaps the wall a little (it stands for a hull); the part beyond the wall is not really there
    const ruin = area(18, 10, 26, 30, 'dense', [[P(22, 10), P(22, 30)]]);
    const tank = model(21.2, 20, 2); // 0.8" from the wall, base radius 2"
    expect(hasLos(board(ruin), tank, model(23.5, 20))).toBe(false);
    expect(hasLos(board(ruin), tank, model(20, 26))).toBe(true);
  });
});
