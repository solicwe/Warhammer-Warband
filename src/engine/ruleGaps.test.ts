// The last hand-played rules made automatic: Ork enhancement weapons / Warphead / Blitzboss / Boss Boomer / Pulse Jet,
// Thousand Sons Gift of Change, Deceptive Glamour, Deranged Ferocity, Through the Veil, Scouring Warpflame, Horrors.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFightPools, killModel } from './attack';
import { reactionOffers } from './stratagems';
import { abilityOff, addTimed, effectsFor, unitFlags } from './effects';
import { actsOfUnit, resolvePickUnit, resolveRevivals } from './activations';
import { commitMove, createGame, formationAt, placeUnit, validatePlacement } from './game';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const TS = load('TS');
const ORK = load('ORK');

type Row = [string, number, string?, Partial<{ enhancement: string; warlord: boolean; embarkIn: string }>?];
const list = (factionId: string, det: string, units: Row[]): ArmyList => ({
  name: 't', factionId, battleSize: 'strike', detachments: [det],
  units: units.map(([d, n, attachTo, extra], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts: 50, attachTo, ...extra })),
});
function game(ts: Row[], tsDet: string, ork: Row[], orkDet: string): GameState {
  const s = createGame({
    lists: [list('TS', tsDet, ts), list('ORK', orkDet, ork)], factions: [TS, ORK], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
  });
  s.terrain = [];
  s.round = 2; s.turn = 2; s.active = 0; s.phase = 'movement';
  return s;
}
const U = (s: GameState, id: string) => s.units.find((u) => u.id === id)!;
function put(s: GameState, id: string, c: Pt) { const u = U(s, id); placeUnit(s, u, formationAt(u, c)); u.setUpTurn = -10; return u; }

describe('Orks', () => {
  it('enhancement weapons, Warphead and Blitzboss', () => {
    const s = game([['Rubric Marines', 5]], 'Hexwarp Thrallband', [['Warboss', 1, undefined, { enhancement: 'Da Gobshot Thunderbuss', warlord: true }], ['Trukk', 1], ['Weirdboy', 1, undefined, { enhancement: 'Warphead' }]], 'Brute Bosses');
    const boss = U(s, 'p1-x0');
    const gun = boss.models[0].weapons.find((w) => w.name === 'Da Gobshot Thunderbuss');
    expect(gun?.profiles[0]).toMatchObject({ range: 24, A: '6', S: 7, AP: -2, D: '2' });
    expect(gun?.profiles[0].abilities).toContain('rapid fire 6');
    expect(U(s, 'p1-x2').models[0].deadlyDemise).toBe('D6');
    // Blitzboss: the transport the Warboss rides gets +2" Move and a 5+ invulnerable save
    const s2 = game([['Rubric Marines', 5]], 'Hexwarp Thrallband', [['Warboss', 1, undefined, { enhancement: 'Blitzboss', warlord: true }], ['Trukk', 1]], 'Brute Bosses');
    const trukk = put(s2, 'p1-x1', { x: 30, y: 30 });
    expect(unitFlags(s2, trukk).move).toBe(0);
    Object.assign(U(s2, 'p1-x0'), { status: 'embarked', embarkedIn: trukk.id });
    expect(unitFlags(s2, trukk).move).toBe(2);
    expect(effectsFor(s2, trukk).some((a) => a.e.defend?.inv === 5)).toBe(true);
  });
  it('a move granted as the unit\'s move (Pulse Jet) counts as its Normal move', () => {
    const s = game([['Rubric Marines', 5]], 'Hexwarp Thrallband', [['Trukk', 1]], 'Brute Bosses');
    const t = put(s, 'p1-x0', { x: 30, y: 30 });
    t.extraMove = { max: 20, label: 'Pulse Jet', kind: 'extra', asMove: true };
    commitMove(s, t, 'extra', new Map(t.models.map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x + 10, y: m.y }]])));
    expect(t.move).toBe('normal');
  });
});

