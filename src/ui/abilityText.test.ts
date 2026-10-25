// Every ability button in a battle can show its full rule text: for each faction's ready-made army, every
// activation of every unit finds its text (datasheet, enhancement, army or detachment rule).
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame } from '../engine/game';
import { actsOfUnit } from '../rules-engine/activations';
import { abilityRuleText } from './RuleText';
import { PRESETS } from './presets';
import type { FactionData } from '../engine/types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;

it('finds the rule text of every ability button', () => {
  const missing: string[] = [];
  for (const F of Object.keys(PRESETS)) {
    const opp = F === 'SM' ? 'ORK' : 'SM';
    const s = createGame({ lists: [PRESETS[F], PRESETS[opp]], factions: [load(F), load(opp)], names: ['A', 'B'], seed: 1 });
    for (const u of s.units.filter((x) => x.owner === 0)) for (const d of actsOfUnit(s, u, true)) {
      if (!abilityRuleText(s, d.holder, d.name).trim()) missing.push(`${F} ${u.name}: ${d.name}`);
    }
  }
  expect(missing).toEqual([]);
});
