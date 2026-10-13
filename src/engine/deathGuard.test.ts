// Death Guard (Codex + Faction Pack v1.3): Contagion Range, Afflicted and the Plagues, the detachment rules that keep
// state, every ability and stratagem automatic, and whole bot games in every detachment.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildShootPools, targetToughness } from './attack';
import { botAct } from './bot';
import { abilityStatus, modelDefence, modelOc, unitFlags } from './effects';
import { buildUnits, validateList } from './army';
import { contagionRange, dgCommandEnd, dgCommandStart, dgRoundStart, isAfflicted, plaguesOn } from './deathGuard';
import { pickDetChoice } from './detachments';
import { createGame, formationAt, nudgePlacement, placeUnit, validatePlacement } from './game';
import { stratRuleFor } from './stratagems';
import { PRESETS } from '../ui/presets';
import type { ArmyList, FactionData, GameState } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const DG = load('DG');
const SM = load('SM');

const dgList = (det: string, extra: ArmyList['units'] = []): ArmyList => ({ ...PRESETS.DG, detachments: [det], units: [...PRESETS.DG.units, ...extra] });
const game = (list: ArmyList, seed = 3): GameState => createGame({ lists: [list, PRESETS.SM], factions: [DG, SM], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed });
const unit = (s: GameState, owner: number, sheet: string) => s.units.find((u) => u.owner === owner && u.sources[0] === sheet)!;

/** A Plague Marines unit and an enemy unit `gap`" apart, nothing else on the board. */
function pair(det = 'Virulent Vectorium', gap = 2) {
  const s = game(dgList(det));
  s.terrain = [];
  const pm = unit(s, 0, 'Plague Marines');
  const e = s.units.find((u) => u.owner === 1 && u.models.length >= 5)!;
  placeUnit(s, pm, formationAt(pm, { x: 20, y: 30 }));
  const near = Math.max(...pm.models.map((m) => m.y + m.r));
  placeUnit(s, e, formationAt(e, { x: 20, y: near + gap + 3 }));
  const far = Math.min(...e.models.map((m) => m.y - m.r));
  for (const m of e.models) m.y += near + gap - far;
  return { s, pm, e };
}

describe('Nurgle’s Gift', () => {
  it('Contagion Range grows 3" / 6" / 9" with the battle rounds; Afflicted is -1 T', () => {
    const { s, pm, e } = pair('Virulent Vectorium', 4);
    s.round = 1;
    expect(contagionRange(s, pm)).toBe(3);
    expect(isAfflicted(s, e)).toBe(false);
    const t0 = targetToughness(e, s);
    s.round = 2;
    expect(contagionRange(s, pm)).toBe(6);
    expect(isAfflicted(s, e)).toBe(true);
    expect(targetToughness(e, s)).toBe(t0 - 1);
    s.round = 4;
    expect(contagionRange(s, pm)).toBe(9);
  });
  it('the chosen Plague: Rattlejoint Ague worsens the Save, Scabrous Soulrot OC (never below 1)', () => {
    const { s, e } = pair('Virulent Vectorium', 1);
    s.phase = 'command'; s.active = 0; s.round = 1;
    expect(pickDetChoice(s, 0, 'Nurgle’s Gift (Aura)', ['rattlejoint'])).toBeNull();
    expect(plaguesOn(s, e)).toEqual(['rattlejoint']);
    expect(modelDefence(s, e, e.models[0], 'ranged').save).toBe(-1);
    s.players[0].plague = 'scabrous';
    expect(unitFlags(s, e).move).toBe(-1);
    expect(modelOc(s, e, e.models[0])).toBe(Math.max(1, (e.models[0].profile.OC ?? 0) - 1));
  });
  it('Infused with the Blessings of Nurgle marks the unit it hit; a mark makes a unit Afflicted anywhere', () => {
    const { s, e } = pair('Virulent Vectorium', 20);
    expect(isAfflicted(s, e)).toBe(false);
    e.timed = [{ e: {}, label: 'x', until: 'nextTurnStart', by: 0, turn: 0, mark: 'Afflicted' }];
    expect(isAfflicted(s, e)).toBe(true);
  });
});

