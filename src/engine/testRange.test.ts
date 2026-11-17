// The test range: a small empty table for trying out shooting. Not an official layout, never picked at random.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botShouldAct, botStep } from '../ai/bot';
import { LAYOUTS, TEST_RANGE, TEST_RANGE_ID, layoutsFor } from './config';
import { createGame, endPhase } from './game';
import { alive, boardUnits, tableH, tableW } from './state';
import { PRESETS } from '../ui/presets';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));
const range = () => createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 5, deploymentId: TEST_RANGE_ID, maxRounds: 2 });

describe('test range', () => {
  it('is not among the official layouts and never comes from a pairing', () => {
    expect(LAYOUTS.some((l) => l.id === TEST_RANGE_ID)).toBe(false);
    expect(layoutsFor('take-and-hold', 'take-and-hold').some((l) => l.id === TEST_RANGE_ID)).toBe(false);
  });
  it('is a 24" x 30" table with no terrain', () => {
    const s = range();
    expect(s.deploymentId).toBe(TEST_RANGE_ID);
    expect([tableW(s), tableH(s)]).toEqual([24, 30]);
    expect(s.terrain.filter((t) => t.kind !== 'objective-area').length).toBe(0); // only the flat objective areas
    expect(TEST_RANGE.terrain.length).toBe(0);
  });
  it('a whole bot game on it ends, and every model stays on the table', () => {
    const s = range();
    s.bots = [0, 1];
    let steps = 0;
    while (s.phase !== 'gameover' && steps < 8000) {
      steps++;
      const p = s.window?.player ?? (s.phase === 'deploy' || s.phase === 'scouts' ? s.deployTurn : s.active);
      if (botShouldAct(s, p)) botStep(s, p); else endPhase(s);
      for (const u of boardUnits(s, 0).concat(boardUnits(s, 1))) for (const m of alive(u)) {
        expect(m.x).toBeGreaterThan(-1); expect(m.x).toBeLessThan(25); expect(m.y).toBeGreaterThan(-1); expect(m.y).toBeLessThan(31);
      }
    }
    expect(s.phase).toBe('gameover');
  }, 240000);
});
