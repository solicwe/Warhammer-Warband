// Every scoring condition written in data/missions.json must have engine code behind it (an unknown one scores 0 forever),
// and the card lines that are separate on the official cards stay separate.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MISSIONS } from './config';

const mis = fs.readFileSync('src/engine/missions.ts', 'utf8');
const sec = fs.readFileSync('src/engine/secondaries.ts', 'utf8');
const hasCase = (src: string, c: string) => src.includes(`case '${c}'`);

describe('mission data and engine agree', () => {
  it('all 25 primaries and 18 secondaries are there', () => {
    expect(MISSIONS.primaries.length).toBe(25);
    expect(MISSIONS.secondaries.length).toBe(18);
  });
  it('every primary scoring condition (and bonus) has a handler', () => {
    const missing: string[] = [];
    for (const p of MISSIONS.primaries as unknown as { id: string; scoring: { condition: string; bonus?: { condition: string } }[] }[]) {
      for (const s of p.scoring) for (const c of [s.condition, s.bonus?.condition]) if (c && !hasCase(mis, c)) missing.push(`${p.id}: ${c}`);
    }
    expect(missing).toEqual([]);
  });
  it('every secondary scoring condition (and bonus) has a handler', () => {
    const missing: string[] = [];
    for (const s of MISSIONS.secondaries) for (const a of s.auto) for (const c of [a.condition, a.bonus?.condition]) if (c && !hasCase(sec, c)) missing.push(`${s.id}: ${c}`);
    expect(missing).toEqual([]);
  });
  it('Purge and Secure scores its two 3VP kill lines separately', () => {
    const p = (MISSIONS.primaries as unknown as { id: string; scoring: { condition: string; vp: number }[] }[]).find((x) => x.id === 'purge-and-secure')!;
    expect(p.scoring.filter((s) => s.vp === 3 && /^kill/.test(s.condition)).map((s) => s.condition)).toEqual(['killByUnitNearObjective', 'killStartedInRangeOfObjective']);
  });
  it('Assassination (tactical) has two separate 5VP lines', () => {
    const a = MISSIONS.secondaries.find((x) => x.id === 'assassination')!;
    expect(a.auto.filter((r) => r.mode === 'tactical').map((r) => r.condition)).toEqual(['characterDiedThisTurn', 'allCharactersDead']);
  });
});
