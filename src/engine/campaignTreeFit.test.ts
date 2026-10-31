// Tree v3 (docs/04-campaign-tree.md): every node fits the army it is in, and relics never do what the tree does.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUX_EXCLUSIONS } from './autoList';
import { ALL_PLAYABLE_FACTIONS, makeOffer, newRun, relicById, relicDesc, relicMaxLevel, RELICS } from './campaign';
import { autoList } from './autoList';
import { effectKeys, TREE_KEYS, treeFor, treeVocab } from './campaignTree';
import { FIELDED } from './treeFielded';
import type { FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
/** the units an army can field in a campaign: its own (no allies, no other book's units, no fortifications) */
const fieldable = (f: FactionData) => f.datasheets.filter((d) => !d.ally && !d.subfaction && d.points?.[0]?.options?.length && !d.keywords.includes('FORTIFICATION')
  && !(AUX_EXCLUSIONS[f.id] ?? []).some((k) => d.factionKeywords.includes(k)));
const keywordsOf = (f: FactionData) => new Set(fieldable(f).flatMap((d) => [...d.keywords, ...d.factionKeywords]));
const ARMIES = Object.fromEntries(ALL_PLAYABLE_FACTIONS.map((id) => [id, keywordsOf(load(id))]));

describe('army tree v3: every node fits the army', () => {
  it('treeFielded.ts matches the data (UPDATE_FIELDED=1 rewrites it)', () => {
    const vocab = treeVocab();
    const want = Object.fromEntries(ALL_PLAYABLE_FACTIONS.map((id) => [id, vocab.filter((k) => ARMIES[id].has(k))]));
    if (process.env.UPDATE_FIELDED) {
      fs.writeFileSync('src/engine/treeFielded.ts', `// Written by campaignTreeFit.test.ts (UPDATE_FIELDED=1): the tree keywords each army can field.\nexport const FIELDED: Record<string, string[]> = ${JSON.stringify(want, null, 1).replace(/\n\s*/g, ' ')};\n`);
    }
    expect(FIELDED).toEqual(want);
  });

  it('no node names a keyword its army cannot field; conversions need both', () => {
    const bad: string[] = [];
    for (const id of ALL_PLAYABLE_FACTIONS) {
      for (const n of treeFor(id)) {
        const ks = n.units?.split('|') ?? [];
        if (ks.length && !ks.includes('VETERAN') && !ks.every((k) => ARMIES[id].has(k))) bad.push(`${id} ${n.id} ${n.name}: ${n.units}`);
        if (n.as) for (const k of [n.as.from, n.as.to]) if (k !== 'VETERAN' && !ARMIES[id].has(k)) bad.push(`${id} ${n.name}: ${k}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('Space Marines get no MONSTER node and Tyranids no VEHICLE node', () => {
    expect(treeFor('SM').filter((n) => n.units?.includes('MONSTER') || n.as?.from === 'MONSTER' || n.as?.to === 'MONSTER').map((n) => n.name)).toEqual([]);
    expect(treeFor('TYR').filter((n) => n.units?.split('|').every((k) => k === 'VEHICLE') || n.as?.from === 'VEHICLE' || n.as?.to === 'VEHICLE').map((n) => n.name)).toEqual([]);
  });

  it('nodes keep their distance on every army\'s drawing', () => {
    for (const id of ALL_PLAYABLE_FACTIONS) {
      const nodes = treeFor(id);
      for (const a of nodes) for (const b of nodes) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y), `${id} ${a.id} ${b.id}`).toBeGreaterThan(24);
    }
  });
});

describe('army tree v3: relics never repeat the tree', () => {
  const treeNodes = ALL_PLAYABLE_FACTIONS.flatMap((id) => treeFor(id).map((n) => ({ id, n })));

  it('the tree changes only numbers and re-rolls', () => {
    const bad = treeNodes.flatMap(({ id, n }) => [...effectKeys(n.e), ...effectKeys(n.bonus?.e)].filter((k) => !TREE_KEYS.has(k)).map((k) => `${id} ${n.name}: ${k}`));
    expect([...new Set(bad)]).toEqual([]);
  });

  it('every relic gives a special rule the tree never gives, and nothing the tree gives', () => {
    for (const r of RELICS) {
      const keys = effectKeys(r.e);
      expect(keys.length, `${r.id} does something`).toBeGreaterThan(0);
      expect(keys.filter((k) => TREE_KEYS.has(k)), r.id).toEqual([]);
    }
  });

  it('no relic shares a name with a tree node', () => {
    const names = new Set(treeNodes.map(({ n }) => n.name.toLowerCase()));
    expect(RELICS.filter((r) => names.has(r.name.toLowerCase())).map((r) => r.name)).toEqual([]);
  });

  it('a relic says what it does at every level, and levels up only while a level changes something', () => {
    const iron = relicById('iron')!;
    expect(relicDesc(iron)).toBe('CHARACTER units: 4+ invulnerable save.');
    expect(relicDesc(iron, 2)).toBe('CHARACTER units: 3+ invulnerable save.');
    expect(relicMaxLevel(iron)).toBe(2);
    expect(relicDesc(relicById('fury')!, 2)).toBe('Every unit: melee weapons have [SUSTAINED HITS 3].');
    expect(relicMaxLevel(relicById('firstblow')!)).toBe(1);
    expect(relicMaxLevel(relicById('servo')!)).toBe(2);
    for (const r of RELICS) for (let l = 1; l <= relicMaxLevel(r); l++) expect(relicDesc(r, l), r.id).toMatch(/^[A-Z][^]*\.$/);
  });

  it('an army is only offered relics for units it can field', () => {
    for (const id of ['SM', 'QI', 'TYR']) {
      const f = load(id);
      const run = newRun(f, autoList(f, 500, 1), ['ORK'], 3);
      for (let salt = 0; salt < 30; salt++) {
        for (const o of makeOffer(run, f, 'boss', salt)) {
          if (o.kind !== 'relic') continue;
          const r = relicById(o.id)!;
          for (const k of r.units?.split('|') ?? []) if (!r.units!.split('|').some((x) => ARMIES[id].has(x))) expect.fail(`${id} offered ${r.name} (${k})`);
        }
      }
    }
  });
});

