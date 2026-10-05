// Adeptus Custodes (Codex 2026): every rule has machine-readable data, Martial Ka'tah readies units and the ka'tah
// abilities work, and a whole game against Orks plays through with the bot using them.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { actsOfUnit, manualActs, useActByKey } from './activations';
import { buildFightPools } from './attack';
import { botAct } from './bot';
import { abilityRule, DET_RULES } from './effects';
import { buildUnits, enhancementFits, listPoints, validateList } from './army';
import { createGame, formationAt, placeUnit } from './game';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const AC = load('AC');
const ORK = load('ORK');

type Row = [string, number, number, string?, Partial<{ enhancement: string; warlord: boolean }>?];
const list = (factionId: string, units: Row[], det = 'Guardians of the Throne'): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments: factionId === 'AC' ? [det] : [],
  units: units.map(([d, n, pts, attachTo, extra], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts, attachTo, ...extra })),
});

function game(ac: Row[], ork: Row[], det?: string): GameState {
  const s = createGame({
    lists: [list('AC', ac, det), list('ORK', ork)], factions: [AC, ORK], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
  });
  s.terrain = s.terrain.filter((t) => t.objectiveId);
  s.terrain.forEach((t) => { t.walls = []; t.category = 'exposed'; });
  if (det) s.players[0].detachments = AC.detachments.filter((d) => d.name === det);
  s.round = 2; s.turn = 2; s.active = 0;
  return s;
}

function put(s: GameState, unitId: string, c: Pt) {
  const u = s.units.find((x) => x.id === unitId)!;
  placeUnit(s, u, formationAt(u, c));
  u.setUpTurn = -10;
  return u;
}

describe('Adeptus Custodes: every rule has data', () => {
  it('datasheet abilities', () => {
    const missing = new Set<string>();
    for (const d of AC.datasheets) for (const a of d.abilities) {
      if (a.type === 'Core' || (a.type === 'Faction' && DET_RULES[a.name])) continue;
      const u = { sources: [d.name], abilities: [] } as unknown as Parameters<typeof abilityRule>[0];
      if (!abilityRule(u, { ...a, sheet: d.name, faction: 'AC' })) missing.add(`${a.name}@${d.name}`);
    }
    expect([...missing]).toEqual([]);
  });
  it('army rules and detachments', () => {
    expect(AC.armyRules.map((r) => r.name).filter((n) => !DET_RULES[n])).toEqual([]);
    expect(AC.detachments.map((d) => d.name).filter((n) => !DET_RULES[n])).toEqual([]);
  });
  it('enhancements', () => {
    const missing = AC.detachments.flatMap((d) => d.enhancements).filter((e) => {
      const u = { sources: [e.name], abilities: [] } as unknown as Parameters<typeof abilityRule>[0];
      return !abilityRule(u, { name: e.name, type: 'Enhancement', text: e.text, sheet: e.name, faction: 'AC' });
    }).map((e) => e.name);
    expect(missing).toEqual([]);
  });
  it('stratagems', () => {
    const rules = (JSON.parse(fs.readFileSync('data/stratagems/AC.json', 'utf8')) as { rules: Record<string, unknown> }).rules;
    const missing = AC.detachments.flatMap((d) => d.stratagems.filter((st) => !rules[st.name] && !rules[`${st.name}@${d.name}`]).map((st) => `${st.name}@${d.name}`));
    expect(missing).toEqual([]);
    // 6 in Guardians of the Throne, 3 in every other detachment (the pack has only 2 for Auric Champions)
    expect(AC.detachments.reduce((a, d) => a + d.stratagems.length, 0)).toBe(41);
  });
  it('enhancement restrictions read "X/Y unit only (excluding Z units)" and enhancement weapons', () => {
    const fits = (n: string, sheet: string) => {
      const e = AC.detachments.flatMap((d) => d.enhancements).find((x) => x.name === n)!;
      const d = AC.datasheets.find((x) => x.name === sheet)!;
      return enhancementFits(e.text, [...d.keywords, ...d.factionKeywords])?.ok;
    };
    expect(fits('Auric Eagle', 'Shield-Captain')).toBe(true);
    expect(fits('Auric Eagle', 'Shield-Captain in Allarus Terminator Armour')).toBe(false);
    expect(fits('Memento Moritoi', 'Telemon Heavy Dreadnought')).toBe(true);
    expect(fits('Memento Moritoi', 'Shield-Captain')).toBe(false);
    expect(fits('Bane of Abominations', 'Knight-Centura')).toBe(false);
    const m = buildUnits({ name: 't', factionId: 'AC', battleSize: 'strike', detachments: ['Emissaries Imperatus'], units: [{ uid: 'a', datasheet: 'Shield-Captain', models: 1, pts: 180, enhancement: 'Auriferous Orb' }] }, AC, 0)[0].models[0];
    const orb = m.weapons.find((w) => w.name === 'Auriferous Orb')!;
    expect(orb.profiles[0]).toMatchObject({ range: 12, A: '3', S: 1 });
    expect(orb.profiles[0].abilities).toContain('devastating wounds');
  });
});

