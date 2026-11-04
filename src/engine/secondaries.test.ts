// Secondary missions: cards really are drawn at random, shown, and score VP in a played game.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botAct } from '../ai/bot';
import { createGame } from './game';
import { alive } from './state';
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
  }, 360_000); // three whole games with lookahead
});

describe('Plunder and Beacon', () => {
  const setup = () => {
    const s = createGame({ lists: armies(), factions: [SM, ORK], names: ['A', 'B'], seed: 7, secondaryMode: 'tactical' });
    s.units.forEach((u) => { u.status = 'board'; });
    s.round = 2; s.turn = 3; s.active = 0;
    return s;
  };
  it('Plunder is offered to a unit standing in a terrain area outside its territory', async () => {
    const { actionOptions, territoryPoly } = await import('./missions');
    const { formationAt, placeUnit } = await import('./game');
    const { pointInPoly, polyCentroid } = await import('./geometry');
    const s = setup();
    s.players[0].secActive = ['plunder'];
    s.phase = 'shooting';
    const t = s.terrain.find((x) => x.kind !== 'objective-area' && !pointInPoly(polyCentroid(x.poly), territoryPoly(s, 0)) && x.poly.length > 3)!;
    const u = s.units.find((x) => x.owner === 0 && alive(x).length === 1) ?? s.units.find((x) => x.owner === 0)!;
    placeUnit(s, u, formationAt(u, polyCentroid(t.poly)));
    u.move = null; u.shotTurn = -10;
    expect(actionOptions(s, 0).some((o) => o.action === 'plunder' && o.unitId === u.id)).toBe(true);
  });
  it('Beacon: the player may select the beacon unit during the turn the card is drawn', async () => {
    const { beaconCandidates, setBeacon } = await import('./secondaries');
    const s = setup();
    s.players[0].secActive = ['beacon'];
    s.players[0].sec.beaconTurn = s.turn;
    const mine = beaconCandidates(s, 0);
    expect(mine.length).toBeGreaterThan(1);
    expect(setBeacon(s, 0, mine[1].id)).toBeNull();
    expect(s.players[0].sec.beacon).toBe(mine[1].id);
    s.turn += 1;
    expect(beaconCandidates(s, 0)).toEqual([]);
  });
  it('Burden of Trust: guardOptions lists objectives and setGuard assigns friendly units in range', async () => {
    const { guardOptions, setGuard } = await import('./secondaries');
    const { formationAt, placeUnit } = await import('./game');
    const s = setup();
    s.players[0].secActive = ['burden-of-trust'];
    const obj = s.objectives[0];
    const u = s.units.find((x) => x.owner === 0)!;
    placeUnit(s, u, formationAt(u, { x: obj.x, y: obj.y }));
    const opts = guardOptions(s, 0);
    const opt = opts.find((o) => o.objId === obj.id);
    expect(opt).toBeDefined();
    expect(opt!.candidates.some((c) => c.id === u.id)).toBe(true);

    expect(setGuard(s, 0, obj.id, u.id)).toBeNull();
    expect(s.players[0].sec.guards.some((g) => g.objId === obj.id && g.unitId === u.id)).toBe(true);

    // Clears guard
    expect(setGuard(s, 0, obj.id, null)).toBeNull();
    expect(s.players[0].sec.guards.some((g) => g.objId === obj.id)).toBe(false);
  });

  it('A Tempting Target: temptingTargetCandidates lists No Mans Land objectives and setTemptingTarget sets it', async () => {
    const { temptingTargetCandidates, setTemptingTarget } = await import('./secondaries');
    const s = setup();
    s.players[0].secActive = ['a-tempting-target'];
    const cands = temptingTargetCandidates(s, 0);
    expect(cands.length).toBeGreaterThan(0);
    const targetObj = cands[0].obj;
    expect(setTemptingTarget(s, 0, targetObj.id)).toBeNull();
    expect(s.players[0].sec.temptingTarget).toBe(targetObj.id);
  });
});
