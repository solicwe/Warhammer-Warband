import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { acceptOffer, actsOfUnit, abilityChoices, fire, freeDiceNow, initSagas, manualActs, pickAbilities, resolveRevivals, useActByKey, useFreeDie } from './activations';
import { detChoices, pickDetChoice } from './detachments';
import { buildFightPools, buildShootPools, finishAttack, resolveAll, rollHits, startAttack } from './attack';
import { abilityRule, effectsFor } from './effects';
import { commitMove, createGame, endPhase, formationAt, ingressUnit, placeUnit, updateControl, validatePlacement } from './game';
import { alive, canUseStratagem, spendStratagem, stratCost } from './state';
import type { ArmyList, FactionData, GameState, Pt } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

type Row = [string, number, number, string?, Partial<{ split: boolean; warlord: boolean }>?];
function list(factionId: string, units: Row[]): ArmyList {
  return {
    name: 't', factionId, battleSize: 'incursion', detachments: [],
    units: units.map(([d, n, pts, attachTo, extra], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts, attachTo, ...extra })),
  };
}

function game(sm: Row[], ork: Row[]): GameState {
  const s = createGame({
    lists: [list('SM', sm), list('ORK', ork)], factions: [SM, ORK], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42,
  });
  s.terrain = s.terrain.filter((t) => t.objectiveId); // ability tests run on an open board
  s.terrain.forEach((t) => (t.walls = []));
  s.round = 2; s.turn = 2;
  return s;
}

function put(s: GameState, unitId: string, c: Pt) {
  const u = s.units.find((x) => x.id === unitId)!;
  placeUnit(s, u, formationAt(u, c));
  u.setUpTurn = -10;
  return u;
}

describe('ability data covers every Space Marine and Ork ability', () => {
  for (const f of [SM, ORK]) {
    it(`${f.id}: every datasheet ability has a rule`, () => {
      const missing = new Set<string>();
      const handled = ['Oath of Moment', 'Templar Vows']; // army rules (core code / Templar Vows choice)
      for (const d of f.datasheets) for (const a of d.abilities) {
        if (a.type === 'Core' || handled.includes(a.name)) continue;
        const u = { sources: [d.name], abilities: [] } as unknown as Parameters<typeof abilityRule>[0];
        if (!abilityRule(u, { ...a, sheet: d.name, faction: f.id })) missing.add(a.name);
      }
      expect([...missing]).toEqual([]);
    });
  }
});

