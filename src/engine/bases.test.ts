// Oval bases and vehicle hulls: measured edge to edge along their real shape, turned to their facing.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { baseShape } from './army';
import { bodyAt, contactAt, gap, onTable, ptGap } from './geometry';
import type { FactionData } from './types';

const QI = JSON.parse(fs.readFileSync('public/data/factions/QI.json', 'utf8')) as FactionData;

describe('non-round bases', () => {
  const knight = { x: 20, y: 20, ...baseShape(QI.datasheets.find((d) => d.name === 'Knight Paladin')!, 0), rot: 0 };
  it('a Knight stands on a 170 × 109mm oval: 3.35" long, 2.15" wide (half-lengths)', () => {
    expect(knight.hl! + knight.hw!).toBeCloseTo(170 / 25.4 / 2, 2);
    expect(knight.hw).toBeCloseTo(109 / 25.4 / 2, 2);
  });
  it('distance is measured to the nearest edge: further off its side than off its end', () => {
    const end = { x: 20 + 3.35 + 1, y: 20 }, side = { x: 20, y: 20 + 2.15 + 1 };
    expect(ptGap(knight, end)).toBeCloseTo(1, 1);
    expect(ptGap(knight, side)).toBeCloseTo(1, 1);
    const marine = { x: 20, y: 20 + 2.15 + 0.63 + 0.5, r: 0.63 };
    expect(gap(knight, marine)).toBeCloseTo(0.5, 2);
    expect(gap({ ...knight, rot: Math.PI / 2 }, marine)).toBeLessThan(0); // turned: the Knight's end now overlaps it
  });
  it('base-to-base contact from any angle', () => {
    const m = { x: 0, y: 0, r: 0.63 };
    for (const a of [0, 0.7, Math.PI / 2, 2.5]) expect(gap(bodyAt(m, contactAt(m, knight, a, 0.02)), knight)).toBeCloseTo(0.02, 2);
  });
  it('the whole hull must be on the table', () => {
    expect(onTable({ ...knight, x: 2.5 }, 60, 44)).toBe(false); // its end pokes over the edge
    expect(onTable({ ...knight, x: 2.5, rot: Math.PI / 2 }, 60, 44)).toBe(true); // turned, it fits
  });
});
