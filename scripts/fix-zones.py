#!/usr/bin/env python3
"""Clean deployment zones: every layout of one deployment type uses the same two zones, so each type's zones are
voted from all its layout images (a spot hidden under terrain in one layout is open in another), traced at
0.1" and simplified into straight edges and smooth arcs, then written back to every layout of that type.

Usage: python3 scripts/fix-zones.py <dir with no-measurements PNGs> data/layouts.json > new-layouts.json
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

BW, BH = 44.0, 60.0
R = 10  # pixels per inch of the voting grid


def board_box(im):
    dark = im.max(2) < 70
    h, w = dark.shape
    rows = np.where(dark.mean(1) > 0.6)[0]
    cols = np.where(dark.mean(0) > 0.45)[0]
    rows = rows[(rows > h * 0.15) & (rows < h * 0.9)]
    return max(c for c in cols if c < w / 2) + 1, max(r for r in rows if r < h / 2) + 1, min(c for c in cols if c > w / 2), min(r for r in rows if r > h / 2)


def classify(path):
    """-1 unknown (terrain, icons, lines), 0 open, 1 attacker (red), 2 defender (blue), on an R px/inch grid."""
    im = np.asarray(Image.open(path).convert('RGB')).astype(int)
    xl, yt, xr, yb = board_box(im)
    crop = im[yt:yb, xl:xr]
    small = np.asarray(Image.fromarray(crop.astype(np.uint8)).resize((int(BW * R), int(BH * R)), Image.BILINEAR)).astype(int)
    r, g, b = small[..., 0], small[..., 1], small[..., 2]
    red = (r > 115) & (r < 185) & (g > 45) & (g < 100) & (b > 40) & (b < 100) & (r - g > 50)
    blue = (r > 30) & (r < 80) & (g > 50) & (g < 95) & (b > 70) & (b < 120) & (b - r > 25)
    open_ = (r > 215) & (g > 210) & (b > 195) & (abs(r - g) < 14) & (r - b < 30) & ~((r > 222) & (g < 218))
    # the open field's grid lines are tan: count them as open too
    open_ |= (r > 175) & (r < 215) & (g > 160) & (b > 130) & (r - b > 25) & (r - b < 60)
    # plates are hatched near-white (225,218,210): not the field
    plate = (r > 220) & (g > 212) & (g < 224) & (b > 202) & (b < 218)
    out = np.full(r.shape, -1)
    out[open_ & ~plate] = 0
    out[red] = 1
    out[blue] = 2
    # trim the ragged edges of every region a little: anti-aliased boundaries vote nothing
    for v in (0, 1, 2):
        m = out == v
        out[m & ~ndimage.binary_erosion(m, iterations=1)] = -1
    return out


TRANSFORMS = {
    'id': lambda a: a,
    'fx': lambda a: a[:, ::-1],
    'fy': lambda a: a[::-1, :],
    'rot': lambda a: a[::-1, ::-1],
}


def vote(grids):
    """Align each grid to the first one (flip / rotate), then majority per cell."""
    ref = grids[0]
    aligned = []
    for i, g in enumerate(grids):
        best = None
        for name, f in TRANSFORMS.items():
            t = f(g)
            both = (t >= 0) & (ref >= 0)
            agree = ((t == ref) & both).sum() / max(1, both.sum())
            if best is None or agree > best[0]:
                best = (agree, name, t)
        aligned.append(best[1])
        grids[i] = best[2]
    stack = np.stack(grids)
    counts = np.stack([(stack == v).sum(0) for v in (0, 1, 2)])
    res = counts.argmax(0)
    res[counts.sum(0) == 0] = 0
    return res, aligned


def trace(mask):
    lab, n = ndimage.label(mask)
    if not n:
        return []
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    mask = ndimage.binary_fill_holes(lab == 1 + int(np.argmax(sizes)))
    edges = {}
    H, W = mask.shape
    for y, x in zip(*np.where(mask)):
        if y == 0 or not mask[y - 1, x]: edges[(x, y)] = (x + 1, y)
        if x == W - 1 or not mask[y, x + 1]: edges[(x + 1, y)] = (x + 1, y + 1)
        if y == H - 1 or not mask[y + 1, x]: edges[(x + 1, y + 1)] = (x, y + 1)
        if x == 0 or not mask[y, x - 1]: edges[(x, y + 1)] = (x, y)
    start = min(edges)
    pts, cur = [start], edges[start]
    while cur != start:
        pts.append(cur)
        cur = edges[cur]
    return pts


def dp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float)
    P = np.array(pts, float)
    ab = b - a
    L = np.hypot(*ab)
    d = np.abs(ab[0] * (P[:, 1] - a[1]) - ab[1] * (P[:, 0] - a[0])) / L if L > 1e-9 else np.hypot(*(P - a).T)
    i = int(np.argmax(d))
    if d[i] > eps:
        return dp(pts[:i + 1], eps)[:-1] + dp(pts[i:], eps)
    return [pts[0], pts[-1]]


def outline(mask):
    """Zone outline in inches: staircase corners smoothed (each pixel corner replaced by the midpoints of its edges),
    simplified, then cleaned into straight card lines (see tidy)."""
    ring = trace(mask)
    if not ring:
        return []
    mids = [((ring[k][0] + ring[(k + 1) % len(ring)][0]) / 2, (ring[k][1] + ring[(k + 1) % len(ring)][1]) / 2) for k in range(len(ring))]
    pts = [(x / R, y / R) for x, y in mids]
    k0 = next((k for k, (x, y) in enumerate(pts) if x <= 0.6 or y <= 0.6 or x >= BW - 0.6 or y >= BH - 0.6), 0)
    pts = pts[k0:] + pts[:k0]
    return tidy(dp(pts + [pts[0]], 0.12)[:-1])


def onx(p): return p[0] in (0.0, BW)
def ony(p): return p[1] in (0.0, BH)


def collinear(P, tol=0.06):
    """Drop repeated points and points on the straight line between their neighbours."""
    changed = True
    while changed and len(P) > 3:
        changed = False
        for k in range(len(P)):
            a, b, c = np.array(P[k - 1]), np.array(P[k]), np.array(P[(k + 1) % len(P)])
            ac = c - a
            L = np.hypot(*ac)
            d = abs(ac[0] * (b[1] - a[1]) - ac[1] * (b[0] - a[0])) / L if L > 1e-9 else 0
            if np.hypot(*(b - a)) < 1e-6 or d < tol and np.dot(b - a, c - b) >= 0:
                del P[k]
                changed = True
                break
    return P


def cross(p1, p2, q1, q2):
    """Intersection of the lines p1-p2 and q1-q2, or None when nearly parallel."""
    d1, d2 = np.subtract(p2, p1), np.subtract(q2, q1)
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 0.17 * np.hypot(*d1) * np.hypot(*d2):
        return None
    t = ((q1[0] - p1[0]) * d2[1] - (q1[1] - p1[1]) * d2[0]) / den
    return [p1[0] + t * d1[0], p1[1] + t * d1[1]]


def arcs(P):
    """A run of short edges is an arc on the card: fit its circle (centre and radius on whole / half inches when close)
    and redraw it evenly, its ends moved onto the circle."""
    n = len(P)
    ln = [np.hypot(P[(k + 1) % n][0] - P[k][0], P[(k + 1) % n][1] - P[k][1]) for k in range(n)]
    k0 = next((k for k in range(n) if ln[k] >= 3.2), None)
    if k0 is None:
        return P
    order = list(range(k0 + 1, n)) + list(range(0, k0 + 1))
    out, run = [], []
    for k in order:
        run.append(k)
        if ln[k] >= 3.2:
            out.extend(arc_run([P[i] for i in run]))
            run = []
    return out


def arc_run(pts):
    """pts: the vertices from the end of one long edge to the start of the next (both kept, moved onto the arc)."""
    if len(pts) < 4:
        return pts
    A = np.array(pts)
    M = np.c_[2 * A, np.ones(len(A))]
    c = np.linalg.lstsq(M, (A ** 2).sum(1), rcond=None)[0]
    cx, cy = c[0], c[1]
    r = np.sqrt(c[2] + cx * cx + cy * cy)
    if np.abs(np.hypot(*(A - [cx, cy]).T) - r).max() > 0.4:
        return pts
    snap = lambda v: round(v * 2) / 2 if abs(round(v * 2) / 2 - v) < 0.3 else v
    cx, cy, r = snap(cx), snap(cy), snap(r)
    a0 = np.arctan2(A[0, 1] - cy, A[0, 0] - cx)
    a1 = np.arctan2(A[-1, 1] - cy, A[-1, 0] - cx)
    mid = np.arctan2(A[len(A) // 2, 1] - cy, A[len(A) // 2, 0] - cx)
    # go the way round that passes the middle vertex
    d = (a1 - a0 + np.pi) % (2 * np.pi) - np.pi
    dm = (mid - a0 + np.pi) % (2 * np.pi) - np.pi
    if dm * d < 0 or abs(dm) > abs(d):
        d = d - np.sign(d) * 2 * np.pi
    steps = max(2, int(np.ceil(abs(d) / np.radians(10))))
    return [[cx + r * np.cos(a0 + d * t / steps), cy + r * np.sin(a0 + d * t / steps)] for t in range(steps + 1)]


def tidy(P):
    """Card zones are straight lines and arcs: snap to the board edge, make near-vertical / near-horizontal runs exact
    (on whole or half inches), cut off the rounded / chamfered corners where two long lines meet, and put the board
    corners back."""
    P = [[float(x), float(y)] for x, y in P]
    for p in P:
        for i, M in ((0, BW), (1, BH)):
            if p[i] < 0.6: p[i] = 0.0
            if p[i] > M - 0.6: p[i] = M
    P = arcs(P)
    for _ in range(2):
        for k in range(len(P)):
            p, q = P[k], P[(k + 1) % len(P)]
            for i in (0, 1):
                if abs(p[i] - q[i]) < 0.35 and abs(p[1 - i] - q[1 - i]) > 2.5:
                    if p[i] in (0.0, BW, BH) or q[i] in (0.0, BW, BH):
                        continue
                    v = round((p[i] + q[i]) * 0.5 * 2) / 2 if abs((p[i] + q[i]) / 2 - round(p[i] + q[i]) / 2) < 0.2 else (p[i] + q[i]) / 2
                    p[i] = q[i] = v
    P = collinear(P)
    # corners: a short edge between two long ones is a rounded / cut corner of the pixel trace
    changed = True
    while changed and len(P) > 3:
        changed = False
        n = len(P)
        ln = lambda k: np.hypot(P[(k + 1) % n][0] - P[k][0], P[(k + 1) % n][1] - P[k][1])
        for k in range(n):
            if ln(k) < 1.3 and ln(k - 1) > 2.5 and ln(k + 1) > 2.5:
                x = cross(P[k - 1], P[k], P[(k + 1) % n], P[(k + 2) % n])
                if x and np.hypot(x[0] - P[k][0], x[1] - P[k][1]) < 1.5:
                    P[k] = x
                    del P[(k + 1) % n]
                    changed = True
                    break
    # board corners where neighbours lie on two different edges, or a point sits close to a corner
    for p in P:
        for cx in (0.0, BW):
            for cy in (0.0, BH):
                if abs(p[0] - cx) < 1.0 and abs(p[1] - cy) < 1.0 and (onx(p) or ony(p)):
                    p[0], p[1] = cx, cy
    out = []
    for k, p in enumerate(P):
        out.append(p)
        q = P[(k + 1) % len(P)]
        if onx(p) and ony(q) and not ony(p) and not onx(q):
            out.append([p[0], q[1]])
        elif ony(p) and onx(q) and not onx(p) and not ony(q):
            out.append([q[0], p[1]])
    out = collinear(out, 0.02)
    res = []
    for x, y in out:
        rx, ry = round(x * 2) / 2, round(y * 2) / 2
        res.append([rx if abs(rx - x) < 0.1 else round(x, 2), ry if abs(ry - y) < 0.1 else round(y, 2)])
    return res


def close(P, Q, tol=0.6):
    """Every vertex of each polygon lies within tol of the other's outline."""
    def dist(p, R):
        best = 1e9
        for k in range(len(R)):
            a, b = np.array(R[k], float), np.array(R[(k + 1) % len(R)], float)
            ab = b - a
            t = np.clip(np.dot(np.subtract(p, a), ab) / max(1e-9, np.dot(ab, ab)), 0, 1)
            best = min(best, np.hypot(*(a + t * ab - p)))
        return best
    return all(dist(p, Q) < tol for p in P) and all(dist(q, P) < tol for q in Q)


