// Imperial Knights and Chaos Knights (Faction Packs v1.2): the Oath (Code Chivalric), Bondsman, Super-heavy Walker,
// Harbingers of Dread, Malefic Surge, the army builder's rules, every ability and stratagem automatic, and bot games.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allySources, withAllies } from './allies';
import { actTargets, actsOfUnit, useAct } from './activations';
import { botAct } from './bot';
import { abilityRule, abilityStatus, effectsFor, unitFlags } from './effects';
import { buildUnits, validateList } from './army';
import { pickDetChoice } from './detachments';
import { createGame, formationAt, placeUnit, settleMove } from './game';
import { knightsCommandStart, knightsTurnEnd } from './knights';
import { stratRuleFor } from './stratagems';
import { PRESETS } from '../ui/presets';
import type { ArmyList, FactionData, GameState, UnitState } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const QI = load('QI');
const QT = load('QT');
const SM = load('SM');
const size = { points: 1000, dp: 3, unitLimit: 3, enhancements: 3 };

const with_ = (base: ArmyList, det: string, extra: ArmyList['units'] = []): ArmyList => ({ ...base, detachments: [det], units: [...base.units, ...extra] });
const game = (list: ArmyList, F: FactionData, seed = 3): GameState => createGame({ lists: [list, PRESETS.SM], factions: [F, SM], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed });
const unit = (s: GameState, owner: number, sheet: string) => s.units.find((u) => u.owner === owner && u.sources[0] === sheet)!;