describe('detachments', () => {
  it('Worldblight: a held objective is secured and enemy units in range of it are Afflicted', () => {
    const s = game(dgList('Virulent Vectorium'));
    const pm = unit(s, 0, 'Plague Marines');
    const o = s.objectives[0];
    placeUnit(s, pm, formationAt(pm, { x: o.x, y: o.y }));
    o.controller = 0;
    s.active = 0; s.round = 1;
    dgCommandEnd(s);
    expect(o.secured).toBe(0);
    const e = s.units.find((u) => u.owner === 1)!;
    placeUnit(s, e, formationAt(e, { x: o.x + 30, y: o.y }));
    expect(isAfflicted(s, e)).toBe(false);
    for (const m of e.models) { m.x = o.x + 2; m.y = o.y + 2; }
    expect(isAfflicted(s, e)).toBe(true);
  });
  it('Miasmic Bombardment: enemy units far from the army are Afflicted this battle round', () => {
    const { s, e } = pair('Mortarion’s Hammer', 20);
    s.players[0].battleSize = 'incursion';
    dgRoundStart(s);
    expect(isAfflicted(s, e)).toBe(true);
  });
  it('Deadly Vectors: Afflicted enemy units roll in their Command phase', () => {
    const { s, e } = pair('Death Lord’s Chosen', 1);
    s.round = 3; s.active = 1;
    const w0 = e.models.reduce((a, m) => a + m.wounds, 0);
    for (let i = 0; i < 10; i++) dgCommandStart(s);
    expect(e.models.reduce((a, m) => a + m.wounds, 0)).toBeLessThan(w0);
  });
  it('Numberless Horde: a new Poxwalkers unit (Battleline) joins the Strategic Reserves from round 2', () => {
    const s = game(dgList('Shamblerot Vectorium'));
    s.players[0].battleSize = 'incursion';
    const n0 = s.units.filter((u) => u.owner === 0 && u.sources[0] === 'Poxwalkers').length;
    s.active = 0; s.round = 2;
    dgCommandStart(s);
    const pox = s.units.filter((u) => u.owner === 0 && u.sources[0] === 'Poxwalkers');
    expect(pox.length).toBe(n0 + 1);
    expect(pox.at(-1)!.status).toBe('reserves');
    expect(pox.at(-1)!.keywords).toContain('BATTLELINE');
    s.round = 4;
    dgCommandStart(s);
    expect(s.units.filter((u) => u.owner === 0 && u.sources[0] === 'Poxwalkers').length).toBe(n0 + 1); // Incursion: rounds 2-3
  });
  it('Hypervirulent Strains: +3" for CHARACTER units; Contagion Range never above 12"', () => {
    const s = game(dgList('Paragons of Putrescence'));
    const bl = unit(s, 0, 'Blightlord Terminators'); // led by the Lord of Contagion
    s.round = 5;
    expect(contagionRange(s, bl)).toBe(12);
  });
  it('Death Approaches: Deep Strike 6" from Afflicted enemy units in the Movement phase', () => {
    const s = game(dgList('Virulent Vectorium', [{ uid: 'ds', datasheet: 'Deathshroud Terminators', models: 3, pts: 150 }]));
    s.terrain = [];
    const ds = unit(s, 0, 'Deathshroud Terminators');
    const e = s.units.find((u) => u.owner === 1)!;
    placeUnit(s, e, formationAt(e, { x: 22, y: 40 }));
    s.phase = 'movement'; s.active = 0;
    const pos = formationAt(ds, { x: 22, y: 30 });
    const gapOf = () => Math.min(...[...pos.values()].flatMap((p) => e.models.map((n) => Math.hypot(p.x - n.x, p.y - n.y) - n.r - ds.models[0].r)));
    const shift = gapOf() - 7;
    for (const p of pos.values()) p.y += shift;
    const gap = gapOf();
    expect(gap).toBeGreaterThan(6);
    expect(gap).toBeLessThan(8);
    expect(validatePlacement(s, ds, pos, 'deepStrike').ok).toBe(false);
    const adjusted = nudgePlacement(s, ds, pos, 'deepStrike');
    expect(validatePlacement(s, ds, adjusted, 'deepStrike').ok).toBe(true);
    expect([...adjusted].some(([id, p]) => Math.hypot(p.x - pos.get(id)!.x, p.y - pos.get(id)!.y) > 0.001)).toBe(true);
    e.timed = [{ e: {}, label: 'x', until: 'battle', by: 0, turn: 0, mark: 'Afflicted' }];
    expect(validatePlacement(s, ds, pos, 'deepStrike').errors.join()).not.toMatch(/more than/);
  });
  it('Strategic Reserves nudge back into the 6" battlefield-edge corridor', () => {
    const s = game(dgList('Virulent Vectorium', [{ uid: 'ds', datasheet: 'Deathshroud Terminators', models: 3, pts: 150 }]));
    s.terrain = [];
    s.objectives = [];
    s.round = 3;
    const ds = unit(s, 0, 'Deathshroud Terminators');
    ds.status = 'reserves';
    const pos = formationAt(ds, { x: 15, y: 15 });
    expect(validatePlacement(s, ds, pos, 'ingress').ok).toBe(false);
    const adjusted = nudgePlacement(s, ds, pos, 'ingress');
    expect(validatePlacement(s, ds, adjusted, 'ingress').ok).toBe(true);
    expect([...adjusted].some(([id, p]) => Math.hypot(p.x - pos.get(id)!.x, p.y - pos.get(id)!.y) > 0.001)).toBe(true);
  });
});

