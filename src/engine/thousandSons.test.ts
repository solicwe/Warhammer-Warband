// Thousand Sons (Faction Pack v1.3): every rule has machine-readable data, Rituals are attempted at the start of the
// Shooting phase (by the bot and by a player on automatic rules), the Flow of Magic, Split, and whole games with the bot.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildShootPools } from './attack';
import { applyDetachmentStratagem } from './stratagems';
import { botAct } from './bot';
import { abilityRule, DET_RULES } from './effects';
import { listPoints, validateList } from './army';
import { createGame, formationAt, placeUnit } from './game';
import { inFlow } from './flow';
import { attemptRitual, casters, ritualsPending, testOdds } from './rituals';
import { botRituals } from './botRituals';
import { autoDue, autoStep } from './autoPlay';
import { PRESETS } from '../ui/presets';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const TS = load('TS');
const ORK = load('ORK');

type Row = [string, number, number, string?, Partial<{ enhancement: string; warlord: boolean; wargear: any[] }>?];
const list = (factionId: string, units: Row[], det = 'Hexwarp Thrallband'): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments: factionId === 'TS' ? [det] : [],
  units: units.map(([d, n, pts, attachTo, extra], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts, attachTo, ...extra })),
});

function game(ts: Row[], ork: Row[], det = 'Hexwarp Thrallband'): GameState {
  const s = createGame({
    lists: [list('TS', ts, det), list('ORK', ork)], factions: [TS, ORK], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
  });
  s.terrain = s.terrain.filter((t) => t.objectiveId);
  s.terrain.forEach((t) => { t.walls = []; t.category = 'exposed'; });
  s.players[0].detachments = TS.detachments.filter((d) => d.name === det);
  s.round = 2; s.turn = 2; s.active = 0;
  return s;
}

function put(s: GameState, unitId: string, c: Pt) {
  const u = s.units.find((x) => x.id === unitId)!;
  placeUnit(s, u, formationAt(u, c));
  u.setUpTurn = -10;
  return u;
}
const strat = (name: string) => TS.detachments.flatMap((d) => d.stratagems).find((x) => x.name === name)!;

describe('Thousand Sons: every rule has data', () => {
  it('datasheet abilities', () => {
    const missing = new Set<string>();
    for (const d of TS.datasheets) for (const a of d.abilities) {
      if (a.type === 'Core' || (a.type === 'Faction' && DET_RULES[a.name])) continue;
      if (/^Cabal of Sorcerers/.test(a.name)) continue; // the army rule (Rituals) itself
      const u = { sources: [d.name], abilities: [] } as unknown as Parameters<typeof abilityRule>[0];
      if (!abilityRule(u, { ...a, sheet: d.name, faction: 'TS' })) missing.add(`${a.name}@${d.name}`);
    }
    expect([...missing]).toEqual([]);
  });
  it('army rules and detachments (Oath of Moment and Dark Pacts are not Thousand Sons rules)', () => {
    expect(TS.armyRules.map((r) => r.name)).not.toContain('Oath of Moment');
    expect(TS.armyRules.map((r) => r.name)).not.toContain('Dark Pacts');
    expect(TS.detachments.map((d) => d.name).filter((n) => !DET_RULES[n])).toEqual([]);
  });
  it('enhancements', () => {
    const missing = TS.detachments.flatMap((d) => d.enhancements).filter((e) => {
      const u = { sources: [e.name], abilities: [] } as unknown as Parameters<typeof abilityRule>[0];
      return !abilityRule(u, { name: e.name, type: 'Enhancement', text: e.text, sheet: e.name, faction: 'TS' });
    }).map((e) => e.name);
    expect(missing).toEqual([]);
  });
  it('stratagems', () => {
    const rules = (JSON.parse(fs.readFileSync('data/stratagems/TS.json', 'utf8')) as { rules: Record<string, unknown> }).rules;
    const missing = TS.detachments.flatMap((d) => d.stratagems.filter((st) => !rules[st.name] && !rules[`${st.name}@${d.name}`]).map((st) => `${st.name}@${d.name}`));
    expect(missing).toEqual([]);
  });
  it('Faction Pack v1.3 profile changes', () => {
    const sheet = (n: string) => TS.datasheets.find((d) => d.name === n)!;
    expect(sheet('Rubric Marines').models.every((m) => m.T === 5)).toBe(true);
    expect(sheet('Scarab Occult Terminators').models.every((m) => m.T === 6)).toBe(true);
    const pistol = sheet('Rubric Marines').weapons.find((w) => /inferno bolt pistol/i.test(w.name))!;
    expect(pistol.profiles[0]).toMatchObject({ S: 5, AP: -2 });
  });
});

