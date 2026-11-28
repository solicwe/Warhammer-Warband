// Convergence of Dominion: each model becomes its own unit when first set up.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, formationAt, placeUnit } from './game';
import type { FactionData } from './types';

it('Convergence of Dominion splits into one-model units on set-up', () => {
  const nec = JSON.parse(fs.readFileSync('public/data/factions/NEC.json', 'utf8')) as FactionData;
  const sheet = nec.datasheets.find((d) => d.name === 'Convergence Of Dominion')!;
  const n = Math.max(2, sheet.composition?.[0]?.min ?? 3);
  const l = { name: 't', factionId: 'NEC', battleSize: 'incursion' as const, detachments: [], units: [{ uid: 'a', datasheet: sheet.name, models: n, pts: 90 }] };
  const s = createGame({ lists: [l, l], factions: [nec, nec], names: ['A', 'B'], seed: 1 });
  const u = s.units.find((x) => x.owner === 0 && x.name === sheet.name)!;
  const before = u.models.length;
  placeUnit(s, u, formationAt(u, { x: 30, y: 8 }));
  const parts = s.units.filter((x) => x.owner === 0 && x.name === sheet.name);
  expect(parts.length).toBe(before);
  expect(parts.every((p) => p.models.length === 1)).toBe(true);
});
