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

  it('a model only touching an area with its rim is not "in" it: the area still blocks', () => {
    const s = board(area(18, 10, 26, 30, 'light'));
    expect(hasLos(s, model(10, 20), model(26.7, 20))).toBe(false);
    expect(hasLos(s, model(10, 20), model(26.4, 20))).toBe(false); // base edge over the area, centre outside
  });

  it('the area a model stands in never blocks: it sees out of it and is seen in it, from any depth (13.10)', () => {
    const s = board(area(18, 10, 26, 30, 'light'));
    expect(hasLos(s, model(10, 20), model(19, 20))).toBe(true); // 1" in from the near edge
    expect(hasLos(s, model(10, 20), model(25, 20))).toBe(true); // at the far edge
    expect(hasLos(s, model(25, 20), model(34, 20))).toBe(true); // looking out of the near side
    expect(hasLos(s, model(19, 20), model(34, 20))).toBe(true); // looking out of the far side
    expect(hasLos(s, model(19, 20), model(25, 20))).toBe(true); // both in it
    expect(hasLos(s, model(10, 20), model(34, 20))).toBe(false); // neither in it: the area blocks
  });

  it('a big base pressed against a ruin wall does not see (or get seen) through it', () => {
    // the token overlaps the wall a little (it stands for a hull); the part beyond the wall is not really there
    const ruin = area(18, 10, 26, 30, 'dense', [[P(22, 10), P(22, 30)]]);
    const tank = model(21.2, 20, 2); // 0.8" from the wall, base radius 2"
    expect(hasLos(board(ruin), tank, model(23.5, 20))).toBe(false);
    expect(hasLos(board(ruin), tank, model(20, 26))).toBe(true);
  });
});

describe('a hairline between two terrain areas (layout tracing)', () => {
  it('no line of sight slips through the corner where two footprints almost touch', () => {
    // a light area above, a dense ruin to the right, 0.25" apart at the shared corner; the tank tucked in the angle
    const s = board(area(5.25, 38.75, 9, 44.5, 'light'), area(9, 44.75, 15.75, 56, 'dense'));
    const tank = model(5.6, 47.2, 2.4);
    for (const [x, y] of [[20, 30], [28, 17], [16, 34], [24, 28]]) expect(hasLos(s, model(x, y), tank)).toBe(false);
  });

  it('a real gap between two areas still gives line of sight', () => {
    const s = board(area(10, 10, 18, 18, 'light'), area(20, 10, 28, 18, 'light'));
    expect(hasLos(s, model(19, 4), model(19, 24))).toBe(true);
  });
});

describe('model-level obscuring in a unit', () => {
  it('models standing outside behind an obscuring ruin cannot see through it, even if a squadmate stands inside', () => {
    const t = area(18, 10, 21, 30, 'light');
    const inside = { ...model(19, 20), id: 'a1', dead: false } as unknown as ModelState;
    const outside = { ...model(16.5, 20), id: 'a2', dead: false } as unknown as ModelState;
    const viewer = { ...model(30, 20), id: 'b1', dead: false } as unknown as ModelState;
    const squad = { units: [{ id: 'A', models: [inside, outside] }, { id: 'B', models: [viewer] }], terrain: [t] } as unknown as GameState;
    expect(hasLos(squad, inside, viewer)).toBe(true); // inside the ruin: sees out to viewer
    expect(hasLos(squad, outside, viewer)).toBe(false); // outside behind the ruin: still blocked by obscuring terrain
  });
});
