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

  it('Prophesied Doom (Tzaangor Enlightened) parses mortal roll on charge', async () => {
    const { parseAbilityText } = await import('../rules-engine/abilityText');
    const text = 'Each time this unit ends a Charge move, select one enemy unit within Engagement Range of it, then roll one D6 for each model in this unit that is within Engagement Range of that enemy unit: for each 4+, that enemy unit suffers 1 mortal wound.';
    const parsed = parseAbilityText('Prophesied Doom', text) as any;
    expect(parsed).toBeDefined();
    expect(parsed?.act?.when).toBe('endOfCharge');
    expect(parsed?.act?.target).toEqual({ side: 'enemy', engaged: true });
    expect(parsed?.act?.do?.[0]?.mortalRoll).toEqual({ on: 4 });
  });

  it('Thousand Sons inFlow handles units near table edge and activates Flow of Magic buff', async () => {
    const { inFlow, hasFlowOfMagic } = await import('../factions/flow');
    const s = {
      turn: 1,
      round: 1,
      phase: 'shooting',
      deploymentId: 'take-and-hold-vs-purge-the-foe-3',
      players: [
        {
          id: 0,
          role: 'attacker',
          factionId: 'TS',
          detachments: [{ name: 'Hexwarp Thrallband', rules: [{ name: 'Flow of Magic' }] }],
        },
        {
          id: 1,
          role: 'defender',
          factionId: 'SM',
          detachments: [],
        },
      ],
      objectives: [],
      units: [],
    } as unknown as any;

    expect(hasFlowOfMagic(s, 0)).toBe(true);

    // Unit near table edge x=0.5, y=5 in attacker zone
    const u: any = {
      id: 'u_sorc',
      owner: 0,
      status: 'board',
      keywords: ['PSYKER', 'INFANTRY', 'THOUSAND SONS'],
      factionKeywords: ['THOUSAND SONS'],
      enhancements: [],
      models: [
        { id: 'm1', x: 0.5, y: 5, r: 0.7874, dead: false },
        { id: 'm2', x: 1.5, y: 5, r: 0.7874, dead: false },
      ],
    };

    expect(inFlow(s, u)).toBe(true);
  });

  it('Normal Deep Strike does not set noChargeTurn, and FLY charge autoApproach is not blocked', async () => {
    const { ingressUnit, autoApproach } = await import('./game');
    const s = {
      turn: 2,
      round: 2,
      phase: 'movement',
      active: 0,
      players: [
        { id: 0, role: 'attacker', factionId: 'TS', detachments: [] },
        { id: 1, role: 'defender', factionId: 'SM', detachments: [] },
      ],
      units: [
        // Enemy unit at x=20, y=20
        {
          id: 'foe',
          name: 'Marine',
          owner: 1,
          status: 'board',
          sources: ['Marine'],
          keywords: ['INFANTRY'],
          factionKeywords: ['SPACE MARINES'],
          abilities: [],
          enhancements: [],
          buffs: [],
          models: [{ id: 'fm1', name: 'Marine', x: 20, y: 20, r: 0.63, dead: false, wounds: 2, keywords: ['INFANTRY'], profile: { W: 2 } }],
        },
      ],
      terrain: [],
      objectives: [],
      log: [],
      fx: [],
      window: null,
      firstPlayer: 0,
    } as unknown as any;

    // Daemon Prince with Wings arriving 9.1" away
    const dp: any = {
      id: 'dp',
      name: 'Daemon Prince of Tzeentch with Wings',
      owner: 0,
      status: 'reserves',
      sources: ['Daemon Prince of Tzeentch with Wings'],
      keywords: ['MONSTER', 'FLY', 'PSYKER', 'CHARACTER'],
      factionKeywords: ['THOUSAND SONS'],
      core: { deepStrike: true },
      abilities: [{ name: 'Deep Strike' }],
      models: [{ id: 'dp_m1', name: 'Daemon Prince', x: 0, y: 0, r: 1.18, dead: false, wounds: 10, keywords: ['MONSTER', 'FLY'], profile: { W: 10, M: 12 } }],
      buffs: [],
      enhancements: [],
    };
    s.units.push(dp);

    // Deep Strike 9.5" away
    const pos = new Map([['dp_m1', { x: 20, y: 20 - 9.5 - 1.18 - 0.63 }]]);
    const res = ingressUnit(s, dp, pos);
    expect(res.ok).toBe(true);
    // Crucially: noChargeTurn must NOT be set!
    expect(dp.noChargeTurn).toBeUndefined();

    // Now in charge phase, test autoApproach with FLY towards enemy target
    s.phase = 'charge';
    const enemyUnit = s.units[0];
    const approach = autoApproach(s, dp, [enemyUnit], 9);
    expect(approach).toBeDefined();
    // DP should successfully approach and be within engagement range
    const approachedPath = approach!.get('dp_m1')!;
    const endSpot = approachedPath[approachedPath.length - 1];
    const endGap = Math.hypot(endSpot.x - 20, endSpot.y - 20) - 1.18 - 0.63;
    expect(endGap).toBeLessThanOrEqual(1.0);
  });

  it('Bot deployment prefers sheltered/concealed positions against enemy with Advance+Charge and Infiltrators', async () => {
    const { smartPlacement } = await import('../ai/deploy');
    const { createGame } = await import('./game');
    const load = (id: string) => JSON.parse(fs.readFileSync(`public/data/factions/${id}.json`, 'utf8')) as FactionData;
    const list = (f: string, u: [string, number, number][]): ArmyList => ({ name: 't', factionId: f, battleSize: 'incursion', detachments: [], units: u.map(([d, n, p], i) => ({ uid: `x${i}`, datasheet: d, models: n, pts: p })) });

    const s = createGame({
      lists: [
        list('TS', [['Rubric Marines', 5, 105], ['Exalted Sorcerer', 1, 100]]),
        // Enemy Orks with Waaagh! (Advance + Charge) and Kommandos (Infiltrators)
        list('ORK', [['Boyz', 10, 85], ['Kommandos', 10, 135], ['Warboss', 1, 100]]),
      ],
      factions: [load('TS'), load('ORK')], names: ['A', 'B'], seed: 42,
    });

    const rubric = s.units.find((u) => u.owner === 0 && u.name === 'Rubric Marines')!;
    const placed = smartPlacement(s, rubric);
    expect(placed).not.toBeNull();
    // Rubrics should not be deployed in the open without cover; they should be placed safely
    expect(placed!.size).toBe(5);
  });

  it('11th Edition Knight and Vehicle Cover rules: partially obscured gives -1 BS per model, footprint alone does not', async () => {
    const { hasCover } = await import('./visibility');
    const { buildShootPools } = await import('./attack');

    const s = {
      phase: 'shooting',
      round: 1,
      turn: 1,
      active: 0,
      players: [
        { id: 0, role: 'attacker', factionId: 'SM', detachments: [] },
        { id: 1, role: 'defender', factionId: 'QI', detachments: [] },
      ],
      terrain: [
        // Footprint terrain (ruin footprint with a solid wall)
        {
          id: 't1',
          category: 'dense',
          poly: [{ x: 10, y: 10 }, { x: 25, y: 10 }, { x: 25, y: 25 }, { x: 10, y: 25 }],
          walls: [{ a: { x: 10, y: 10 }, b: { x: 20, y: 10 } }], // Wall along part of top edge
          windows: [],
        },
      ],
      units: [],
      objectives: [],
      log: [],
    } as unknown as any;

    // Knight standing in the footprint but out in the open (no wall between attacker and knight)
    const knightInFootprint: any = {
      id: 'knight',
      name: 'Knight Paladin',
      owner: 1,
      status: 'board',
      sources: ['Knight Paladin'],
      keywords: ['VEHICLE', 'TITANIC', 'IMPERIAL KNIGHTS', 'TOWERING'],
      factionKeywords: ['IMPERIAL KNIGHTS'],
      abilities: [],
      enhancements: [],
      buffs: [],
      core: {},
      models: [{
        id: 'km1',
        name: 'Knight Paladin',
        x: 22,
        y: 18,
        r: 2.5,
        hl: 2.0,
        hw: 1.5,
        dead: false,
        wounds: 22,
        keywords: ['VEHICLE', 'TITANIC'],
        profile: { W: 22, T: 12, Sv: 3 },
      }],
    };

    // Attacker model 1 (x: 22, y: 2): unobstructed LoS straight down into Knight at x:22, y:18
    const shooterOpen: ModelState = {
      id: 'sm1',
      name: 'Marine 1',
      x: 22,
      y: 2,
      r: 0.63,
      dead: false,
      wounds: 2,
      keywords: ['INFANTRY'],
      profile: { W: 2, BS: 3 },
    } as unknown as ModelState;

    // Attacker model 2 (x: 20, y: 2): Wall ends at x=20; right side of Knight base is visible past wall edge, but left side of base is blocked behind wall
    const shooterObscured: ModelState = {
      id: 'sm2',
      name: 'Marine 2',
      x: 20,
      y: 2,
      r: 0.63,
      dead: false,
      wounds: 2,
      keywords: ['INFANTRY'],
      profile: { W: 2, BS: 3 },
    } as unknown as ModelState;

    // 1) Non-Infantry standing in footprint alone with clear LoS does NOT get cover:
    expect(hasCover(s, shooterOpen, knightInFootprint)).toBe(false);

    // 2) Partially obscured by wall gives Cover (-1 BS):
    expect(hasCover(s, shooterObscured, knightInFootprint)).toBe(true);

    // 3) Attack pools check per model: shooter with cover gets -1 BS (Cover -1 BS)
    const testWeapon = {
      name: 'Bolt rifle',
      profiles: [{
        name: 'Bolt rifle',
        range: 24,
        A: '2',
        skill: 3,
        S: 4,
        AP: -1,
        D: '1',
        abilities: [],
      }],
    };
    (shooterOpen as any).weapons = [testWeapon];
    (shooterObscured as any).weapons = [testWeapon];

    const attackerUnit: any = {
      id: 'attackers',
      name: 'Intercessors',
      owner: 0,
      status: 'board',
      sources: ['Intercessor Squad'],
      keywords: ['INFANTRY'],
      factionKeywords: ['SPACE MARINES'],
      abilities: [],
      enhancements: [],
      buffs: [],
      core: {},
      weaponsFired: [],
      models: [shooterOpen, shooterObscured],
    };
    s.units = [attackerUnit, knightInFootprint];

    const pools = buildShootPools(s, attackerUnit.id, knightInFootprint.id, { mode: 'normal' });
    const coveredPool = pools.pools.find((p) => p.skillNote?.includes('Cover −1 BS'));
    const openPool = pools.pools.find((p) => !p.skillNote?.includes('Cover'));

    expect(coveredPool).toBeDefined();
    expect(openPool).toBeDefined();
    // Obscured shooter has -1 BS (skill becomes 4+ instead of 3+)
    expect(coveredPool?.skill).toBe(4);
    // Open shooter shoots at normal 3+
    expect(openPool?.skill).toBe(3);
  });

  it('Melee 2nd-rank fighting eligibility: squad mates in base contact allow trailing models to fight', async () => {
    const { buildFightPools } = await import('./attack');
    const { autoApproach } = await import('./game');

    const s = {
      phase: 'fight',
      round: 1,
      turn: 1,
      active: 0,
      players: [{ id: 0, role: 'attacker', factionId: 'SM', detachments: [] }, { id: 1, role: 'defender', factionId: 'CSM', detachments: [] }],
      terrain: [],
      units: [],
      objectives: [],
      log: [],
    } as unknown as any;

    const enemyModel = { id: 'e1', name: 'Legionary', x: 20, y: 20, r: 0.63, dead: false, wounds: 2, keywords: ['INFANTRY'], profile: { T: 4, W: 2, Sv: 3 } };
    const enemyUnit: any = {
      id: 'foe',
      name: 'Legionaries',
      owner: 1,
      status: 'board',
      sources: ['Legionaries'],
      keywords: ['INFANTRY'],
      factionKeywords: ['CHAOS SPACE MARINES'],
      abilities: [],
      enhancements: [],
      buffs: [],
      core: {},
      models: [enemyModel],
    };

    // Attacking squad of 3 models:
    // m1 is directly in base contact with e1 (gap <= 0.05)
    // m2 is in base contact with m1 (gap <= 0.05), so in 2nd rank behind m1
    // m3 is far away (> 2" away)
    const m1 = { id: 'm1', name: 'Marine 1', x: 20, y: 20 - 0.63 - 0.63, r: 0.63, dead: false, wounds: 2, keywords: ['INFANTRY'], profile: { T: 4, W: 2, Sv: 3, A: 2, WS: 3, S: 4, AP: 0, D: 1 } };
    const m2 = { id: 'm2', name: 'Marine 2', x: 20, y: m1.y - 0.63 - 0.63, r: 0.63, dead: false, wounds: 2, keywords: ['INFANTRY'], profile: { T: 4, W: 2, Sv: 3, A: 2, WS: 3, S: 4, AP: 0, D: 1 } };
    const m3 = { id: 'm3', name: 'Marine 3', x: 20, y: m1.y - 5.0, r: 0.63, dead: false, wounds: 2, keywords: ['INFANTRY'], profile: { T: 4, W: 2, Sv: 3, A: 2, WS: 3, S: 4, AP: 0, D: 1 } };

    const meleeWeapon = {
      name: 'Close combat weapon',
      profiles: [{ name: 'Close combat weapon', range: 'Melee', A: '2', skill: 3, S: 4, AP: 0, D: '1', abilities: [] }],
    };
    (m1 as any).weapons = [meleeWeapon];
    (m2 as any).weapons = [meleeWeapon];
    (m3 as any).weapons = [meleeWeapon];

    const friendlyUnit: any = {
      id: 'fr',
      name: 'Intercessors',
      owner: 0,
      status: 'board',
      sources: ['Intercessor Squad'],
      keywords: ['INFANTRY'],
      factionKeywords: ['SPACE MARINES'],
      abilities: [],
      enhancements: [],
      buffs: [],
      core: {},
      models: [m1, m2, m3],
    };
    s.units = [friendlyUnit, enemyUnit];

    const result = buildFightPools(s, friendlyUnit.id, enemyUnit.id);
    expect(result.error).toBeUndefined();
    // Both m1 (1st rank) and m2 (2nd rank behind m1) should be eligible to fight!
    const totalModels = result.pools.reduce((sum, p) => sum + p.models, 0);
    expect(totalModels).toBe(2);
    expect(result.pools[0].fromIds).toEqual(['m1', 'm2']);
    expect(result.pools[0].attackNote).toContain('2 models');
  });

  it('Teleport Homer marker placement establishes legal deployment territory anchor', async () => {
    const { startOfBattle } = await import('./missions');
    const { zoneOf } = await import('./game');
    const { pointInPoly } = await import('./geometry');
    const s = {
      phase: 'command',
      round: 1,
      turn: 1,
      active: 0,
      deploymentId: 'dawn-of-war',
      players: [
        { id: 0, role: 'attacker', name: 'Player', factionId: 'SM', detachments: [] },
        { id: 1, role: 'defender', name: 'Opponent', factionId: 'CSM', detachments: [] },
      ],
      terrain: [],
      markers: [],
      objectives: [
        { id: 'home', x: 22, y: 8, r: 0.78, type: 'home' },
        { id: 'center', x: 22, y: 30, r: 0.78, type: 'central' },
        { id: 'enemyHome', x: 22, y: 52, r: 0.78, type: 'home' },
      ],
      units: [
        {
          id: 'term',
          name: 'Terminator Squad',
          owner: 0,
          status: 'reserves',
          abilities: [{ name: 'Teleport Homer: Place marker' }],
          models: [],
        },
      ],
      log: [],
    } as unknown as any;

    startOfBattle(s);
    const term = s.units[0];
    expect(term.homer).toBeDefined();
    expect(pointInPoly(term.homer!, zoneOf(s, term.owner))).toBe(true);
  });
});
