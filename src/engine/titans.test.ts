import { describe, expect, it } from 'vitest';
import { baseShape, validateList } from './army';
import { listDisposition } from './game';
import { parseAbilityText } from '../rules-engine/abilityText';
import { stratCost, canUseStratagem } from './state';
import { superHeavy } from '../factions/knights';
import { rollHits, rollWounds, rollSavesAndDamage, applyDamage } from './attack';
import type { DatasheetData, GameState, UnitState, ModelState, ArmyList, FactionData } from './types';
import tlFaction from '../../public/data/factions/TL.json';
import smFaction from '../../public/data/factions/SM.json';
import tyrFaction from '../../public/data/factions/TYR.json';
import votannFaction from '../../public/data/factions/LoV.json';
import tauFaction from '../../public/data/factions/TAU.json';
import necronFaction from '../../public/data/factions/NEC.json';
import acFaction from '../../public/data/factions/AC.json';

describe('Unit Sizes & Footprints (HULLS & ROUND)', () => {
  it('Titans have accurate physical footprint dimensions in inches', () => {
    const warlord = tlFaction.datasheets.find((d) => d.name === 'Warlord Titan')!;
    const wShape = baseShape(warlord as unknown as DatasheetData, 0);
    expect(wShape.hull).toBe(true);
    // len = 16, wid = 14 => hw = 7, hl = 1, r = (16+14)/4 = 7.5
    expect(wShape.hw).toBeCloseTo(7.0);
    expect(wShape.hl).toBeCloseTo(1.0);
    expect(wShape.r).toBeCloseTo(7.5);

    const warbringer = tlFaction.datasheets.find((d) => d.name === 'Warbringer Nemesis Titan')!;
    const wbShape = baseShape(warbringer as unknown as DatasheetData, 0);
    expect(wbShape.hull).toBe(true);
    // len = 13.5, wid = 11 => hw = 5.5, hl = 1.25, r = (13.5+11)/4 = 6.125
    expect(wbShape.hw).toBeCloseTo(5.5);
    expect(wbShape.hl).toBeCloseTo(1.25);
    expect(wbShape.r).toBeCloseTo(6.125);

    const reaver = tlFaction.datasheets.find((d) => d.name === 'Reaver Titan')!;
    const rShape = baseShape(reaver as unknown as DatasheetData, 0);
    expect(rShape.hull).toBe(true);
    // len = 12, wid = 10 => hw = 5, hl = 1, r = 5.5
    expect(rShape.hw).toBeCloseTo(5.0);
    expect(rShape.hl).toBeCloseTo(1.0);
    expect(rShape.r).toBeCloseTo(5.5);

    const warhound = tlFaction.datasheets.find((d) => d.name === 'Warhound Titan')!;
    const whShape = baseShape(warhound as unknown as DatasheetData, 0);
    expect(whShape.hull).toBe(true);
    // len = 8.5, wid = 7 => hw = 3.5, hl = 0.75, r = 3.875
    expect(whShape.hw).toBeCloseTo(3.5);
    expect(whShape.hl).toBeCloseTo(0.75);
    expect(whShape.r).toBeCloseTo(3.875);
  });

  it('Super-heavies, bio-titans, and vehicles have accurate dimensions', () => {
    const hierophant = tyrFaction.datasheets.find((d) => d.name === 'Hierophant')!;
    const hShape = baseShape(hierophant as unknown as DatasheetData, 0);
    expect(hShape.hull).toBe(true);
    // len = 14, wid = 11 => hw = 5.5, hl = 1.5, r = 6.25
    expect(hShape.hw).toBeCloseTo(5.5);
    expect(hShape.hl).toBeCloseTo(1.5);

    const thunderhawk = smFaction.datasheets.find((d) => d.name === 'Thunderhawk Gunship')!;
    const thShape = baseShape(thunderhawk as unknown as DatasheetData, 0);
    expect(thShape.hull).toBe(true);
    // len = 19, wid = 17 => hw = 8.5, hl = 1, r = 9
    expect(thShape.hw).toBeCloseTo(8.5);
    expect(thShape.hl).toBeCloseTo(1.0);

    const astraeus = smFaction.datasheets.find((d) => d.name === 'Astraeus')!;
    const astShape = baseShape(astraeus as unknown as DatasheetData, 0);
    expect(astShape.hull).toBe(true);
    // len = 11, wid = 8 => hw = 4, hl = 1.5
    expect(astShape.hw).toBeCloseTo(4.0);
    expect(astShape.hl).toBeCloseTo(1.5);

    const hekaton = (votannFaction.datasheets as any[]).find((d: any) => d.name === 'Hekaton Land Fortress')!;
    const hekShape = baseShape(hekaton as unknown as DatasheetData, 0);
    expect(hekShape.hull).toBe(true);
    // len = 7, wid = 4.5 => hw = 2.25, hl = 1.25
    expect(hekShape.hw).toBeCloseTo(2.25);
    expect(hekShape.hl).toBeCloseTo(1.25);

    const sagitaur = (votannFaction.datasheets as any[]).find((d: any) => d.name === 'Sagitaur')!;
    const sagShape = baseShape(sagitaur as unknown as DatasheetData, 0);
    expect(sagShape.hull).toBe(true);
    // len = 4.8, wid = 3.2 => hw = 1.6, hl = 0.8
    expect(sagShape.hw).toBeCloseTo(1.6);
    expect(sagShape.hl).toBeCloseTo(0.8);
  });

  it('Fortifications and walkers without bases have accurate shapes', () => {
    const shieldline = tauFaction.datasheets.find((d) => d.name === 'Tidewall Shieldline')!;
    const slShape = baseShape(shieldline as unknown as DatasheetData, 0);
    expect(slShape.hull).toBe(true);
    expect(slShape.hw).toBeCloseTo(1.25);
    expect(slShape.hl).toBeCloseTo(2.5);

    const stalker = necronFaction.datasheets.find((d) => d.name === 'Triarch Stalker')!;
    const stkShape = baseShape(stalker as unknown as DatasheetData, 0);
    // 6x6 round/oval => r = 3.0
    expect(stkShape.r).toBeCloseTo(3.0);

    const telemon = acFaction.datasheets.find((d) => d.name === 'Telemon Heavy Dreadnought')!;
    const telShape = baseShape(telemon as unknown as DatasheetData, 0);
    // 100mm base round => r = 2.0 inches
    expect(telShape.r).toBeCloseTo(2.0);
  });
});