describe('everything automatic', () => {
  it('every datasheet ability and enhancement resolves by itself', () => {
    const all: ArmyList = { name: 'all', factionId: 'DG', battleSize: 'onslaught', detachments: ['Tallyband Summoners'], units: DG.datasheets.map((d, i) => ({ uid: `u${i}`, datasheet: d.name, models: d.points[0]?.options[0]?.models ?? 1, pts: 0 })) };
    const not: string[] = [];
    for (const u of buildUnits(all, DG, 0)) for (const a of u.abilities) { const st = abilityStatus(u, a).status; if (st !== 'auto' && st !== 'core' && st !== 'info') not.push(`${a.name}@${u.sources[0]}: ${st}`); }
    for (const d of DG.detachments) for (const e of d.enhancements) {
      const u = buildUnits(all, DG, 0)[0];
      const st = abilityStatus(u, { name: e.name, type: 'Enhancement', text: e.text, faction: 'DG' } as never).status;
      if (st !== 'auto' && st !== 'info') not.push(`${e.name}: ${st}`);
    }
    expect([...new Set(not)]).toEqual([]);
  });
  it('Pact of Decay: Plague Legions units only with Tallyband Summoners, up to 500 pts at Incursion', () => {
    const size = { points: 1000, dp: 3, unitLimit: 3, enhancements: 3 };
    const pb = (n: number): ArmyList['units'] => Array.from({ length: n }, (_, i) => ({ uid: `pb${i}`, datasheet: 'Plaguebearers', models: 10, pts: 110 }));
    expect(validateList(dgList('Virulent Vectorium', pb(1)), DG, size).join()).toMatch(/only be included with the Tallyband Summoners/);
    expect(validateList(dgList('Tallyband Summoners', pb(1)), DG, size).join()).not.toMatch(/PLAGUE LEGIONS/);
  });
  it('every stratagem has a written rule', () => {
    const s = game(dgList('Virulent Vectorium'));
    const missing = DG.detachments.flatMap((d) => d.stratagems).filter((st) => stratRuleFor(s, 0, st).status !== 'auto').map((st) => st.name);
    expect(missing).toEqual([]);
  });
  it('the Plague Marines boltgun is S5 AP-1 (Faction Pack v1.3)', () => {
    const s = game(dgList('Virulent Vectorium'));
    const { pm, e } = { pm: unit(s, 0, 'Plague Marines'), e: s.units.find((u) => u.owner === 1)! };
    const bg = pm.models.flatMap((m) => m.weapons).find((w) => w.name === 'Boltgun')!;
    expect([bg.profiles[0].S, bg.profiles[0].AP]).toEqual([5, -1]);
    expect(e).toBeTruthy();
    expect(buildShootPools).toBeTruthy();
  });
});

describe('Death Guard in a game', () => {
  for (const det of DG.detachments.map((d) => d.name)) {
    it(`bot vs bot reaches game over: ${det}`, () => {
      const extra: ArmyList['units'] = det === 'Tallyband Summoners' ? [{ uid: 'p1', datasheet: 'Plaguebearers', models: 10, pts: 110 }]
        : det === 'Contagion Engines' ? [{ uid: 'b1', datasheet: 'Foetid Bloat-drone', models: 1, pts: 100 }] : [];
      const s = game(dgList(det, extra), 11);
      s.bots = [0, 1];
      let steps = 0;
      while (s.phase !== 'gameover' && steps < 6000) { botAct(s); steps++; }
      expect(s.phase).toBe('gameover');
      expect(s.players[0].plague).toBeTruthy();
      for (const u of s.units) for (const m of u.models) expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
    }, 240000);
  }
});
