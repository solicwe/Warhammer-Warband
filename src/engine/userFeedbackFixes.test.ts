import fs from 'fs';
import { describe, expect, it } from 'vitest';
import { canCrossDense, blockingWalls } from './pathing';
import { weaponFx } from './weaponFx';
import { stratagemBlock } from '../rules-engine/stratagems';
import { discardSecondary } from './game';
import { secondaryDead } from './secondaries';
import { embarkCheck, parseTransport } from './army';
import type { GameState, ModelState, StratagemData, WeaponProfileData, FactionData, ArmyList } from './types';

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

  it('candidate cards and unit pills explicitly display equipped enhancements to tell duplicate units apart', () => {
    const gameScreenTsx = fs.readFileSync('src/ui/GameScreen.tsx', 'utf8');
    const stratUseTsx = fs.readFileSync('src/ui/StratUse.tsx', 'utf8');

    // Risen Rubricae candidate cards display sub.enh, icon, No Enhancement fallback, and Bearer badge
    expect(gameScreenTsx).toContain('const cands = risenRubricaeCandidates(s, p);');
    expect(gameScreenTsx).toContain('const sub = unitSubDetails(c.unit);');
    expect(gameScreenTsx).toContain('<Icon name="enhancement" size={13} />');
    expect(gameScreenTsx).toContain('No Enhancement');
    expect(gameScreenTsx).toContain('Bearer');

    // Unit pill displays enhancement badge when unit has enhancements
    expect(gameScreenTsx).toContain('u.enhancements?.length > 0 && (');
    expect(gameScreenTsx).toContain("u.enhancements.map((e) => e.name).join(' · ')");

    // StratUse displays enhancement badge for friendly candidate targets
    expect(stratUseTsx).toContain('u.enhancements?.length > 0 && (');
    expect(stratUseTsx).toContain("u.enhancements.map((e) => e.name).join(' · ')");
  });

  it('Risen Rubricae automatically hides when all selected units are placed on the board, and prevents toggling deployed units', async () => {
    const { toggleRisenRubricae } = await import('../factions/thousandSons');
    const gameScreenTsx = fs.readFileSync('src/ui/GameScreen.tsx', 'utf8');

    // UI hides the card when all selected units are placed on the board
    expect(gameScreenTsx).toContain("sel.length > 0 && sel.every((c) => c.unit.status === 'board')");
    expect(gameScreenTsx).toContain('setRrCollapsed');
    expect(gameScreenTsx).toContain('This unit is already deployed on the board');

    // Engine rejects toggling units already deployed on the board
    const s = {
      turn: 1,
      phase: 'deployment',
      players: [{ risenRubricae: ['term1'] }],
      units: [
        {
          id: 'term1',
          name: 'Scarab Occult Terminators',
          owner: 0,
          status: 'board', // already deployed
          keywords: ['TERMINATOR', 'RUBRICAE'],
          core: { infiltrators: true },
          models: [{ id: 'm1', dead: false, wounds: 3, profile: { W: 3 } }],
          enhancements: [{ name: 'Risen Rubricae' }],
        },
      ],
    } as unknown as GameState;

    const res = toggleRisenRubricae(s, 0, 'term1');
    expect(res).toBe('Unit is already deployed on the battlefield');
  });

  it('Ability bar and disabled buttons use semantic theme variables for high contrast in light mode', () => {
    const css = fs.readFileSync('src/ui/styles.css', 'utf8');
    const gameScreenTsx = fs.readFileSync('src/ui/GameScreen.tsx', 'utf8');

    // .ab-bar uses var(--surface-2) instead of hardcoded dark rgba
    expect(css).toContain('.ab-bar { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1.5px solid var(--line-2); border-radius: 8px; background: var(--surface-2);');
    expect(css).not.toContain('.ab-bar { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: rgba(18, 22, 28, 0.92);');

    // .btn.primary:disabled has distinct readable styling
    expect(css).toContain('.btn.primary:disabled {');
    expect(css).toContain('background: var(--surface-2) !important;');
    expect(css).toContain('color: var(--text-3) !important;');

    // Shooting weapon selection label uses readable theme color
    expect(gameScreenTsx).toContain("color: 'var(--text-2)'");
  });

  it('Thousand Sons embarkation restrictions: Terminators and Monsters cannot embark in Rhino', () => {
    const ts = JSON.parse(fs.readFileSync('public/data/factions/TS.json', 'utf8')) as FactionData;
    const testList: ArmyList = {
      name: 'TS Test',
      factionId: 'TS',
      battleSize: 'incursion',
      detachments: [],
      units: [
        { uid: 'u_rhino', datasheet: 'Chaos Rhino', models: 1, pts: 75 },
        { uid: 'u_lr', datasheet: 'Chaos Land Raider', models: 1, pts: 240 },
        { uid: 'u_rubric', datasheet: 'Rubric Marines', models: 5, pts: 105 },
        { uid: 'u_sorc', datasheet: 'Sorcerer In Terminator Armour', models: 1, pts: 110 },
        { uid: 'u_terms', datasheet: 'Scarab Occult Terminators', models: 5, pts: 200 },
        { uid: 'u_magnus', datasheet: 'Magnus The Red', models: 1, pts: 455 },
        { uid: 'u_defiler', datasheet: 'Defiler', models: 1, pts: 330 },
      ],
    };

    const rubricCheck = embarkCheck(testList, ts, 'u_rubric', 'u_rhino');
    expect(rubricCheck.why).toBeNull();

    const sorcCheck = embarkCheck(testList, ts, 'u_sorc', 'u_rhino');
    expect(sorcCheck.why).toContain('TERMINATOR');

    const termsCheck = embarkCheck(testList, ts, 'u_terms', 'u_rhino');
    expect(termsCheck.why).toContain('TERMINATOR');

    const magnusCheck = embarkCheck(testList, ts, 'u_magnus', 'u_rhino');
    expect(magnusCheck.why).not.toBeNull();

    const defilerCheck = embarkCheck(testList, ts, 'u_defiler', 'u_rhino');
    expect(defilerCheck.why).not.toBeNull();

    // Land Raider can carry Terminators (Sorc and Scarab Occult)
    expect(embarkCheck(testList, ts, 'u_sorc', 'u_lr').why).toBeNull();
    expect(embarkCheck(testList, ts, 'u_terms', 'u_lr').why).toBeNull();
    // But Land Raider cannot carry Magnus (Monster) or Defiler (Vehicle/Walker)
    expect(embarkCheck(testList, ts, 'u_magnus', 'u_lr').why).not.toBeNull();
    expect(embarkCheck(testList, ts, 'u_defiler', 'u_lr').why).not.toBeNull();

    // Check all transports across all factions for edge cases
    const dir = 'public/data/factions';
    const broken: string[] = [];
    fs.readdirSync(dir).filter(f => f.endsWith('.json')).forEach(f => {
      const fac = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8')) as FactionData;
      (fac.datasheets || []).forEach(d => {
        if (d.transport) {
          const info = parseTransport(d.transport);
          if (info && !info.infantryOnly && (!info.kinds || !info.kinds.length)) {
            broken.push(`${fac.id} ${d.name}: ${d.transport}`);
          }
        }
      });
    });
    // Let's verify what broken has
    expect(broken).toEqual([]);
  });

  it('Game does not prematurely end when an army is wiped out in round 4, and winner is decided strictly by VP', async () => {
    const { endPhase, endBattle } = await import('./game');
    const s = {
      round: 4,
      phase: 'shooting',
      firstPlayer: 0,
      active: 0,
      players: [
        { id: 0, name: 'Thousand Sons', vp: 21, secVp: 0, detachments: [] },
        { id: 1, name: 'Chaos Knights', vp: 34, secVp: 0, detachments: [] },
      ],
      units: [
        // Player 0 has alive units
        { id: 'u0', owner: 0, status: 'board', buffs: [], abilities: [], keywords: [], factionKeywords: [], weaponsFired: [], models: [{ id: 'm0', dead: false, wounds: 3, profile: { M: 6 } }] },
        // Player 1 has all units destroyed (tabled)
        { id: 'u1', owner: 1, status: 'destroyed', buffs: [], abilities: [], keywords: [], factionKeywords: [], weaponsFired: [], models: [{ id: 'm1', dead: true, wounds: 0 }] },
      ],
      log: [],
      ordersUsed: {},
      objectives: [],
    } as unknown as any;

    // Ending the shooting phase in round 4 should NOT call endBattle / should NOT set phase to gameover
    endPhase(s);
    expect(s.phase).not.toBe('gameover');

    // When the battle actually finishes, endBattle compares VP:
    endBattle(s);
    expect(s.phase).toBe('gameover');
    // Player 1 had 34 VP, Player 0 had 21 VP -> Player 1 (Chaos Knights) wins based on VP, not who survived!
    expect(s.winner).toBe(1);
  });

  it('Clustered units in deployment do not suffer infinite cascading wipe from Soulfire overload', async () => {
    const { applyAilment, initCombatState } = await import('./combatEngine');
    const units = [0, 1, 2, 3, 4, 5].map((i) => ({
      id: `unit-${i}`,
      owner: 0,
      name: `Squad ${i}`,
      status: 'board' as const,
      models: [{
        id: `m-${i}`,
        name: `Marine ${i}`,
        x: 10 + i * 2, // 2" apart - tightly clustered within 4"
        y: 10,
        r: 0.6,
        wounds: 10,
        dead: false,
        profile: { W: 10, T: 4, Sv: 3, InSv: null },
      }],
      combatRole: 'BREACHER' as const,
      combatState: initCombatState('BREACHER'),
    })) as unknown as any[];

    const s = {
      round: 1,
      turn: 1,
      active: 0,
      units,
      log: [],
      fx: [],
      players: [{ id: 0, cp: 1, vp: 0 }, { id: 1, cp: 1, vp: 0 }],
    } as unknown as any;

    // Unit 0 hits 5 stacks of soulfire (triggers Conflagration)
    applyAilment(s, units[0], 'soulfire', 5);

    // Unit 0 takes 3 MW from Conflagration and resets soulfire to 0
    expect(units[0].models[0].wounds).toBe(7);
    expect(units[0].combatState.ailments.soulfire).toBe(0);

    // Units 1..5 MUST NOT gain soulfire stacks or suffer damage from chain reaction
    for (let i = 1; i <= 5; i++) {
      expect(units[i].combatState.ailments.soulfire).toBe(0);
      expect(units[i].models[0].wounds).toBe(10);
      expect(units[i].status).toBe('board');
    }
  });
});
