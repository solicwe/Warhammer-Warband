// A short battle: three rounds, then the score is final. The last round's rules (Primary scored at the end of the turn,
// CP kept for nothing, the end-of-battle secondaries) come at round 3 instead of round 5.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botShouldAct, botStep } from '../ai/bot';
import { createGame, endPhase } from './game';
import { lastRound, pace } from './state';
import { PRESETS } from '../ui/presets';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));

describe('short battle', () => {
  it('ends after battle round 3 with a winner decided', () => {
    const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 5, secondaryMode: 'tactical', maxRounds: 3 });
    s.bots = [0, 1];
    expect(lastRound(s)).toBe(3);
    let steps = 0;
    while (s.phase !== 'gameover' && steps < 8000) {
      steps++;
      const p = s.window?.player ?? (s.phase === 'deploy' || s.phase === 'scouts' ? s.deployTurn : s.active);
      if (botShouldAct(s, p)) botStep(s, p); else endPhase(s);
    }
    expect(s.phase).toBe('gameover');
    expect(s.round).toBe(3);
    expect(s.winner).not.toBeNull();
    expect(s.players.some((P) => P.vp > 0)).toBe(true);
  });

  it('a full game is unchanged: no maxRounds, pace equals the round', () => {
    const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 5 });
    expect(s.maxRounds).toBeUndefined();
    expect(lastRound(s)).toBe(5);
    s.round = 3;
    expect(pace(s)).toBe(3);
    const t = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['A', 'B'], seed: 5, maxRounds: 3 });
    t.round = 3;
    expect(pace(t)).toBe(5);
  });
});