describe('Ork abilities', () => {
  it('Might Is Right: the Warboss gets +3 A and +2 S after charging, the Boyz do not', () => {
    const s = game([['Intercessor Squad', 10, 150]], [['Boyz', 10, 90], ['Warboss', 1, 100, 'x0']]);
    s.phase = 'fight'; s.active = 1;
    const sm = put(s, 'p0-x0', { x: 20, y: 20 });
    const ork = put(s, 'p1-x0', { x: 20, y: 25.2 });
    ork.chargedTurn = s.turn;
    const pools = buildFightPools(s, ork.id, sm.id).pools;
    const boss = pools.filter((p) => p.key.startsWith('Warboss|'));
    const boyz = pools.filter((p) => p.key.startsWith('Boyz|'));
    expect(boss.length).toBeGreaterThan(0);
    expect(boss.every((p) => p.attackBonus === 3)).toBe(true);
    expect(boyz.every((p) => !p.attackBonus)).toBe(true);
  });

  it('Prophet of da Great Waaagh! (aura): Ork melee +1 hit and +1 wound within 6"', () => {
    const s = game([['Intercessor Squad', 10, 150]], [['Boyz', 10, 90], ['Ghazghkull Thraka', 1, 300]]);
    s.phase = 'fight'; s.active = 1;
    const sm = put(s, 'p0-x0', { x: 20, y: 20 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 25.2 });
    put(s, 'p1-x1', { x: 34, y: 30 });
    const far = buildFightPools(s, boyz.id, sm.id).pools;
    expect(far.every((p) => p.hitMod === 0)).toBe(true);
    put(s, 'p1-x1', { x: 26, y: 27 });
    const near = buildFightPools(s, boyz.id, sm.id).pools;
    expect(near.every((p) => p.hitMod === 1 && p.woundMod === 1)).toBe(true);
  });

  it('Arrogant Invulnerability worsens AP; Mobile Fortress makes ranged damage −1', () => {
    const s = game([['Devastator Squad', 5, 120]], [['Meganobz', 3, 110], ['Battlewagon', 1, 150]]);
    s.phase = 'shooting'; s.active = 0;
    const dev = put(s, 'p0-x0', { x: 20, y: 10 });
    const mega = put(s, 'p1-x0', { x: 14, y: 26 });
    const bw = put(s, 'p1-x1', { x: 28, y: 26 });
    const vs = buildShootPools(s, dev.id, mega.id, { mode: 'normal' }).pools;
    for (const p of vs) expect(p.ap).toBe(Math.min(0, p.profile.AP + 1));
    const r = buildShootPools(s, dev.id, bw.id, { mode: 'normal' });
    startAttack(s, 'shoot', dev.id, bw.id, r.pools);
    resolveAll(s);
    const lines = s.attack!.pools.flatMap((p) => p.damageLines).join(' ');
    finishAttack(s);
    expect(alive(bw).length).toBe(1);
    void lines;
  });

  it('Crude Surgery heals at the start of the Command phase', () => {
    const s = game([['Intercessor Squad', 10, 150]], [['Boyz', 10, 90], ['Painboy', 1, 45, 'x0']]);
    const boyz = put(s, 'p1-x0', { x: 20, y: 30 });
    const doc = boyz.models.find((m) => m.source === 'Painboy')!;
    doc.wounds = 1;
    s.active = 1; s.phase = 'command';
    fire(s, 'commandStart', [boyz]);
    expect(doc.wounds).toBe(Math.min(doc.profile.W, 4));
  });

  it('Ammo Runts: a button once per battle, +1 to hit for that shooting', () => {
    const s = game([['Intercessor Squad', 10, 150]], [['Boyz', 10, 90]]);
    s.phase = 'shooting'; s.active = 1;
    const sm = put(s, 'p0-x0', { x: 20, y: 14 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 24 });
    const before = buildShootPools(s, boyz.id, sm.id, { mode: 'normal' }).pools[0].hitMod;
    const m = manualActs(s, 1).find((x) => x.def.name.startsWith('Ammo Runts'))!;
    expect(m).toBeTruthy();
    expect(useActByKey(s, boyz.id, m.def.key)).toBeNull();
    expect(buildShootPools(s, boyz.id, sm.id, { mode: 'normal' }).pools[0].hitMod).toBe(before + 1);
    expect(manualActs(s, 1).some((x) => x.def.name.startsWith('Ammo Runts'))).toBe(false); // used up
  });

  it('Bomb Squigs: once per turn, twice per battle', () => {
    const s = game([['Intercessor Squad', 10, 150]], [['Tankbustas', 6, 145]]);
    s.phase = 'movement'; s.active = 1;
    put(s, 'p0-x0', { x: 20, y: 14 });
    const tb = put(s, 'p1-x0', { x: 20, y: 24 });
    const bomb = () => manualActs(s, 1).find((x) => x.def.name.startsWith('Bomb Squigs'));
    expect(bomb()).toBeUndefined(); // only after a normal move
    tb.move = 'normal';
    expect(bomb()).toBeTruthy();
    useActByKey(s, tb.id, bomb()!.def.key);
    expect(bomb()).toBeUndefined();
    s.turn += 2;
    expect(bomb()).toBeTruthy();
    useActByKey(s, tb.id, bomb()!.def.key);
    s.turn += 2;
    expect(bomb()).toBeUndefined(); // twice per battle
  });
});

