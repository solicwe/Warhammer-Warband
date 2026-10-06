#!/usr/bin/env python3
"""Re-trace the terrain of every layout from gdmissions.app's current layout images (2026 style: hatched baseplates
with a black outline and ragged rubble edges, green ruin walls, orange obstacles).

Usage: python3 scripts/extract-layouts-v2.py <dir with no-measurements PNGs> data/layouts.json > new-layouts.json

Only the terrain is replaced: deployment zones, territory, objectives and ids are kept from the existing file
(they come from the deployment cards). Each baseplate keeps its real outline (triangles, rubble edges) instead of
being squared off into a rectangle. Board: 44" x 60" portrait, x 0..44 left->right, y 0..60 top->bottom.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

BW, BH = 44.0, 60.0


def board_box(im):
    """The board's thick black frame: the inner edge of the longest dark runs around the middle."""
    dark = im.max(2) < 70
    h, w = dark.shape
    rows = np.where(dark.mean(1) > 0.6)[0]
    cols = np.where(dark.mean(0) > 0.45)[0]
    rows = rows[(rows > h * 0.15) & (rows < h * 0.9)]
    top = [r for r in rows if r < h / 2]
    bot = [r for r in rows if r > h / 2]
    left = [c for c in cols if c < w / 2]
    right = [c for c in cols if c > w / 2]
    return max(left) + 1, max(top) + 1, min(right), min(bot)


def trace(mask):
    """Outer boundary (pixel corners, clockwise) of the largest region in a boolean mask."""
    lab, n = ndimage.label(mask)
    if n == 0:
        return []
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    mask = lab == (1 + int(np.argmax(sizes)))
    mask = ndimage.binary_fill_holes(mask)
    edges = {}
    H, W = mask.shape
    ys, xs = np.where(mask)
    for y, x in zip(ys, xs):
        if y == 0 or not mask[y - 1, x]: edges[(x, y)] = (x + 1, y)
        if x == W - 1 or not mask[y, x + 1]: edges[(x + 1, y)] = (x + 1, y + 1)
        if y == H - 1 or not mask[y + 1, x]: edges[(x + 1, y + 1)] = (x, y + 1)
        if x == 0 or not mask[y, x - 1]: edges[(x, y + 1)] = (x, y)
    start = min(edges)
    pts, cur = [start], edges[start]
    while cur != start and len(pts) < 200000:
        pts.append(cur)
        cur = edges[cur]
    return pts


def dp(pts, eps):
    """Douglas-Peucker on an open polyline."""
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float)
    ab = b - a
    L = np.hypot(*ab) or 1e-9
    P = np.array(pts, float)
    d = np.abs(ab[0] * (P[:, 1] - a[1]) - ab[1] * (P[:, 0] - a[0])) / L if np.hypot(*ab) > 1e-9 else np.hypot(*(P - a).T)
    i = int(np.argmax(d))
    if d[i] > eps:
        return dp(pts[:i + 1], eps)[:-1] + dp(pts[i:], eps)
    return [pts[0], pts[-1]]


def dp_closed(pts, eps):
    P = np.array(pts, float)
    c = P.mean(0)
    i0 = int(np.argmax(np.hypot(*(P - c).T)))
    ring = pts[i0:] + pts[:i0]
    j = int(np.argmax(np.hypot(*(np.array(ring, float) - np.array(ring[0], float)).T)))
    out = dp(ring[:j + 1], eps)[:-1] + dp(ring[j:] + [ring[0]], eps)[:-1]
    return out


def area(poly):
    return abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))) / 2


