// Bot-vs-bot battles with many different datasheets, so every ability's code path runs in real games.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botAct } from './bot';
import { createGame } from './game';
import type { ArmyList, FactionData, GameState } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM');
const ORK = load('ORK');

/** A list of `n` datasheets taken in turn from the faction (offset by k), with their first points option. */
function spread(f: FactionData, k: number, n: number, sub?: string): ArmyList {
  const sheets = f.datasheets.filter((d) => d.points[0]?.options.length && (!d.subfaction || d.subfaction === sub) && !d.keywords.includes('FORTIFICATION'));
  const units = Array.from({ length: n }, (_, i) => sheets[(k * n + i) % sheets.length]).map((d, i) => {
    const o = d.points[0].options[0];
    return { uid: `u${i}`, datasheet: d.name, models: o.models, pts: o.pts };
  });
  return { name: 't', factionId: f.id, subfaction: sub, battleSize: 'strike', detachments: [], units };
}

function invariants(s: GameState) {
  for (const p of s.players) expect(p.cp).toBeGreaterThanOrEqual(0);
  for (const u of s.units) for (const m of u.models) {
    if (!m.dead) expect(m.wounds).toBeGreaterThan(0);
    expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
  }
}

describe('bot battles with every datasheet', () => {
  const chapters = [undefined, 'BLOOD ANGELS', 'DARK ANGELS', 'SPACE WOLVES', 'BLACK TEMPLARS', 'ULTRAMARINES', 'DEATHWATCH'];
  const smCount = SM.datasheets.length;
  const games = Math.ceil(smCount / 10);
  for (let k = 0; k < games; k++) {
    const sub = chapters[k % chapters.length];
    it(`game ${k + 1}/${games} (${sub ?? 'codex'})`, () => {
      const a = spread(SM, k, 10, sub);
      const b = spread(ORK, k, 10);
      a.detachments = [SM.detachments.filter((d) => !d.subfaction || d.subfaction === sub)[k % 5]?.name].filter(Boolean) as string[];
      b.detachments = [ORK.detachments[k % ORK.detachments.length].name];
      const s = createGame({ lists: [a, b], factions: [SM, ORK], names: ['A', 'B'], seed: 11 + k });
      let steps = 0;
      while (s.phase !== 'gameover' && s.round < 4 && steps < 4000) {
        botAct(s);
        invariants(s);
        steps++;
      }
      expect(s.round >= 4 || s.phase === 'gameover').toBe(true);
    });
  }
});
