import type { ModelState, Pt, Seg } from './types';

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const EPS = 0.01;

/** A model's footprint. Round bases: a circle of radius `r`. Oval bases and vehicle hulls: a capsule (a segment of
 *  half-length `hl` turned `rot` radians, swept by radius `hw`) — `r` then stays the mean radius for rough estimates. */
export type Body = Pt & { r: number; hw?: number; hl?: number; rot?: number };

/** The footprint's long axis (a single point for a round base). */
export function axis(b: Body): Seg {
  if (!b.hl) return { a: b, b };
  const c = Math.cos(b.rot ?? 0) * b.hl, n = Math.sin(b.rot ?? 0) * b.hl;
  return { a: { x: b.x - c, y: b.y - n }, b: { x: b.x + c, y: b.y + n } };
}
/** The footprint's half-width around its axis. */
export const girth = (b: Body) => (b.hl ? b.hw ?? b.r : b.r);
/** The farthest any part of the base reaches from its centre. */
export const reachOf = (b: Body) => (b.hl ? b.hl + (b.hw ?? b.r) : b.r);
/** The same model standing at another spot (same footprint and facing). */
export const bodyAt = (m: Body, p: Pt & { rot?: number }): Body => ({ x: p.x, y: p.y, r: m.r, hw: m.hw, hl: m.hl, rot: p.rot ?? m.rot });
/** Edge-to-edge distance between two bases; negative when they overlap. */
export const gap = (a: Body, b: Body) => (a.hl || b.hl ? segSegDist(axis(a), axis(b)) - girth(a) - girth(b) : dist(a, b) - a.r - b.r);
/** Distance from a point to the edge of a base; negative inside it. */
export const ptGap = (b: Body, p: Pt) => (b.hl ? pointSegDist(p, axis(b)) - girth(b) : dist(b, p) - b.r);
/** Edge-to-edge distance between two bases (0 when touching or overlapping). */
export const baseDist = (a: ModelState | Body, b: ModelState | Body) => Math.max(0, gap(a, b));
/** The base's bounding box. */
export function bodyBox(b: Body) {
  const ax = axis(b), g = girth(b);
  return { x0: Math.min(ax.a.x, ax.b.x) - g, y0: Math.min(ax.a.y, ax.b.y) - g, x1: Math.max(ax.a.x, ax.b.x) + g, y1: Math.max(ax.a.y, ax.b.y) + g };
}
/** Any part of the base, grown by `extra`, inside the polygon. */
export function bodyTouchesPoly(b: Body, extra: number, poly: Pt[]): boolean {
  if (!b.hl) return circleTouchesPoly(b, b.r + extra, poly);
  const ax = axis(b);
  return pointInPoly(ax.a, poly) || pointInPoly(ax.b, poly) || polyEdges(poly).some((e) => segSegDist(ax, e) <= girth(b) + extra);
}
/** Every part of the base inside the polygon. */
export function bodyWhollyInPoly(b: Body, poly: Pt[]): boolean {
  if (!b.hl) return circleWhollyInPoly(b, b.r, poly);
  const ax = axis(b);
  return pointInPoly(ax.a, poly) && pointInPoly(ax.b, poly) && polyEdges(poly).every((e) => segSegDist(ax, e) >= girth(b) - EPS);
}

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

/** Do two segments touch or cross (an end lying on the other segment counts)? */
export function segsTouch(p: Seg, q: Seg): boolean {
  return segSegDist(p, q) < 1e-7;
}

/** Strictly inside the polygon (not on its boundary). */
const strictlyInside = (p: Pt, poly: Pt[]) => pointInPoly(p, poly) && polyEdges(poly).every((e) => pointSegDist(p, e) > 1e-7);

/** Does the segment pass through the inside of the polygon? Running along its boundary or touching a corner
 *  from outside does not count; passing through two corners (a diagonal) does. */
