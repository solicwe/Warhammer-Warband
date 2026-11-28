// Chaos Daemons Pink Horrors use the same Split / Exploding Horrors machinery as the Thousand Sons ones.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame } from './game';
import type { FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
it('CD Pink Horrors get Split templates', () => {
  const cd = load('CD');
  const l = { name: 't', factionId: 'CD', battleSize: 'incursion' as const, detachments: [], units: [{ uid: 'a', datasheet: 'Pink Horrors', models: 10, pts: 120 }] };
  const s = createGame({ lists: [l, l], factions: [cd, cd], names: ['A', 'B'], seed: 1 });
  const u = s.units.find((x) => x.name === 'Pink Horrors')!;
  expect(u.abilities.some((a) => a.name === 'Split')).toBe(true);
  expect(u.templates?.length).toBeGreaterThan(0);
  const d = JSON.parse(fs.readFileSync('data/abilities/CD.json', 'utf8'));
  expect(d.Split.status).toBe('auto');
  expect(d['Exploding Horrors'].act.do[0].explodeModels.name).toBe('Brimstone');
});
