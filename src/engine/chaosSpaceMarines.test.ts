// Chaos Space Marines (Faction Pack v1.3, 30 Sep 2026): every rule has data, Dark Pacts, the focus of hatred, the
// pack's profile changes, the quick list, and a whole game with the bot.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyDetachmentStratagem, stratRule } from './stratagems';
import { botAct } from './bot';
import { abilityRule, DET_RULES, effectsFor } from './effects';
import { buildUnits, listPoints, validateList } from './army';
import { chargeReach, createGame, formationAt, markRuleName, placeUnit, setOathTarget, startTurn } from './game';
import { buildShootPools, rollHits, rollWounds, startAttack } from './attack';
import { pickDetChoice } from './detachments';
import { canMakePact, makeDarkPact } from './darkPacts';
import { alive } from './state';
import { PRESETS } from '../ui/presets';
import csmAbilities from '../../data/abilities/CSM.json';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const CSM = load('CSM');
const ORK = load('ORK');

type Row = [string, number, number, string?];
const list = (factionId: string, units: Row[], det: string): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments: factionId === 'CSM' ? [det] : [],
  units: units.map(([d, n, pts, attachTo], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts, attachTo })),
});

function game(csm: Row[], ork: Row[], det = 'Veterans of the Long War'): GameState {
  const s = createGame({
    lists: [list('CSM', csm, det), list('ORK', ork, '')], factions: [CSM, ORK], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
  });
  s.terrain = s.terrain.filter((t) => t.objectiveId);
  s.terrain.forEach((t) => { t.walls = []; t.category = 'exposed'; });
  s.players[0].detachments = CSM.detachments.filter((d) => d.name === det);
  s.round = 2; s.turn = 2; s.active = 0;
  return s;
}
function put(s: GameState, unitId: string, c: Pt) {
  const u = s.units.find((x) => x.id === unitId)!;
  placeUnit(s, u, formationAt(u, c));
  u.setUpTurn = -10;
  return u;
}

describe('Chaos Space Marines: every rule has data', () => {
  it('datasheet abilities', () => {
    const missing = new Set<string>();
    for (const d of CSM.datasheets) for (const a of d.abilities) {
      if (a.type === 'Core' || (a.type === 'Faction' && DET_RULES[a.name]) || a.name === 'Dark Pacts') continue;
      const u = { sources: [d.name], abilities: [] } as unknown as Parameters<typeof abilityRule>[0];
      if (!abilityRule(u, { ...a, sheet: d.name, faction: 'CSM' })) missing.add(`${a.name}@${d.name}`);
    }
    expect([...missing]).toEqual([]);
  });
  it('army rules: Dark Pacts and Cult of the Dark Gods (no Oath of Moment)', () => {
    expect(CSM.armyRules.map((r) => r.name).sort()).toEqual(['Cult of the Dark Gods', 'Dark Pacts']);
  });
  it('detachment rules, enhancements and stratagems', () => {
    expect(CSM.detachments.map((d) => d.name).filter((n) => !DET_RULES[n])).toEqual([]);
    const enh = CSM.detachments.flatMap((d) => d.enhancements.map((e) => e.name));
    expect(enh.filter((n) => !(n in csmAbilities))).toEqual([]);
    const strats = CSM.detachments.flatMap((d) => d.stratagems.map((st) => stratRule(st, 'CSM', d.name)));
    expect(strats.filter((r) => r.status && r.status !== 'auto').length).toBe(0);
    expect(CSM.detachments.filter((d) => DET_RULES[d.name].auto !== 'full').map((d) => d.name)).toEqual([]);
  });
  it('Faction Pack v1.3 profile changes', () => {
    const sheet = (n: string) => CSM.datasheets.find((d) => d.name === n)!;
    expect(sheet('Legionaries').models.every((m) => m.T === 5)).toBe(true);
    expect(sheet('Chaos Terminator Squad').models.every((m) => m.T === 6)).toBe(true);
    const bolt = sheet('Legionaries').weapons.find((w) => w.name === 'Boltgun')!;
    expect(bolt.profiles[0]).toMatchObject({ S: 5, AP: -1 });
  });
});

