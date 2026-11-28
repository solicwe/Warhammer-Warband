// Aerial Seeding (Genestealer Cults): the carrier arrives from battle round 1; its passengers get out at once, more than 8" from enemies (dropPodAssault in game.ts).
import fs from 'node:fs';
import { expect, it } from 'vitest';

it('both Aerial Seeding entries are automated and let the carrier arrive from round 1', () => {
  const d = JSON.parse(fs.readFileSync('data/abilities/GC.json', 'utf8'));
  for (const k of ['Aerial Seeding', 'Aerial Seeding@Tyrannocyte']) {
    expect(d[k].status).toBe('auto');
    expect(d[k].effects).toEqual([{ arriveFromRound: 1 }]);
  }
  expect(fs.readFileSync('src/engine/game.ts', 'utf8')).toContain("unitHasAbility(u, 'Aerial Seeding')");
});

it('the Genestealer Cults detachment rules are shown as automated', () => {
  const d = JSON.parse(fs.readFileSync('data/abilities/GC.json', 'utf8'));
  for (const k of ['Hypermorphic Fury', 'Unquestioning Fanaticism', 'Rapid Takeover', 'Enemy Within', 'Hordes of the Faithful']) expect(d[k].code).toBe(true);
});
