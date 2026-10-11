// The bot commander's lines: every faction has a voice, names are filled in, and a line is not said twice in a row.
import { describe, expect, it } from 'vitest';
import { line, voiceOf } from './voice';

const FACTIONS = ['AC', 'AE', 'AM', 'AS', 'AdM', 'AoI', 'CD', 'CSM', 'DG', 'DRU', 'EC', 'GC', 'GK', 'LoV', 'NEC', 'ORK', 'QI', 'QT', 'SM', 'TAU', 'TL', 'TS', 'TYR', 'UA', 'WE'];

describe('commander voices', () => {
  it('every faction has a commander and a line for every moment', () => {
    for (const f of FACTIONS) {
      expect(voiceOf(f).title.length).toBeGreaterThan(2);
      for (const ev of ['think', 'steady', 'aggressive', 'careful', 'objectives', 'hunt', 'target', 'kill', 'loss', 'objective', 'objectiveLost', 'charge', 'ahead', 'behind', 'win', 'lose'] as const) {
        const l = line(f, ev, { u: 'Boyz', t: 'Intercessors' });
        expect(l.length).toBeGreaterThan(3);
        expect(l).not.toMatch(/\{[ut]\}/);
      }
    }
  });
  it('names go into the line, and the same line is not said twice in a row', () => {
    expect(line('ORK', 'kill', { t: 'Intercessors' })).toBeTruthy();
    let prev = line('SM', 'kill', { t: 'Boyz' });
    for (let i = 0; i < 20; i++) { const l = line('SM', 'kill', { t: 'Boyz' }); expect(l).not.toBe(prev); prev = l; }
    expect([0, 1, 2, 3, 4, 5].map(() => line('NEC', 'target', { t: 'Gretchin' })).some((l) => l.includes('Gretchin'))).toBe(true);
  });
});
