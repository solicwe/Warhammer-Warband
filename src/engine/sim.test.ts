import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botAct } from '../ai/bot';
import { layoutsFor, MISSIONS, type DispositionId } from './config';
import { createGame } from './game';
import { PRESETS } from '../ui/presets';
import type { GameState } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));
const SM = load('SM');
const ORK = load('ORK');

function checkInvariants(s: GameState) {
  for (const p of s.players) {
    expect(p.cp).toBeGreaterThanOrEqual(0);
    expect(p.vp).toBeLessThanOrEqual(MISSIONS.vpCaps.primaryTotal);
  }
  for (const u of s.units) for (const m of u.models) {
    if (!m.dead) expect(m.wounds).toBeGreaterThan(0);
    expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
  }
}

describe('full game simulation (bot vs bot)', () => {
  const D = MISSIONS.forceDispositions.map((d) => d.id);
  const matchups: [DispositionId, DispositionId][] = [];
  for (let i = 0; i < D.length; i++) for (let j = i; j < D.length; j++) matchups.push([D[i], D[j]]);
  matchups.forEach(([a, b], k) => {
    const layout = layoutsFor(a, b)[k % 3];
    for (const seed of [1, 7]) {
      it(`${a} vs ${b} / ${layout.deployment} #${layout.number} / seed ${seed} reaches game over`, () => {
        const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [SM, ORK], names: ['A', 'B'], deploymentId: layout.id, dispositions: seed === 1 ? [a, b] : [b, a], seed, secondaryMode: seed === 7 ? 'tactical' : 'none' });
        let steps = 0;
        while (s.phase !== 'gameover' && steps < 5000) {
          botAct(s);
          checkInvariants(s);
          steps++;
        }
        expect(s.phase).toBe('gameover');
        expect(s.round).toBe(5);
      });
    }
  });
});
