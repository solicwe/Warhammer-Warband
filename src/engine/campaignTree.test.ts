import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoList } from './autoList';
import { allySources, withAllies } from './allies';
import { afterBattle, ALL_PLAYABLE_FACTIONS, applyCampaign, canRecruitTitanOrKnight, getFactionFamily, isFactionAllowedKnight, migrateRun, newRun, requiresTitanRequisition, type Run } from './campaign';
import { allocate, canAllocate, canRefund, isVeteran, refund, RENOWN, treeCp, treeFor, treeScrap, unitsReached } from './campaignTree';
import { createGame } from './game';
import type { FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

const smRun = (): Run => newRun(SM, autoList(SM, 500, 7), ['ORK'], 7);
const battle = (run: Run) => {
  const s = createGame({ lists: [run.list, autoList(ORK, 500, 3)], factions: [SM, ORK], names: ['You', 'Orks'], secondaryMode: 'none', maxRounds: 3, seed: 1 });
  applyCampaign(s, run, []);
  return s;
};

describe('army tree: shape', () => {
  const ids = fs.readdirSync('public/data/factions').map((f) => f.replace('.json', ''));
  const allKeywords = new Set(ids.flatMap((id) => load(id).datasheets.flatMap((d) => [...d.keywords, ...d.factionKeywords])));

  it('every army gets a tree of about 180 nodes with three branches of its own, every node reachable, links both ways', () => {
    for (const id of ALL_PLAYABLE_FACTIONS) {
      const nodes = treeFor(id);
      expect(nodes.length, id).toBeGreaterThanOrEqual(170);
      expect(nodes.length, id).toBeLessThanOrEqual(190);
      expect(nodes.filter((n) => n.slot === 'corps' || n.slot === 'arsenal').length, id).toBe(32);
      expect(new Set(nodes.map((n) => n.name)).size, `${id}: node names are unique`).toBe(nodes.length);
      // a spoke's far end is not joined to another spoke: past depth 4 every link stays on the spoke
      for (const n of nodes) {
        const depth = Number(/-(\d)$/.exec(n.id)?.[1] ?? 0);
        if (n.slot !== 'ring' && n.slot !== 'start' && depth > 4) for (const l of n.links) expect(nodes.find((m) => m.id === l)!.slot).toBe(n.slot);
      }
      expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
      for (const n of nodes) for (const l of n.links) expect(nodes.find((m) => m.id === l)!.links).toContain(n.id);
      const seen = new Set(['start']);
      const queue = ['start'];
      while (queue.length) { const id = queue.pop(); for (const l of nodes.find((n) => n.id === id)!.links) if (!seen.has(l)) { seen.add(l); queue.push(l); } }
      expect(seen.size).toBe(nodes.length);
    }
  });

  it('nodes do not overlap on the drawing', () => {
    for (const id of ['SM', 'AM', 'DRU']) {
      const nodes = treeFor(id);
      for (const a of nodes) for (const b of nodes) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.id} ${b.id}`).toBeGreaterThan(24);
    }
  });

  it("an army's own branches name only keywords its own units have", () => {
    for (const id of ALL_PLAYABLE_FACTIONS) {
      const mine = new Set(load(id).datasheets.filter((d) => !d.ally).flatMap((d) => [...d.keywords, ...d.factionKeywords]));
      for (const n of treeFor(id).filter((x) => x.slot === 'corps' || x.slot === 'arsenal')) {
        for (const k of n.units?.split('|') ?? []) expect(mine.has(k), `${id} ${n.name}: ${k}`).toBe(true);
      }
    }
  });

  it('the titan keystone is there exactly for the armies that can recruit a titanic unit or a Knight', () => {
    const idx = JSON.parse(fs.readFileSync('public/data/index.json', 'utf8')) as { factions: { id: string; group?: string }[] };
    for (const id of ALL_PLAYABLE_FACTIONS) {
      const f = load(id), family = getFactionFamily(id);
      const allies = allySources(id, idx.factions.find((x) => x.id === id)?.group).flatMap((src) => (fs.existsSync(`public/data/factions/${src.id}.json`) ? [{ src, data: load(src.id) }] : []));
      const run = newRun(f, autoList(f, 500, 1), ['ORK'], 1);
      // the recruit screen's pool: the army's own units and the allies its family may take
      const pool = withAllies(f, allies).datasheets.filter((d) => (!d.ally || (family === 'IMPERIUM' && (d.ally === 'QI' || d.ally === 'TL')) || (family === 'CHAOS' && (d.ally === 'QT' || d.ally === 'CD'))) && d.points?.[0]?.options?.length && isFactionAllowedKnight(id, d));
      const locked = pool.filter((d) => requiresTitanRequisition(d) && !canRecruitTitanOrKnight(id, d, run));
      expect(treeFor(id).some((n) => n.titan), `${id}: ${locked.length} units need a titan keystone`).toBe(locked.length > 0);
    }
  });

  it('every keyword a node names exists in the data (VETERAN aside)', () => {
    for (const fam of ['SM', 'TS', 'CSM', 'NEC', 'ORK', 'TYR', 'TAU', 'AM', 'GC']) {
      for (const n of treeFor(fam)) {
        for (const k of [...(n.units?.split('|') ?? []), ...(n.as ? [n.as.from, n.as.to] : [])]) {
          if (k !== 'VETERAN') expect(allKeywords.has(k), `${n.name}: ${k}`).toBe(true);
        }
      }
    }
  });
});

describe('army tree: Renown, allocating and refunding', () => {
  it('a node next to a taken one costs 1 Renown; a far one cannot be taken', () => {
    const run = smRun();
    expect(run.renown).toBe(RENOWN.start);
    expect(canAllocate(run, 'fire-2')).toBe(false);
    const r1 = allocate(run, 'fire-1');
    expect(r1.tree).toEqual(['fire-1']);
    expect(r1.renown).toBe(RENOWN.start - 1);
    expect(canAllocate(r1, 'fire-2')).toBe(true);
    expect(allocate({ ...r1, renown: 0 }, 'fire-2').tree).toEqual(['fire-1']);
  });

  it('refunds only at an armory or medicae tent, for Scrap, and never cuts the tree in two', () => {
    let run = allocate(allocate(smRun(), 'fire-1'), 'fire-2');
    expect(canRefund(run, 'fire-2')).toBe(false); // not at an armory
    const armory = run.map[0];
    run = { ...run, map: run.map.map((n) => (n === armory ? { ...n, kind: 'armory' } : n)), path: [armory.id], scrap: 100 };
    expect(canRefund(run, 'fire-1')).toBe(false); // fire-2 hangs off it
    expect(canRefund(run, 'fire-2')).toBe(true);
    const r = refund(run, 'fire-2');
    expect(r.tree).toEqual(['fire-1']);
    expect(r.scrap).toBe(80);
    expect(r.renown).toBe(run.renown! + 1);
    expect(r.refunds).toBe(1);
  });

  it('a won battle gives Renown by node kind and counts towards VETERAN', () => {
    let run = smRun();
    const node = run.map.find((n) => n.layer === 0)!;
    run = { ...run, fighting: node.id };
    const after = afterBattle(run, 0, SM, 'Orks');
    expect(after.renown).toBe(RENOWN.start + RENOWN.battle);
    expect(after.list.units.every((u) => u.battles === 1)).toBe(true);
    expect(isVeteran({ battles: 2 })).toBe(false);
    expect(isVeteran({ battles: 3 })).toBe(true);
    const lost = afterBattle(run, 1, SM, 'Orks');
    expect(lost.renown).toBe(RENOWN.start + RENOWN.loss);
  });
});

describe('army tree: in battle', () => {
  it('a node reaches only units with its keyword', () => {
    const run = { ...smRun(), tree: ['fire-1'] };
    const s = battle(run);
    const mine = s.units.filter((u) => u.owner === 0);
    for (const u of mine) expect(u.timed?.some((t) => t.label === 'Steady Aim') ?? false).toBe(u.keywords.includes('INFANTRY'));
    expect(unitsReached(run, SM.datasheets, treeFor('SM').find((n) => n.id === 'fire-1')!).length).toBeGreaterThan(0);
  });

  it('a conversion keystone lets a keyword count as another', () => {
    const base = { ...smRun(), tree: ['fire-1', 'fire-2', 'fire-3', 'fire-4'] };
    const heavy = (r: Run) => battle(r).units.filter((u) => u.owner === 0 && u.keywords.includes('INFANTRY') && !u.keywords.includes('VEHICLE'))
      .some((u) => u.timed?.some((t) => t.label === 'Heavy Rounds'));
    expect(heavy(base)).toBe(false);
    // Mechanised Infantry sits between Armour and Speed: INFANTRY count as VEHICLE
    expect(heavy({ ...base, tree: [...base.tree!, 'outer-armour'] })).toBe(true);
  });

  it('VETERAN units get VETERAN nodes; CP and Scrap nodes and their thresholds add up', () => {
    const run = { ...smRun(), tree: ['logistics-1', 'logistics-2'] };
    const vet = { ...run, list: { ...run.list, units: run.list.units.map((u, i) => ({ ...u, battles: i === 0 ? 3 : 0 })) } };
    const blooded = battle(vet).units.filter((u) => u.owner === 0 && u.timed?.some((t) => t.label === 'Blooded'));
    expect(blooded.length).toBeGreaterThan(0);
    expect(blooded.every((u) => u.id.endsWith(vet.list.units[0].uid) || vet.list.units.some((e) => e.attachTo === vet.list.units[0].uid || e.uid === vet.list.units[0].attachTo))).toBe(true);
    expect(treeScrap(run)).toBe(10);
    const cmd = { ...run, tree: ['command-1', 'command-2', 'command-3', 'command-4', 'command-5', 'command-6'] };
    expect(treeCp(cmd)).toBe(3); // War Council 1 + Master Tactician 1 + its 6-node bonus 1
    const s = battle(cmd);
    expect(s.players[0].cp - battle(smRun()).players[0].cp).toBe(3);
  });

  it("the army's titan keystone unlocks TITANIC units; a Knight army's own Knights need none", () => {
    const knight = SM.datasheets.find((d) => d.keywords.includes('TITANIC'))!;
    const run = smRun();
    expect(canRecruitTitanOrKnight('SM', knight, run)).toBe(false);
    expect(canRecruitTitanOrKnight('SM', knight, { ...run, tree: ['logistics-1', 'logistics-2', 'logistics-3', 'logistics-4', 'logistics-5', 'logistics-6', 'logistics-7'] })).toBe(false);
    const path = ['arsenal-1', 'arsenal-2', 'arsenal-3', 'arsenal-4', 'arsenal-5', 'arsenal-6', 'arsenal-7'];
    expect(treeFor('SM').find((n) => n.id === 'arsenal-7')!.titan).toBe(true);
    expect(canRecruitTitanOrKnight('SM', knight, { ...run, tree: path })).toBe(true);
    const QI = load('QI');
    const paladin = QI.datasheets.find((d) => d.name === 'Knight Paladin')!;
    expect(canRecruitTitanOrKnight('QI', paladin, newRun(QI, autoList(QI, 500, 1), ['ORK'], 1))).toBe(true);
  });
});

describe('old saved runs', () => {
  it('drops honors, experience and the tech tree, and gives Renown back', () => {
    const run = smRun();
    const old = { ...run, renown: undefined, tree: undefined, wins: 4, techTree: ['imp_orbital'], datasheetHonors: { X: ['hardened'] },
      list: { ...run.list, units: run.list.units.map((u) => ({ ...u, xp: 2, honors: ['hardened'] })) } } as unknown as Run;
    const m = migrateRun(old) as Run & { techTree?: unknown; datasheetHonors?: unknown };
    expect(m.renown).toBe(4 * RENOWN.battle + RENOWN.start);
    expect(m.tree).toEqual([]);
    expect(m.techTree).toBeUndefined();
    expect(m.datasheetHonors).toBeUndefined();
    expect(m.list.units.every((u) => u.battles === 2 && !('xp' in u) && !('honors' in u))).toBe(true);
    expect(migrateRun(m)).toBe(m);
  });

  it('a run from the eight-slot tree: lost and cut-off nodes and the old Titan Requisition come back as Renown', () => {
    const run = smRun();
    // reached the army branch through the old bridge from fire-4 (that bridge now joins army-4 and corps-4)
    const tree = ['fire-1', 'fire-2', 'fire-3', 'fire-4', 'ring-army', 'army-4', 'army-5', 'logistics-1', 'logistics-2', 'logistics-3', 'logistics-4', 'logistics-5', 'logistics-6', 'logistics-7', 'gone-1'];
    const old = { ...run, treeVersion: undefined, renown: 2, tree } as unknown as Run;
    const m = migrateRun(old);
    expect(m.tree).toEqual(['fire-1', 'fire-2', 'fire-3', 'fire-4', 'logistics-1', 'logistics-2', 'logistics-3', 'logistics-4', 'logistics-5', 'logistics-6']);
    expect(m.renown).toBe(2 + 5);
    expect(m.story.at(-1)).toMatch(/5 nodes refunded/);
    expect(migrateRun(m)).toBe(m);
  });
});