def segments(mask, sx, sy, min_len, angles):
    """Straight strokes in a colour mask (walls / obstacles) as [x0, y0, x1, y1] in inches. Strokes run along the
    plate's own edges, so each connected stroke (an L, a box) is cut into straight runs along those directions."""
    res = []
    lab, n = ndimage.label(ndimage.binary_closing(mask, iterations=1))
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(xs) < 25:
            continue
        pts = np.c_[xs, ys].astype(float)
        c = pts.mean(0)
        for a in angles:
            ca, sa = np.cos(a), np.sin(a)
            u = (pts[:, 0] - c[0]) * ca + (pts[:, 1] - c[1]) * sa
            t = -(pts[:, 0] - c[0]) * sa + (pts[:, 1] - c[1]) * ca
            tb = np.floor(t + 0.5).astype(int)  # (np.round would pair rows up: half to even)
            order = np.lexsort((u, tb))
            tb_s, u_s = tb[order], u[order]
            runs = []
            for tv in np.unique(tb_s):
                us = u_s[tb_s == tv]
                br = np.where(np.diff(us) > 2.5)[0]
                starts = np.r_[us[0], us[br + 1]]
                ends = np.r_[us[br], us[-1]]
                for s0, e0 in zip(starts, ends):
                    if (e0 - s0) / sx >= min_len:
                        runs.append((tv, s0, e0))
            runs.sort()
            groups = []
            for r in runs:
                for g in groups:
                    if r[0] - g['t1'] <= 1 and not (r[2] < g['s'] - 3 or r[1] > g['e'] + 3):
                        g['t1'] = r[0]; g['s'] = min(g['s'], r[1]); g['e'] = max(g['e'], r[2]); g['n'] += 1; break
                else:
                    groups.append({'t0': r[0], 't1': r[0], 's': r[1], 'e': r[2], 'n': 1})
            for g in groups:
                thick = (g['t1'] - g['t0'] + 1) / sx
                if g['n'] < 3 or thick > 0.9:
                    continue
                tm = (g['t0'] + g['t1']) / 2
                p1 = (c[0] + g['s'] * ca - tm * sa, c[1] + g['s'] * sa + tm * ca)
                p2 = (c[0] + g['e'] * ca - tm * sa, c[1] + g['e'] * sa + tm * ca)
                res.append([round(p1[0] / sx * 4) / 4, round(p1[1] / sy * 4) / 4, round(p2[0] / sx * 4) / 4, round(p2[1] / sy * 4) / 4])
    return res


def edge_angles(poly):
    """The plate's straight directions: its longest edge and the perpendicular, plus any other long edge (a triangle's
    sides). Short rubble edges don't count."""
    cand = []
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        L = np.hypot(x2 - x1, y2 - y1)
        if L >= 2.5:
            a = np.arctan2(y2 - y1, x2 - x1) % np.pi
            cand += [(a, L), ((a + np.pi / 2) % np.pi, L * 0.5)]
    cand.sort(key=lambda c: -c[1])
    out = []
    for a, _ in cand:
        if all(min(abs(a - b), np.pi - abs(a - b)) > np.radians(12) for b in out):
            out.append(a)
    return out or [0.0, np.pi / 2]


def dedupe(segs):
    """Drop a segment that lies along (within 0.35") a longer one."""
    segs = sorted(segs, key=lambda s: -np.hypot(s[2] - s[0], s[3] - s[1]))
    out = []
    for s in segs:
        a, b = np.array(s[:2]), np.array(s[2:])
        if any(max(_psd(a, o), _psd(b, o)) < 0.35 for o in out):
            continue
        out.append(s)
    return out


def _psd(p, s):
    a, b = np.array(s[:2], float), np.array(s[2:], float)
    d = b - a
    L2 = d @ d
    t = 0 if L2 == 0 else max(0, min(1, (p - a) @ d / L2))
    return float(np.hypot(*(p - a - t * d)))


def pip(pt, poly):
    x, y = pt
    inside = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
            inside = not inside
    return inside


def seg_dist_to_poly(s, poly):
    def psd(p, a, b):
        ax, ay, bx, by = a[0], a[1], b[0], b[1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = 0 if L2 == 0 else max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2))
        return np.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy)
    m = ((s[0] + s[2]) / 2, (s[1] + s[3]) / 2)
    if pip(m, poly):
        return 0.0
    return min(psd(m, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))


