// Secondary missions: cards really are drawn at random, shown, and score VP in a played game.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botAct } from './bot';
import { createGame } from './game';
import type { ArmyList, FactionData } from './types';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
const SM = load('SM'), ORK = load('ORK');
const list = (f: string, u: [string, number, number][]): ArmyList => ({ name: 't', factionId: f, battleSize: 'incursion', detachments: [], units: u.map(([d, n, p], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts: p })) });
const armies = (): [ArmyList, ArmyList] => [
  list('SM', [['Intercessor Squad', 10, 150], ['Hellblaster Squad', 5, 110], ['Redemptor Dreadnought', 1, 195], ['Assault Intercessor Squad', 5, 75], ['Captain', 1, 80]]),
  list('ORK', [['Boyz', 20, 180], ['Deff Dread', 1, 130], ['Mek Gunz', 1, 55], ['Warboss', 1, 100], ['Stormboyz', 5, 65]]),
];

describe('tactical secondaries', () => {
  it('the deck is shuffled differently per game, two cards are drawn at the start of the turn and the draw is shown', () => {
    const decks = [1, 2, 3].map((seed) => createGame({ lists: armies(), factions: [SM, ORK], names: ['A', 'B'], seed, secondaryMode: 'tactical' }).players[0].secDeck.join(','));
    expect(new Set(decks).size).toBe(3);
    const s = createGame({ lists: armies(), factions: [SM, ORK], names: ['A', 'B'], seed: 4, secondaryMode: 'tactical' });
    s.bots = [0, 1];
    let steps = 0;
    while (!(s.phase === 'command' && s.round === 1) && steps < 400) { botAct(s); steps++; }
    const first = s.players[s.active];
    expect(first.secActive.length).toBe(2);
    expect((s.fx ?? []).some((e) => e.kind === 'cards' && e.owner === s.active && e.ids.length === 2)).toBe(true);
  });

  it('over whole games both sides draw new cards and score secondary VP', () => {
    let scored = 0, drawn = 0;
    for (const seed of [11, 12, 13]) {
      const s = createGame({ lists: armies(), factions: [SM, ORK], names: ['A', 'B'], seed, secondaryMode: 'tactical' });
      s.bots = [0, 1];
      let steps = 0;
      while (s.phase !== 'gameover' && steps < 6000) { botAct(s); steps++; }
      scored += s.players[0].secVp + s.players[1].secVp;
      drawn += s.log.filter((l) => /draws Secondary Mission/.test(l.text)).length;
    }
    expect(drawn).toBeGreaterThan(12);
    expect(scored).toBeGreaterThan(0);
  });
});
