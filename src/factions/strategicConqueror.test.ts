// Strategic Conqueror (T'au enhancement): a person is asked for an objective at the start of the battle, a bot picks one;
// friendly T'AU EMPIRE units in range of it get +1 OC while the bearer lives.
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, formationAt, placeUnit } from '../engine/game';
import { ocOf } from '../rules-engine/effects';
import { alive } from '../engine/state';
import { botConqueror, conquerorStart, setConqueror } from './tau';
import type { FactionData } from '../engine/types';

const tau = JSON.parse(fs.readFileSync('public/data/factions/TAU.json', 'utf8')) as FactionData;
const list = { name: 't', factionId: 'TAU', battleSize: 'incursion' as const, detachments: ['Mont’ka'], units: [
  { uid: 'a', datasheet: 'Commander Farsight', models: 1, pts: 90 },
  { uid: 'b', datasheet: 'Strike Team', models: 10, pts: 70 },
] };

it('asks a person, picks for a bot, and gives +1 OC near the picked objective', () => {
  const l = JSON.parse(JSON.stringify(list));
  const sheet = tau.datasheets.find((d) => d.keywords.includes('CHARACTER') && !d.keywords.includes('EPIC HERO'))!;
  l.units[0] = { uid: 'a', datasheet: sheet.name, models: 1, pts: 90, enhancement: 'Strategic Conqueror' };
  const s = createGame({ lists: [l, l], factions: [tau, tau], names: ['A', 'B'], seed: 1 });
  s.bots = [1];
  const bearer = s.units.find((u) => u.owner === 0 && u.enhancements.some((e) => e.name === 'Strategic Conqueror'));
  expect(bearer).toBeTruthy();
  conquerorStart(s);
  expect(s.window?.kind).toBe('conqueror');
  expect(s.players[1].conqueror).toBeTruthy(); // the bot picked by itself
  const obj = s.objectives.find((o) => o.id === botConqueror(s, 0))!;
  setConqueror(s, 0, obj.id);
  expect(s.window).toBeNull();
  const fw = s.units.find((u) => u.owner === 0 && u.name === 'Strike Team')!;
  placeUnit(s, bearer!, formationAt(bearer!, { x: 5, y: 5 }));
  placeUnit(s, fw, formationAt(fw, { x: obj.x, y: obj.y + 4 }));
  s.phase = 'command'; s.round = 1;
  const near = ocOf(s, fw)(alive(fw)[0]);
  fw.models.forEach((m, i) => { m.x = 3 + i; m.y = 3; });
  const far = ocOf(s, fw)(alive(fw)[0]);
  expect(near).toBe(far + 1);
});
