// The traced layouts give walls twice (two plates meeting), as a thin wall's two faces an inch apart, or as a tangle
// of stubs. buildTerrain cleans them, so on the table (walls draw about 0.6" wide with their shadow) no two walls lie
// side by side and none cross another, on any of the 45 layouts.
import { expect, it } from 'vitest';
import { LAYOUTS } from './config';
import { buildTerrain } from './game';
import type { Pt, Seg } from './types';

/** how long a stretch of t runs alongside s within `gap` inches */
const alongside = (s: Seg, t: Seg, gap: number) => {
  const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  const ux = (s.b.x - s.a.x) / L, uy = (s.b.y - s.a.y) / L;
  const side = (p: Pt) => (p.x - s.a.x) * uy - (p.y - s.a.y) * ux;
  if (Math.abs(side(t.a)) > gap || Math.abs(side(t.b)) > gap || Math.abs(side(t.a) - side(t.b)) > 0.45) return 0;
  const along = (p: Pt) => (p.x - s.a.x) * ux + (p.y - s.a.y) * uy;
  return Math.min(L, Math.max(along(t.a), along(t.b))) - Math.max(0, Math.min(along(t.a), along(t.b)));
};
const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const crosses = (s: Seg, t: Seg) => cross(t.a, t.b, s.a) * cross(t.a, t.b, s.b) < -0.3 && cross(s.a, s.b, t.a) * cross(s.a, s.b, t.b) < -0.3;

it('no wall runs alongside or crosses another on any of the 45 layouts', () => {
  const bad: string[] = [];
  for (const L of LAYOUTS) {
    const ws = buildTerrain(L.id).terrain.flatMap((t) => t.walls);
    for (let a = 0; a < ws.length; a++) for (let b = a + 1; b < ws.length; b++) {
      if (alongside(ws[a], ws[b], 1.35) > 0.6 || alongside(ws[b], ws[a], 1.35) > 0.6) bad.push(`${L.id} side by side`);
      else if (crosses(ws[a], ws[b])) bad.push(`${L.id} crossing`);
    }
  }
  expect(LAYOUTS.length).toBe(45);
  expect([...new Set(bad)]).toEqual([]);
});

it('plates stand apart: under 1" only where both hold an objective or the slide would be over the cap; walls stay on their plate', () => {
  const es = (p: Pt[]) => p.map((a, i) => ({ a, b: p[(i + 1) % p.length] }));
  const segDist = (s: Seg, t: Seg) => {
    const pd = (p: Pt, w: Seg) => { const L2 = (w.b.x - w.a.x) ** 2 + (w.b.y - w.a.y) ** 2; const f = L2 ? Math.max(0, Math.min(1, ((p.x - w.a.x) * (w.b.x - w.a.x) + (p.y - w.a.y) * (w.b.y - w.a.y)) / L2)) : 0; return Math.hypot(p.x - w.a.x - f * (w.b.x - w.a.x), p.y - w.a.y - f * (w.b.y - w.a.y)); };
    return crosses(s, t) ? 0 : Math.min(pd(s.a, t), pd(s.b, t), pd(t.a, s), pd(t.b, s));
  };
  const inside = (p: Pt, poly: Pt[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c; return c; };
  let close = 0;
  const off: string[] = [];
  for (const L of LAYOUTS) {
    const ts = buildTerrain(L.id).terrain.filter((t) => t.kind !== 'objective-area');
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      const A = ts[i].poly, B = ts[j].poly;
      const over = A.some((p) => inside(p, B)) || B.some((p) => inside(p, A));
      if (over || Math.min(...es(A).flatMap((e) => es(B).map((f) => segDist(e, f)))) < 0.99) close++;
    }
    for (const t of ts) for (const w of t.walls) for (const p of [w.a, w.b]) if (!inside(p, t.poly) && Math.min(...es(t.poly).map((e) => segDist({ a: p, b: p }, e))) > 0.35) off.push(`${L.id} ${t.id}`);
  }
  expect(close).toBeLessThanOrEqual(20); // was 177 as traced
  expect(off).toEqual([]);
});