describe('Imperial Knights', () => {
  it('Code Chivalric: a Deed and a Quality; legacy gives +2 OC; reclaim the realm fulfils at the end of the opponent’s turn (+2CP, Honoured)', () => {
    const s = game(with_(PRESETS.QI, 'Valourstrike Lance'), QI);
    s.phase = 'command'; s.active = 0;
    expect(pickDetChoice(s, 0, 'Code Chivalric', ['reclaim', 'eager'])).toBeNull();
    const pal = unit(s, 0, 'Knight Paladin');
    expect(unitFlags(s, pal).move).toBe(2);
    for (const o of s.objectives) o.controller = 0;
    const cp = s.players[0].cp;
    s.active = 1;
    knightsTurnEnd(s);
    expect(s.players[0].knights?.honoured).toBe(true);
    expect(s.players[0].cp).toBe(cp + 2);
  });
  it('a Quality and a Deed must both be picked', () => {
    const s = game(with_(PRESETS.QI, 'Valourstrike Lance'), QI);
    s.phase = 'command'; s.active = 0;
    expect(pickDetChoice(s, 0, 'Code Chivalric', ['reclaim', 'tally'])).toMatch(/one of each/);
  });
  it('Bondsman: in the Command phase the Paladin’s Duty goes to the closest ARMIGER within 12" (Knightly Teachings: up to three)', () => {
    const s = game(with_(PRESETS.QI, 'Spearhead-At-Arms'), QI);
    s.terrain = [];
    const pal = unit(s, 0, 'Knight Paladin');
    const gl = unit(s, 0, 'Armiger Warglaive');
    const hv = unit(s, 0, 'Armiger Helverin');
    placeUnit(s, pal, formationAt(pal, { x: 20, y: 30 }));
    placeUnit(s, gl, formationAt(gl, { x: 30, y: 30 }));
    placeUnit(s, hv, formationAt(hv, { x: 20, y: 40 }));
    s.active = 0; s.phase = 'command';
    knightsCommandStart(s);
    for (const a of [gl, hv]) expect((a.timed ?? []).some((t) => t.mark === `bond:${pal.id}`)).toBe(true);
    expect(gl.keywords).toContain('BATTLELINE');
  });
  it('an allied Imperial Knight resolves its own Bondsman ability in a non-Knight army', () => {
    const source = allySources('SM', 'Imperium').find((a) => a.id === 'QI')!;
    const host = withAllies(SM, [{ src: source, data: QI }]);
    const army = { ...PRESETS.SM, units: [
      ...PRESETS.SM.units,
      { uid: 'paladin-ally', datasheet: 'Knight Paladin', models: 1, pts: 405 },
      { uid: 'armiger-ally', datasheet: 'Armiger Warglaive', models: 1, pts: 140 },
    ] };
    const s = game(army, host);
    s.terrain = [];
    const pal = unit(s, 0, 'Knight Paladin');
    const armiger = unit(s, 0, 'Armiger Warglaive');
    placeUnit(s, pal, formationAt(pal, { x: 20, y: 30 }));
    placeUnit(s, armiger, formationAt(armiger, { x: 29, y: 30 }));
    s.active = 0; s.phase = 'command';
    expect(pal.abilities.find((a) => a.name === 'Paladin’s Duty (Bondsman)')?.faction).toBe('QI');
    knightsCommandStart(s);
    expect(effectsFor(s, armiger).some((a) => a.e.abilities?.includes('lethal hits'))).toBe(true);
    const castellan = { ...army.units[0], uid: 'castellan-ally', datasheet: 'Knight Castellan', pts: 525 };
    const withCastellan = createGame({ lists: [{ ...army, units: [...army.units, castellan] }, PRESETS.SM], factions: [host, SM], names: ['A', 'B'], seed: 3 });
    const alliedCastellan = unit(withCastellan, 0, 'Knight Castellan');
    const aegis = alliedCastellan.abilities.find((a) => a.name === 'Ion Aegis (Aura)')!;
    expect(abilityStatus(alliedCastellan, { ...aegis, faction: 'SM' }).status).toBe('auto');
    expect(abilityRule(alliedCastellan, { ...aegis, faction: 'SM' })?.effects?.[0].defend?.cover).toBe(true);
  });
  it('every Imperial Knight datasheet ability resolves on an ally datasheet preview', () => {
    const source = allySources('SM', 'Imperium').find((a) => a.id === 'QI')!;
    const host = withAllies(SM, [{ src: source, data: QI }]);
    const knightSheets = host.datasheets.filter((d) => d.factionKeywords.includes('IMPERIAL KNIGHTS'));
    const missing: string[] = [];
    for (const sheet of knightSheets) {
      const probe = { sources: [sheet.name], abilities: [], models: [] } as unknown as UnitState;
      for (const a of sheet.abilities.filter((x) => x.type !== 'Core' && x.type !== 'Faction')) {
        const status = abilityStatus(probe, { ...a, sheet: sheet.name, faction: sheet.ally ?? host.id }).status;
        if (status !== 'auto') missing.push(`${sheet.name}: ${a.name} (${status})`);
      }
    }
    expect(missing).toEqual([]);
    const gallant = host.datasheets.find((d) => d.name === 'Knight Gallant')!;
    const probe = { sources: [gallant.name], abilities: [] } as unknown as UnitState;
    const duty = gallant.abilities.find((a) => a.name === 'Gallant’s Duty (Bondsman)')!;
    expect(abilityRule(probe, { ...duty, sheet: gallant.name, faction: gallant.ally ?? host.id })?.bond).toBeDefined();
    const pride = gallant.abilities.find((a) => a.name === 'Martial Pride')!;
    expect(abilityStatus(probe, { ...pride, sheet: gallant.name, faction: gallant.ally ?? host.id }).status).toBe('auto');
  });
  it('an allied Chaos Knight resolves its own datasheet ability', () => {
    const CSM = load('CSM');
    const source = allySources('CSM', 'Chaos').find((a) => a.id === 'QT')!;
    const host = withAllies(CSM, [{ src: source, data: QT }]);
    const army = { ...PRESETS.CSM, units: [...PRESETS.CSM.units, { uid: 'karnivore-ally', datasheet: 'War Dog Karnivore', models: 1, pts: 140 }] };
    const s = createGame({ lists: [army, PRESETS.SM], factions: [host, SM], names: ['A', 'B'], seed: 3 });
    const karnivore = unit(s, 0, 'War Dog Karnivore');
    expect(karnivore.abilities.find((a) => a.name === 'Karnivore')?.faction).toBe('QT');
    expect(effectsFor(s, karnivore).some((a) => a.e.rerollAdvance && a.e.rerollCharge)).toBe(true);
    const legacyAbility = { ...karnivore.abilities.find((a) => a.name === 'Karnivore')!, faction: 'CSM' };
    expect(abilityStatus(karnivore, legacyAbility).status).toBe('auto');
  });
  it('every Chaos Knight datasheet ability is implemented', () => {
    const knightSheets = QT.datasheets.filter((d) => d.factionKeywords.includes('CHAOS KNIGHTS'));
    const missing: string[] = [];
    for (const sheet of knightSheets) {
      const probe = { sources: [sheet.name], abilities: [], models: [] } as unknown as UnitState;
      for (const a of sheet.abilities.filter((x) => x.type !== 'Core' && x.type !== 'Faction')) {
        const status = abilityStatus(probe, { ...a, sheet: sheet.name, faction: QT.id }).status;
        if (status !== 'auto') missing.push(`${sheet.name}: ${a.name} (${status})`);
      }
    }
    expect(missing).toEqual([]);
  });
  it('Canis Rex can remove Battle-shock from an eligible friendly Knight once per battle', () => {
    const list = { ...PRESETS.QI, detachments: ['Valourstrike Lance'], units: [
      { uid: 'canis', datasheet: 'Canis Rex', models: 1, pts: 450 },
      { uid: 'paladin', datasheet: 'Knight Paladin', models: 1, pts: 405 },
    ] };
    const s = game(list, QI);
    const canis = unit(s, 0, 'Canis Rex');
    const paladin = unit(s, 0, 'Knight Paladin');
    placeUnit(s, canis, formationAt(canis, { x: 20, y: 30 }));
    placeUnit(s, paladin, formationAt(paladin, { x: 28, y: 30 }));
    paladin.battleShocked = true;
    const action = actsOfUnit(s, canis).find((a) => a.name === 'Chainbreaker')!;
    expect(actTargets(s, action).map((u) => u.id)).toContain(paladin.id);
    expect(useAct(s, action, paladin.id)).toBeNull();
    expect(paladin.battleShocked).toBe(false);
    expect(useAct(s, action, paladin.id)).toBe('Already used');
  });
  it('Super-heavy Walker: a Normal move goes through infantry', () => {
    const s = game(with_(PRESETS.QI, 'Valourstrike Lance'), QI);
    s.terrain = [];
    const pal = unit(s, 0, 'Knight Paladin');
    placeUnit(s, pal, formationAt(pal, { x: 20, y: 30 }));
    const e = s.units.find((u) => u.owner === 1 && u.models.length >= 5)!;
    placeUnit(s, e, formationAt(e, { x: 30, y: 30 }));
    s.phase = 'movement'; s.active = 0;
    const m = pal.models[0];
    const path = settleMove(s, pal, 'normal', new Map([[m.id, [{ x: m.x, y: m.y }, { x: 40, y: 30 }]]]), { maxFor: () => 30 }).get(m.id)!;
    expect(path[path.length - 1].x).toBeGreaterThan(36);
  });
  it('Mechanicus Allies only with Questor Forgepact, up to 500 points', () => {
    const tp: ArmyList['units'] = [{ uid: 't1', datasheet: 'Tech-priest Dominus', models: 1, pts: 60 }];
    expect(validateList(with_(PRESETS.QI, 'Valourstrike Lance', tp), QI, size).join()).toMatch(/Questor Forgepact/);
    expect(validateList(with_(PRESETS.QI, 'Questor Forgepact', tp), QI, size).join()).not.toMatch(/ADEPTUS MECHANICUS/);
  });
});

