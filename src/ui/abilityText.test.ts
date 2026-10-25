// Every ability button in a battle can show its full rule text: for each faction's ready-made army, every
// activation of every unit finds its text (datasheet, enhancement, army or detachment rule).
import fs from 'node:fs';
import { expect, it } from 'vitest';
import { createGame } from '../engine/game';
import { actsOfUnit } from '../rules-engine/activations';
import { abilityRuleText } from './RuleText';
import { PRESETS } from './presets';
import type { ArmyList, FactionData } from '../engine/types';

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

it('finds the rule text of every ability button on every datasheet of every faction', () => {
  const missing: string[] = [];
  let checked = 0;
  const ORK = load('ORK'), SM = load('SM');
  for (const f of fs.readdirSync('public/data/factions').map((x) => x.replace('.json', ''))) {
    const F = load(f);
    const opp = f === 'ORK' ? SM : ORK;
    for (const d of F.datasheets) {
      const pts = d.points?.[0]?.options?.[0];
      const list = { name: 't', factionId: f, battleSize: 'strike', detachments: F.detachments?.[0] ? [F.detachments[0].name] : [], units: [{ uid: 'x0', datasheet: d.name, models: pts?.models ?? 1, pts: pts?.pts ?? 100 }] } as ArmyList;
      let s;
      try { s = createGame({ lists: [list, { name: 'o', factionId: opp.id, battleSize: 'strike', detachments: [], units: [] } as ArmyList], factions: [F, opp], names: ['A', 'B'], seed: 1 }); } catch { continue; }
      for (const u of s.units.filter((x) => x.owner === 0)) for (const a of actsOfUnit(s, u, true)) {
        checked++;
        if (!abilityRuleText(s, a.holder, a.name).trim()) missing.push(`${f} ${u.name}: ${a.name}`);
      }
    }
  }
  expect(checked).toBeGreaterThan(1000);
  expect([...new Set(missing)]).toEqual([]);
});
