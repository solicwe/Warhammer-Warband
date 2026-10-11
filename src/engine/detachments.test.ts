import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botAct } from './bot';
import { DET_RULES } from './detachments';
import { createGame } from './game';
import { PRESETS } from '../ui/presets';
import type { FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

describe('every automated detachment survives two bot battle rounds', () => {
  const sm = SM.detachments.filter((d) => DET_RULES[d.name]).map((d) => d.name);
  const ork = ORK.detachments.filter((d) => DET_RULES[d.name]).map((d) => d.name);
  const pairs = Array.from({ length: Math.max(sm.length, ork.length) }, (_, i) => [sm[i % sm.length], ork[i % ork.length]] as const);
  for (const [a, b] of pairs) {
    it(`${a} vs ${b}`, () => {
      const s = createGame({
        lists: [{ ...PRESETS.SM, detachments: [a] }, { ...PRESETS.ORK, detachments: [b] }],
        factions: [SM, ORK], names: ['A', 'B'], seed: 3,
      });
      s.bots = [0, 1]; // both sides play their stratagems and re-rolls
      let steps = 0;
      while (s.phase !== 'gameover' && s.round < 3 && steps < 3000) { botAct(s); steps++; }
      expect(s.round).toBeGreaterThanOrEqual(3);
      for (const u of s.units) for (const m of u.models) expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
    });
  }
});