def extract(path):
    im = np.asarray(Image.open(path).convert('RGB')).astype(int)
    xl, yt, xr, yb = board_box(im)
    crop = im[yt:yb, xl:xr]
    sx, sy = (xr - xl) / BW, (yb - yt) / BH
    r, g, b = crop[..., 0], crop[..., 1], crop[..., 2]
    black = crop.max(2) < 75
    green = (abs(r - 56) < 32) & (abs(g - 110) < 32) & (abs(b - 82) < 32) & (g - r > 25)
    orange = (r > 180) & (g > 95) & (g < 180) & (b < 90) & (r - b > 110)
    # objective discs (white, with a coloured ring) are drawn over plate outlines: the disc and its ring close the gap
    disc = ndimage.binary_opening(crop.min(2) > 243, iterations=2)
    disc = ndimage.binary_dilation(disc, iterations=max(3, int(0.2 * sx)))
    barrier = black | green | orange | disc
    # the open field: everything reachable from the board's edge without crossing an outline, wall or obstacle
    free = ~ndimage.binary_dilation(barrier, iterations=1)
    lab, n = ndimage.label(free)
    edge_ids = set(np.unique(np.r_[lab[2, :], lab[-3, :], lab[:, 2], lab[:, -3]])) - {0}
    field = np.isin(lab, list(edge_ids))
    # what is left: baseplates (interiors + their outline, walls and obstacles) and loose objective discs
    solid = ~field
    # split touching plates along their shared black outline: plate interiors (not black) joined through walls/obstacles
    # pockets of plate interior (between outlines, walls and obstacles); pockets split only by a wall or an obstacle
    # stroke belong to the same plate, pockets split by a plain black outline are different plates
    stroke = green | orange
    inner = solid & ~black & ~stroke
    lab2, n2 = ndimage.label(inner)
    th = max(2, int(round(0.12 * sx)))  # half the outline width
    reach = int(round(0.6 * sx))  # an obstacle with its black edges is ~0.9" wide
    objs = ndimage.find_objects(lab2)
    comp = []
    for i in range(1, n2 + 1):
        sl = objs[i - 1]
        m = lab2[sl] == i
        if m.sum() < 0.04 * sx * sy:
            continue
        # a loose objective disc: round, mostly white, not on a plate
        cut = crop[sl][m]
        bw, bh = (sl[1].stop - sl[1].start) / sx, (sl[0].stop - sl[0].start) / sy
        if (cut.min(1) > 240).mean() > 0.45 and bw < 2.8 and bh < 2.8 and m.sum() > 0.5 * sx * sy:
            continue
        comp.append(i)
    parent = {i: i for i in comp}
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    grown = {}
    for i in comp:
        sl = objs[i - 1]
        y0, x0 = max(0, sl[0].start - reach), max(0, sl[1].start - reach)
        y1, x1 = sl[0].stop + reach, sl[1].stop + reach
        grown[i] = ((y0, x0), ndimage.binary_dilation(lab2[y0:y1, x0:x1] == i, iterations=reach))
    for a_ in range(len(comp)):
        for b_ in range(a_ + 1, len(comp)):
            A, B = comp[a_], comp[b_]
            (ay, ax), ma = grown[A]; (by, bx), mb = grown[B]
            Y0, X0 = max(ay, by), max(ax, bx)
            Y1, X1 = min(ay + ma.shape[0], by + mb.shape[0]), min(ax + ma.shape[1], bx + mb.shape[1])
            if Y0 >= Y1 or X0 >= X1:
                continue
            ov = ma[Y0 - ay:Y1 - ay, X0 - ax:X1 - ax] & mb[Y0 - by:Y1 - by, X0 - bx:X1 - bx]
            # what lies between the two pockets: mostly wall / obstacle colour = one plate; a plain black outline = two
            band = ov & ~inner[Y0:Y1, X0:X1]
            if band.sum() > 4 and (stroke[Y0:Y1, X0:X1] & band).sum() > 0.4 * band.sum():
                parent[find(A)] = find(B)
    groups = {}
    for i in comp:
        groups.setdefault(find(i), []).append(i)
    # each group's footprint as a full-size mask; footprints that overlap a lot are one plate (a walled strip whose
    # pockets are boxed in by the walls' own black edges)
    H, W = solid.shape
    masks = []
    for ids in groups.values():
        m = np.isin(lab2, ids)
        ys, xs = np.where(m)
        if len(xs) < 0.3 * sx * sy:
            continue
        y0, y1, x0, x1 = max(0, ys.min() - 3 * th), ys.max() + 3 * th + 1, max(0, xs.min() - 3 * th), xs.max() + 3 * th + 1
        sub = m[y0:y1, x0:x1] | (stroke[y0:y1, x0:x1] & ndimage.binary_dilation(m[y0:y1, x0:x1], iterations=reach))
        sub = ndimage.binary_closing(sub, iterations=th)
        sub = ndimage.binary_dilation(sub, iterations=th + 1) & solid[y0:y1, x0:x1]
        full = np.zeros((H, W), bool)
        full[y0:y1, x0:x1] = ndimage.binary_fill_holes(sub)
        masks.append({'m': full, 'inner': m})
    merged = True
    while merged:
        merged = False
        for a_ in range(len(masks)):
            for b_ in range(a_ + 1, len(masks)):
                A, B = masks[a_]['m'], masks[b_]['m']
                ov = (A & B).sum()
                if ov > 0.3 * min(A.sum(), B.sum()):
                    masks[a_] = {'m': A | B, 'inner': masks[a_]['inner'] | masks[b_]['inner']}
                    del masks[b_]
                    merged = True
                    break
            if merged:
                break
    pieces = []
    for mk in masks:
        ring = trace(mk['m'])
        if len(ring) < 8:
            continue
        poly = dp_closed(ring, 0.3 * sx)  # rubble edges kept roughly, ~8 corners a plate
        poly = [[round(x / sx, 2), round(y / sy, 2)] for x, y in poly]
        if len(poly) < 3 or area(poly) < 0.8:
            continue
        # a sliver along a plate's edge (part of an outline), not a plate: thinner than half an inch
        span = max(np.hypot(a[0] - b[0], a[1] - b[1]) for a in poly for b in poly)
        if area(poly) / max(span, 1e-9) < 0.5:
            continue
        # an objective disc drawn on a plate (its own black ring): round, small, mostly white
        per = sum(np.hypot(poly[k][0] - poly[k - 1][0], poly[k][1] - poly[k - 1][1]) for k in range(len(poly)))
        roundness = 4 * np.pi * area(poly) / max(per * per, 1e-9)
        if area(poly) < 11 and roundness > 0.85 and (crop[mk['inner']].min(1) > 235).mean() > 0.3:
            continue
        pieces.append({'poly': poly, 'walls': [], 'obstacles': [], 'n': int(mk['m'].sum())})
    # interiors split into pockets by walls that touch the outline: a pocket inside a bigger plate joins that plate
    pieces.sort(key=lambda p: -area(p['poly']))
    kept = []
    for p in pieces:
        P = np.array(p['poly'], float)
        x0_, y0_ = P.min(0); x1_, y1_ = P.max(0)
        samples = [(x, y) for x in np.linspace(x0_, x1_, 9) for y in np.linspace(y0_, y1_, 9) if pip((x, y), p['poly'])]
        if samples and any(np.mean([pip(q, k['poly']) for q in samples]) > 0.5 for k in kept):
            continue  # a pocket between walls inside a bigger plate
        kept.append(p)
    # walls and obstacles go to the plate they lie on
    # walls and obstacles: the strokes on each plate, read along that plate's edge directions
    from PIL import ImageDraw
    H, W = green.shape
    for p in kept:
        img = Image.new('L', (W, H), 0)
        ImageDraw.Draw(img).polygon([(x * sx, y * sy) for x, y in p['poly']], fill=1)
        on = ndimage.binary_dilation(np.asarray(img).astype(bool), iterations=int(0.3 * sx))
        ang = edge_angles(p['poly'])
        p['walls'] = dedupe(segments(green & on, sx, sy, 0.9, ang))
        p['obstacles'] = dedupe(segments(orange & on, sx, sy, 0.7, ang))
    for p in kept:
        del p['n']
    return kept


def main(folder, old_path):
    old = json.load(open(old_path))
    files = {f.replace('-portrait', '').replace('.png', ''): os.path.join(folder, f) for f in os.listdir(folder) if f.endswith('.png')}
    for L in old['layouts']:
        f = files.get(L['id'])
        if not f:
            print('missing image for', L['id'], file=sys.stderr)
            continue
        terrain = extract(f)
        print(f"{L['id']}: {len(L['terrain'])} -> {len(terrain)} pieces", file=sys.stderr)
        L['terrain'] = terrain
    old['_comment'] = (old.get('_comment', '') + ' Terrain re-traced from the 2026 images (real footprint outlines) with scripts/extract-layouts-v2.py.').strip()
    sys.stdout.write(json.dumps(old, separators=(',', ':')))
    print()


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