describe('mustering', () => {
  const size = { points: 1000, dp: 2, unitLimit: 3, enhancements: 2 };
  it('the quick list is legal', () => {
    expect(validateList(PRESETS.TS, TS, size)).toEqual([]);
    expect(listPoints(PRESETS.TS, TS)).toBeLessThanOrEqual(1000);
  });
  it('Scintillating Legions need Changehost of Deceit, at most 500 pts at Incursion, never the Warlord', () => {
    const l = list('TS', [['Sorcerer', 1, 95, undefined, { warlord: true }], ['Pink Horrors', 10, 115]]);
    expect(validateList(l, TS, size).some((e) => /SCINTILLATING LEGIONS units need a Detachment/.test(e))).toBe(true);
    l.detachments = ['Changehost of Deceit'];
    expect(validateList(l, TS, size).some((e) => /SCINTILLATING LEGIONS/.test(e))).toBe(false);
    l.units.push({ uid: 'y1', datasheet: 'Lord of Change', models: 1, pts: 320 }, { uid: 'y2', datasheet: 'Pink Horrors', models: 10, pts: 115 });
    expect(validateList(l, TS, size).some((e) => /at most 500 pts/.test(e))).toBe(true);
    l.units = [{ uid: 'a', datasheet: 'Sorcerer', models: 1, pts: 95 }, { uid: 'b', datasheet: 'Lord of Change', models: 1, pts: 320, warlord: true }];
    expect(validateList(l, TS, size).some((e) => /cannot be your Warlord/.test(e))).toBe(true);
  });
  it('Magnus must be the Warlord', () => {
    const l = list('TS', [['Magnus The Red', 1, 455], ['Sorcerer', 1, 95, undefined, { warlord: true }]]);
    expect(validateList(l, TS, { ...size, points: 2000 }).some((e) => /Magnus The Red must be your Warlord/.test(e))).toBe(true);
  });
});

describe('Rituals', () => {
  it('a Sorcerer can attempt each Ritual once per turn; Doombolt deals mortal wounds when manifested', () => {
    const s = game([['Rubric Marines', 5, 100], ['Sorcerer', 1, 95, 'x0']], [['Boyz', 10, 90]]);
    put(s, 'p0-x0', { x: 20, y: 30 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 45 });
    s.phase = 'shooting';
    expect(ritualsPending(s, 0)).toBe(true);
    const cs = casters(s, 0);
    // the Sorcerer and the Aspiring Sorcerer of the Rubric Marines (Cabal of Sorcerers)
    expect(cs.length).toBe(2);
    const before = boyz.models.filter((m) => !m.dead).length;
    let manifested = false;
    for (let i = 0; i < 30 && !manifested; i++) {
      s.players[0].rituals = undefined;
      s.rng = 1000 + i * 7919;
      const r = attemptRitual(s, 0, cs[0].model.id, 'doombolt', boyz.id, { channel: true });
      expect(r.error).toBeNull();
      manifested = !!r.out?.manifested;
    }
    expect(manifested).toBe(true);
    expect(boyz.models.filter((m) => !m.dead).length).toBeLessThan(before);
    expect(attemptRitual(s, 0, cs[1].model.id, 'doombolt', boyz.id, { channel: false }).error).toMatch(/already attempted/);
  });
  it('the odds of a Psychic test', () => {
    expect(testOdds(2, 0, 7).pass).toBeCloseTo(21 / 36, 5);
    expect(testOdds(3, 0, 9).pass).toBeGreaterThan(testOdds(2, 0, 9).pass);
    expect(testOdds(3, 0, 9).perils).toBeGreaterThan(testOdds(2, 0, 9).perils);
  });
  it('the bot (and a player on automatic rules) attempts Rituals at the start of its Shooting phase', () => {
    const s = game([['Rubric Marines', 10, 190], ['Exalted Sorcerer', 1, 95, 'x0'], ['Sorcerer', 1, 95]], [['Boyz', 20, 180], ['Nobz', 5, 125]]);
    put(s, 'p0-x0', { x: 20, y: 25 });
    put(s, 'p0-x2', { x: 30, y: 25 });
    put(s, 'p1-x0', { x: 20, y: 40 });
    put(s, 'p1-x1', { x: 32, y: 40 });
    s.phase = 'shooting';
    s.autoRules = [0];
    expect(autoDue(s, 0)).toBe(true);
    expect(autoStep(s, 0)).toBe(true);
    expect(ritualsPending(s, 0)).toBe(false);
    expect(s.log.some((l) => /Psychic test/.test(l.text) && l.player === 0)).toBe(true);
    // botRituals is safe to call when nothing is left
    botRituals(s, 0);
  });
});