describe('Chaos Knights', () => {
  it('Deathly Terror: enemy units within 9" have -1 Leadership; Darkness gives Stealth', () => {
    const s = game(with_(PRESETS.QT, 'Traitoris Lance'), QT);
    s.terrain = [];
    const d = unit(s, 0, 'Knight Desecrator');
    placeUnit(s, d, formationAt(d, { x: 20, y: 30 }));
    const e = s.units.find((u) => u.owner === 1 && u.models.length >= 5)!;
    placeUnit(s, e, formationAt(e, { x: 20, y: 38 }));
    expect(unitFlags(s, e).ld).toBe(-1);
    s.phase = 'command'; s.active = 0; s.round = 1;
    expect(pickDetChoice(s, 0, 'Harbingers of Dread', ['darkness'])).toBeNull();
    expect(unitFlags(s, d).stealth).toBe(true);
    // Paragons of Terror: one more in the first battle round, not rolled
    expect(pickDetChoice(s, 0, 'Harbingers of Dread', ['random'])).toMatch(/Paragons/);
    expect(pickDetChoice(s, 0, 'Harbingers of Dread', ['despair'])).toBeNull();
    expect(unitFlags(s, e).ld).toBe(-2);
  });
  it('Malefic Surge: Chaos Knights are Empowered in the Command phase (Infernal Lance)', () => {
    const s = game(with_(PRESETS.QT, 'Infernal Lance'), QT);
    s.terrain = [];
    const d = unit(s, 0, 'Knight Desecrator');
    placeUnit(s, d, formationAt(d, { x: 20, y: 30 }));
    s.active = 0; s.phase = 'command';
    knightsCommandStart(s);
    expect((d.timed ?? []).some((t) => t.mark === 'Empowered')).toBe(true);
  });
  it('Houndpack Lance needs three War Dogs; Wretched Thralls: DAMNED only with Iconoclast Fiefdom', () => {
    const two: ArmyList = { ...PRESETS.QT, detachments: ['Houndpack Lance'], units: PRESETS.QT.units.slice(0, 3) };
    expect(validateList(two, QT, size).join()).toMatch(/three or more WAR DOG/);
    const mob: ArmyList['units'] = [{ uid: 'm1', datasheet: 'Cultist Mob', models: 10, pts: 50 }];
    expect(validateList(with_(PRESETS.QT, 'Traitoris Lance', mob), QT, size).join()).toMatch(/Iconoclast Fiefdom/);
  });
});

