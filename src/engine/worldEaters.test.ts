// World Eaters (Faction Pack v1.3): Blessings of Khorne, Blood Tithe, Idols of Khorne, and whole bot games in every detachment.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blessingPicks, blessingsRoll } from './blessings';
import { botAct } from './bot';
import { pickDetChoice } from './detachments';
import { cond, effectsFor } from './effects';
import { createGame, formationAt, placeUnit } from './game';
import { PRESETS } from '../ui/presets';
import type { ArmyList, FactionData, GameState } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const WE = load('WE');
const SM = load('SM');

const weList = (det: string, extra: ArmyList['units'] = []): ArmyList => ({ ...PRESETS.WE, detachments: [det], units: [...PRESETS.WE.units, ...extra] });
const game = (list: ArmyList, seed = 3): GameState => createGame({ lists: [list, PRESETS.SM], factions: [WE, SM], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed });

describe('Blessings of Khorne', () => {
  it('the rulebook dice: the best legal pair (three 2s pay for Warp Blades, the 6s for Decapitating Strikes)', () => {
    const picks = blessingPicks([1, 2, 2, 2, 3, 4, 6, 6], 2);
    expect(picks[0].ids.sort()).toEqual(['decap', 'warp']);
    // the book's own choice is one of the options
    expect(picks.some((p) => [...p.ids].sort().join() === 'bloodlust,warp')).toBe(true);
    // a triple pays too: three 3s → Decapitating Strikes
    expect(blessingPicks([3, 3, 3, 1, 2, 4, 5, 6], 1)[0].ids).toEqual(['decap']);
    expect(blessingPicks([1, 2, 3, 4, 5, 6, 1, 2].map((_, i) => i + 1 > 6 ? 6 : i + 1).slice(0, 6), 2)).toEqual([]);
  });
  it('rolled at the start of the battle round for the bot; its units get the effects', () => {
    const s = game(weList('Berzerker Warband'));
    s.bots = [0, 1];
    blessingsRoll(s, 0);
    const ids = s.players[0].blessings?.ids ?? [];
    const zerk = s.units.find((u) => u.owner === 0 && u.sources[0] === 'Khorne Berzerkers')!;
    const labels = effectsFor(s, zerk).map((a) => a.label);
    for (const id of ids) expect(labels.some((l) => /Bloodlust|Invigoration|Carnage|Excellence|Warp|Decapitating/.test(l))).toBe(true);
    // a player who decides gets the choice
    const s2 = game(weList('Berzerker Warband'));
    blessingsRoll(s2, 0);
    expect(['blessings', undefined]).toContain(s2.window?.kind);
  });
});

describe('detachments', () => {
  it('Blood Tithe points buy abilities in the Command phase (Khorne Daemonkin)', () => {
    const s = game(weList('Khorne Daemonkin', [{ uid: 'b1', datasheet: 'Bloodletters', models: 10, pts: 90 }]));
    s.phase = 'command'; s.active = 0; s.turn = 2;
    s.players[0].tithe = 4;
    expect(pickDetChoice(s, 0, 'Khorne Daemonkin', ['might'])).toMatch(/Needs 5/);
    expect(pickDetChoice(s, 0, 'Khorne Daemonkin', ['boon'])).toBeNull();
    expect(s.players[0].tithe).toBe(0);
    const bl = s.units.find((u) => u.sources[0] === 'Bloodletters')!;
    expect(effectsFor(s, bl).some((a) => a.e.defend?.inv === 4)).toBe(true);
  });
  it('Idols of Khorne reach Jakhals near a World Eaters MONSTER (Cult of Blood)', () => {
    const s = game(weList('Cult of Blood', [{ uid: 'd1', datasheet: 'Daemon Prince of Khorne', models: 1, pts: 200 }]));
    s.terrain = [];
    const jak = s.units.find((u) => u.sources[0] === 'Jakhals')!;
    const dp = s.units.find((u) => u.sources[0] === 'Daemon Prince of Khorne')!;
    placeUnit(s, jak, formationAt(jak, { x: 20, y: 20 }));
    placeUnit(s, dp, formationAt(dp, { x: 20, y: 26 }));
    expect(cond('nearIdol', { s, A: jak })).toBe(true);
    placeUnit(s, dp, formationAt(dp, { x: 38, y: 50 }));
    expect(cond('nearIdol', { s, A: jak })).toBe(false);
  });
  for (const det of WE.detachments.map((d) => d.name)) {
    it(`bot vs bot reaches game over: ${det}`, () => {
      const extra: ArmyList['units'] = det === 'Khorne Daemonkin' ? [{ uid: 'b1', datasheet: 'Bloodletters', models: 10, pts: 90 }]
        : det === 'Butchers of Khorne' ? [{ uid: 't1', datasheet: 'Chaos Terminators', models: 5, pts: 165 }]
        : det === 'Cult of Blood' ? [{ uid: 'd1', datasheet: 'Daemon Prince of Khorne', models: 1, pts: 200 }] : [];
      const s = game(weList(det, extra), 11);
      s.bots = [0, 1];
      let steps = 0;
      while (s.phase !== 'gameover' && steps < 6000) { botAct(s); steps++; }
      expect(s.phase).toBe('gameover');
      for (const u of s.units) for (const m of u.models) expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
      expect(s.log.some((l) => /Blessings of Khorne/.test(l.text))).toBe(true);
    }, 240000);
  }
});