describe('Hexwarp Thrallband: Flow of Magic', () => {
  it('the own deployment zone is in the Flow; No Man\'s Land only while holding half its objectives', () => {
    const s = game([['Rubric Marines', 5, 100], ['Rubric Marines', 5, 100]], [['Boyz', 10, 90]]);
    s.phase = 'shooting';
    const a = put(s, 'p0-x0', { x: 30, y: 4 });
    const b = put(s, 'p0-x1', { x: 30, y: 30 });
    put(s, 'p1-x0', { x: 30, y: 56 });
    s.players[0].flow = undefined;
    const inA = inFlow(s, a);
    const inB = inFlow(s, b);
    expect(inA || inB).toBe(true);
    expect(inA && inB).toBe(false);
    for (const o of s.objectives) o.controller = 0;
    s.players[0].flow = undefined;
    expect(inFlow(s, a) && inFlow(s, b)).toBe(true);
  });
  it('psychic attacks get +1 to wound wholly within Flow of Magic, and re-roll 1s outside', () => {
    const s = game([['Sorcerer', 1, 95], ['Sorcerer', 1, 95]], [['Boyz', 10, 90]]);
    s.phase = 'shooting';
    const inside = put(s, 'p0-x0', { x: 30, y: 4 });
    const outside = put(s, 'p0-x1', { x: 30, y: 30 });
    const boyz = put(s, 'p1-x0', { x: 30, y: 16 });
    s.players[0].flow = undefined;

    const resInside = buildShootPools(s, inside.id, boyz.id, { mode: 'normal' });
    const psyInside = resInside.pools.find((p) => p.psychic);
    expect(psyInside).toBeDefined();
    expect(psyInside?.woundMod).toBe(1);
    expect(psyInside?.woundNote).toContain('Flow of Magic: +1 Wound');

    const resOutside = buildShootPools(s, outside.id, boyz.id, { mode: 'normal' });
    const psyOutside = resOutside.pools.find((p) => p.psychic);
    expect(psyOutside).toBeDefined();
    expect(psyOutside?.rerollWounds1).toBe(true);
    expect(psyOutside?.woundNote).toContain('Flow of Magic: re-roll 1s');
  });
  it('does not apply Flow of Magic when detachment is not Hexwarp Thrallband (e.g. Grand Coven)', () => {
    const s = game([['Sorcerer', 1, 95]], [['Boyz', 10, 90]], 'Grand Coven');
    s.phase = 'shooting';
    const sorc = put(s, 'p0-x0', { x: 30, y: 4 });
    const boyz = put(s, 'p1-x0', { x: 30, y: 16 });
    expect(inFlow(s, sorc)).toBe(false);

    const res = buildShootPools(s, sorc.id, boyz.id, { mode: 'normal' });
    const psy = res.pools.find((p) => p.psychic);
    expect(psy).toBeDefined();
    expect(psy?.woundMod).toBe(0);
    expect(psy?.woundNote ?? '').not.toContain('Flow of Magic');
  });
});

describe('Thousand Sons stratagems', () => {
  it('Infernal Fusillade gives inferno weapons [PSYCHIC]', () => {
    const s = game([['Rubric Marines', 5, 100, undefined, { wargear: [] }]], [['Boyz', 10, 90]], 'Rubricae Phalanx');
    const rm = put(s, 'p0-x0', { x: 20, y: 30 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 40 });
    s.phase = 'shooting'; s.players[0].cp = 5;
    applyDetachmentStratagem(s, 0, strat('INFERNAL FUSILLADE'), rm.id);
    const r = buildShootPools(s, rm.id, boyz.id, { mode: 'normal' });
    expect(r.pools.some((p) => p.psychic && /inferno/i.test(p.weapon))).toBe(true);
  });
  it('Implacable Guardians: -1 Damage on the Rubric Marines', () => {
    const s = game([['Rubric Marines', 5, 100]], [['Boyz', 10, 90]], 'Rubricae Phalanx');
    const rm = put(s, 'p0-x0', { x: 20, y: 30 });
    s.players[0].cp = 5; s.phase = 'shooting'; s.active = 1;
    applyDetachmentStratagem(s, 0, strat('IMPLACABLE GUARDIANS'), rm.id);
    expect((rm.timed ?? []).some((t) => t.e.defend?.damage === -1)).toBe(true);
  });
});

describe('Scintillating Legions: Split', () => {
  it('a slain Pink Horror can split into Blue Horrors', () => {
    const s = game([['Pink Horrors', 10, 115]], [['Boyz', 10, 90]], 'Changehost of Deceit');
    const ph = s.units.find((u) => u.id === 'p0-x0')!;
    expect(ph.templates?.length).toBeGreaterThan(0);
  });
});

describe('Thousand Sons in a game', () => {
  it('the quick Thousand Sons list vs Orks plays to the end with the bot, attempting Rituals', () => {
    const s = createGame({ lists: [PRESETS.TS, PRESETS.ORK], factions: [TS, ORK], names: ['A', 'B'], seed: 11, secondaryMode: 'tactical' });
    s.bots = [0, 1];
    let steps = 0;
    while (s.phase !== 'gameover' && steps < 15000) { botAct(s); steps++; }
    expect(s.phase).toBe('gameover');
    expect(s.log.some((l) => /Psychic test/.test(l.text) && l.player === 0)).toBe(true);
  });

  it('prevents cross-faction allied units (e.g. in CSM) from using Cabal of Sorcerers rituals', () => {
    const s = game([['Rubric Marines', 5, 100]], [['Boyz', 10, 90]]);
    // Simulate player 0 having CSM faction
    s.players[0].factionId = 'CSM';
    s.phase = 'shooting';
    s.active = 0;
    expect(casters(s, 0)).toEqual([]);
    expect(ritualsPending(s, 0)).toBe(false);
  });
});
