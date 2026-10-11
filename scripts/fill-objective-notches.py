#!/usr/bin/env python3
"""Fill the notch the tracer cut into terrain footprints under an objective icon (data/layouts.json; idempotent).

The objective icon drawn on a ruin was traced as a bite out of the footprint (about 5 sq in). Each footprint that
touches an objective is closed (grown then shrunk by 2", square joins keep its corners), which fills bites narrower
than 4" and leaves the outline otherwise as it was.

Usage: python3 scripts/fill-objective-notches.py   (needs shapely)
"""
import json
from shapely.geometry import Point, Polygon

PATH = 'data/layouts.json'


def r(v):
    return round(v * 4) / 4


def main():
    data = json.load(open(PATH))
    fixed = 0
    for l in data['layouts']:
        for t in l['terrain']:
            dict_pts = isinstance(t['poly'][0], dict)
            pts = [(p['x'], p['y']) for p in t['poly']] if dict_pts else [tuple(p) for p in t['poly']]
            P = Polygon(pts)
            if not P.is_valid:
                P = P.buffer(0)
            if not any(P.distance(Point(o['x'], o['y'])) < 1.5 for o in l['objectives']):
                continue
            C = P.buffer(2, join_style=2).buffer(-2, join_style=2).simplify(0.05)
            if C.geom_type != 'Polygon' or C.area - P.area < 1:
                continue
            out = [(r(x), r(y)) for x, y in list(C.exterior.coords)[:-1]]
            t['poly'] = [{'x': x, 'y': y} for x, y in out] if dict_pts else [[x, y] for x, y in out]
            fixed += 1
    json.dump(data, open(PATH, 'w'), separators=(',', ':'))
    print(f'filled {fixed} footprints')


if __name__ == '__main__':
    main()
