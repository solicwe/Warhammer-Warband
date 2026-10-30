// A long list of whole loadouts (the Lieutenant's 27) is picked weapon by weapon: each row offers only what a legal
// loadout allows after the weapons before it.
import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ArmyUnitEntry, FactionData } from '../engine/types';
import { WargearEditor } from './ArmyBuilder';

const SM = JSON.parse(fs.readFileSync('public/data/factions/SM.json', 'utf8')) as FactionData;
const lt = SM.datasheets.find((d) => d.name === 'Lieutenant')!;
const oi = lt.wargearOptions!.findIndex((o) => o.choices.length > 8);
const chips = (html: string) => [...html.matchAll(/<div class="wg-chips">(.*?)<\/div>/g)].map((m) => [...m[1].matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((b) => b[1]));
const unit = (choice?: number): ArmyUnitEntry => ({ uid: 'u', datasheet: 'Lieutenant', models: 1, pts: 0, wargear: choice === undefined ? [] : [{ opt: oi, choice, count: 1 }] });

it('the Lieutenant picks pistol, then weapons, then a shield, not from 28 buttons', () => {
  const rows = chips(renderToStaticMarkup(<WargearEditor sheet={lt} u={unit()} onChange={() => {}} />));
  expect(rows[0]).toEqual(['Bolt Pistol', 'Heavy Bolt Pistol', 'Neo-volkite Pistol']);
  expect(rows.every((r) => r.length <= 5)).toBe(true);
  expect(rows.flat()).not.toContain('Storm Shield');
  // with the Neo-volkite Pistol and a Master-crafted Power Weapon the shield can be taken
  const nv = lt.wargearOptions![oi].choices.findIndex((c) => c[0] === 'Neo-volkite Pistol' && c.length === 3 && c[2] === 'Ceramite Fists');
  const nvRows = chips(renderToStaticMarkup(<WargearEditor sheet={lt} u={unit(nv)} onChange={() => {}} />));
  expect(nvRows.flat()).toContain('Storm Shield');
  expect(nvRows.flat()).not.toContain('Master-crafted Bolter');
});
