// Emperor's Children (Faction Pack v1.3): Thrill Seekers, Pledges to the Dark Prince, Favoured Champions, Daemonic
// Poisons, every ability automatic, and whole bot games in every detachment.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildShootPools } from './attack';
import { botAct } from './bot';
import { abilityStatus, effectsFor, unitFlags } from './effects';
import { favouredOnKill, initFavoured, noteTarget, pledgeRoundEnd, poisonTick, setPledge, snapshotEngaged } from './emperorsChildren';
import { buildUnits } from './army';
import { createGame, formationAt, placeUnit } from './game';
import { PRESETS } from '../ui/presets';
import type { ArmyList, FactionData, GameState } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const EC = load('EC');
const SM = load('SM');

const ecList = (det: string, extra: ArmyList['units'] = []): ArmyList => ({ ...PRESETS.EC, detachments: [det], units: [...PRESETS.EC.units, ...extra] });
const game = (list: ArmyList, seed = 3): GameState => createGame({ lists: [list, PRESETS.SM], factions: [EC, SM], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed });
const unit = (s: GameState, owner: number, sheet: string) => s.units.find((u) => u.owner === owner && u.sources[0] === sheet)!;

describe('Thrill Seekers', () => {
  it('after Advancing it shoots, but not at a unit it was engaged with or one already attacked this phase', () => {
    const s = game(ecList('Mercurial Host'));
    s.terrain = s.terrain.filter((t) => s.objectives.some((o) => o.terrainId === t.id));
    const nm = unit(s, 0, 'Noise Marines');
    const [a, b] = s.units.filter((u) => u.owner === 1).slice(0, 2);
    placeUnit(s, nm, formationAt(nm, { x: 22, y: 30 }));
    placeUnit(s, a, formationAt(a, { x: 22, y: 40 }));
    placeUnit(s, b, formationAt(b, { x: 30, y: 40 }));
    s.phase = 'shooting'; s.active = 0;
    expect(unitFlags(s, nm).thrill).toBe(true);
    nm.move = 'advance';
    snapshotEngaged(s);
    expect(buildShootPools(s, nm.id, a.id, { mode: 'normal' }).error).toBeUndefined();
    noteTarget(s, 'someone-else', a.id);
    expect(buildShootPools(s, nm.id, a.id, { mode: 'normal' }).error).toMatch(/Thrill Seekers/);
    expect(buildShootPools(s, nm.id, b.id, { mode: 'normal' }).error).toBeUndefined();
    nm.startEngaged = { turn: s.turn, ids: [b.id] };
    expect(buildShootPools(s, nm.id, b.id, { mode: 'normal' }).error).toMatch(/engaged/);
    nm.move = 'normal';
    expect(buildShootPools(s, nm.id, b.id, { mode: 'normal' }).error).toBeUndefined();
  });
});

describe('detachments', () => {
  it('Pledges to the Dark Prince: kept → Pact points and their bonuses; broken → the Warlord takes mortal wounds', () => {
    const s = game(ecList('Coterie of the Conceited'));
    s.round = 2;
    setPledge(s, 0, 1);
    s.destroyedByTurn.push({ turn: 2, owner: 1, unitId: 'x' });
    pledgeRoundEnd(s);
    expect(s.players[0].pactPoints).toBe(1);
    const tor = unit(s, 0, 'Tormentors');
    expect(effectsFor(s, tor).some((a) => a.e.reroll === 'hits1')).toBe(true);
    setPledge(s, 0, 3);
    const lord = tor.models.find((m) => m.source === 'Lord Exultant')!;
    tor.status = 'board';
    const before = lord.wounds;
    pledgeRoundEnd(s);
    expect(s.players[0].pactPoints).toBe(1);
    expect(lord.wounds).toBeLessThan(before);
  });
  it('Favoured Champions: the Warlord\'s unit, then the first CHARACTER unit to destroy an enemy unit in a turn', () => {
    const s = game(ecList('Slaanesh’s Chosen'));
    initFavoured(s);
    const tor = unit(s, 0, 'Tormentors');
    const fb = unit(s, 0, 'Flawless Blades');
    expect(s.players[0].favoured).toBe(tor.id);
    fb.status = 'board';
    favouredOnKill(s, fb);
    expect(s.players[0].favoured).toBe(fb.id);
    favouredOnKill(s, tor); // only the first in each turn
    expect(s.players[0].favoured).toBe(fb.id);
    expect(effectsFor(s, fb).some((a) => a.e.reroll === 'wounds')).toBe(true);
  });
  it('Daemonic Poisons: a poisoned unit rolls at the start of each Command phase', () => {
    const s = game(ecList('Mercurial Host'));
    const e = s.units.find((u) => u.owner === 1)!;
    e.status = 'board';
    e.timed = [{ e: { poisoned: true }, label: 'Daemonic Poisons', until: 'battle', by: 0, turn: 0, mark: 'Poisoned' }];
    const w0 = e.models.reduce((a, m) => a + m.wounds, 0);
    for (let i = 0; i < 12; i++) poisonTick(s);
    expect(e.models.reduce((a, m) => a + m.wounds, 0)).toBeLessThan(w0);
  });
});

describe('everything automatic', () => {
  it('every datasheet ability and enhancement resolves by itself', () => {
    const all: ArmyList = { name: 'all', factionId: 'EC', battleSize: 'onslaught', detachments: ['Carnival of Excess'], units: EC.datasheets.map((d, i) => ({ uid: `u${i}`, datasheet: d.name, models: d.points[0]?.options[0]?.models ?? 1, pts: 0 })) };
    const not: string[] = [];
    for (const u of buildUnits(all, EC, 0)) for (const a of u.abilities) { const st = abilityStatus(u, a).status; if (st !== 'auto' && st !== 'core' && st !== 'info') not.push(`${a.name}@${u.sources[0]}: ${st}`); }
    expect([...new Set(not)]).toEqual([]);
  });
});

describe('Emperor’s Children in a game', () => {
  for (const det of EC.detachments.map((d) => d.name)) {
    it(`bot vs bot reaches game over: ${det}`, () => {
      const extra: ArmyList['units'] = det === 'Carnival of Excess' ? [{ uid: 'd1', datasheet: 'Daemonettes', models: 10, pts: 100 }]
        : det === 'Elegant Brutes' ? [{ uid: 't1', datasheet: 'Chaos Terminators', models: 5, pts: 155 }]
        : det === 'Rapid Evisceration' ? [{ uid: 'r1', datasheet: 'Chaos Rhino', models: 1, pts: 70 }] : [];
      const s = game(ecList(det, extra), 11);
      s.bots = [0, 1];
      let steps = 0;
      while (s.phase !== 'gameover' && steps < 6000) { botAct(s); steps++; }
      expect(s.phase).toBe('gameover');
      for (const u of s.units) for (const m of u.models) expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
    }, 240000);
  }
});