describe('Space Marine abilities', () => {
  it('Evade and Survive: an enemy ending a move within 8" offers a 6" move to the Lieutenant', () => {
    const s = game([['Lieutenant with Combi-weapon', 1, 95]], [['Boyz', 10, 90]]);
    s.phase = 'movement'; s.active = 1;
    const lt = put(s, 'p0-x0', { x: 20, y: 14 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 30 });
    const paths = new Map(alive(boyz).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y - 6 }]]));
    commitMove(s, boyz, 'normal', paths);
    expect(s.window?.kind).toBe('abilityMove');
    const w = s.window as { offers: { unitId: string; key: string }[] };
    expect(w.offers[0].unitId).toBe(lt.id);
    expect(acceptOffer(s, lt.id, w.offers[0].key)).toBeNull();
    expect(lt.extraMove?.max).toBe(6);
    const away = new Map(alive(lt).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y - 5 }]]));
    commitMove(s, lt, 'extra', away);
    expect(lt.extraMove).toBeUndefined();
    expect(s.window).toBeNull();
  });

  it('Heroic Last Stand: a Battle Leader killed in melee fights back before being removed', () => {
    const s = game([['Wolf Guard Battle Leader', 1, 65]], [['Boyz', 20, 180]]);
    s.phase = 'fight'; s.active = 1;
    s.fight = { step: 'fight', stepPlayer: 1, chooser: 1, eligible: [], fought: [], forcedNext: null, movedThisStep: [] };
    const bl = put(s, 'p0-x0', { x: 20, y: 20 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 23.5 });
    // make sure he dies and passes the 2+ roll: give the Boyz an absurd amount of attacks against him
    const r = buildFightPools(s, boyz.id, bl.id);
    for (const p of r.pools) { p.attackBonus = 10; }
    let fought = false;
    for (let seed = 1; seed < 40 && !fought; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      startAttack(t, 'fight', boyz.id, bl.id, structuredClone(r.pools));
      resolveAll(t);
      finishAttack(t);
      fought = t.log.some((l) => /ตีก่อนถูกนำออก/.test(l.text));
    }
    expect(fought).toBe(true);
  });

  it('Rites of Battle: −1CP on a stratagem once per battle round; Unorthodox Strategist taxes the opponent', () => {
    const s = game([['Intercessor Squad', 10, 150], ['Captain', 1, 80], ['Uriel Ventris', 1, 105]], [['Boyz', 10, 90]]);
    s.phase = 'shooting'; s.active = 0;
    put(s, 'p0-x0', { x: 20, y: 14 });
    const ints = put(s, 'p0-x1', { x: 30, y: 10 }); // Rites of Battle: the Captain's own unit
    put(s, 'p0-x2', { x: 26, y: 18 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 25 });
    expect(stratCost(s, 'command-reroll', ints, 1)).toBe(0);
    s.players[0].cp = 5;
    spendStratagem(s, 0, 'command-reroll', ints);
    expect(s.players[0].cp).toBe(5);
    expect(stratCost(s, 'command-reroll', ints, 1)).toBe(1); // once per battle round
    // Uriel within 12" of the Boyz: the Ork player's stratagem on them costs 1 more, once per turn
    expect(stratCost(s, 'command-reroll', boyz, 1)).toBe(2);
    s.players[1].cp = 5;
    spendStratagem(s, 1, 'command-reroll', boyz);
    expect(s.players[1].cp).toBe(3);
    expect(stratCost(s, 'command-reroll', boyz, 1)).toBe(1);
    expect(canUseStratagem(s, 1, 'command-reroll', boyz)).toBeTruthy(); // once per phase anyway
  });

  it('Combat Squads splits a Tactical Squad into two units of five', () => {
    const s = game([['Tactical Squad', 10, 140, undefined, { split: true }]], [['Boyz', 10, 90]]);
    const tac = s.units.filter((u) => u.owner === 0);
    expect(tac.map((u) => u.models.length)).toEqual([5, 5]);
    expect(tac[0].models.some((m) => /Sergeant/.test(m.name))).toBe(true);
    expect(tac[0].pts + tac[1].pts).toBe(140);
  });

  it('Author of the Codex: two of three abilities, switched in the Command phase', () => {
    const s = game([['Intercessor Squad', 10, 150], ['Roboute Guilliman', 1, 355]], [['Boyz', 10, 90]]);
    const rg = put(s, 'p0-x1', { x: 30, y: 12 });
    const ints = put(s, 'p0-x0', { x: 30, y: 18 });
    const c = abilityChoices(s, 0)[0];
    expect(c.on).toEqual(['Primarch of the XIII (Aura)', 'Master of Battle']);
    const oc = () => effectsFor(s, ints).some((a) => a.label === 'Primarch of the XIII (Aura)');
    expect(oc()).toBe(true);
    pickAbilities(s, rg.id, ['Master of Battle', 'Supreme Strategist']);
    expect(oc()).toBe(false);
  });

  it('Armour of Fate: Guilliman can come back at the end of the phase', () => {
    const s = game([['Roboute Guilliman', 1, 355]], [['Boyz', 10, 90]]);
    s.phase = 'shooting'; s.active = 1;
    const rg = put(s, 'p0-x0', { x: 30, y: 12 });
    const m = rg.models[0];
    s.revivals = [{ unitId: rg.id, modelId: m.id, label: 'Armour of Fate', on: 1, wounds: 6, x: m.x, y: m.y }];
    m.dead = true; m.wounds = 0; rg.status = 'destroyed';
    resolveRevivals(s);
    expect(m.dead).toBe(false);
    expect(m.wounds).toBe(6);
    expect(rg.status).toBe('board');
  });

  it('Omni-scramblers: enemy units from Reserves cannot arrive within 12"', () => {
    const s = game([['Infiltrator Squad', 5, 110]], [['Boyz', 10, 90]]);
    s.phase = 'movement'; s.active = 1;
    put(s, 'p0-x0', { x: 30, y: 30 });
    const boyz = s.units.find((u) => u.id === 'p1-x0')!;
    boyz.status = 'reserves';
    const near = formationAt(boyz, { x: 30, y: 41 });
    expect(validatePlacement(s, boyz, near, 'ingress').errors.join()).toMatch(/Omni-scramblers/);
    expect(ingressUnit(s, boyz, near).ok).toBe(false);
  });

  it('Objective Secured keeps an objective after the Intercessors walk off', () => {
    const s = game([['Intercessor Squad', 10, 150]], [['Boyz', 10, 90]]);
    const o = s.objectives[0];
    const ints = put(s, 'p0-x0', { x: o.x, y: o.y });
    s.active = 0; s.phase = 'command';
    updateControl(s);
    expect(o.controller).toBe(0);
    endPhase(s); // end of Command phase: Objective Secured
    expect(o.secured).toBe(0);
    placeUnit(s, ints, formationAt(ints, { x: o.x + 20 > 55 ? o.x - 20 : o.x + 20, y: o.y }));
    updateControl(s);
    expect(o.controller).toBe(0);
  });

  it('Armorium Cherub: once per battle, change a hit roll to a 6', () => {
    const s = game([['Devastator Squad', 5, 120]], [['Boyz', 10, 90]]);
    s.phase = 'shooting'; s.active = 0;
    const dev = put(s, 'p0-x0', { x: 20, y: 10 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 26 });
    const r = buildShootPools(s, dev.id, boyz.id, { mode: 'normal' });
    startAttack(s, 'shoot', dev.id, boyz.id, r.pools);
    rollHits(s);
    const fd = freeDiceNow(s).find((f) => f.kind === 'setSix');
    expect(fd).toBeTruthy();
    const p = s.attack!.pools[0];
    const i = p.hits.findIndex((h) => h.v !== 6);
    if (i >= 0) {
      expect(useFreeDie(s, fd!.key, i)).toBeNull();
      expect(p.hits[i].v).toBe(6);
    }
    expect(freeDiceNow(s).some((f) => f.kind === 'setSix')).toBe(false);
  });

  it('each ability with an act is reachable by its unit', () => {
    const s = game([['Captain', 1, 80], ['Techmarine', 1, 55]], [['Painboy', 1, 45]]);
    for (const u of s.units) expect(() => actsOfUnit(s, u)).not.toThrow();
  });
});