describe('everything automatic', () => {
  for (const F of [QI, QT]) {
    it(`${F.name}: every datasheet ability, enhancement and stratagem resolves by itself`, () => {
      const not: string[] = [];
      for (const det of F.detachments) {
        const all: ArmyList = { name: 'all', factionId: F.id, battleSize: 'onslaught', detachments: [det.name], units: F.datasheets.map((d, i) => ({ uid: `u${i}`, datasheet: d.name, models: d.points[0]?.options[0]?.models ?? 1, pts: 0 })) };
        const units = buildUnits(all, F, 0);
        for (const u of units) for (const a of u.abilities) { const st = abilityStatus(u, a).status; if (st !== 'auto' && st !== 'core' && st !== 'info') not.push(`${a.name}@${u.sources[0]}: ${st}`); }
        for (const e of det.enhancements) { const st = abilityStatus(units[0], { name: e.name, type: 'Enhancement', text: e.text, faction: F.id } as never).status; if (st !== 'auto' && st !== 'info') not.push(`${e.name}: ${st}`); }
        const s = game({ ...all, units: all.units.slice(0, 2) }, F);
        for (const st of det.stratagems) if (stratRuleFor(s, 0, st).status !== 'auto') not.push(`${st.name}: ${stratRuleFor(s, 0, st).status}`);
      }
      expect([...new Set(not)]).toEqual([]);
    });
  }
});

describe('Knights in a game', () => {
  for (const [F, base] of [[QI, PRESETS.QI], [QT, PRESETS.QT]] as const) {
    for (const det of F.detachments.map((d) => d.name)) {
      it(`bot vs bot reaches game over: ${F.name} — ${det}`, () => {
        const extra: ArmyList['units'] = det === 'Questor Forgepact' ? [{ uid: 'x1', datasheet: 'Tech-priest Dominus', models: 1, pts: 60 }]
          : det === 'Iconoclast Fiefdom' ? [{ uid: 'x1', datasheet: 'Cultist Mob', models: 10, pts: 50 }] : [];
        const s = game(with_(base, det, extra), F, 11);
        s.bots = [0, 1];
        let steps = 0;
        while (s.phase !== 'gameover' && steps < 6000) { botAct(s); steps++; }
        expect(s.phase).toBe('gameover');
        for (const u of s.units) for (const m of u.models) expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
      }, 240000);
    }
  }
});
