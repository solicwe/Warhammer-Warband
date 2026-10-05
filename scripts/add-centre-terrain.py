#!/usr/bin/env python3
"""Give a centre ruin to the layouts whose centre objective was left in the open (data/layouts.json; idempotent).

The tracer lost the centre piece of a few layouts (only the objective icon was picked up, and that was dropped as a
fake piece by fix-layout-centres.py). The official maps have terrain on the centre objective, so these get a
6" x 7.5" ruin centred on it, point-symmetric like the rest of the layout: ruin walls on one corner, barricades on
the opposite pair.

Usage: python3 scripts/add-centre-terrain.py
"""
import json

PATH = 'data/layouts.json'


def inside(x, y, poly):
    ins, j = False, len(poly) - 1
    for i in range(len(poly)):
        (ax, ay), (bx, by) = poly[i], poly[j]
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            ins = not ins
        j = i
    return ins


def centre_ruin(cx, cy):
    w, h = 3.0, 3.75
    x0, x1, y0, y1 = cx - w, cx + w, cy - h, cy + h
    e = 0.25
    return {
        'poly': [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
        'walls': [[x0 + e, y0 + e, cx, y0 + e], [x0 + e, y0 + e, x0 + e, cy - 1],
                  [x1 - e, y1 - e, cx, y1 - e], [x1 - e, y1 - e, x1 - e, cy + 1]],
        'obstacles': [[x1 - e, y0 + e, cx + 1, y0 + e], [x1 - e, y0 + e, x1 - e, cy - 2],
                      [x0 + e, y1 - e, cx - 1, y1 - e], [x0 + e, y1 - e, x0 + e, cy + 2]],
    }


def main():
    data = json.load(open(PATH))
    n = 0
    for l in data['layouts']:
        for o in l['objectives']:
            if o['type'] != 'central' or any(inside(o['x'], o['y'], t['poly']) for t in l['terrain']):
                continue
            l['terrain'].append(centre_ruin(o['x'], o['y']))
            n += 1
            print(f"{l['id']}: centre ruin added at ({o['x']}, {o['y']})")
    with open(PATH, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'{n} centre ruins added')


if __name__ == '__main__':
    main()
