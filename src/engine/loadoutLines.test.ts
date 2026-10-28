// Deathwatch Veterans list each loadout as its own optional model line: the player picks how many take each,
// and the battle models carry those weapons (before, all five always took boltgun and power weapon).
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { buildUnits, distributeModels, loadoutLines } from './army';
import type { ArmyList, FactionData } from './types';

const SM = JSON.parse(fs.readFileSync('public/data/factions/SM.json', 'utf8')) as FactionData;
const sheet = SM.datasheets.find((d) => d.name === 'Deathwatch Veterans')!;
const list = (comp?: Record<string, number>): ArmyList => ({ name: 't', factionId: 'SM', battleSize: 'strike', detachments: [], units: [{ uid: 'x', datasheet: sheet.name, models: 5, pts: 115, comp }] });
const weapons = (l: ArmyList) => buildUnits(l, SM, 0)[0].models.flatMap((m) => m.weapons.map((w) => w.name));

it('Deathwatch Veterans pick their loadouts per model', () => {
  expect(loadoutLines(sheet).length).toBeGreaterThan(5);
  const comp = { 'Veteran w/ boltgun and power weapon': 2, 'Veteran w/ Deathwatch thunder hammer': 2, 'Sgt w/ boltgun and xenophase blade': 1 };
  expect(distributeModels(sheet, 5, comp).map((p) => [p.comp, p.count])).toEqual(Object.entries(comp));
  const w = weapons(list(comp));
  expect(w.filter((n) => /thunder hammer/i.test(n)).length).toBe(2);
  expect(w.some((n) => /xenophase/i.test(n))).toBe(true);
  expect(weapons(list()).some((n) => /thunder hammer/i.test(n))).toBe(false);
});

it('a split bigger than the unit is trimmed to its size', () => {
  const parts = distributeModels(sheet, 5, { 'Veteran w/ boltgun and power weapon': 4, 'Veteran w/ Deathwatch thunder hammer': 4 });
  expect(parts.reduce((a, p) => a + p.count, 0)).toBe(5);
});
