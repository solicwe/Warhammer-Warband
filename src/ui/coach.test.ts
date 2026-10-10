// First-battle tips: the right tip for the moment, none on the bot's side of things it can't see.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGame } from '../engine/game';
import { PRESETS } from './presets';
import { tipsNow, type CoachView } from './Coach';

const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8'));
const game = () => {
  const s = createGame({ lists: [PRESETS.SM, PRESETS.ORK], factions: [load('SM'), load('ORK')], names: ['You', 'Bot'], seed: 2 });
  s.bots = [1];
  return s;
};
const view = (over: Partial<CoachView>): CoachView => ({ s: game(), me: 0, botActing: false, mode: null, selFresh: false, selCanShoot: false, selCanCharge: false, planReady: false, ...over });

describe('coach tips', () => {
  it('deployment, movement and shooting each point at their control', () => {
    const s = game();
    s.deployTurn = 0;
    expect(tipsNow(view({ s }))[0].id).toBe('deploy');
    s.phase = 'movement'; s.active = 0; s.round = 1;
    expect(tipsNow(view({ s }))[0].id).toBe('move');
    expect(tipsNow(view({ s, selFresh: true }))[0].id).toBe('move-kind');
    expect(tipsNow(view({ s, mode: { k: 'move' } }))[0].id).toBe('move-drag');
    s.phase = 'shooting';
    expect(tipsNow(view({ s, selFresh: true, selCanShoot: true }))[0].id).toBe('shoot-pick');
    expect(tipsNow(view({ s, mode: { k: 'shoot', target: null } }))[0].id).toBe('shoot-target');
  });
  it('the bot\'s turn gets its tip; the enemy\'s phases get none; game over gets none', () => {
    const s = game();
    s.phase = 'movement'; s.active = 1;
    expect(tipsNow(view({ s })).length).toBe(0);
    expect(tipsNow(view({ s, botActing: true }))[0].id).toBe('bot-turn');
    s.phase = 'gameover';
    expect(tipsNow(view({ s, botActing: true })).length).toBe(0);
  });
});