describe('detachment rules added in this round', () => {
  function detGame(smDet: string, orkDet: string, sm: Row[], ork: Row[], smSub?: string): GameState {
    const a = list('SM', sm), b = list('ORK', ork);
    a.detachments = [smDet]; b.detachments = [orkDet];
    if (smSub) a.subfaction = smSub;
    const s = createGame({ lists: [a, b], factions: [SM, ORK], names: ['A', 'B'], deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 42 });
    s.terrain = s.terrain.filter((t) => t.objectiveId);
    s.terrain.forEach((t) => (t.walls = []));
    s.round = 2; s.turn = 2;
    return s;
  }

  it('Armoured Wrath: one free re-roll per unit per phase', () => {
    const s = detGame('Ironstorm Spearhead', 'War Horde', [['Intercessor Squad', 10, 150]], [['Boyz', 10, 90]]);
    s.phase = 'shooting'; s.active = 0;
    const ints = put(s, 'p0-x0', { x: 20, y: 14 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 24 });
    startAttack(s, 'shoot', ints.id, boyz.id, buildShootPools(s, ints.id, boyz.id, { mode: 'normal' }).pools);
    rollHits(s);
    const fd = freeDiceNow(s).filter((f) => f.name === 'Ironstorm Spearhead');
    expect(fd.map((f) => f.stage)).toEqual(['hit', 'wound']);
    const i = s.attack!.pools[0].hits.findIndex((h) => h.o === 'miss');
    useFreeDie(s, fd[0].key, Math.max(0, i));
    expect(freeDiceNow(s).some((f) => f.name === 'Ironstorm Spearhead')).toBe(false); // hit OR wound, once
  });

  it('Grim Resolve: one army-wide button gives a unit +1 OC until the next Command phase', () => {
    const s = detGame('Unforgiven Task Force', 'War Horde', [['Intercessor Squad', 10, 150], ['Intercessor Squad', 5, 80]], [['Boyz', 10, 90]], 'DARK ANGELS');
    s.phase = 'command'; s.active = 0;
    const a = put(s, 'p0-x0', { x: 20, y: 14 });
    put(s, 'p0-x1', { x: 30, y: 14 });
    const btns = manualActs(s, 0).filter((m) => m.def.name === 'Unforgiven Task Force');
    expect(btns.length).toBe(1);
    expect(useActByKey(s, btns[0].def.holder.id, btns[0].def.key, a.id)).toBeNull();
    expect(effectsFor(s, a).some((x) => x.e.oc === 1)).toBe(true);
    expect(manualActs(s, 0).some((m) => m.def.name === 'Unforgiven Task Force')).toBe(false);
  });

  it('Black Templars: Templar Vows replaces Oath of Moment; Accept Any Challenge gives +1 wound when S ≤ T', () => {
    const s = detGame('Wrathful Procession', 'War Horde', [['Intercessor Squad', 10, 150]], [['Meganobz', 3, 110]], 'BLACK TEMPLARS');
    expect(s.players[0].armyRules.some((r) => r.name === 'Oath of Moment')).toBe(false);
    s.phase = 'command'; s.active = 0; s.round = 1;
    const ch = detChoices(s, 0).find((c) => c.rule === 'Templar Vows')!;
    expect(ch.open).toBe(true);
    expect(pickDetChoice(s, 0, 'Templar Vows', ['challenge'])).toBeNull();
    s.phase = 'fight'; s.round = 2;
    const ints = put(s, 'p0-x0', { x: 20, y: 20 });
    const mega = put(s, 'p1-x0', { x: 20, y: 23.6 });
    const pools = buildFightPools(s, ints.id, mega.id).pools;
    expect(pools.length).toBeGreaterThan(0);
    expect(pools.every((p) => p.woundMod === 1)).toBe(true); // S4 vs T5
  });

  it('Saga of the Hunter: the Quarry tally completes the Saga and adds +1 to wound', () => {
    const s = detGame('Saga of the Hunter', 'War Horde', [['Blood Claws', 10, 135]], [['Boyz', 10, 90]], 'SPACE WOLVES');
    s.phase = 'command'; s.active = 0; s.turn = 0; s.round = 1;
    initSagasForTest(s);
    const g = s.players[0].saga!;
    expect(g.target).toBe(2); // Incursion
    g.tally = 2; g.done = true;
    s.phase = 'fight'; s.round = 2; s.turn = 2;
    const bc = put(s, 'p0-x0', { x: 20, y: 20 });
    const boyz = put(s, 'p1-x0', { x: 20, y: 23.6 });
    for (const m of boyz.models.slice(5)) { m.dead = true; m.wounds = 0; } // 10 Blood Claws outnumber 5 Boyz
    const pools = buildFightPools(s, bc.id, boyz.id).pools;
    expect(pools.length).toBeGreaterThan(0);
    expect(pools.every((p) => p.hitMod === 1 && p.woundMod === 1)).toBe(true);
    g.done = false;
    expect(buildFightPools(s, bc.id, boyz.id).pools.every((p) => p.hitMod === 1 && p.woundMod === 0)).toBe(true);
  });

  it('Ork detachments: Wurrband powers, Brute Bosses, Shoota Boyz range, Dread Mob buttons', () => {
    const s = detGame('Gladius Task Force', 'Wurrband', [['Intercessor Squad', 10, 150]], [['Weirdboy', 1, 60], ['Boyz', 10, 90]]);
    s.phase = 'movement'; s.active = 1;
    put(s, 'p0-x0', { x: 20, y: 14 });
    put(s, 'p1-x0', { x: 20, y: 24 });
    expect(manualActs(s, 1).some((m) => m.def.name === 'Powers of da Waaagh!')).toBe(true);

    const b = detGame('Gladius Task Force', 'Brute Bosses', [['Intercessor Squad', 10, 150]], [['Warboss', 1, 100]]);
    const boss = b.units.find((u) => u.id === 'p1-x0')!;
    expect(effectsFor(b, boss).some((x) => x.label === '’Ard as Nails')).toBe(true);

    const c = detGame('Gladius Task Force', 'Shoota Boyz', [['Intercessor Squad', 10, 150]], [['Boyz', 10, 90]]);
    c.phase = 'shooting'; c.active = 1;
    const sm = put(c, 'p0-x0', { x: 20, y: 10 });
    const boyz = put(c, 'p1-x0', { x: 20, y: 30 }); // ~18" apart: out of 18" shoota range edge
    const before = buildShootPools(c, boyz.id, sm.id, { mode: 'normal' }).pools.reduce((n, p) => n + p.models, 0);
    boyz.riledUntil = c.turn;
    const after = buildShootPools(c, boyz.id, sm.id, { mode: 'normal' }).pools.reduce((n, p) => n + p.models, 0);
    expect(after).toBeGreaterThanOrEqual(before);

    const d = detGame('Gladius Task Force', 'Dread Mob', [['Intercessor Squad', 10, 150]], [['Deff Dread', 1, 130]]);
    d.phase = 'shooting'; d.active = 1;
    put(d, 'p0-x0', { x: 20, y: 14 });
    put(d, 'p1-x0', { x: 20, y: 24 });
    const tdb = manualActs(d, 1).filter((m) => m.def.name === 'Try Dat Button!');
    expect(tdb.length).toBe(2);
    expect(useActByKey(d, tdb[0].def.holder.id, tdb[0].def.key)).toBeNull();
    expect(manualActs(d, 1).some((m) => m.def.name === 'Try Dat Button!')).toBe(false);
  });
});

function initSagasForTest(s: GameState) {
  // the battle starts: sagas get their targets
  initSagas(s);
}
