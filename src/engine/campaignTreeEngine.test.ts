// Proof that the army tree works in battle, not only on paper: every node's effect is read by the rules engine,
// every condition a node names is one the engine knows, and a whole campaign battle runs with a full tree.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botShouldAct, botStep } from '../ai/bot';
import { addTimed, cond, defencesFor, modelDefence, ocOf, offenceFor, rollMods, unitFlags, unknownConds, type Effect } from '../rules-engine/effects';
import { afterBattle, applyCampaign, campaignMission, enemyDetachments, newRun, type Run } from './campaign';
import { autoList } from './autoList';
import { OWN_BRANCHES, treeFor, type TreeNode } from './campaignTree';
import { createGame, endPhase } from './game';
import type { DatasheetData, FactionData, GameState, UnitState } from './types';
import '../factions';

const cache = new Map<string, FactionData>();
const load = (id: string) => cache.get(id) ?? (cache.set(id, JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'))), cache.get(id)!);
const ORK = load('ORK');
/** one tree per branch: the five armies with their own, and one army for each family branch still in use */
const TREES = [...OWN_BRANCHES, 'AM', 'CSM', 'GC', 'TAU'];
const ALL = fs.readdirSync('public/data/factions').map((f) => f.replace('.json', ''));

const hasKind = (d: DatasheetData, kind?: 'melee' | 'ranged') => !kind || d.weapons.some((w) => w.profiles.some((p) => (p.range === 'Melee') === (kind === 'melee')));
/** a datasheet the node reaches (its own army first), with a weapon of the kind the effect needs */
function sheetFor(army: string, n: TreeNode, e: Effect): { f: FactionData; d: DatasheetData } {
  const want = n.units?.split('|').filter((k) => k !== 'VETERAN');
  for (const id of [army, ...ALL]) {
    const f = load(id);
    const d = f.datasheets.find((x) => !x.ally && x.models.length && x.points[0]?.options.length && hasKind(x, e.attack)
      && (!want?.length || want.some((k) => x.keywords.includes(k))));
    if (d) return { f, d };
  }
  throw new Error(`no datasheet for ${n.name}`);
}

/** everything the engine works out for a unit: its stats, rolls, OC, attack and defence modifiers */
function signature(s: GameState, u: UnitState) {
  const T = s.units.find((x) => x.owner === 1)!;
  const m = u.models[0];
  const off = (['melee', 'ranged'] as const).flatMap((kind) => m.weapons.flatMap((w) => w.profiles.map((p) => offenceFor(s, u, m, T, w, p, kind, 6).map((a) => a.label))));
  return JSON.stringify({
    flags: unitFlags(s, u), rolls: rollMods(s, u), oc: u.models.map(ocOf(s, u)), off,
    def: (['ranged', 'melee', 'mortal'] as const).map((k) => modelDefence(s, u, m, k, true, T)),
    defBy: (['ranged', 'melee'] as const).map((k) => defencesFor(s, u, k, m, T).map((a) => a.label)),
  });
}

function game(f: FactionData, d: DatasheetData) {
  const o = d.points[0].options[0];
  return createGame({
    lists: [{ name: 't', factionId: f.id, battleSize: 'strike', detachments: [], units: [{ uid: 'a', datasheet: d.name, models: o.models, pts: o.pts }] }, autoList(ORK, 500, 2)],
    factions: [f, ORK], names: ['A', 'B'], secondaryMode: 'none', maxRounds: 3, seed: 3,
  });
}

describe('army tree in the rules engine', () => {
  it('every condition a node names is one the engine knows', () => {
    const s = game(load('SM'), load('SM').datasheets.find((d) => d.name === 'Intercessor Squad')!);
    const u = s.units.find((x) => x.owner === 0)!;
    const bad: string[] = [];
    for (const id of TREES) {
      for (const n of treeFor(id)) {
        const es = [...(n.e ? (Array.isArray(n.e) ? n.e : [n.e]) : []), ...(n.bonus?.e ? [n.bonus.e] : [])];
        for (const c of es.flatMap((e) => e.if ?? []).flatMap((c) => c.replace(/^any:/, '').split('||'))) {
          unknownConds.clear();
          cond(c, { s, A: u, T: s.units.find((x) => x.owner === 1) });
          if (unknownConds.size) bad.push(`${id} ${n.name}: ${c}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('every node changes what the engine works out for a unit it reaches', () => {
    // control: an effect the engine has nothing to read in leaves the signature as it was
    const SM = load('SM');
    const isq = SM.datasheets.find((d) => d.name === 'Intercessor Squad')!;
    const c0 = game(SM, isq), c1 = game(SM, isq);
    const u1 = c1.units.find((x) => x.owner === 0)!;
    addTimed(c1, u1, { e: { attack: 'melee' }, label: 'Nothing', until: 'battle', by: 0 });
    expect(signature(c1, u1)).toBe(signature(c0, c0.units.find((x) => x.owner === 0)!));
    addTimed(c1, u1, { e: { move: 1 }, label: 'Move', until: 'battle', by: 0 });
    expect(signature(c1, u1)).not.toBe(signature(c0, c0.units.find((x) => x.owner === 0)!));

    const dead: string[] = [];
    let checked = 0;
    const seen = new Set<string>();
    for (const id of TREES) {
      for (const n of treeFor(id)) {
        const es = [...(n.e ? (Array.isArray(n.e) ? n.e : [n.e]) : []), ...(n.bonus?.e ? [n.bonus.e] : [])];
        for (const [i, e] of es.entries()) {
          const key = `${n.name}#${i}#${JSON.stringify(e)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const { f, d } = sheetFor(id, n, e);
          const before = game(f, d), after = game(f, d);
          const ub = before.units.find((x) => x.owner === 0)!, ua = after.units.find((x) => x.owner === 0)!;
          // the node's conditions are left out here: they are checked by name above and in play below
          addTimed(after, ua, { e: { ...e, if: undefined }, label: n.name, until: 'battle', by: 0 });
          checked++;
          if (signature(before, ub) === signature(after, ua)) dead.push(`${id} ${n.name} (${JSON.stringify(e)}) on ${d.name}`);
        }
      }
    }
    expect(dead).toEqual([]);
    expect(checked).toBeGreaterThan(150);
  }, 240_000);

  it('in a combined unit, a CHARACTER node reaches the leader only', () => {
    const SM = load('SM');
    const run: Run = { ...newRun(SM, { name: 't', factionId: 'SM', battleSize: 'strike', detachments: [], units: [
      { uid: 'a', datasheet: 'Intercessor Squad', models: 5, pts: 80 }, { uid: 'b', datasheet: 'Captain', models: 1, pts: 80, attachTo: 'a' }] }, ['ORK'], 1), tree: ['assault-1', 'assault-2', 'assault-3'] };
    const s = createGame({ lists: [run.list, autoList(ORK, 500, 2)], factions: [SM, ORK], names: ['A', 'B'], secondaryMode: 'none', maxRounds: 3, seed: 3 });
    applyCampaign(s, run, []);
    const u = s.units.find((x) => x.owner === 0)!;
    const captain = u.models.find((m) => m.source === 'Captain')!;
    const marine = u.models.find((m) => m.source === 'Intercessor Squad')!;
    const T = s.units.find((x) => x.owner === 1)!;
    const labels = (m: typeof captain) => m.weapons.filter((w) => w.profiles.some((p) => p.range === 'Melee'))
      .flatMap((w) => w.profiles.flatMap((p) => offenceFor(s, u, m, T, w, p, 'melee', 1).map((a) => a.label)));
    expect(labels(captain)).toContain('Hammer Blow');
    expect(labels(marine)).not.toContain('Hammer Blow');
    expect(labels(marine)).toContain('Bayonet Drill'); // INFANTRY: both
  });
});

describe('army tree in a whole campaign battle', () => {
  it('a battle with most of the tree taken plays to the end and pays Renown', () => {
    const SM = load('SM');
    const base = newRun(SM, autoList(SM, 500, 11), ['ORK'], 11);
    // every node but the keystones that slow the army down
    const tree = treeFor('SM').filter((n) => n.id !== 'start' && !['fire-7', 'armour-7', 'speed-7'].includes(n.id)).map((n) => n.id);
    const node = base.map.find((n) => n.layer === 0)!;
    const run: Run = { ...base, tree, fighting: node.id };
    const orks = autoList(ORK, 500, 4);
    // as the campaign plays it: the battle's own primary mission, and a later-campaign enemy with three detachments
    const s = createGame({ lists: [run.list, { ...orks, detachments: enemyDetachments(ORK, orks.detachments, 3, 4) }], factions: [SM, ORK], names: ['You', 'Orks'], secondaryMode: 'none', maxRounds: 3, seed: 9, dispositions: campaignMission(node).dispositions });
    applyCampaign(s, run, []);
    const cp0 = s.players[0].cp;
    expect(s.units.filter((u) => u.owner === 0).every((u) => (u.timed ?? []).length > 0)).toBe(true);
    s.bots = [0, 1];
    let steps = 0;
    while (s.phase !== 'gameover' && steps < 12000) {
      steps++;
      const p = s.window?.player ?? (s.phase === 'deploy' || s.phase === 'scouts' ? s.deployTurn : s.active);
      if (botShouldAct(s, p)) botStep(s, p); else endPhase(s);
    }
    expect(s.phase).toBe('gameover');
    const plain = createGame({ lists: [run.list, autoList(ORK, 500, 4)], factions: [SM, ORK], names: ['You', 'Orks'], secondaryMode: 'none', maxRounds: 3, seed: 9, dispositions: campaignMission(node).dispositions });
    applyCampaign(plain, { ...run, tree: [] }, []);
    expect(cp0 - plain.players[0].cp).toBe(6); // War Council 1, Master Tactician 1 + its bonus 1, Total War 2, Tithe Masters' bonus 1
    // the buffs last the whole battle
    expect(s.units.filter((u) => u.owner === 0 && u.status !== 'destroyed').every((u) => (u.timed ?? []).some((t) => t.label === 'Swift Strike'))).toBe(true);
    const after = afterBattle(run, s.winner, SM, 'Orks');
    expect(after.renown).toBeGreaterThan(run.renown!);
  }, 300_000);
});
