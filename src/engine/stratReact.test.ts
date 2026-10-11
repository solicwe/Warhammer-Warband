// Space Marine stratagems that pick options, pick enemy units, or react to a moment of the game.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMortalWounds, buildShootPools, finishAttack, resolveAll, startAttack } from './attack';
import { effectsFor, ocOf } from './effects';
import { commitMove, createGame, formationAt, placeUnit } from './game';
import { alive } from './state';
import { answerReaction, applyDetachmentStratagem, stratagemBlock } from './stratagems';
import type { ArmyList, FactionData, GameState, PlayerId, Pt, StratagemData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

type Row = [string, number, number];
const list = (factionId: string, units: Row[], detachments: string[] = []): ArmyList => ({
  name: 't', factionId, battleSize: 'incursion', detachments, units: units.map(([d, n, pts], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts })),
});

function game(sm: Row[], det: string[], ork: Row[]): GameState {
  const s = createGame({
    lists: [list('SM', sm, det), list('ORK', ork)], factions: [SM, ORK], names: ['A', 'B'],
    deploymentId: 'take-and-hold-vs-purge-the-foe-3', dispositions: ['take-and-hold', 'take-and-hold'], seed: 7,
  });
  s.terrain = s.terrain.filter((t) => t.objectiveId);
  s.terrain.forEach((t) => { t.walls = []; t.category = 'exposed'; }); // open ground: only the objective areas stay
  s.round = 2; s.turn = 2; s.phase = 'command'; s.active = 0;
  s.players[0].cp = 10; s.players[1].cp = 10;
  return s;
}
const put = (s: GameState, id: string, c: Pt) => { const u = s.units.find((x) => x.id === id)!; placeUnit(s, u, formationAt(u, c)); u.setUpTurn = -10; return u; };
const strat = (s: GameState, p: PlayerId, name: string) => s.players[p].detachments.flatMap((d) => d.stratagems).find((x) => x.name === name) as StratagemData;

/** The Orks shoot the unit until one of its models dies. */
function orksShoot(s: GameState, shooter: string, target: string) {
  s.phase = 'shooting'; s.active = 1;
  for (let i = 0; i < 6; i++) {
    const T = s.units.find((x) => x.id === target)!;
    for (const m of alive(T)) m.wounds = 1; // every unsaved wound kills
    const r = buildShootPools(s, shooter, target, { mode: 'normal' });
    expect(r.error).toBeUndefined();
    const before = alive(T).length;
    startAttack(s, 'shoot', shooter, target, r.pools);
    resolveAll(s);
    finishAttack(s);
    if (alive(T).length < before) return;
    s.units.find((x) => x.id === shooter)!.weaponsFired = [];
  }
  throw new Error('the Orks never killed anything');
}

describe('stratagem options ("select either …")', () => {
  it('Gene-wrought Might: [LANCE], and +1 AP as well while the assault doctrine is active for the unit', () => {
    const s = game([['Assault Intercessor Squad', 10, 150]], ['Assault Brethren'], [['Boyz', 10, 90]]);
    const u = put(s, 'p0-x0', { x: 20, y: 30 });
    s.phase = 'fight';
    const st = strat(s, 0, 'GENE-WROUGHT MIGHT');
    applyDetachmentStratagem(s, 0, st, u.id);
    const fx = () => effectsFor(s, u).filter((a) => a.label === 'GENE-WROUGHT MIGHT');
    expect(fx().some((a) => a.e.abilities?.includes('lance'))).toBe(true);
    const ap = () => effectsFor(s, u).some((a) => a.label === 'GENE-WROUGHT MIGHT' && a.e.ap === 1);
    expect(ap()).toBe(true); // the timed effect carries the +1 AP; it only counts while the doctrine is active:
    s.players[0].det = { 'Combat Doctrines': { active: ['assault'], used: ['assault'], count: 1 } };
    expect(effectsFor(s, u).some((a) => a.label === 'Assault Doctrine')).toBe(true);
  });
  it('For the Emperor!: a Tacticus unit on an objective has +1 OC until the end of the turn', () => {
    const s = game([['Intercessor Squad', 10, 170]], ['Tacticus Firestorm Force'], [['Boyz', 10, 90]]);
    const o = s.objectives[0];
    const u = put(s, 'p0-x0', { x: o.x, y: o.y });
    s.phase = 'command'; s.active = 0;
    const st = strat(s, 0, 'FOR THE EMPEROR!');
    expect(stratagemBlock(s, 0, st, u)).toBeNull();
    const before = ocOf(s, u)(alive(u)[0]);
    applyDetachmentStratagem(s, 0, st, u.id);
    expect(ocOf(s, u)(alive(u)[0])).toBe(before + 1);
  });
});

