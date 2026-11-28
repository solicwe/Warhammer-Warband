// Fealty to the Lion (Lion El'Jonson): in the Movement phase the model goes into Reserves and can be set up again at once.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, formationAt, placeUnit, canIngress } from './game';
import { manualActs, useAct } from '../rules-engine/activations';
import type { FactionData } from './types';

it('the Lion can use Fealty to the Lion in the Movement phase and may arrive at once', () => {
  const sm = JSON.parse(fs.readFileSync('public/data/factions/SM.json', 'utf8')) as FactionData;
  const l = { name: 't', factionId: 'SM', battleSize: 'incursion' as const, detachments: [], units: [{ uid: 'a', datasheet: 'Lion El’jonson', models: 1, pts: 300 }] };
  const s = createGame({ lists: [l, l], factions: [sm, sm], names: ['A', 'B'], seed: 1 });
  const lion = s.units.find((u) => u.owner === 0)!;
  placeUnit(s, lion, formationAt(lion, { x: 30, y: 8 }));
  lion.setUpTurn = -10;
  s.phase = 'movement'; s.round = 2; s.active = 0;
  lion.abilityPicks = { pool: [], on: ["Fealty to the Lion"] };
  console.log(lion.abilities.map((a) => a.name).join(" | "));
  const act = manualActs(s, 0).find((m) => m.def.name.startsWith('Fealty to the Lion'));
  expect(act).toBeTruthy();
  expect(useAct(s, act!.def)).toBeNull();
  expect(lion.status).toBe('reserves');
  expect(canIngress(s, lion)).toBe(true);
});
