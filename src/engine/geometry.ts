import type { ModelState, Pt, Seg } from './types';

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const EPS = 0.01;

/** Edge-to-edge distance between two round bases (0 when touching or overlapping). */
export const baseDist = (a: ModelState | (Pt & { r: number }), b: ModelState | (Pt & { r: number })) =>
  Math.max(0, dist(a, b) - a.r - b.r);

export function pointSegDist(p: Pt, s: Seg): number {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (s.a.x + t * dx), p.y - (s.a.y + t * dy));
}

function orient(a: Pt, b: Pt, c: Pt) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }

export function segsIntersect(p: Seg, q: Seg): boolean {
  const d1 = orient(q.a, q.b, p.a), d2 = orient(q.a, q.b, p.b);
  const d3 = orient(p.a, p.b, q.a), d4 = orient(p.a, p.b, q.b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function segSegDist(p: Seg, q: Seg): number {
  if (segsIntersect(p, q)) return 0;
  return Math.min(pointSegDist(p.a, q), pointSegDist(p.b, q), pointSegDist(q.a, p), pointSegDist(q.b, p));
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const polyEdges = (poly: Pt[]): Seg[] => poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length] }));

/** "Within" an area: any part of the base is inside the polygon. */
export function circleTouchesPoly(c: Pt, r: number, poly: Pt[]): boolean {
  if (pointInPoly(c, poly)) return true;
  return polyEdges(poly).some((e) => pointSegDist(c, e) <= r);
}

/** "Wholly within": every part of the base is inside the polygon. */
export function circleWhollyInPoly(c: Pt, r: number, poly: Pt[]): boolean {
  return pointInPoly(c, poly) && polyEdges(poly).every((e) => pointSegDist(c, e) >= r - EPS);
}

export function segCrossesPoly(s: Seg, poly: Pt[]): boolean {
  if (pointInPoly(s.a, poly) || pointInPoly(s.b, poly)) return true;
  return polyEdges(poly).some((e) => segsIntersect(s, e));
}

/** Sample points on and inside a base for line-of-sight tests. */
export function samplePoints(m: Pt & { r: number }, n = 8): Pt[] {
  const pts: Pt[] = [{ x: m.x, y: m.y }];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: m.x + Math.cos(a) * m.r * 0.92, y: m.y + Math.sin(a) * m.r * 0.92 });
  }
  return pts;
}

export function polyCentroid(poly: Pt[]): Pt {
  return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
}

/** Coherency (03.03): every model within `near` of one other, and within `max` of all others, as one group. */
export function coherencyProblems(models: Pt[], near: number, max: number, radii: number[]): number[] {
  const n = models.length;
  if (n <= 1) return [];
  const d = (i: number, j: number) => Math.max(0, dist(models[i], models[j]) - radii[i] - radii[j]);
  const bad = new Set<number>();
  // connected via `near` links
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length) {
    const i = stack.pop()!;
    for (let j = 0; j < n; j++) if (!seen.has(j) && d(i, j) <= near + EPS) { seen.add(j); stack.push(j); }
  }
  for (let i = 0; i < n; i++) {
    if (!seen.has(i)) bad.add(i);
    let hasNear = false;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (d(i, j) <= near + EPS) hasNear = true;
      if (d(i, j) > max + EPS) bad.add(i);
    }
    if (!hasNear) bad.add(i);
  }
  return [...bad];
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