def main(folder, path):
    data = json.load(open(path))
    files = {f.replace('-portrait', '').replace('.png', ''): os.path.join(folder, f) for f in os.listdir(folder) if f.endswith('.png')}
    by_type = {}
    for L in data['layouts']:
        by_type.setdefault(L['deployment'], []).append(L)
    for dep, Ls in by_type.items():
        grids = [classify(files[L['id']]) for L in Ls]
        res, aligned = vote(list(grids))
        # each region lost a pixel of its anti-aliased rim in classify: give it back
        grow = lambda v: ndimage.binary_dilation(res == v) & (res != 3 - v)
        zones = {'attacker': outline(grow(1)), 'defender': outline(grow(2))}
        # the two zones are the same shape turned half way round: the red one reads more sharply off the images,
        # so the blue one is the red one turned when they agree
        turned = [[round(BW - x, 2) + 0.0, round(BH - y, 2) + 0.0] for x, y in zones['attacker']]
        if close(turned, zones['defender']):
            zones['defender'] = turned
        else:
            print(f'  {dep}: zones are not point-symmetric, kept both', file=sys.stderr)
        inv = {'id': lambda p: p, 'fx': lambda p: [BW - p[0], p[1]], 'fy': lambda p: [p[0], BH - p[1]], 'rot': lambda p: [BW - p[0], BH - p[1]]}
        for L, t in zip(Ls, aligned):
            for k in ('attacker', 'defender'):
                L['zones'][k] = [inv[t](p) for p in zones[k]]
        print(f'{dep}: {len(Ls)} layouts, transforms {sorted(set(aligned))}, attacker {len(zones["attacker"])} pts, defender {len(zones["defender"])} pts', file=sys.stderr)
    sys.stdout.write(json.dumps(data, separators=(',', ':')))
    print()


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