describe('Titan Abilities', () => {
  it('Super-heavy Walker allows moving over models and terrain', () => {
    const u: UnitState = {
      id: 'warhound-1',
      name: 'Warhound Titan',
      owner: 0,
      keywords: ['VEHICLE', 'TITANIC', 'WALKER'],
      factionKeywords: ['ADEPTUS TITANICUS'],
      abilities: [{ name: 'Super-heavy Walker', type: 'Faction', text: '...' }],
      models: [],
      sources: ['Warhound Titan'],
    } as unknown as UnitState;

    expect(superHeavy(u)).toBe(true);
  });

  it('Striding Colossus multiplies stratagem CP cost by 2x, 3x, or 4x', () => {
    const s: GameState = {
      round: 1,
      turn: 1,
      phase: 'command',
      active: 0,
      players: [
        { cp: 6, stratagemsUsed: [], name: 'P1' },
        { cp: 6, stratagemsUsed: [], name: 'P2' },
      ],
      units: [],
      terrain: [],
      objectives: [],
      markers: [],
      pendingActions: [],
      destroyedByTurn: [],
      log: [],
    } as unknown as GameState;

    const warhound: UnitState = {
      id: 'wh-1',
      name: 'Warhound Titan',
      owner: 0,
      keywords: ['TITANIC', 'VEHICLE'],
      factionKeywords: ['ADEPTUS TITANICUS'],
      sources: ['Warhound Titan'],
      sheet: { name: 'Warhound Titan', faction: 'TL' } as any,
      abilities: [
        { name: 'Striding Colossus', type: 'Datasheet', text: 'Each time you target this model with a Stratagem, you must spend twice that Stratagem’s stated CP cost to do so.' },
      ],
      models: [],
    } as unknown as UnitState;

    const reaver: UnitState = {
      id: 'rv-1',
      name: 'Reaver Titan',
      owner: 0,
      keywords: ['TITANIC', 'VEHICLE'],
      factionKeywords: ['ADEPTUS TITANICUS'],
      sources: ['Reaver Titan'],
      sheet: { name: 'Reaver Titan', faction: 'TL' } as any,
      abilities: [
        { name: 'Striding Colossus', type: 'Datasheet', text: 'Each time you target this model with a Stratagem, you must spend three times that Stratagem’s stated CP cost to do so.' },
      ],
      models: [],
    } as unknown as UnitState;

    const warlord: UnitState = {
      id: 'wl-1',
      name: 'Warlord Titan',
      owner: 0,
      keywords: ['TITANIC', 'VEHICLE'],
      factionKeywords: ['ADEPTUS TITANICUS'],
      sources: ['Warlord Titan'],
      sheet: { name: 'Warlord Titan', faction: 'TL' } as any,
      abilities: [
        { name: 'Striding Colossus', type: 'Datasheet', text: 'Each time you target this model with a Stratagem, you must spend four times that Stratagem’s stated CP cost to do so.' },
      ],
      models: [],
    } as unknown as UnitState;

    s.units = [warhound, reaver, warlord];

    // Command Re-roll is normally 1 CP:
    expect(stratCost(s, 'command-reroll', warhound)).toBe(2);
    expect(stratCost(s, 'command-reroll', reaver)).toBe(3);
    expect(stratCost(s, 'command-reroll', warlord)).toBe(4);

    // If stratagem stated cost is 2 CP:
    expect(stratCost(s, 'custom-2cp', warhound, 2)).toBe(4);
    expect(stratCost(s, 'custom-2cp', reaver, 2)).toBe(6);
    expect(stratCost(s, 'custom-2cp', warlord, 2)).toBe(8);

    // canUseStratagem checks multiplied CP cost
    s.players[0].cp = 3;
    expect(canUseStratagem(s, 0, 'command-reroll', warhound)).toBe(null); // 2 CP <= 3 CP
    expect(canUseStratagem(s, 0, 'command-reroll', reaver)).toBe(null); // 3 CP <= 3 CP
    expect(canUseStratagem(s, 0, 'command-reroll', warlord)).toBe('Not enough CP'); // 4 CP > 3 CP
  });

  it('Flank Speed: parses to fixed 8" advance', () => {
    const text = 'Each time this model Advances, do not make an Advance roll for it. Instead, until the end of the phase, add 8" to the Move characteristic of this model.';
    const parsed = parseAbilityText('Flank Speed', text);
    expect(parsed?.parsed).toBe(true);
    expect(parsed?.effects).toContainEqual({ advanceFixed: 8 });
  });

  it('God-machine: parses to eligible to shoot and charge after falling back', () => {
    const text = 'This model is eligible to shoot and declare a charge in a turn in which it Fell Back.';
    const parsed = parseAbilityText('God-machine', text);
    expect(parsed?.parsed).toBe(true);
    expect(parsed?.effects?.[0]?.eligible).toContain('shootAfterFallBack');
    expect(parsed?.effects?.[0]?.eligible).toContain('chargeAfterFallBack');
  });

  it('Wrath of the Omnissiah: parses to Battle-shock test after shooting', () => {
    const text = 'In your Shooting phase, after this model has shot, select one enemy unit hit by one or more of those attacks. That unit must take a Battle-shock test.';
    const parsed = parseAbilityText('Wrath of the Omnissiah', text);
    expect(parsed?.parsed).toBe(true);
    expect((parsed?.act as any)?.when).toBe('afterShooting');
    expect((parsed?.act as any)?.do).toContainEqual({ shock: 0 });
  });

  it('Titanic Fire Support: parses to AP improvement on critical wound', () => {
    const text = 'In your Shooting phase, after this model has shot, select one enemy unit hit by one or more of those attacks. Until the end of the phase, each time a friendly Imperium model makes an attack that targets that enemy unit, on a Critical Wound, improve the Armour Penetration characteristic of that attack by 1.';
    const parsed = parseAbilityText('Titanic Fire Support', text);
    expect(parsed?.parsed).toBe(true);
    expect((parsed?.act as any)?.when).toBe('afterShooting');
    expect((parsed?.act as any)?.do).toEqual([
      { incoming: { units: ['kw:IMPERIUM'], critWoundAp: 1 }, until: 'phase' }
    ]);
  });

  it('critWoundAp improves AP by 1 on saves from Critical Wounds', () => {
    const targetUnit: UnitState = {
      id: 'target-1',
      name: 'Enemy Tank',
      owner: 1,
      status: 'alive',
      keywords: ['VEHICLE'],
      factionKeywords: ['CHAOS'],
      sources: ['Enemy Tank'],
      sheet: { name: 'Enemy Tank', faction: 'CSM' } as any,
      abilities: [],
      buffs: [],
      timed: [],
      models: [
        {
          id: 'm1',
          name: 'Enemy Tank',
          wounds: 10,
          dead: false,
          profile: { W: 10, Sv: 3, InSv: null },
          keywords: ['VEHICLE'],
          isCharacter: false,
        } as unknown as ModelState,
      ],
      core: {},
    } as unknown as UnitState;

    const attackerUnit: UnitState = {
      id: 'attacker-1',
      name: 'Allied Tank',
      owner: 0,
      status: 'alive',
      keywords: ['VEHICLE'],
      factionKeywords: ['IMPERIUM'],
      sources: ['Allied Tank'],
      sheet: { name: 'Allied Tank', faction: 'AM' } as any,
      abilities: [],
      buffs: [],
      timed: [],
      models: [
        {
          id: 'a1',
          name: 'Allied Tank',
          wounds: 10,
          dead: false,
          profile: { W: 10, Sv: 3, InSv: null },
          keywords: ['VEHICLE'],
          weapons: [],
          isCharacter: false,
        } as unknown as ModelState,
      ],
      core: {},
    } as unknown as UnitState;

    const s: GameState = {
      round: 1,
      turn: 1,
      phase: 'shooting',
      active: 0,
      units: [attackerUnit, targetUnit],
      players: [{ cp: 2 }, { cp: 2 }],
      rngState: [123456, 789012, 345678, 901234],
    } as unknown as GameState;

    // Simulate an attack pool with base AP -1 and critWoundAp = 1 (Titanic Fire Support)
    s.attack = {
      kind: 'shoot',
      attackerId: attackerUnit.id,
      targetId: targetUnit.id,
      idx: 0,
      stage: 'wound',
      summary: [],
      pools: [
        {
          key: 'gun-1',
          weapon: 'Battle Cannon',
          profile: { name: 'Battle Cannon', range: 72, A: '2', skill: 3, S: 10, AP: -1, D: '3', abilities: [] },
          models: 1,
          instances: [{ A: '2', extras: [], flat: 2 }],
          attacks: 2,
          attackNote: '',
          skill: 3,
          skillNote: '',
          hitMod: 0,
          hitNote: '',
          hitOn6Only: false,
          autoHit: false,
          noHitReroll: false,
          ap: -1,
          critWoundAp: 1, // +1 AP on critical wound => AP becomes -2
          damage: '3',
          hazardous: 0,
          woundNeed: 3,
          woundMod: 0,
          woundNote: '',
          critWoundOn: 6,
          sustained: null,
          lethal: false,
          devastating: false,
          twinLinked: false,
          precision: false,
          hits: [],
          wounds: [],
          autoWounds: 0,
          saves: [],
          saveTargets: [],
          mortalFromDev: [],
          damageLines: [],
          killed: 0,
          done: false,
        },
      ],
    } as any;

    const p = s.attack!.pools[0];
    // Force hits: 2 hits
    p.hits = [{ v: 4, o: 'hit' }, { v: 5, o: 'hit' }];
    // Force wounds: 1 normal wound, 1 critical wound
    p.wounds = [{ v: 4, o: 'wound' }, { v: 6, o: 'critWound' }];

    // Roll saves:
    rollSavesAndDamage(s);

    // Save for crit wound should have crit: true
    expect(p.saves.length).toBe(2);
    expect(p.saves[0].crit).toBe(true); // normalCrits is 1, so index 0 has crit: true
    expect(p.saves[1].crit).toBeUndefined();

    // Now set save dice values:
    // Target Sv is 3+.
    // Normal wound (AP -1): need 3 - (-1) = 4+. If roll is 4 -> 4 + (-1) = 3 >= 3 -> saved!
    // Crit wound (AP -2): with roll 4 -> 4 + (-2) = 2 < 3 -> FAILS!
    p.saves[0].v = 4; // crit wound, AP -2 -> fails
    p.saves[1].v = 4; // normal wound, AP -1 -> saves

    applyDamage(s);

    expect(p.saves[0].o).toBe('fail');
    expect(p.saveTargets[0]).toContain('AP-2');

    expect(p.saves[1].o).toBe('saved');
    expect(p.saveTargets[1]).toContain('AP-1');
  });

  describe('Adeptus Titanicus Muster & Towering Example', () => {
    it('allows Warhound Titan to be Warlord without CHARACTER keyword and no detachments', () => {
      const list: ArmyList = {
        name: 'Titan Army',
        battleSize: 'Strike Force',
        factionId: 'TL',
        detachments: [],
        units: [
          { uid: 'u1', datasheet: 'Warhound Titan', models: 1, pts: 1100, warlord: true },
        ],
      };
      const size = { points: 2000, dp: 2, unitLimit: 3, enhancements: 3 };
      const errs = validateList(list, tlFaction as unknown as FactionData, size);
      expect(errs).toEqual([]);
    });

    it('requires a Warlord even for Adeptus Titanicus', () => {
      const list: ArmyList = {
        name: 'Titan Army',
        battleSize: 'Strike Force',
        factionId: 'TL',
        detachments: [],
        units: [
          { uid: 'u1', datasheet: 'Warhound Titan', models: 1, pts: 1100, warlord: false },
        ],
      };
      const size = { points: 2000, dp: 2, unitLimit: 3, enhancements: 3 };
      const errs = validateList(list, tlFaction as unknown as FactionData, size);
      expect(errs).toContain("No Warlord selected (tap a character's ⋮ → Make Warlord)");
    });

    it('defaults Force Disposition to Take and Hold for Adeptus Titanicus', () => {
      const list: ArmyList = {
        name: 'Titan Army',
        battleSize: 'Strike Force',
        factionId: 'TL',
        detachments: [],
        units: [
          { uid: 'u1', datasheet: 'Warhound Titan', models: 1, pts: 1100, warlord: true },
        ],
      };
      const disp = listDisposition(list, tlFaction as unknown as FactionData);
      expect(disp).toBe('take-and-hold');
    });

    it('Titan units actively draw line of sight across ruins and shoot', async () => {
      const { buildShootPools } = await import('./attack');
      const { hasLos } = await import('./visibility');
      const state: GameState = {
        round: 1,
        turn: 1,
        phase: 'shooting',
        active: 0,
        players: [
          { id: 0, factionId: 'TL', name: 'Titans', cp: 3, detachments: [], armyRules: [] },
          { id: 1, factionId: 'SM', name: 'Marines', cp: 3, detachments: [], armyRules: [] },
        ],
        units: [
          {
            id: 'titan-1',
            owner: 0,
            status: 'board',
            name: 'Warhound Titan',
            sources: ['Warhound Titan'],
            keywords: ['VEHICLE', 'TITANIC', 'TOWERING'],
            factionKeywords: ['ADEPTUS TITANICUS'],
            weaponsFired: [],
            models: [
              {
                id: 'm-titan',
                name: 'Warhound Titan',
                source: 'Warhound Titan',
                keywords: ['VEHICLE', 'TITANIC', 'TOWERING'],
                weapons: [
                  {
                    name: 'Warhound vulcan mega-bolter',
                    profiles: [{ name: 'Warhound vulcan mega-bolter', range: 36, A: '20', skill: 3, S: 6, AP: -1, D: '2', abilities: ['sustained hits 1'] }],
                  },
                ],
                profile: { M: 14, T: 10, Sv: 3, W: 40, Ld: 6, OC: 8 },
                wounds: 40,
                dead: false,
                x: 10,
                y: 10,
                r: 3.875,
              },
            ],
            abilities: [],
            enhancements: [],
            core: {},
            buffs: [],
          },
          {
            id: 'target-1',
            owner: 1,
            status: 'board',
            name: 'Intercessors',
            sources: ['Intercessors'],
            keywords: ['INFANTRY'],
            factionKeywords: ['ADEPTUS ASTARTES'],
            models: [
              {
                id: 'm-target',
                name: 'Intercessor',
                source: 'Intercessors',
                keywords: ['INFANTRY'],
                weapons: [],
                profile: { M: 6, T: 4, Sv: 3, W: 2, Ld: 6, OC: 2 },
                wounds: 2,
                dead: false,
                x: 10,
                y: 35,
                r: 0.63,
              },
            ],
            abilities: [],
            enhancements: [],
            core: {},
            buffs: [],
          },
        ],
        terrain: [
          {
            id: 'ruin-1',
            category: 'dense',
            poly: [{ x: 5, y: 20 }, { x: 25, y: 20 }, { x: 25, y: 25 }, { x: 5, y: 25 }],
            walls: [],
          },
        ],
        objectives: [],
        markers: [],
        destroyedByTurn: [],
        log: [],
      } as unknown as GameState;

      const mTitan = state.units[0].models[0];
      const mTarget = state.units[1].models[0];
      // Absolute Footprint Obscuring: Ruin footprint between (y: 20-25) blocks LoS even for Towering/Titanic units
      expect(hasLos(state, mTitan, mTarget)).toBe(false);

      // Once the titan steps into the footprint, line of sight is established
      mTitan.y = 22;
      expect(hasLos(state, mTitan, mTarget)).toBe(true);
      const r = buildShootPools(state, 'titan-1', 'target-1', { mode: 'normal' });
      expect(r.error).toBeUndefined();
      expect(r.pools.length).toBeGreaterThan(0);
    });
  });
});