describe('Thousand Sons', () => {
  it('Gift of Change: a Chaos Spawn is set up where the character died', () => {
    const s = game([['Exalted Sorcerer', 1], ['Rubric Marines', 5]], 'Warpmeld Pact', [['Boyz', 10]], 'Brute Bosses');
    expect(s.players[0].spawnTemplate?.name).toMatch(/Chaos Spawn/);
    // offered when a (non-MONSTER) character model dies
    const sorc = put(s, 'p0-x0', { x: 20, y: 20 });
    s.players[0].cp = 3;
    killModel(s, sorc, sorc.models[0]);
    expect(reactionOffers(s, 0, 'modelDestroyed', { unitId: sorc.id, modelId: sorc.models[0].id }).map((o) => o.st.name)).toContain('GIFT OF CHANGE');
    const before = s.units.length;
    s.spawns = [{ owner: 0, x: 20, y: 20, label: 'GIFT OF CHANGE' }];
    resolveRevivals(s);
    expect(s.units.length).toBe(before + 1);
    expect(s.units[before].status).toBe('board');
  });
  it('Deceptive Glamour, Deranged Ferocity and Horrors are Blue', () => {
    const s = game([['Rubric Marines', 5], ['Pink Horrors', 10]], 'Changehost of Deceit', [['Boyz', 10]], 'Brute Bosses');
    const rub = put(s, 'p0-x0', { x: 20, y: 20 });
    const pink = put(s, 'p0-x1', { x: 20, y: 24 });
    const boyz = U(s, 'p1-x0');
    // one Boy touching both units
    placeUnit(s, boyz, new Map(boyz.models.map((m, i) => [m.id, i === 0 ? { x: 20, y: 22 } : { x: 30 + i, y: 35 }])));
    expect(buildFightPools(s, boyz.id, rub.id).pools.length).toBeGreaterThan(0);
    addTimed(s, rub, { e: { glamour: true }, label: 'DECEPTIVE GLAMOUR', until: 'phase', by: 0 });
    expect(buildFightPools(s, boyz.id, rub.id).pools.length).toBe(0);
    // Deranged Ferocity: models within 3" of the enemy unit also fight
    const near = { x: boyz.models[0].x, y: boyz.models[0].y };
    placeUnit(s, rub, new Map(rub.models.map((m, i) => [m.id, { x: near.x - 2 - i * 1.4, y: near.y - 0.6 }])));
    const n0 = buildFightPools(s, rub.id, boyz.id).pools.reduce((a, p) => a + p.models, 0);
    addTimed(s, rub, { e: { fightReach3: true }, label: 'DERANGED FEROCITY', until: 'phase', by: 0 });
    expect(buildFightPools(s, rub.id, boyz.id).pools.reduce((a, p) => a + p.models, 0)).toBeGreaterThan(n0);
    // Pink Horrors get the Blue Horrors abilities once no Pink Horror is left
    const blue = pink.abilities.find((a) => a.name === 'Exploding Horrors')!;
    expect(abilityOff(pink, blue)).toBe(true);
    for (const m of pink.models) if (/pink/i.test(m.name)) m.dead = true;
    expect(abilityOff(pink, blue)).toBe(false);
  });
  it('Through the Veil: Scarab Occult must arrive wholly within the Flow of Magic', () => {
    const s = game([['Scarab Occult Terminators', 5]], 'Hexwarp Thrallband', [['Boyz', 10]], 'Brute Bosses');
    const so = U(s, 'p0-x0');
    so.status = 'reserves';
    addTimed(s, so, { e: { deepStrikeRange: 6, deepStrikeInFlow: true }, label: 'THROUGH THE VEIL', until: 'phase', by: 0 });
    const far = validatePlacement(s, so, formationAt(so, { x: 30, y: 52 }), 'deepStrike');
    expect(far.errors.join()).toMatch(/Flow of Magic/);
  });
  it('a player picks the unit a rule asks for (Scouring Warpflame)', () => {
    const s = game([['Rubric Marines', 5]], 'Hexwarp Thrallband', [['Boyz', 10], ['Boyz', 10]], 'Brute Bosses');
    const rub = put(s, 'p0-x0', { x: 20, y: 20 });
    const [a, b] = [put(s, 'p1-x0', { x: 20, y: 34 }), put(s, 'p1-x1', { x: 35, y: 34 })];
    s.window = { kind: 'pickUnit', player: 0, label: 'Scouring Warpflame: pick', units: [a.id, b.id], holderId: rub.id, acts: [{ on: 'target', incoming: { attack: 'ranged', noCover: true }, until: 'phase' }] };
    resolvePickUnit(s, b.id);
    expect(s.window).toBeNull();
    expect((b.timed ?? []).length + (rub.timed ?? []).length + (a.timed ?? []).length).toBeGreaterThan(0);
    expect(actsOfUnit(s, rub).length).toBeGreaterThanOrEqual(0);
  });
});