export function segCrossesPoly(s: Seg, poly: Pt[]): boolean {
  if (strictlyInside(s.a, poly) || strictlyInside(s.b, poly)) return true;
  // split the segment where it meets the boundary (corners included) and test the middle of each piece
  const rx = s.b.x - s.a.x, ry = s.b.y - s.a.y;
  const ts = [0, 1];
  for (const e of polyEdges(poly)) {
    const ex = e.b.x - e.a.x, ey = e.b.y - e.a.y;
    const den = rx * ey - ry * ex;
    const qx = e.a.x - s.a.x, qy = e.a.y - s.a.y;
    if (Math.abs(den) < 1e-12) continue; // parallel: at most runs along the boundary
    const t = (qx * ey - qy * ex) / den;
    const u = (qx * ry - qy * rx) / den;
    if (t > -1e-9 && t < 1 + 1e-9 && u > -1e-9 && u < 1 + 1e-9) ts.push(Math.min(1, Math.max(0, t)));
  }
  if (ts.length === 2) return false;
  ts.sort((a, b) => a - b);
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - ts[i - 1] < 1e-9) continue;
    const m = (ts[i] + ts[i - 1]) / 2;
    if (strictlyInside({ x: s.a.x + rx * m, y: s.a.y + ry * m }, poly)) return true;
  }
  return false;
}

/** How much of the segment lies inside the polygon. */
export function segLengthInPoly(s: Seg, poly: Pt[]): number {
  const rx = s.b.x - s.a.x, ry = s.b.y - s.a.y;
  const ts = [0, 1];
  for (const e of polyEdges(poly)) {
    const ex = e.b.x - e.a.x, ey = e.b.y - e.a.y;
    const den = rx * ey - ry * ex;
    if (Math.abs(den) < 1e-12) continue;
    const qx = e.a.x - s.a.x, qy = e.a.y - s.a.y;
    const t = (qx * ey - qy * ex) / den, u = (qx * ry - qy * rx) / den;
    if (t > 0 && t < 1 && u > -1e-9 && u < 1 + 1e-9) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  let inside = 0;
  for (let i = 1; i < ts.length; i++) {
    const m = (ts[i] + ts[i - 1]) / 2;
    if (pointInPoly({ x: s.a.x + rx * m, y: s.a.y + ry * m }, poly)) inside += ts[i] - ts[i - 1];
  }
  return inside * Math.hypot(rx, ry);
}

/** Sample points on and inside a base for line-of-sight tests. */
export function samplePoints(m: Pt & { r: number }, n = 8): Pt[] {
  const pts: Pt[] = [{ x: m.x, y: m.y }];
  // the model itself stands inside its base: a sliver of base rim past a wall end is not a model to see or shoot from
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: m.x + Math.cos(a) * m.r * 0.75, y: m.y + Math.sin(a) * m.r * 0.75 });
  }
  return pts;
}

export function polyCentroid(poly: Pt[]): Pt {
  return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
}

/** Coherency (03.03): every model within `near` of one other, and within `max` of all others, as one group. */
export function coherencyProblems(models: Pt[], near: number, max: number, radii: (number | Body)[]): number[] {
  const n = models.length;
  if (n <= 1) return [];
  const body = (i: number): Body => { const r = radii[i]; return typeof r === 'number' ? { x: models[i].x, y: models[i].y, r } : bodyAt(r, models[i]); };
  const d = (i: number, j: number) => Math.max(0, gap(body(i), body(j)));
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

/** The whole base on a W × H battlefield (`slack` allows a hair over the edge). */
export function onTable(b: Body, W: number, H: number, slack = 0): boolean {
  if (!b.hl) return b.x - b.r >= -slack && b.y - b.r >= -slack && b.x + b.r <= W + slack && b.y + b.r <= H + slack;
  const k = bodyBox(b);
  return k.x0 >= -slack && k.y0 >= -slack && k.x1 <= W + slack && k.y1 <= H + slack;
}

/** Where `m` stands to touch `e` (edge to edge `clear`) coming from angle `ang` (radians, from e's centre). */
export function contactAt(m: Body, e: Body, ang: number, clear: number): Pt {
  const ray = (d: number) => ({ x: e.x + Math.cos(ang) * d, y: e.y + Math.sin(ang) * d });
  if (!m.hl && !e.hl) return ray(e.r + m.r + clear);
  let lo = 0, hi = reachOf(e) + reachOf(m) + clear + 0.1;
  for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (gap(bodyAt(m, ray(mid)), e) < clear) lo = mid; else hi = mid; }
  return ray(hi);
}
