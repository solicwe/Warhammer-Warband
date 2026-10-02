import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botAct } from './bot';
import { MISSIONS } from './config';
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
  for (const dep of MISSIONS.deployments) {
    for (const prim of MISSIONS.primaries) {
      for (const seed of [1, 7]) {
        it(`${dep.id} / ${prim.id} / seed ${seed} reaches game over`, () => {
          const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [SM, ORK], names: ['A', 'B'], deploymentId: dep.id, primaryId: prim.id, seed });
          let steps = 0;
          while (s.phase !== 'gameover' && steps < 4000) {
            botAct(s);
            checkInvariants(s);
            steps++;
          }
          expect(s.phase).toBe('gameover');
          expect(s.round).toBe(5);
        });
      }
    }
  }
});
