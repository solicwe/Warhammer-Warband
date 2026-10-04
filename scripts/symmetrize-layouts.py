#!/usr/bin/env python3
"""Make every layout in data/layouts.json point-symmetric about the board centre (run after fix-layout-centres.py; idempotent).

The official layouts are mirror images through the centre (22", 30"), but the tracer reads each half on its own:
  * one terrain piece (a container with its barricades) comes out as a box plus small slivers;
  * the two halves of the map get different wall lines.
It also closes the cracks at wall corners and marks sealed containers (walls on all four sides of a small box) with their footprint as `box`.
This merges slivers into the piece they touch, then for each pair of mirrored pieces keeps the better-traced one
(more wall/obstacle length) and rotates it onto the other half. A piece on the centre keeps the walls of its first half.

Usage: python3 scripts/symmetrize-layouts.py [in.json] [out.json]   (needs shapely)
"""
import json
import sys
from shapely.geometry import LineString, MultiPoint, Polygon
from shapely.ops import unary_union

W, H = 44.0, 60.0
SLIVER = 10.0  # sq in


def r(v):
    return round(v * 4) / 4


def rot(p):
    return [r(W - p[0]), r(H - p[1])]


def rot_seg(s):
    return rot(s[:2]) + rot(s[2:])


def poly(t):
    return Polygon(t['poly']).buffer(0)


def seg_len(ss):
    return sum(((s[2] - s[0]) ** 2 + (s[3] - s[1]) ** 2) ** 0.5 for s in ss)


def outline(g):
    if g.geom_type != 'Polygon':
        g = g.convex_hull
    g = g.simplify(0.2)
    return [[r(x), r(y)] for x, y in list(g.exterior.coords)[:-1]]


def merge_slivers(T):
    changed = True
    while changed:
        changed = False
        for i, t in enumerate(T):
            a = poly(t)
            if a.area >= SLIVER:
                continue
            near = [j for j in range(len(T)) if j != i and poly(T[j]).distance(a) < 0.6]
            if not near:
                continue
            j = min(near, key=lambda j: poly(T[j]).distance(a))
            u = unary_union([a.buffer(0.35, join_style=2), poly(T[j]).buffer(0.35, join_style=2)]).buffer(-0.35, join_style=2)
            T[j] = {'poly': outline(u), 'walls': T[j]['walls'] + t['walls'], 'obstacles': T[j]['obstacles'] + t['obstacles']}
            del T[i]
            changed = True
            break
    return T


def iou(a, b):
    u = a.union(b).area
    return a.intersection(b).area / u if u else 0


def symmetrize(T):
    P = [poly(t) for t in T]
    R = [Polygon([rot(p) for p in t['poly']]).buffer(0) for t in T]
    done, out = set(), []
    for i in range(len(T)):
        if i in done:
            continue
        j = max(range(len(T)), key=lambda j: iou(P[j], R[i]))
        if iou(P[j], R[i]) < 0.25 or j in done:
            out.append(T[i])  # no partner: keep as traced (and add its mirror if that spot is free)
            done.add(i)
            if all(R[i].distance(P[k]) > 0.5 for k in range(len(T))):
                out.append({'poly': [rot(p) for p in T[i]['poly']], 'walls': [rot_seg(s) for s in T[i]['walls']], 'obstacles': [rot_seg(s) for s in T[i]['obstacles']]})
            continue
        done |= {i, j}
        if i == j:  # on the centre: one half's walls + their mirror
            first = lambda s: (s[1] + s[3]) / 2 < H / 2 or ((s[1] + s[3]) / 2 == H / 2 and (s[0] + s[2]) / 2 < W / 2)
            g = unary_union([P[i], R[i]])
            ws = [s for s in T[i]['walls'] if first(s)]
            ob = [s for s in T[i]['obstacles'] if first(s)]
            out.append({'poly': outline(g) if iou(P[i], R[i]) < 0.9 else T[i]['poly'], 'walls': ws + [rot_seg(s) for s in ws], 'obstacles': ob + [rot_seg(s) for s in ob]})
            continue
        score = lambda k: seg_len(T[k]['walls']) * 2 + seg_len(T[k]['obstacles'])
        src = i if score(i) >= score(j) else j
        t = T[src]
        out.append(t)
        out.append({'poly': [rot(p) for p in t['poly']], 'walls': [rot_seg(s) for s in t['walls']], 'obstacles': [rot_seg(s) for s in t['obstacles']]})
    return out


def close_corners(t, gap=0.6):
    """Walls of one ruin that stop just short of each other (the tracer leaves ~0.25" at corners): move the end onto
    the other wall, so a line of sight can't slip through a crack that isn't on the real model."""
    from shapely.geometry import Point
    ws = t['walls']
    for i, w in enumerate(ws):
        for k in (0, 2):
            e = Point(w[k], w[k + 1])
            best = None
            for j, v in enumerate(ws):
                if j == i:
                    continue
                line = LineString([(v[0], v[1]), (v[2], v[3])])
                d = line.distance(e)
                if 0.01 < d <= gap and (best is None or d < best[0]):
                    best = (d, line.interpolate(line.project(e)))
            if best:
                w[k], w[k + 1] = round(best[1].x, 3), round(best[1].y, 3)


def container_box(t):
    """The footprint of a sealed container: walls closing all four sides of a small rectangle (else None)."""
    if len(t['walls']) < 3:
        return None
    ws = [LineString([(w[0], w[1]), (w[2], w[3])]) for w in t['walls']]
    rect = MultiPoint([c for w in ws for c in w.coords]).minimum_rotated_rectangle
    if rect.geom_type != 'Polygon' or rect.area > 20:
        return None
    cs = list(rect.exterior.coords)
    for a, b in zip(cs, cs[1:]):
        side = LineString([a, b])
        if sum(w.intersection(side.buffer(0.35)).length for w in ws) < 0.75 * side.length:
            return None
    return [[r(x), r(y)] for x, y in cs[:-1]]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'data/layouts.json'
    dst = sys.argv[2] if len(sys.argv) > 2 else src
    data = json.load(open(src))
    for l in data['layouts']:
        n = len(l['terrain'])
        if not l.get('symmetric'):
            l['symmetric'] = True
            l['terrain'] = symmetrize(merge_slivers(l['terrain']))
        for t in l['terrain']:
            close_corners(t)
            box = container_box(t)
            if box:
                t['box'] = box
            else:
                t.pop('box', None)
        print(f"{l['id']}: {n} -> {len(l['terrain'])} pieces")
    with open(dst, 'w') as f:
        json.dump(data, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
