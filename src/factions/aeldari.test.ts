import { describe, it, expect, beforeEach } from 'vitest';
import {
  isAeldariArmy,
  getFateDice,
  gainFateDice,
  aeldariBattleStart,
  aeldariRoundStart,
  canFocus,
  spendFocus,
  canUseFateDie,
  useFateDie,
  tryFateDie,
  resetPhaseStrandsOfFate,
} from './aeldari';
import { createGame } from '../engine/game';
import { botAct } from '../ai/bot';
import { PRESETS } from '../ui/presets';
import aeFaction from '../../public/data/factions/AE.json';
import smFaction from '../../public/data/factions/SM.json';
import type { GameState, UnitState } from '../engine/types';

function createMockAeldariState(): GameState {
  return {
    turn: 0,
    round: 1,
    active: 0,
    firstPlayer: 0,
    phase: 'command',
    players: [
      {
        id: 0,
        name: 'Aeldari Player',
        factionId: 'AE',
        factionName: 'Aeldari',
        cp: 1,
        vp: 0,
        fateDice: [],
        strandsOfFateUsed: [],
        battleFocusTokens: 0,
        detachments: [{ id: 'd1', name: 'Warhost', rules: [{ name: 'Martial Grace', text: '' }] }],
      } as any,
      {
        id: 1,
        name: 'Enemy Player',
        factionId: 'SM',
        factionName: 'Space Marines',
        cp: 1,
        vp: 0,
      } as any,
    ],
    units: [],
    objectives: [
      { id: 'obj1', x: 10, y: 10, r: 1.5, controller: 0 },
      { id: 'obj2', x: 30, y: 20, r: 1.5, controller: 1 },
    ],
    fx: [],
    log: [],
  } as unknown as GameState;
}

function createUnit(id: string, name: string, owner: number, x: number, y: number, abilities: string[] = []): UnitState {
  return {
    id,
    owner,
    name,
    sources: [name],
    keywords: ['AELDARI', 'INFANTRY'],
    factionKeywords: ['AELDARI'],
    models: [
      {
        id: `${id}-m1`,
        name,
        source: name,
        x,
        y,
        r: 1,
        wounds: 1,
        dead: false,
        profile: { M: 7, T: 3, Sv: 4, W: 1, Ld: 6, OC: 1 },
      },
    ],
    startingStrength: 1,
    abilities: abilities.map((a) => ({ name: a, text: '', type: 'Datasheet' })),
    status: 'board',
    buffs: [],
    core: {},
  } as unknown as UnitState;
}

describe('Aeldari Engine & Strands of Fate', () => {
  let state: GameState;

  beforeEach(() => {
    state = createMockAeldariState();
  });

  it('identifies Aeldari army correctly', () => {
    expect(isAeldariArmy(state, 0)).toBe(true);
    expect(isAeldariArmy(state, 1)).toBe(false);
  });

  it('aeldariBattleStart rolls 6 Fate dice (Eldrad does not add any: his ability gives CP)', () => {
    state.units.push(createUnit('u-eldrad', 'Eldrad Ulthran', 0, 5, 5, ['Diviner of Futures']));
    aeldariBattleStart(state);
    const pool = getFateDice(state, 0);
    expect(pool.length).toBe(6);
    expect(pool.every((d) => d >= 1 && d <= 6)).toBe(true);
  });

  it('Battle Focus: 2 / 4 / 6 tokens by battle size each round, Warhost one more', () => {
    state.players[0].armyRules = [{ name: 'Battle Focus', text: '' }] as never;
    for (const [size, n] of [['incursion', 3], ['strike-force', 5], ['onslaught', 7]] as const) {
      state.players[0].battleSize = size;
      aeldariRoundStart(state);
      expect(state.players[0].battleFocusTokens).toBe(n);
    }
  });

  it('Agile Manoeuvres: a token each, one manoeuvre per unit per phase, Swift as the Wind for several units', () => {
    state.players[0].battleFocusTokens = 2;
    const a = createUnit('a', 'Dire Avengers', 0, 10, 10, ['Battle Focus']);
    const b = createUnit('b', 'Rangers', 0, 20, 10, ['Battle Focus']);
    const c = createUnit('c', 'Wraithguard', 0, 30, 10);
    state.units.push(a, b, c);
    expect(canFocus(state, c, 'swift')).toBe(false); // no Battle Focus (not in a Spirit Conclave)
    expect(canFocus(state, a, 'swift')).toBe(true);
    spendFocus(state, a, 'swift', 'Swift as the Wind');
    expect(state.players[0].battleFocusTokens).toBe(1);
    expect(canFocus(state, a, 'flitting')).toBe(false); // this unit performed one this phase
    expect(canFocus(state, b, 'swift')).toBe(true); // another unit may still use Swift as the Wind
    spendFocus(state, b, 'suddenStrike', 'Sudden Strike');
    expect(state.players[0].battleFocusTokens).toBe(0);
    expect(canFocus(state, c, 'flitting')).toBe(false);
  });

  it('gainFateDice adds dice in descending order', () => {
    state.players[0].fateDice = [5, 3];
    gainFateDice(state, 0, 1, 6, 'Defenders of the Shrines');
    expect(state.players[0].fateDice).toEqual([6, 5, 3]);
  });

  it('useFateDie substitutes a die, removes it from pool, and enforces once per phase limit', () => {
    state.players[0].fateDice = [6, 4, 2];
    const unit = createUnit('u1', 'Dire Avengers', 0, 10, 10);
    state.units.push(unit);

    expect(canUseFateDie(state, unit)).toBe(true);
    const substituted = useFateDie(state, unit, undefined, 4, 'Charge roll');
    expect(substituted).toBe(4); // picked lowest die >= 4
    expect(state.players[0].fateDice).toEqual([6, 2]);

    // Already used this phase
    expect(canUseFateDie(state, unit)).toBe(false);
    expect(useFateDie(state, unit)).toBeNull();

    // After phase reset, can use again
    resetPhaseStrandsOfFate(state);
    expect(canUseFateDie(state, unit)).toBe(true);
  });

  it('tryFateDie intelligently substitutes for charge when high die available', () => {
    state.players[0].fateDice = [6, 5, 2];
    const unit = createUnit('u1', 'Howling Banshees', 0, 10, 10);
    state.units.push(unit);

    const substituted = tryFateDie(state, unit, 'charge', { need: 8 });
    expect(substituted).toBe(5); // picked 5 (min need 8-6=2)
    expect(state.players[0].fateDice).toEqual([6, 2]);
  });

  it('runs a complete Aeldari bot-vs-bot game to game over without error', () => {
    const gameState = createGame({
      lists: [PRESETS.AE, PRESETS.SM],
      factions: [aeFaction as any, smFaction as any],
      names: ['Aeldari', 'Marines'],
      dispositions: ['take-and-hold', 'take-and-hold'],
      seed: 123,
    });
    gameState.bots = [0, 1];
    let steps = 0;
    while (gameState.phase !== 'gameover' && steps < 5000) {
      botAct(gameState);
      steps++;
    }
    expect(gameState.phase).toBe('gameover');
    expect(steps).toBeLessThan(5000);
  });
});

