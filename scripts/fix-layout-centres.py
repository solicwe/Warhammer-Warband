#!/usr/bin/env python3
"""Clean up the centre of the traced layouts in data/layouts.json (run after extract-layouts.py; idempotent).

The tracer misreads two things around the board centre:
  * the centre-objective icon / centre-line marks become tiny fake terrain pieces (< 5 sq in);
  * a ruin that straddles the dashed centre line is split into two halves that meet under the objective,
    so the objective belongs to only one half.
This drops the fake pieces and merges pieces that meet under an objective into one terrain piece.

Usage: python3 scripts/fix-layout-centres.py   (needs shapely)
"""
import json
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

PATH = 'data/layouts.json'
TINY = 5.0  # sq in: smaller than any real terrain footprint


def r(v):
    return round(v * 4) / 4


def main():
    data = json.load(open(PATH))
    changed = 0
    for l in data['layouts']:
        objs = [Point(o['x'], o['y']) for o in l['objectives']]
        before = len(l['terrain'])
        l['terrain'] = [t for t in l['terrain']
                        if not (Polygon(t['poly']).area < TINY and min(Polygon(t['poly']).distance(p) for p in objs) < 4)]
        for p in objs:
            near = [t for t in l['terrain'] if Polygon(t['poly']).buffer(0).distance(p) < 0.5]
            if len(near) < 2:
                continue
            u = unary_union([Polygon(t['poly']).buffer(0.3, join_style=2) for t in near]).buffer(-0.3, join_style=2)
            if u.geom_type != 'Polygon':
                continue
            # the halves of one ruin: use its clean outline (a rectangle when the halves fill one)
            box = u.minimum_rotated_rectangle
            u = box if u.area / box.area > 0.8 else u.convex_hull
            merged = {'poly': [[r(x), r(y)] for x, y in list(u.exterior.coords)[:-1]],
                      'walls': [w for t in near for w in t['walls']],
                      'obstacles': [w for t in near for w in t['obstacles']]}
            l['terrain'] = [merged] + [t for t in l['terrain'] if t not in near]
        if len(l['terrain']) != before:
            changed += 1
            print(f"{l['id']}: {before} -> {len(l['terrain'])} pieces")
    with open(PATH, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'{changed} layouts changed')


if __name__ == '__main__':
    main()