describe('stratagem reactions', () => {
  it('Hail of Vengeance (bot): after the Orks kill some of its models, the unit shoots back', () => {
    const s = game([['Hellblaster Squad', 10, 230]], ['Devastator Brethren'], [['Boyz', 20, 180]]);
    s.bots = [0];
    put(s, 'p0-x0', { x: 22, y: 30 });
    const boyz = put(s, 'p1-x0', { x: 22, y: 38 });
    const w0 = alive(boyz).reduce((a, m) => a + m.wounds, 0);
    const cp0 = s.players[0].cp;
    orksShoot(s, 'p1-x0', 'p0-x0');
    expect(s.log.some((l) => l.text.includes('HAIL OF VENGEANCE'))).toBe(true);
    expect(s.players[0].cp).toBe(cp0 - 2);
    expect(alive(boyz).reduce((a, m) => a + m.wounds, 0)).toBeLessThan(w0);
  });

  it('Hail of Vengeance (player): a prompt opens; using it shoots back, passing closes it', () => {
    const s = game([['Intercessor Squad', 10, 150]], ['Devastator Brethren'], [['Flash Gitz', 5, 80]]);
    s.bots = [1];
    put(s, 'p0-x0', { x: 22, y: 30 });
    put(s, 'p1-x0', { x: 22, y: 40 });
    orksShoot(s, 'p1-x0', 'p0-x0');
    const w = s.window;
    expect(w?.kind).toBe('stratReaction');
    if (w?.kind !== 'stratReaction') return;
    expect(w.player).toBe(0);
    const offer = w.offers.find((o) => strat(s, 0, 'HAIL OF VENGEANCE').id === o.stratId);
    expect(offer?.units).toEqual(['p0-x0']);
    answerReaction(s, offer!.stratId, 'p0-x0');
    expect(s.window).toBeNull();
    expect(s.log.some((l) => /HAIL OF VENGEANCE: Intercessor Squad shoots Flash Gitz/.test(l.text))).toBe(true);
  });

  it('Squad Tactics: an enemy unit ends a move within 8" → the player is offered a D6" move', () => {
    const s = game([['Intercessor Squad', 10, 150]], ['Gladius Task Force'], [['Boyz', 10, 90]]);
    s.bots = [1];
    put(s, 'p0-x0', { x: 22, y: 30 });
    const boyz = put(s, 'p1-x0', { x: 22, y: 50 });
    s.phase = 'movement'; s.active = 1;
    const paths = new Map(alive(boyz).map((m) => [m.id, [{ x: m.x, y: m.y }, { x: m.x, y: m.y - 10 }]]));
    commitMove(s, boyz, 'normal', paths);
    const w = s.window;
    expect(w?.kind).toBe('stratReaction');
    if (w?.kind !== 'stratReaction') return;
    answerReaction(s, w.offers[0].stratId, 'p0-x0');
    const u = s.units.find((x) => x.id === 'p0-x0')!;
    expect(u.extraMove?.max).toBeGreaterThanOrEqual(1);
    expect(s.window?.kind).toBe('abilityMove');
  });

  it('Vengeful Animus (bot): a Redemptor that dies always blows up', () => {
    const s = game([['Redemptor Dreadnought', 1, 195]], ['Medusa\'s Wrath'], [['Boyz', 10, 90]]);
    s.bots = [0];
    const r = put(s, 'p0-x0', { x: 22, y: 30 });
    put(s, 'p1-x0', { x: 22, y: 36 });
    applyMortalWounds(s, r, 99, 'test');
    expect(s.log.some((l) => l.text.includes('VENGEFUL ANIMUS'))).toBe(true);
    expect(s.log.some((l) => l.text.includes('it explodes'))).toBe(true);
  });

  it('Tactical Dreadnought Fortitude: attacks that target the Terminators have -1 D', () => {
    const s = game([['Terminator Squad', 5, 190]], ['Terminator Storm Force'], [['Boyz', 10, 90]]);
    const t = put(s, 'p0-x0', { x: 22, y: 30 });
    put(s, 'p1-x0', { x: 22, y: 40 });
    s.phase = 'shooting'; s.active = 1;
    applyDetachmentStratagem(s, 0, strat(s, 0, 'TACTICAL DREADNOUGHT FORTITUDE'), t.id);
    expect(t.buffs.some((b) => b.kind === 'damage-1')).toBe(true);
  });
});
