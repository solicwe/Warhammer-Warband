import { describe, expect, it } from 'vitest';
import { canCrossDense, blockingWalls } from './pathing';
import { weaponFx } from './weaponFx';
import { stratagemBlock } from '../rules-engine/stratagems';
import { discardSecondary } from './game';
import { secondaryDead } from './secondaries';
import type { GameState, ModelState, StratagemData, WeaponProfileData } from './types';

describe('User Feedback Fixes Verification', () => {
  it('Beast keyword allows passing through dense walls', () => {
    const beastModel = {
      id: 'm1',
      keywords: ['BEAST'],
      r: 0.5,
    } as unknown as ModelState;
    const beastPluralModel = {
      id: 'm2',
      keywords: ['BEASTS'],
      r: 0.5,
    } as unknown as ModelState;
    const infantryModel = {
      id: 'm3',
      keywords: ['INFANTRY'],
      r: 0.5,
    } as unknown as ModelState;
    const vehicleModel = {
      id: 'm4',
      keywords: ['VEHICLE'],
      r: 1.5,
    } as unknown as ModelState;

    expect(canCrossDense(beastModel)).toBe(true);
    expect(canCrossDense(beastPluralModel)).toBe(true);
    expect(canCrossDense(infantryModel)).toBe(true);
    expect(canCrossDense(vehicleModel)).toBe(false);

    const s = {
      terrain: [
        { category: 'dense', height: 4, walls: [{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }] },
      ],
      units: [],
    } as unknown as GameState;

    expect(blockingWalls(s, beastModel)).toHaveLength(0);
    expect(blockingWalls(s, beastPluralModel)).toHaveLength(0);
    expect(blockingWalls(s, vehicleModel)).toHaveLength(1);
  });

  it('Fatecaster greatbow and other bows get arrow effect instead of psychic', () => {
    const fatecasterProf: WeaponProfileData = { name: 'Fatecaster greatbow', range: 30, A: '2', skill: 3, S: 5, AP: -2, D: '2', abilities: ['ignores cover', 'lethal hits', 'precision'] };
    expect(weaponFx('Fatecaster greatbow', fatecasterProf, false)).toBe('arrow');

    const dartBowProf: WeaponProfileData = { name: 'Dart-bow and tri-blade', range: 24, A: 'D3+1', skill: 3, S: 4, AP: 0, D: '2', abilities: [] };
    expect(weaponFx('Dart-bow and tri-blade', dartBowProf, false)).toBe('arrow');
  });

  it('Stratagem placing units into reserves checks reserve points limit', () => {
    const s = {
      phase: 'fight',
      round: 2,
      active: 1, // opponent's fight phase
      log: [],
      players: [
        { name: 'P0', factionId: 'TS', cp: 3, detachments: [] },
        { name: 'P1', factionId: 'SM', cp: 3, detachments: [] },
      ],
      units: [
        // Total army points = 1000. Cap = 1000 * 0.5 = 500 pts.
        // u1 is 520 pts (> 500 cap).
        { id: 'u1', owner: 0, pts: 520, keywords: ['MONSTER', 'SCINTILLATING LEGIONS'], factionKeywords: ['THOUSAND SONS'], status: 'board', buffs: [], models: [{ id: 'm1', wounds: 18, dead: false }] },
        { id: 'u2', owner: 0, pts: 480, keywords: ['INFANTRY'], factionKeywords: ['THOUSAND SONS'], status: 'board', buffs: [], models: [{ id: 'm2', wounds: 1, dead: false }] },
      ],
    } as unknown as GameState;

    const glimmershift: StratagemData = {
      id: 'glimmershift-portal',
      name: 'GLIMMERSHIFT PORTAL',
      cp: 1,
      type: 'Strategic Ploy',
      phase: 'fight',
      turn: 'opponent',
      text: 'Remove those units from the battlefield and place them into Strategic Reserves.',
    };

    const targetUnit = s.units[0];
    const blockReason = stratagemBlock(s, 0, glimmershift, targetUnit, { react: true });
    expect(blockReason).toContain('Strategic Reserves limit reached');
  });

  it('Discarding an unachievable secondary immediately draws a replacement', () => {
    const s = {
      round: 2,
      active: 0,
      phase: 'shooting',
      log: [],
      fx: [],
      players: [
        {
          name: 'P0',
          cp: 1,
          secMode: 'tactical',
          secActive: ['assassination'],
          secDeck: ['no-prisoners'],
          sec: {},
        },
        {
          name: 'P1',
          cp: 1,
          secMode: 'tactical',
          secActive: [],
          secDeck: [],
          sec: {},
        },
      ],
      units: [
        // Friendly unit
        { id: 'f1', owner: 0, status: 'board', models: [{ id: 'fm1', dead: false, profile: { M: 6 } }] },
        // No enemy characters alive
        { id: 'e1', owner: 1, status: 'board', models: [{ id: 'em1', isCharacter: false, dead: false }] },
      ],
      objectives: [],
    } as unknown as GameState;

    expect(secondaryDead(s, 0, 'assassination')).toBe(true);
    discardSecondary(s, 0, 'assassination');

    // It should have discarded assassination, drawn replacement immediately, and awarded +1 CP
    expect(s.players[0].secActive).not.toContain('assassination');
    expect(s.players[0].secActive).toContain('no-prisoners');
    expect(s.players[0].cp).toBe(2);
  });

  it('Theme manager properly stores and applies light and dark themes', async () => {
    const { applyTheme, getEffectiveTheme, getStoredTheme } = await import('../ui/theme');

    applyTheme('light');
    expect(getStoredTheme()).toBe('light');
    expect(getEffectiveTheme('light')).toBe('light');

    applyTheme('dark');
    expect(getStoredTheme()).toBe('dark');
    expect(getEffectiveTheme('dark')).toBe('dark');

    applyTheme('auto');
    expect(getStoredTheme()).toBe('auto');
  });

  it('Risen Rubricae candidates exclude units in reserves and sync properly', async () => {
    const { risenRubricaeCandidates, syncRisenRubricaeWithReserves } = await import('../factions/thousandSons');

    const s = {
      log: [],
      players: [
        {
          name: 'TS Player',
          factionId: 'TS',
          risenRubricae: ['term1'],
        },
      ],
      units: [
        {
          id: 'term1',
          name: 'Terminators 1',
          owner: 0,
          status: 'reserves', // Sent to reserves
          pts: 200,
          keywords: ['TERMINATOR', 'RUBRICAE'],
          core: { infiltrators: true },
          enhancements: [{ name: 'Risen Rubricae' }],
        },
        {
          id: 'term2',
          name: 'Terminators 2',
          owner: 0,
          status: 'pending', // Available to deploy on board
          pts: 200,
          keywords: ['TERMINATOR', 'RUBRICAE'],
          core: { infiltrators: false },
        },
      ],
    } as unknown as GameState;

    // Unit in reserves should NOT be a candidate
    const candsBefore = risenRubricaeCandidates(s, 0);
    expect(candsBefore.map((c) => c.unit.id)).toEqual(['term2']);

    // Syncing with reserves should remove term1 and update infiltrators
    syncRisenRubricaeWithReserves(s, 0);
    expect(s.units[0].core.infiltrators).toBe(false);
    expect(s.players[0].risenRubricae).toEqual(['term2']);
    expect(s.units[1].core.infiltrators).toBe(true);
  });
});
