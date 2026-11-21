// Deathwatch Veterans take Wahapedia's wargear options (the pack listed fixed loadouts as model lines): the player
// picks weapons per model, and the battle models carry them. "Knives and Fists" is one weapon, not two, and "one of the
// following: 1 Boltgun and 1 Storm Shield, 1 Power Weapon and 1 Storm Shield" is two choices (build-data parser).
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { buildUnits, loadoutLines, wargearProblems } from './army';
import type { ArmyList, ArmyUnitEntry, FactionData } from './types';

const SM = JSON.parse(fs.readFileSync('public/data/factions/SM.json', 'utf8')) as FactionData;
const sheet = SM.datasheets.find((d) => d.name === 'Deathwatch Veterans')!;
const opt = (gain: string) => sheet.wargearOptions!.findIndex((o) => o.choices.some((c) => c.includes(gain)));
const entry = (wargear: ArmyUnitEntry['wargear']): ArmyUnitEntry => ({ uid: 'x', datasheet: sheet.name, models: 5, pts: 115, wargear });
const weapons = (e: ArmyUnitEntry) => buildUnits({ name: 't', factionId: 'SM', battleSize: 'strike', detachments: [], units: [e] } as ArmyList, SM, 0)[0].models.flatMap((m) => m.weapons.map((w) => w.name));

it('Deathwatch Veterans pick their weapons per model', () => {
  expect(loadoutLines(sheet)).toEqual([]);
  const e = entry([{ opt: opt('Heavy Thunder Hammer'), choice: 0, count: 2 }, { opt: opt('Xenophase Blade'), choice: 0, count: 1 }, { opt: opt('Frag Cannon'), choice: 0, count: 1 }]);
  expect(wargearProblems(sheet, e)).toEqual([]);
  const w = weapons(e);
  expect(w.filter((n) => /thunder hammer/i.test(n)).length).toBe(2);
  expect(w.some((n) => /xenophase/i.test(n))).toBe(true);
  expect(w.filter((n) => n === 'Knives and Fists').length).toBe(1);
  expect(weapons(entry([])).some((n) => /thunder hammer/i.test(n))).toBe(false);
});

it('a list of choices without bullets is split into choices', () => {
  const shield = sheet.wargearOptions!.find((o) => /Storm Shield/.test(o.text))!;
  expect(shield.choices).toEqual([['Boltgun', 'Storm Shield'], ['Power Weapon', 'Storm Shield']]);
});
