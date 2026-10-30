// The traced layouts give two plates that meet the same wall each; buildTerrain keeps one copy, so no wall lies
// along another anywhere on any map.
import { expect, it } from 'vitest';
import { LAYOUTS } from './config';
import { buildTerrain } from './game';
import type { Pt, Seg } from './types';

const overlap = (s: Seg, t: Seg) => {
  const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  const ux = (s.b.x - s.a.x) / L, uy = (s.b.y - s.a.y) / L;
  const off = (p: Pt) => Math.abs((p.x - s.a.x) * uy - (p.y - s.a.y) * ux);
  if (off(t.a) > 0.45 || off(t.b) > 0.45) return 0;
  const along = (p: Pt) => (p.x - s.a.x) * ux + (p.y - s.a.y) * uy;
  return Math.min(L, Math.max(along(t.a), along(t.b))) - Math.max(0, Math.min(along(t.a), along(t.b)));
};

it('no wall lies along another on any of the 45 layouts', () => {
  const bad: string[] = [];
  for (const L of LAYOUTS) {
    const ws = buildTerrain(L.id).terrain.flatMap((t) => t.walls);
    for (let a = 0; a < ws.length; a++) for (let b = a + 1; b < ws.length; b++) if (overlap(ws[a], ws[b]) > 0.3) bad.push(L.id);
  }
  expect(LAYOUTS.length).toBe(45);
  expect([...new Set(bad)]).toEqual([]);
});