describe('mustering (11th edition)', () => {
  const size = { points: 2000, dp: 3, unitLimit: 3, enhancements: 3 };
  it('the 2nd and later Shield-Captains cost 20 pts more; at most 3', () => {
    const l = list('AC', [['Shield-Captain', 1, 180, undefined, { warlord: true }], ['Shield-Captain', 1, 180], ['Shield-Captain', 1, 180]]);
    expect(listPoints(l)).toBe(540);
    expect(listPoints(l, AC)).toBe(580);
    expect(validateList(l, AC, size).some((e) => /ใส่ได้ไม่เกิน/.test(e))).toBe(false);
    l.units.push({ uid: 'x9', datasheet: 'Shield-Captain', models: 1, pts: 180 });
    expect(validateList(l, AC, size).some((e) => /Shield-Captain: ใส่ได้ไม่เกิน 3/.test(e))).toBe(true);
  });
  it('Trajann must be the Warlord; an ANATHEMA PSYKANA character can\'t be (unless Null Maiden Vigil)', () => {
    const l = list('AC', [['Trajann Valoris', 1, 265], ['Knight-Centura', 1, 55, undefined, { warlord: true }]]);
    const errs = validateList(l, AC, size);
    expect(errs.some((e) => /Trajann Valoris ต้องเป็น Warlord/.test(e))).toBe(true);
    expect(errs.some((e) => /ANATHEMA PSYKANA\) เป็น Warlord ไม่ได้/.test(e))).toBe(true);
    l.detachments = ['Null Maiden Vigil'];
    expect(validateList(l, AC, size).some((e) => /ANATHEMA PSYKANA\) เป็น Warlord ไม่ได้/.test(e))).toBe(false);
  });
});

describe('Martial Ka\'tah', () => {
  it('units are readied at the start of the Command phase; a ka\'tah ability uses it up', () => {
    const s = game([['Custodian Guard', 3, 240]], [['Boyz', 10, 90]]);
    const cg = put(s, 'p0-x0', { x: 20, y: 30 });
    put(s, 'p1-x0', { x: 20, y: 31.9 });
    s.phase = 'fight';
    s.fight = { step: 'pileIn', stepPlayer: 0, chooser: 0, eligible: [], fought: [], forcedNext: null, movedThisStep: [] };
    cg.readied = true;
    const dac = manualActs(s, 0).find((m) => m.def.name === 'Martial Ka\'tah' && /Dacatarai/.test(m.label))!;
    expect(dac.why).toBeNull();
    expect(useActByKey(s, cg.id, dac.def.key)).toBeNull();
    expect(cg.readied).toBe(false);
    expect(manualActs(s, 0).find((m) => m.def.name === 'Martial Ka\'tah' && /Kaptaris/.test(m.label))!.why).not.toBeNull();
    expect((cg.timed ?? []).some((t) => t.e.reroll === 'hits1' && t.e.attack === 'melee')).toBe(true);
    expect(buildFightPools(s, cg.id, 'p1-x0').pools.every((p) => p.rerollHits1)).toBe(true);
  });
  it('Master of Ka\'tahs readies the unit again once per battle round', () => {
    const s = game([['Custodian Guard', 3, 240], ['Shield-Captain', 1, 180, 'x0']], [['Boyz', 10, 90]]);
    const cg = put(s, 'p0-x0', { x: 20, y: 30 });
    cg.readied = false;
    s.phase = 'movement';
    const def = actsOfUnit(s, cg).find((d) => d.name.startsWith('Master of Ka') && d.spec.when === 'anyPhase')!;
    expect(useActByKey(s, cg.id, def.key)).toBeNull();
    expect(cg.readied).toBe(true);
    cg.readied = false;
    expect(useActByKey(s, cg.id, def.key)).not.toBeNull();
  });
});

describe('Adeptus Custodes in a game', () => {
  it('Custodes vs Space Marines plays to the end with the bot (readied units, ka\'tah abilities)', () => {
    const SM = load('SM');
    const ac = list('AC', [['Custodian Guard', 3, 240], ['Shield-Captain', 1, 180, 'x0', { warlord: true }], ['Allarus Custodians', 2, 180], ['Vertus Praetors', 2, 220], ['Prosecutors', 5, 50]]);
    const sm: ArmyList = { name: 'sm', factionId: 'SM', battleSize: 'incursion', detachments: ['Gladius Task Force'], units: [
      { uid: 'a1', datasheet: 'Intercessor Squad', models: 10, pts: 150 }, { uid: 'a2', datasheet: 'Captain', models: 1, pts: 80, attachTo: 'a1', warlord: true },
      { uid: 'a3', datasheet: 'Hellblaster Squad', models: 5, pts: 110 }, { uid: 'a4', datasheet: 'Assault Intercessor Squad', models: 10, pts: 150 },
      { uid: 'a5', datasheet: 'Redemptor Dreadnought', models: 1, pts: 195 }, { uid: 'a6', datasheet: 'Eliminator Squad', models: 3, pts: 75 }] };
    const s = createGame({ lists: [ac, sm], factions: [AC, SM], names: ['A', 'B'], seed: 7, secondaryMode: 'tactical' });
    s.bots = [0, 1];
    let steps = 0;
    while (s.phase !== 'gameover' && steps < 15000) { botAct(s); steps++; }
    expect(s.phase).toBe('gameover');
    expect(s.log.some((l) => /readied/.test(l.text))).toBe(true);
    expect(s.log.some((l) => /Martial Ka'tah/.test(l.text) && l.player === 0)).toBe(true);
  });
});
