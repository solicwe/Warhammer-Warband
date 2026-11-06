// Thousand Sons (Faction Pack v1.3): every rule has machine-readable data, Rituals are attempted at the start of the
// Shooting phase (by the bot and by a player on automatic rules), the Flow of Magic, Split, and whole games with the bot.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildShootPools } from './attack';
import { applyDetachmentStratagem } from '../rules-engine/stratagems';
import { botAct } from '../ai/bot';
import { abilityRule, DET_RULES } from '../rules-engine/effects';
import { listPoints, validateList } from './army';
import { createGame, endPhase, formationAt, placeUnit } from './game';
import { inFlow } from '../factions/flow';
import { attemptRitual, casters, ritualsLeft, ritualsPending, testOdds } from '../factions/rituals';
import { botRituals } from '../ai/botRituals';
import { autoDue, autoSelectToShoot, autoStep } from '../ai/autoPlay';
import { manualActs } from '../rules-engine/activations';
import { unitDistance } from './state';
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
  it('a Sorcerer cannot repeat a manifested Ritual this turn; Doombolt deals mortal wounds', () => {
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

  it("offers Fatecaster Greatbows' Malign Trickery after the opponent's Movement phase", () => {
    const s = game([['Tzaangor Enlightened with Fatecaster Greatbows', 3, 55]], [['Boyz', 10, 90]]);
    const greatbows = put(s, 'p0-x0', { x: 20, y: 25 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 39 });
    expect(unitDistance(greatbows, boyz)).toBeGreaterThan(8);
    expect(unitDistance(greatbows, boyz)).toBeLessThan(12);
    s.active = 1;
    s.phase = 'movement';

    endPhase(s);

    expect(s.phase).toBe('movement');
    expect(s.window?.kind).toBe('abilityMove');
    if (s.window?.kind !== 'abilityMove') throw new Error('Expected Malign Trickery reaction window');
    expect(s.window.player).toBe(0);
    expect(s.window.offers).toContainEqual(expect.objectContaining({ unitId: greatbows.id, label: expect.stringContaining('Malign Trickery') }));
  });
  it('allows another eligible caster to retry a failed Ritual', () => {
    let failedState: GameState | undefined;
    for (let i = 0; i < 30 && !failedState; i++) {
      const candidate = game([['Rubric Marines', 5, 100], ['Sorcerer', 1, 95, 'x0']], [['Boyz', 10, 90]]);
      put(candidate, 'p0-x0', { x: 20, y: 30 });
      const boyz = put(candidate, 'p1-x0', { x: 20, y: 45 });
      candidate.phase = 'shooting';
      candidate.rng = 3000 + i * 7919;
      const result = attemptRitual(candidate, 0, casters(candidate, 0)[0].model.id, 'doombolt', boyz.id, { channel: false });
      expect(result.error).toBeNull();
      if (result.out?.manifested === false) failedState = candidate;
    }
    expect(failedState).toBeDefined();
    if (!failedState) throw new Error('Could not generate a failed Ritual test');
    const retry = casters(failedState, 0)[0];
    expect(ritualsLeft(failedState, 0, retry).some((r) => r.id === 'doombolt')).toBe(true);
    expect(attemptRitual(failedState, 0, retry.model.id, 'doombolt', 'p1-x0', { channel: false }).error).toBeNull();
  });
  it('Ritual of Regeneration: a wounded unit that manifests a Ritual heals (Sorcerous Invigoration), once a turn', () => {
    const s = game([['Rubric Marines', 5, 100], ['Sorcerer', 1, 95, 'x0']], [['Boyz', 10, 90]], 'Ritual of Regeneration');
    const rubrics = put(s, 'p0-x0', { x: 20, y: 30 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 45 });
    s.phase = 'shooting';
    const hurt = rubrics.models.filter((m) => !m.dead)[1];
    let healed = false;
    for (let i = 0; i < 30 && !healed; i++) {
      s.players[0].rituals = undefined;
      s.players[0].abilityUsed = {};
      hurt.wounds = 1;
      s.rng = 2000 + i * 7919;
      const r = attemptRitual(s, 0, casters(s, 0)[0].model.id, 'doombolt', boyz.id, { channel: true });
      expect(r.error).toBeNull();
      if (r.out?.manifested) { healed = true; expect(hurt.wounds).toBeGreaterThan(1); }
      else expect(hurt.wounds).toBe(1);
    }
    expect(healed).toBe(true);
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

describe('Twisted Sorceries (once per battle)', () => {
  const offered = (s: GameState) => manualActs(s, 0).some((m) => m.def.name.startsWith('Twisted Sorceries') && m.def.spec.when === 'selectedToShoot');
  for (const decides of [true, false]) {
    it(decides ? 'a player who decides keeps it for the button when the Sorcerer is picked to shoot' : 'automatic rules still use it for the player', () => {
      const s = game([['Sorcerer', 1, 95]], [['Boyz', 20, 180]]);
      const u = put(s, 'p0-x0', { x: 20, y: 25 });
      put(s, 'p1-x0', { x: 20, y: 33 });
      s.phase = 'shooting';
      s.autoRules = [0];
      s.decides = decides ? [0] : [];
      expect(offered(s)).toBe(true);
      autoSelectToShoot(s, u);
      expect(offered(s)).toBe(decides);
    });
  }
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

  it('Changehost of Deceit: Mortal Sorcery only allows Scintillating Legions Psykers to cast when within 6" and visible to a Thousand Sons unit', () => {
    // Player 0 has Lord of Change (Scintillating Legions Psyker) and Rubric Marines (Thousand Sons)
    const s = game(
      [['Lord of Change', 1, 320], ['Rubric Marines', 5, 100]],
      [['Boyz', 10, 90]],
      'Changehost of Deceit'
    );
    const loc = put(s, 'p0-x0', { x: 20, y: 20 });
    const rubrics = put(s, 'p0-x1', { x: 40, y: 40 }); // > 6" away
    s.phase = 'shooting';
    s.active = 0;

    // Only the Aspiring Sorcerer from Rubric Marines is a caster; Lord of Change cannot cast (not within 6")
    let cs = casters(s, 0);
    expect(cs.map((c) => c.unit.id)).toEqual(['p0-x1']);
    expect(cs.some((c) => c.unit.id === loc.id)).toBe(false);

    // Now move Rubric Marines to within 6" (e.g. { x: 23, y: 20 }) and visible
    rubrics.models[0].x = 23;
    rubrics.models[0].y = 20;

    cs = casters(s, 0);
    // Now Lord of Change CAN cast because a Thousand Sons unit is within 6" and visible
    expect(cs.some((c) => c.unit.id === loc.id)).toBe(true);
    expect(cs.some((c) => c.unit.id === rubrics.id)).toBe(true);

    // If Thousand Sons unit is removed / dead, Lord of Change cannot cast
    for (const m of rubrics.models) m.dead = true;
    cs = casters(s, 0);
    expect(cs.some((c) => c.unit.id === loc.id)).toBe(false);
  });
});

describe('Risen Rubricae enhancement', () => {
  it('gives the bearer unit Infiltrators when standalone', () => {
    const s = game([['Exalted Sorcerer', 1, 90, undefined, { enhancement: 'Risen Rubricae' }]], [['Boyz', 10, 90]], 'Rubricae Phalanx');
    const sorc = s.units.find((u) => u.sources.includes('Exalted Sorcerer'))!;
    expect(sorc.core.infiltrators).toBe(true);
  });

  it('gives at most 2 Rubric Marines Infiltrators when selecting battleline', () => {
    const s = game([
      ['Rubric Marines', 5, 100],
      ['Exalted Sorcerer', 1, 90, 'x0', { enhancement: 'Risen Rubricae' }],
      ['Rubric Marines', 5, 100],
      ['Rubric Marines', 5, 100],
    ], [['Boyz', 10, 90]], 'Rubricae Phalanx');
    const rubrics = s.units.filter((u) => u.owner === 0 && u.sources.includes('Rubric Marines'));
    expect(rubrics.length).toBe(3);
    const infiltrating = rubrics.filter((u) => u.core.infiltrators);
    // At most 2 Rubric Marines can infiltrate!
    expect(infiltrating.length).toBe(2);
  });

  it('gives only 1 unit Infiltrators when selecting Scarab Occult Terminators', () => {
    const s = game([
      ['Scarab Occult Terminators', 5, 180],
      ['Sorcerer In Terminator Armour', 1, 105, 'x0', { enhancement: 'Risen Rubricae' }],
      ['Scarab Occult Terminators', 5, 180],
    ], [['Boyz', 10, 90]], 'Rubricae Phalanx');
    const terms = s.units.filter((u) => u.owner === 0 && u.sources.includes('Scarab Occult Terminators'));
    expect(terms.length).toBe(2);
    const infiltrating = terms.filter((u) => u.core.infiltrators);
    // Only 1 Terminator unit can infiltrate!
    expect(infiltrating.length).toBe(1);
  });

  it('allows toggling between 2 Rubric Marines and 1 Terminator unit', async () => {
    const { toggleRisenRubricae } = await import('../factions/thousandSons');
    const s = game([
      ['Rubric Marines', 5, 100],
      ['Exalted Sorcerer', 1, 90, 'x0', { enhancement: 'Risen Rubricae' }],
      ['Rubric Marines', 5, 100],
      ['Scarab Occult Terminators', 5, 180],
    ], [['Boyz', 10, 90]], 'Rubricae Phalanx');

    const rubric1 = s.units.find((u) => u.sources.includes('Exalted Sorcerer'))!;
    const rubric2 = s.units.find((u) => u.owner === 0 && u.sources.includes('Rubric Marines') && u.id !== rubric1.id)!;
    const term = s.units.find((u) => u.sources.includes('Scarab Occult Terminators'))!;

    // Initial default: 2 Rubric Marines have Infiltrators
    expect(rubric1.core.infiltrators).toBe(true);
    expect(rubric2.core.infiltrators).toBe(true);
    expect(term.core.infiltrators).toBe(false);

    // Switch to Terminator: Terminator gets Infiltrators, Rubrics lose it
    toggleRisenRubricae(s, 0, term.id);
    expect(term.core.infiltrators).toBe(true);
    expect(rubric1.core.infiltrators).toBe(false);
    expect(rubric2.core.infiltrators).toBe(false);

    // Switch back to Rubrics: click rubric1 then rubric2
    toggleRisenRubricae(s, 0, rubric1.id);
    expect(rubric1.core.infiltrators).toBe(true);
    expect(term.core.infiltrators).toBe(false);

    toggleRisenRubricae(s, 0, rubric2.id);
    expect(rubric1.core.infiltrators).toBe(true);
    expect(rubric2.core.infiltrators).toBe(true);
    expect(term.core.infiltrators).toBe(false);

    const { setRisenRubricae } = await import('../factions/thousandSons');
    // Cannot select 1 Terminator + 1 Rubric Marine
    expect(setRisenRubricae(s, 0, [term.id, rubric1.id])).toBe(
      'Risen Rubricae can only select 1 Terminator/other Rubricae unit, or up to 2 Rubricae Battleline units'
    );
  });

  it('synchronizes Risen Rubricae with Reserves, excluding units sent to reserves', async () => {
    const { declareReserves } = await import('./game');
    const { risenRubricaeCandidates } = await import('../factions/thousandSons');
    const s = game([
      ['Scarab Occult Terminators', 5, 180],
      ['Sorcerer In Terminator Armour', 1, 105, 'x0', { enhancement: 'Risen Rubricae' }],
      ['Scarab Occult Terminators', 5, 180],
      ['Rubric Marines', 5, 100],
      ['Rubric Marines', 5, 100],
      ['Mutalith Vortex Beast', 1, 165],
      ['Chaos Spawn', 2, 65],
      ['Sorcerer', 1, 95],
    ], [['Boyz', 10, 90]], 'Rubricae Phalanx');

    // All units start as 'pending'
    s.units.forEach((u) => { u.status = 'pending'; });

    const termWithEnhancement = s.units.find((u) => u.sources.includes('Sorcerer In Terminator Armour'))!;
    const otherTerm = s.units.find((u) => u.sources.includes('Scarab Occult Terminators') && u.id !== termWithEnhancement.id)!;
    const rubric = s.units.find((u) => u.sources.includes('Rubric Marines'))!;

    // Initial state: bearer unit (termWithEnhancement) is auto-selected for Infiltrators
    expect(termWithEnhancement.core.infiltrators).toBe(true);

    // Send the bearer unit to reserves (285 pts < 495 pts cap)
    const err = declareReserves(s, 0, [termWithEnhancement.id]);
    expect(err).toBeNull();

    expect(termWithEnhancement.status).toBe('reserves');
    // Infiltrators is cleared from unit sent to reserves
    expect(termWithEnhancement.core.infiltrators).toBe(false);

    // Only non-reserve units appear as candidates
    const cands = risenRubricaeCandidates(s, 0);
    const candIds = cands.map((c) => c.unit.id);
    expect(candIds).not.toContain(termWithEnhancement.id);
    expect(candIds).toContain(otherTerm.id);
    expect(candIds).toContain(rubric.id);
  });
});
