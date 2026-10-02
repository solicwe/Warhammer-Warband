#!/usr/bin/env python3
"""Turn the measured terrain-layout images (one per force-disposition matchup) into board data.

Usage: python3 scripts/extract-layouts.py <dir with no-measurements PNGs> > data/layouts.json
Board is 44" x 60" portrait: x 0..44 left->right, y 0..60 top->bottom, attacker (red) zone at the top.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import ConvexHull

BW, BH = 44.0, 60.0

def load(path):
    return np.array(Image.open(path).convert('RGB')).astype(int)

def board_box(im):
    h, w, _ = im.shape
    dark = im.sum(2) < 120
    ymid = h // 2
    xs = np.where(dark[ymid])[0]
    xs = xs[(xs > w * 0.05) & (xs < w * 0.95)]
    # left border run and right border run
    left_run = [xs[0]]
    for x in xs[1:]:
        if x == left_run[-1] + 1: left_run.append(x)
        else: break
    right_run = [xs[-1]]
    for x in xs[::-1][1:]:
        if x == right_run[-1] - 1: right_run.append(x)
        else: break
    xl, xr = left_run[-1] + 1, right_run[-1] - 1
    xm = (xl + xr) // 2
    col = dark[:, xm - 40]  # avoid the centre icon line
    ys = np.where(col)[0]
    ys = ys[(ys > h * 0.2) & (ys < h * 0.9)]
    top_run = [ys[0]]
    for y in ys[1:]:
        if y == top_run[-1] + 1: top_run.append(y)
        else: break
    bot_run = [ys[-1]]
    for y in ys[::-1][1:]:
        if y == bot_run[-1] - 1: bot_run.append(y)
        else: break
    yt, yb = top_run[-1] + 1, bot_run[-1] - 1
    return xl, yt, xr, yb

def classify(im):
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    s = r + g + b
    m = {}
    m['base'] = (abs(r - b) <= 22) & (s >= 625) & (s <= 688) & (abs(r - g) <= 12)
    m['hatch'] = (abs(r - b) <= 25) & (s >= 380) & (s < 625) & (abs(r - g) <= 15)
    m['green'] = (abs(r - 56) < 30) & (abs(g - 113) < 30) & (abs(b - 83) < 30)
    m['orange'] = (r > 190) & (g > 100) & (g < 175) & (b < 90)
    m['red'] = (r > 120) & (r < 185) & (g < 110) & (b < 110) & (r - g > 50)
    m['blue'] = (r < 90) & (g < 110) & (b > 70) & (b < 140) & (b - r > 20)
    m['white'] = s >= 742
    m['dash'] = (abs(r - g) < 8) & (abs(g - b) < 10) & (s > 300) & (s < 420)
    m['dark'] = s < 120
    return m

def min_rect_angle(xs, ys):
    """Orientation (radians) of the minimum-area rectangle around the points, snapped to the axes when close."""
    pts = np.c_[xs, ys].astype(float)
    if len(pts) > 4000:
        pts = pts[np.random.default_rng(0).choice(len(pts), 4000, replace=False)]
    try:
        hull = pts[ConvexHull(pts).vertices]
    except Exception:
        return 0.0
    best = (1e18, 0.0)
    for i in range(len(hull)):
        e = hull[(i + 1) % len(hull)] - hull[i]
        a = np.arctan2(e[1], e[0])
        c, s = np.cos(a), np.sin(a)
        u = hull[:, 0] * c + hull[:, 1] * s
        v = -hull[:, 0] * s + hull[:, 1] * c
        area = np.ptp(u) * np.ptp(v)
        if area < best[0]: best = (area, a)
    a = best[1] % (np.pi / 2)
    if a > np.pi / 4: a -= np.pi / 2
    if abs(a) < np.radians(4): a = 0.0
    return a

def rotated(xs, ys, a):
    """Raster of the points in a frame rotated by -a; returns (raster, u0, v0, c, s)."""
    c, s = np.cos(a), np.sin(a)
    u = xs * c + ys * s
    v = -xs * s + ys * c
    u0, v0 = u.min(), v.min()
    R = np.zeros((int(np.ceil(v.max() - v0)) + 2, int(np.ceil(u.max() - u0)) + 2), dtype=bool)
    R[np.round(v - v0).astype(int), np.round(u - u0).astype(int)] = True
    R = ndimage.binary_closing(R, iterations=1)
    return R, u0, v0, c, s

def unrot(u, v, u0, v0, c, s):
    u, v = u + u0, v + v0
    return u * c - v * s, u * s + v * c

def dp_closed(pts, eps):
    """Douglas-Peucker on a closed polygon."""
    def dp(P_):
        if len(P_) < 3: return P_
        a0, b0 = P_[0], P_[-1]
        dv = b0 - a0
        d = np.abs(dv[0] * (P_[:, 1] - a0[1]) - dv[1] * (P_[:, 0] - a0[0])) / (np.hypot(*dv) + 1e-9)
        i = int(np.argmax(d))
        if d[i] > eps: return np.vstack([dp(P_[:i + 1])[:-1], dp(P_[i:])])
        return np.vstack([a0, b0])
    far = int(np.argmax(np.hypot(pts[:, 0] - pts[0, 0], pts[:, 1] - pts[0, 1])))
    a = dp(pts[:far + 1]); b = dp(np.vstack([pts[far:], pts[:1]]))
    return np.vstack([a[:-1], b[:-1]])

def split_board(line, attacker_zone):
    """Split the board along the territory line; returns {'attacker': poly, 'defender': poly}."""
    corners = [(0, 0), (BW, 0), (BW, BH), (0, BH)]
    def perim(p):  # position along the board edge, clockwise from the top-left corner
        x, y = p
        if abs(y) < 1e-3: return x
        if abs(x - BW) < 1e-3: return BW + y
        if abs(y - BH) < 1e-3: return BW + BH + (BW - x)
        return 2 * BW + BH + (BH - y)
    cpos = [perim(c) for c in corners]
    def walk(a, b):  # corners met going clockwise from perimeter position a to b
        res = []
        L = 2 * (BW + BH)
        for c, pc in sorted(zip(corners, cpos), key=lambda z: (z[1] - a) % L):
            if 0 < (pc - a) % L < (b - a) % L: res.append(list(c))
        return res
    s, e = line[0], line[-1]
    side1 = [list(p) for p in line] + walk(perim(e), perim(s))
    side2 = [list(p) for p in line[::-1]] + walk(perim(s), perim(e))
    def inside(pt, poly):
        x, y = pt; c = False
        for i in range(len(poly)):
            (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1: c = not c
        return c
    if attacker_zone:
        zc = (sum(p[0] for p in attacker_zone) / len(attacker_zone), sum(p[1] for p in attacker_zone) / len(attacker_zone))
    else:
        zc = (BW / 2, 1)
    return {'attacker': side1, 'defender': side2} if inside(zc, side1) else {'attacker': side2, 'defender': side1}

def main(folder):
    out = []
    files = sorted(f for f in os.listdir(folder) if f.endswith('.png'))
    for f in files:
        im = load(os.path.join(folder, f))
        xl, yt, xr, yb = board_box(im)
        sx, sy = (xr - xl) / BW, (yb - yt) / BH
        crop = im[yt:yb, xl:xr]
        m = classify(crop)
        P = lambda px, py: (round(px / sx, 2), round(py / sy, 2))  # pixel -> inches

        # --- terrain baseplates: base + hatch, holes filled, separated by black outlines
        # open field = background cream, its grid lines, and the deployment zone fills; everything else is terrain
        r_, g_, b_ = crop[..., 0], crop[..., 1], crop[..., 2]
        s_ = r_ + g_ + b_
        field = ((s_ >= 688) & (s_ < 742) & (r_ - b_ > 5)) | ((g_ - b_ >= 12) & (s_ > 450) & (r_ - g_ < 25)) | m['red'] | m['blue']
        field |= ((r_ > 110) & (r_ < 190) & (g_ < 120) & (r_ - g_ > 40)) | ((b_ - r_ > 15) & (b_ > g_) & (s_ < 420))
        field = ndimage.binary_opening(field, iterations=1)
        interior = ~field & ~m['dark'] & ~m['dash']
        interior = ndimage.binary_fill_holes(interior)
        interior = ndimage.binary_opening(interior, iterations=2)
        lab, n = ndimage.label(interior)
        # merge fragments split by a thin outline (diagonal joins, wall boxes across a plate) when together they fill a rectangle
        comps = {}
        for i in range(1, n + 1):
            ys, xs = np.where(lab == i)
            if len(xs) >= 0.5 * sx * sy:
                comps[i] = {'n': len(xs), 'box': [xs.min(), ys.min(), xs.max(), ys.max()], 'ids': {i}}
        gap = int(0.35 * sx) + 1
        changed = True
        while changed:
            changed = False
            keys = list(comps)
            for a_i in range(len(keys)):
                for b_i in range(a_i + 1, len(keys)):
                    A, B = comps.get(keys[a_i]), comps.get(keys[b_i])
                    if not A or not B: continue
                    ba, bb = A['box'], B['box']
                    if ba[0] - gap > bb[2] or bb[0] - gap > ba[2] or ba[1] - gap > bb[3] or bb[1] - gap > ba[3]:
                        continue
                    ub = [min(ba[0], bb[0]), min(ba[1], bb[1]), max(ba[2], bb[2]), max(ba[3], bb[3])]
                    area = (ub[2] - ub[0] + 1) * (ub[3] - ub[1] + 1)
                    if A["n"] + B["n"] >= 0.78 * area:
                        A['n'] += B['n']; A['box'] = ub; A['ids'] |= B['ids']; del comps[keys[b_i]]; changed = True
        cand = []
        for c in comps.values():
            if c['n'] < 1.0 * sx * sy:
                continue
            x0, y0, x1, y1 = c['box']
            sub = np.isin(lab[y0:y1 + 1, x0:x1 + 1], list(c['ids']))
            ys, xs = np.where(sub)
            xs, ys = xs + x0, ys + y0
            a = min_rect_angle(xs, ys)
            R, u0, v0, cc, ss = rotated(xs.astype(float), ys.astype(float), a)
            rows, cols = R.sum(1), R.sum(0)
            rk = np.where(rows >= rows.max() * 0.55)[0]
            ck = np.where(cols >= cols.max() * 0.55)[0]
            corners = [(ck.min(), rk.min()), (ck.max() + 1, rk.min()), (ck.max() + 1, rk.max() + 1), (ck.min(), rk.max() + 1)]
            poly = [P(*unrot(u, v, u0, v0, cc, ss)) for u, v in corners]
            w_in, h_in = (ck.max() + 1 - ck.min()) / sx, (rk.max() + 1 - rk.min()) / sy
            fill = R.sum() / max(1, R.shape[0] * R.shape[1])
            if fill < 0.8 and w_in * h_in > 6:
                pts_ = np.c_[xs, ys].astype(float)
                if len(pts_) > 6000: pts_ = pts_[np.random.default_rng(1).choice(len(pts_), 6000, replace=False)]
                hull = pts_[ConvexHull(pts_).vertices]
                hull_in = np.c_[hull[:, 0] / sx, hull[:, 1] / sy]
                simp = dp_closed(hull_in, 0.7)
                if 3 <= len(simp) <= 8:
                    poly = [(float(x), float(y)) for x, y in simp]
            cand.append({'poly': poly, 'w': w_in, 'h': h_in, 'n': c['n'], 'angle': a})
        # drop fragments that sit inside a bigger plate (wall boxes, rubble)
        cand.sort(key=lambda c: -c['n'])
        pieces = []
        def pip(pt, poly):
            x, y = pt; inside = False
            for i in range(len(poly)):
                (x1_, y1_), (x2_, y2_) = poly[i], poly[(i + 1) % len(poly)]
                if (y1_ > y) != (y2_ > y) and x < (x2_ - x1_) * (y - y1_) / (y2_ - y1_ + 1e-12) + x1_: inside = not inside
            return inside
        def grow(poly, d):
            cx = sum(p[0] for p in poly) / len(poly); cy = sum(p[1] for p in poly) / len(poly)
            out_ = []
            for x, y in poly:
                L_ = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 or 1
                out_.append((x + (x - cx) / L_ * d, y + (y - cy) / L_ * d))
            return out_
        for c in cand:
            if min(c['w'], c['h']) < 0.8 or max(c['w'], c['h']) < 1.5:
                continue
            cx = sum(p[0] for p in c['poly']) / len(c['poly']); cy = sum(p[1] for p in c['poly']) / len(c['poly'])
            if any(pip((cx, cy), grow(p['poly'], 0.6)) for p in pieces):
                continue
            pieces.append({'poly': [[round(x * 4) / 4, round(y * 4) / 4] for x, y in c['poly']], 'walls': [], 'obstacles': []})

        # --- wall / obstacle segments from coloured strokes
        def segments(mask, min_len):
            res = []
            lab2, n2 = ndimage.label(ndimage.binary_closing(mask, iterations=1))
            thick = max(3, int(0.6 * sx))
            for i in range(1, n2 + 1):
                ys, xs = np.where(lab2 == i)
                if len(xs) < 20:
                    continue
                a = min_rect_angle(xs, ys)
                R, u0, v0, cc, ss = rotated(xs.astype(float), ys.astype(float), a)
                for axis in (0, 1):
                    S = R if axis == 0 else R.T
                    runs = []
                    for ri, row in enumerate(S):
                        idx = np.where(row)[0]
                        if not len(idx): continue
                        br = np.where(np.diff(idx) > 2)[0]
                        starts = np.r_[idx[0], idx[br + 1]]
                        ends = np.r_[idx[br], idx[-1]]
                        for s0, e0 in zip(starts, ends):
                            if (e0 - s0) >= min_len * sx:
                                runs.append((ri, s0, e0))
                    runs.sort()
                    groups = []
                    for r in runs:
                        for g in groups:
                            if r[0] - g['r1'] <= 2 and not (r[2] < g['s'] or r[1] > g['e']):
                                g['r1'] = r[0]; g['s'] = min(g['s'], r[1]); g['e'] = max(g['e'], r[2]); break
                        else:
                            groups.append({'r0': r[0], 'r1': r[0], 's': r[1], 'e': r[2]})
                    for g in groups:
                        if g['r1'] - g['r0'] > thick * 2.5:
                            continue
                        mid = (g['r0'] + g['r1']) / 2
                        if axis == 0:
                            p1, p2 = (g['s'], mid), (g['e'], mid)
                        else:
                            p1, p2 = (mid, g['s']), (mid, g['e'])
                        A_ = P(*unrot(p1[0], p1[1], u0, v0, cc, ss)); B_ = P(*unrot(p2[0], p2[1], u0, v0, cc, ss))
                        res.append([round(A_[0] * 4) / 4, round(A_[1] * 4) / 4, round(B_[0] * 4) / 4, round(B_[1] * 4) / 4])
            return res

        def assign(segs, key):
            for s in segs:
                c_ = ((s[0] + s[2]) / 2, (s[1] + s[3]) / 2)
                hit = [p for p in pieces if pip(c_, grow(p['poly'], 0.9))]
                if hit:
                    area = lambda q: abs(sum(q[i][0] * q[(i + 1) % len(q)][1] - q[(i + 1) % len(q)][0] * q[i][1] for i in range(len(q)))) / 2
                    hit.sort(key=lambda p: area(p['poly']))
                    hit[0][key].append(s)

        assign(segments(m['green'], 1.0), 'walls')
        assign(segments(m['orange'], 0.8), 'obstacles')

        # --- objectives: white discs with a coloured icon
        objs = []
        lab3, n3 = ndimage.label(ndimage.binary_closing(m['white'], iterations=2))
        for i in range(1, n3 + 1):
            ys, xs = np.where(lab3 == i)
            w_, h_ = (xs.max() - xs.min()) / sx, (ys.max() - ys.min()) / sy
            if not (1.6 <= w_ <= 3.6 and 1.6 <= h_ <= 3.6 and abs(w_ - h_) < 0.5):
                continue
            x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
            box = crop[y0:y1 + 1, x0:x1 + 1]
            bm = classify(box)
            red, blue, dark = bm['red'].sum(), bm['blue'].sum(), bm['dark'].sum()
            teal = ((box[..., 1] > 85) & (box[..., 2] > 85) & (box[..., 0] < 90) & (abs(box[..., 1] - box[..., 2]) < 40)).sum()
            cx, cy = P((x0 + x1) / 2, (y0 + y1) / 2)
            kinds = {'home-attacker': red, 'home-defender': blue, 'expansion': teal, 'central': dark}
            kind = max(kinds, key=kinds.get)
            if kinds[kind] < 15:
                continue
            objs.append({'type': 'home' if kind.startswith('home') else kind, 'owner': kind.split('-')[1] if kind.startswith('home') else None,
                         'x': round(cx * 2) / 2, 'y': round(cy * 2) / 2})

        # --- deployment zones on a half-inch grid
        G = 2
        gw, gh = int(BW * G), int(BH * G)
        lbl = np.zeros((gh, gw), dtype=int)  # 0 unknown, 1 red, 2 blue, 3 open
        for gy in range(gh):
            for gx in range(gw):
                px, py = int((gx + 0.5) / G * sx), int((gy + 0.5) / G * sy)
                patch = slice(max(0, py - 3), py + 4), slice(max(0, px - 3), px + 4)
                rr, bb = m['red'][patch].mean(), m['blue'][patch].mean()
                bg = ((crop[patch][..., 0] > 228) & (crop[patch].sum(2) > 690) & (crop[patch].sum(2) < 742)).mean()
                if rr > 0.5: lbl[gy, gx] = 1
                elif bb > 0.5: lbl[gy, gx] = 2
                elif bg > 0.5: lbl[gy, gx] = 3
        def depth_profile(code, edge):
            """For each line perpendicular to `edge`, how deep the zone reaches; hidden boundaries copied from the nearest clear line."""
            L = lbl if edge in ('top', 'bottom') else lbl.T
            if edge in ('bottom', 'right'):
                L = L[::-1]
            n_lines, n_depth = L.shape[1], L.shape[0]
            exact, rng = {}, {}
            for c in range(n_lines):
                col = L[:, c]
                last = -1
                first_other = n_depth
                for d in range(n_depth):
                    if col[d] == code: last = d
                    elif col[d] in (1, 2, 3) and col[d] != code:
                        first_other = d; break
                rng[c] = (last + 1, first_other)
                if first_other == last + 1: exact[c] = last + 1
            prof = []
            for c in range(n_lines):
                if c in exact: prof.append(exact[c]); continue
                if not exact: prof.append(rng[c][0]); continue
                near = min(exact, key=lambda e: (abs(e - c), e))
                lo, hi = rng[c]
                prof.append(min(max(exact[near], lo), hi))
            return prof

        def zone_poly(code):
            # which edge does this zone touch most?
            edges = {'top': (lbl[0] == code).mean(), 'bottom': (lbl[-1] == code).mean(), 'left': (lbl[:, 0] == code).mean(), 'right': (lbl[:, -1] == code).mean()}
            edge = max(edges, key=edges.get)
            prof = depth_profile(code, edge)
            prof = [int(v) for v in ndimage.median_filter(np.array(prof), size=7, mode='nearest')]
            mask = np.zeros_like(lbl, dtype=bool)
            for c, d in enumerate(prof):
                if edge == 'top': mask[:d, c] = True
                elif edge == 'bottom': mask[gh - d:, c] = True
                elif edge == 'left': mask[c, :d] = True
                else: mask[c, gw - d:] = True
            return mask, edge

        def trace(mask):
            """Rectilinear outer boundary of the largest region in a cell mask, in inches."""
            labm, nm = ndimage.label(mask)
            if nm == 0: return []
            sizes = ndimage.sum(mask, labm, range(1, nm + 1))
            mask = labm == (1 + int(np.argmax(sizes)))
            edges = {}
            H_, W_ = mask.shape
            for y in range(H_):
                for x in range(W_):
                    if not mask[y, x]: continue
                    if y == 0 or not mask[y - 1, x]: edges[(x, y)] = (x + 1, y)
                    if x == W_ - 1 or not mask[y, x + 1]: edges[(x + 1, y)] = (x + 1, y + 1)
                    if y == H_ - 1 or not mask[y + 1, x]: edges[(x + 1, y + 1)] = (x, y + 1)
                    if x == 0 or not mask[y, x - 1]: edges[(x, y + 1)] = (x, y)
            start = min(edges)
            pts = [start]
            cur = edges[start]
            while cur != start and len(pts) < 100000:
                pts.append(cur); cur = edges[cur]
            # drop collinear points
            outp = []
            for i, p in enumerate(pts):
                a, c = pts[i - 1], pts[(i + 1) % len(pts)]
                if (p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0]) != 0:
                    outp.append([p[0] / G, p[1] / G])
            return outp

        ma, edge_a = zone_poly(1)
        md, edge_d = zone_poly(2)
        zones = {'attacker': trace(ma), 'defender': trace(md)}

        # --- territory split from the dashed line (fallback: horizontal centre line)
        bg_only = (s_ >= 688) & (s_ < 742) & (r_ - b_ > 5)
        open_frac = ndimage.uniform_filter(bg_only.astype(float), size=15)
        ys, xs = np.where(m['dash'] & (open_frac > 0.6))
        pts = np.c_[xs / sx, ys / sy] if len(xs) else np.zeros((0, 2))
        if len(pts):  # layouts are point-symmetric: the mirrored dashes fill gaps hidden by terrain
            pts = np.vstack([pts, np.c_[BW - pts[:, 0], BH - pts[:, 1]]])
        line = None
        if len(pts) > 30:
            # straight line through the centre fits most layouts: try it first (robust angle by median of point bearings)
            cx_, cy_ = BW / 2, BH / 2
            far = np.hypot(pts[:, 0] - cx_, pts[:, 1] - cy_) > 3
            if far.sum() > 20:
                ang = np.arctan2(pts[far, 1] - cy_, pts[far, 0] - cx_) % np.pi
                # circular median on the doubled angle
                a2 = np.angle(np.median(np.cos(2 * ang)) + 1j * np.median(np.sin(2 * ang))) / 2
                d = np.abs(-(pts[:, 0] - cx_) * np.sin(a2) + (pts[:, 1] - cy_) * np.cos(a2))
                if (d < 0.6).mean() > 0.8:
                    dx_, dy_ = np.cos(a2), np.sin(a2)
                    # extend to the board edges
                    ts = []
                    for tt in ((0 - cx_) / dx_ if abs(dx_) > 1e-6 else None, (BW - cx_) / dx_ if abs(dx_) > 1e-6 else None,
                               (0 - cy_) / dy_ if abs(dy_) > 1e-6 else None, (BH - cy_) / dy_ if abs(dy_) > 1e-6 else None):
                        if tt is None: continue
                        x_, y_ = cx_ + dx_ * tt, cy_ + dy_ * tt
                        if -1e-6 <= x_ <= BW + 1e-6 and -1e-6 <= y_ <= BH + 1e-6: ts.append(tt)
                    t0, t1 = min(ts), max(ts)
                    line = [[round(cx_ + dx_ * t0, 2), round(cy_ + dy_ * t0, 2)], [round(cx_ + dx_ * t1, 2), round(cy_ + dy_ * t1, 2)]]
        if line is None and len(pts) > 30:
            spread_x, spread_y = np.ptp(pts[:, 0]), np.ptp(pts[:, 1])
            horiz = spread_x >= spread_y
            a_, b_ = (pts[:, 0], pts[:, 1]) if horiz else (pts[:, 1], pts[:, 0])
            span = BW if horiz else BH
            bins = np.arange(0, span + 2, 2)
            centres, vals = [], []
            for i in range(len(bins) - 1):
                sel = (a_ >= bins[i]) & (a_ < bins[i + 1])
                if sel.sum() >= 3:
                    centres.append((bins[i] + bins[i + 1]) / 2); vals.append(float(np.median(b_[sel])))
            if len(centres) >= 3:
                vals = list(ndimage.median_filter(np.array(vals), size=3, mode='nearest'))
                grid_a = np.linspace(0, span, int(span) + 1)
                grid_b = np.interp(grid_a, centres, vals)
                poly = np.c_[grid_a, grid_b] if horiz else np.c_[grid_b, grid_a]
                def dp(P_, eps):
                    if len(P_) < 3: return P_
                    a0, b0 = P_[0], P_[-1]
                    d = np.abs((b0 - a0)[0] * (P_ - a0)[:, 1] - (b0 - a0)[1] * (P_ - a0)[:, 0]) / (np.linalg.norm(b0 - a0) + 1e-9)
                    i = int(np.argmax(d))
                    if d[i] > eps: return np.vstack([dp(P_[:i + 1], eps)[:-1], dp(P_[i:], eps)])
                    return np.vstack([a0, b0])
                line = [[round(float(x), 2), round(float(y), 2)] for x, y in dp(poly, 0.8)]
        if line is None:
            line = [[0, BH / 2], [BW, BH / 2]]

        name = f[:-4].replace('-portrait', '')
        # matchup from the file name: <a>-mirror-<n> or <a>-vs-<b>-<n>
        base, num = name.rsplit('-', 1)
        if base.endswith('-mirror'):
            matchup = [base[:-7], base[:-7]]
        else:
            a_, b_ = base.split('-vs-')
            matchup = [a_, b_]
        # deployment card from the territory line (each card has its own split)
        (lx0, ly0), (lx1, ly1) = line[0], line[-1]
        key = tuple(sorted([(round(lx0), round(ly0)), (round(lx1), round(ly1))]))
        deployment = {((0, 45), (44, 15)): 'crucible-of-battle', ((0, 34), (44, 26)): 'tipping-point', ((19, 60), (25, 0)): 'sweeping-engagement',
                      ((0, 60), (44, 0)): 'search-and-destroy', ((22, 0), (22, 60)): 'dawn-of-war', ((0, 30), (44, 30)): 'hammer-and-anvil'}.get(key, 'unknown')
        territory = split_board(line, zones['attacker'])
        out.append({'file': f, 'id': name, 'matchup': matchup, 'number': int(num), 'deployment': deployment, 'territory': territory, 'attackerEdge': edge_a, 'defenderEdge': edge_d, 'pieces': pieces, 'objectives': objs, 'zones': zones, 'territoryLine': line})
        print(f, len(pieces), 'pieces', len(objs), 'objs', sum(len(p['walls']) for p in pieces), 'walls', file=sys.stderr)
    json.dump(out, sys.stdout, indent=1)

if __name__ == '__main__':
    main(sys.argv[1])
