import fs from 'node:fs';
import { expect, it } from 'vitest';
import { autoApproach, createGame, findPlacement, placeUnit, validateMove } from './game';
import { PRESETS } from '../ui/presets';
import { alive } from './state';
const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));
it('auto charge never ends in walls', () => {
  const SM = load('SM'), ORK = load('ORK');
  let fails = 0;
  for (let seed = 1; seed < 60; seed++) {
    const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [SM, ORK], names: ['a', 'b'], deploymentId: 'hammer-and-anvil', primaryId: 'battlefield-dominance', seed });
    const boyz = s.units.find((u) => u.owner === 1)!;
    const caps = s.units.find((u) => u.owner === 0)!;
    const p1 = findPlacement(s, caps, 'deepStrike', { x: 10 + (seed % 25), y: 22 });
    if (!p1) continue; placeUnit(s, caps, p1);
    const p2 = findPlacement(s, boyz, 'deepStrike', { x: 10 + (seed % 25), y: 34 });
    if (!p2) { continue; }
    placeUnit(s, boyz, p2);
    boyz.chargeRoll = 12;
    const paths = autoApproach(s, boyz, [caps], 12);
    for (const m of alive(boyz)) if (!paths.has(m.id)) paths.set(m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y }]);
    const chk = validateMove(s, boyz, 'charge', paths, { targets: [caps.id] });
    const wall = chk.errors.find((e) => e.includes('กำแพง'));
    if (wall) fails++;
  }
  expect(fails).toBe(0);
});
