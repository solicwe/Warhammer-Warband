// The rules data is checked against the engine: a condition, trigger or key the engine does not know makes a rule
// silently do nothing, while the app still shows it as automated.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cond, unknownConds } from '../rules-engine/effects';
import { createGame } from './game';
import { PRESETS } from '../ui/presets';
import type { FactionData } from './types';

const files = [
  ...fs.readdirSync('data/abilities').map((f) => `data/abilities/${f}`),
  ...fs.readdirSync('data/stratagems').map((f) => `data/stratagems/${f}`),
  'data/detachment-rules.json', 'data/ability-rules.json',
];
const books = files.map((f) => {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { f, rules: (d.rules ?? d) as Record<string, unknown> };
});
const src = ['src/engine', 'src/rules-engine', 'src/factions', 'src/ai', 'src/ui'].flatMap((d) => fs.readdirSync(d).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.')).map((f) => fs.readFileSync(`${d}/${f}`, 'utf8'))).join('\n');

/** Every [rule name, object] pair under a rule, depth first, with the key it sits under. */
function* nodes(o: unknown, key = ''): Generator<[string, Record<string, unknown>]> {
  if (Array.isArray(o)) { for (const x of o) yield* nodes(x, key); return; }
  if (!o || typeof o !== 'object') return;
  yield [key, o as Record<string, unknown>];
  for (const [k, v] of Object.entries(o)) yield* nodes(v, k);
}
const each = (fn: (where: string, key: string, n: Record<string, unknown>) => void) => {
  for (const b of books) for (const [name, r] of Object.entries(b.rules)) for (const [k, n] of nodes(r)) fn(`${b.f}: ${name}`, k, n);
};

// triggers no code fires yet: the rules that use them are listed as known gaps in docs/RULES_STATUS.md
const KNOWN_TRIGGER_GAPS = new Set(['enemyShootHit', 'shootingEnd', 'targetedByAttack']);

describe('rules data matches the engine', () => {
  it('every condition is one cond() understands', () => {
    const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
    const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 1 });
    const A = s.units.find((u) => u.owner === 0)!;
    const T = s.units.find((u) => u.owner === 1)!;
    const bad: string[] = [];
    each((where, _k, n) => {
      for (const [k, v] of Object.entries(n)) {
        if (!(k === 'if' || k.endsWith('If')) || !Array.isArray(v)) continue;
        for (const c of v) {
          for (const part of String(c).replace(/^(any|all):/, '').split(/\|\||&&/)) {
            unknownConds.clear();
            try { cond(part, { s, A, T, m: A.models[0], holder: A, d: 3, kind: 'melee' }); } catch { /* a prefix handler took it */ }
            if (unknownConds.size) bad.push(`${where}: ${part}`);
          }
        }
      }
    });
    expect(bad).toEqual([]);
  });

  it('every trigger (when / react) is fired somewhere', () => {
    const bad: string[] = [];
    each((where, _k, n) => {
      for (const k of ['when', 'react']) {
        const v = n[k];
        if (typeof v === 'string' && !KNOWN_TRIGGER_GAPS.has(v) && !new RegExp(`['"]${v}['"]`).test(src)) bad.push(`${where}: ${k} ${v}`);
      }
    });
    expect(bad).toEqual([]);
  });

  it('melee / ranged is set with "attack" (a "kind" key is ignored)', () => {
    const bad: string[] = [];
    each((where, _k, n) => { if (n.kind === 'melee' || n.kind === 'ranged') bad.push(where); });
    expect(bad).toEqual([]);
  });

  it('defend.save is a bonus to the roll, not a Save characteristic (use svSet)', () => {
    const bad: string[] = [];
    each((where, k, n) => { if (k === 'defend' && typeof n.save === 'number' && n.save > 1) bad.push(where); });
    expect(bad).toEqual([]);
  });
});