describe('mustering', () => {
  it('the quick list is legal', () => {
    const size = { points: 1000, dp: 2, unitLimit: 3, enhancements: 2 };
    expect(validateList(PRESETS.CSM, CSM, size)).toEqual([]);
    expect(listPoints(PRESETS.CSM, CSM)).toBeLessThanOrEqual(1000);
  });
});

describe('Dark Pacts', () => {
  it('a Leadership test, mortal wounds on a fail, then the weapons gain the ability for the phase', () => {
    const s = game([['Legionaries', 10, 180]], [['Boyz', 10, 80]]);
    const u = put(s, 'p0-x0', { x: 20, y: 20 });
    s.phase = 'shooting';
    expect(canMakePact(s, u)).toBe(true);
    const before = alive(u).reduce((a, m) => a + m.wounds, 0);
    const r = makeDarkPact(s, u, 'lethal hits');
    expect(canMakePact(s, u)).toBe(false); // once per phase
    expect(u.timed?.some((t) => t.mark === 'darkPact' && t.e.abilities?.includes('lethal hits'))).toBe(true);
    const after = alive(u).reduce((a, m) => a + m.wounds, 0);
    if (r.passed) { expect(after).toBe(before); expect(u.timed?.some((t) => t.mark === 'pactOk:lethal')).toBe(true); }
    else expect(after).toBeLessThan(before);
  });
  it('Renegade Warband (Slaves to None) loses the Dark Pacts', () => {
    const s = game([['Legionaries', 5, 95]], [['Boyz', 10, 80]], 'Renegade Warband');
    const u = put(s, 'p0-x0', { x: 20, y: 20 });
    s.phase = 'shooting';
    expect(canMakePact(s, u)).toBe(false);
  });
});

describe('Veterans of the Long War: focus of hatred', () => {
  it('is picked like the Oath of Moment and re-rolls hits against it', () => {
    const s = game([['Legionaries', 5, 95]], [['Boyz', 10, 80]]);
    const u = put(s, 'p0-x0', { x: 20, y: 20 });
    const e = put(s, 'p1-x0', { x: 30, y: 20 });
    expect(markRuleName(s, 0)).toBe('Focus of Hatred');
    setOathTarget(s, 0, e.id);
    expect(effectsFor(s, u).some((a) => a.e.reroll === 'hits' && a.e.if?.includes('targetOath'))).toBe(true);
  });
});

describe('detachment rules in play', () => {
  it('Pactbound Zealots: a unit without a god keyword (Chaos Undivided) re-rolls hit rolls of 1 after a passed pact', () => {
    const s = game([['Legionaries', 5, 95]], [['Boyz', 10, 80]], 'Pactbound Zealots');
    const u = put(s, 'p0-x0', { x: 20, y: 20 });
    s.phase = 'shooting';
    for (const m of u.models) m.profile = { ...m.profile, Ld: 2 }; // the test always passes
    makeDarkPact(s, u, 'lethal hits');
    expect(u.timed?.some((t) => t.mark === 'pactOk:lethal')).toBe(true);
    expect(effectsFor(s, u).some((a) => a.e.reroll === 'hits1' && a.e.if?.includes('marked:pactOk:lethal'))).toBe(true);
  });
  it('Dread Talons: an enemy unit below Starting Strength within 12" takes a Battle-shock test', () => {
    const s = game([['Legionaries', 5, 95]], [['Boyz', 10, 80]], 'Dread Talons');
    put(s, 'p0-x0', { x: 20, y: 20 });
    const e = put(s, 'p1-x0', { x: 28, y: 20 });
    e.models[0].dead = true; e.models[0].wounds = 0;
    startTurn(s, 1);
    expect(s.shockTests.some((t) => t.unitId === e.id)).toBe(true);
  });
});

describe('Chaos Space Marines stratagems', () => {
  it('Corrupted Munitions improves the AP of ranged attacks', () => {
    const s = game([['Legionaries', 5, 95]], [['Boyz', 10, 80]], 'Renegade Warband');
    const u = put(s, 'p0-x0', { x: 20, y: 20 });
    s.phase = 'shooting';
    const st = CSM.detachments.find((d) => d.name === 'Renegade Warband')!.stratagems.find((x) => x.name === 'CORRUPTED MUNITIONS')!;
    applyDetachmentStratagem(s, 0, st, u.id);
    expect(effectsFor(s, u).some((a) => a.e.ap === 1 && a.e.attack === 'ranged')).toBe(true);
  });
});

