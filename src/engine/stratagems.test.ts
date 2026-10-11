// Stratagem rules: hand-written ones in data/stratagems/<FACTION>.json load and point at real stratagems,
// and most Space Marine / Ork stratagems are played by the app.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stratRule, stratTargetOk } from './stratagems';
import type { FactionData, UnitState } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;

describe('stratagem rules data', () => {
  for (const id of ['SM', 'ORK']) {
    it(`${id}: every entry in data/stratagems/${id}.json names a stratagem of the faction`, () => {
      const f = load(id);
      const book = JSON.parse(fs.readFileSync(`data/stratagems/${id}.json`, 'utf8')).rules as Record<string, unknown>;
      const names = new Set(f.detachments.flatMap((d) => d.stratagems.flatMap((st) => [st.name, `${st.name}@${d.name}`])));
      expect(Object.keys(book).filter((k) => !names.has(k))).toEqual([]);
    });
    it(`${id}: most stratagems are played by the app`, () => {
      const f = load(id);
      const all = f.detachments.flatMap((d) => d.stratagems.map((st) => stratRule(st, id, d.name)));
      const done = all.filter((r) => r.status !== 'manual').length;
      expect(done / all.length).toBeGreaterThan(0.75);
    });
  }
  it('TARGET keywords: Hulking Brutes is for Nobz / Meganobz only', () => {
    const st = load('ORK').detachments.flatMap((d) => d.stratagems).find((x) => x.name === 'HULKING BRUTES')!;
    const u = (name: string, kws: string[]) => ({ keywords: kws, factionKeywords: ['ORKS'], sources: [name] }) as unknown as UnitState;
    expect(stratTargetOk(st, u('Nobz', ['INFANTRY', 'NOBZ']))).toBe(true);
    expect(stratTargetOk(st, u('Boyz', ['INFANTRY', 'BOYZ']))).toBe(false);
  });
});

describe('stratagems of any faction read from the card (no hand-written file needed)', () => {
  const card = (name: string, effect: string) => ({ id: name, name, cp: 1, type: 'Battle Tactic', turn: 'Your turn', phase: 'Fight phase', text: `WHEN: Fight phase.\nTARGET: One unit from your army.\nEFFECT: ${effect}` });
  it('fight on death, only targetable up close, Advance without a roll, critical hits on 5+, pile-in 6"', () => {
    const fx = (effect: string) => stratRule(card('X', effect)).effects ?? [];
    expect(fx('Until the end of the phase, each time a model in your unit is destroyed, if that model has not fought this phase, do not remove it from play. The destroyed model can fight after the attacking unit has finished making its attacks, and is then removed from play.')).toEqual([{ fightOnDeath: 1 }]);
    expect(fx('Until the end of the phase, each time a model in your unit is destroyed, if that model has not fought this phase, roll one D6. On a 4+, do not remove the destroyed model from play; it can fight after the attacking unit has finished making its attacks, and is then removed from play.')).toEqual([{ fightOnDeath: 4 }]);
    expect(fx('Until the end of the phase, your unit can only be selected as the target of a ranged attack if the attacking model is within 18".')).toEqual([{ targetableWithin: 18 }]);
    expect(fx('Until the end of the phase, if your unit Advances, do not make an Advance roll for it. Instead, until the end of the phase, add 6" to the Move characteristic of models in your unit.')).toEqual([{ advanceFixed: 6 }]);
    expect(fx('Until the end of the phase, each time a model in your unit makes an attack, an unmodified Hit roll of 5+ scores a Critical Hit.')[0]).toMatchObject({ critHitOn: 5 });
    expect(fx('Until the end of the phase, each time a model in your unit makes a Pile-in or Consolidation move, it can move up to 6" instead of up to 3".')).toEqual([{ pileIn: 6, consolidate: 6 }]);
    // the bot uses a +crit stratagem before attacking
    expect(stratRule(card('X', 'Until the end of the phase, each time a model in your unit makes an attack, an unmodified Hit roll of 5+ scores a Critical Hit.')).bot).toBe('attack');
  });
});