describe('the rest of the pack', () => {
  const st = (det: string, name: string) => CSM.detachments.find((d) => d.name === det)!.stratagems.find((x) => x.name === name)!;
  it('Siegecraft: -2 only for a charge that targets that unit', () => {
    const s = game([['Legionaries', 5, 95]], [['Boyz', 10, 80]], 'Fellhammer Siege-host');
    const u = put(s, 'p0-x0', { x: 20, y: 20 });
    const e = put(s, 'p1-x0', { x: 27, y: 20 });
    s.phase = 'charge'; s.active = 1;
    applyDetachmentStratagem(s, 0, st('Fellhammer Siege-host', 'SIEGECRAFT'), u.id);
    e.chargeRoll = 9;
    expect(chargeReach(s, e, [u])).toBe(7);
    expect(chargeReach(s, e, [])).toBe(9);
  });
  it('Mortal Thralls: wound rolls against the unit become mortal wounds on the DAMNED unit within 3"', () => {
    const s = game([['Legionaries', 5, 95], ['Cultist Mob', 10, 50]], [['Boyz', 10, 80]], 'Chaos Cult');
    const u = put(s, 'p0-x0', { x: 20, y: 20 });
    const d = put(s, 'p0-x1', { x: 20, y: 23.5 });
    const e = put(s, 'p1-x0', { x: 30, y: 20 });
    applyDetachmentStratagem(s, 0, st('Chaos Cult', 'MORTAL THRALLS'), u.id);
    s.phase = 'shooting'; s.active = 1;
    const r = buildShootPools(s, e.id, u.id, { mode: 'normal' });
    startAttack(s, 'shoot', e.id, u.id, r.pools);
    s.attack!.pools.forEach((p) => { p.hits = Array.from({ length: 6 }, () => ({ v: 6, o: 'hit' as const })); });
    s.attack!.stage = 'wound';
    const before = alive(d).length;
    rollWounds(s);
    expect(s.attack!.pools[0].wounds.length).toBe(0);
    expect(alive(d).length).toBeLessThan(before);
    void rollHits;
  });
  it('Pactbound Zealots: the Mark of Chaos picked in the builder; Khorne psykers and mixed marks are refused', () => {
    const base = list('CSM', [['Legionaries', 5, 95], ['Chaos Lord', 1, 95, 'x0'], ['Sorcerer', 1, 65]], 'Pactbound Zealots');
    base.units[0].mark = 'KHORNE'; base.units[1].mark = 'KHORNE'; base.units[1].warlord = true;
    const size = { points: 1000, dp: 3, unitLimit: 3, enhancements: 2 };
    expect(validateList(base, CSM, size)).toEqual([]);
    expect(buildUnits(base, CSM, 0)[0].keywords).toContain('KHORNE');
    base.units[1].mark = 'NURGLE';
    expect(validateList(base, CSM, size).some((e) => /same Mark/.test(e))).toBe(true);
    base.units[1].mark = 'KHORNE'; base.units[2].mark = 'KHORNE';
    expect(validateList(base, CSM, size).some((e) => /PSYKER/.test(e))).toBe(true);
  });
  it('Experimental Augmentations: two at random', () => {
    const s = game([['Legionaries', 5, 95]], [['Boyz', 10, 80]], 'Creations of Bile');
    s.round = 1; s.phase = 'command';
    expect(pickDetChoice(s, 0, 'Creations of Bile', ['random'])).toBeNull();
    const act = s.players[0].det?.['Creations of Bile']?.active ?? [];
    expect(act.length).toBeGreaterThanOrEqual(1);
    expect(act).not.toContain('random');
  });
});

describe('Chaos Space Marines in a game', () => {
  it('the quick list vs Orks plays to the end with the bot, making Dark Pacts', () => {
    const s = createGame({ lists: [PRESETS.CSM, PRESETS.ORK], factions: [CSM, ORK], names: ['A', 'B'], seed: 11, secondaryMode: 'tactical' });
    s.bots = [0, 1];
    let steps = 0;
    while (s.phase !== 'gameover' && steps < 15000) { botAct(s); steps++; }
    expect(s.phase).toBe('gameover');
    expect(s.log.some((l) => /makes a Dark Pact/.test(l.text) && l.player === 0)).toBe(true);
  });
});
