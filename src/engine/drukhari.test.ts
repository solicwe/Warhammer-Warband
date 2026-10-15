import { describe, it, expect } from 'vitest';
import {
  isDrukhariArmy,
  hasDrukhariFaction,
  isUnitEmpowered,
  gainPainToken,
  spendPainToken,
  empowerUnit,
  drukhariBattleStart,
  drukhariCommandStart,
  drukhariPhaseEnd,
  drukhariUnitDestroyed,
  drukhariBattleShockFailed,
  drukhariAttackModifiers,
  drukhariDefenseModifiers,
} from './drukhari';
import { canDo } from './effects';
import type { GameState, UnitState, ModelState } from './types';

function createDummyUnit(
  id: string,
  owner: 0 | 1,
  name: string,
  keywords: string[],
  x = 0,
  y = 0,
  wounds = 3,
  maxWounds = 3,
  toughness = 3
): UnitState {
  const model: ModelState = {
    id: `${id}-m1`,
    name,
    source: name,
    isCharacter: keywords.includes('CHARACTER'),
    isBodyguard: false,
    keywords,
    weapons: [],
    x,
    y,
    r: 1,
    wounds,
    dead: false,
    profile: { M: 8, T: toughness, Sv: 4, W: maxWounds, Ld: 6, OC: 1, base: '28mm' } as any,
  };

  return {
    id,
    owner,
    name,
    sources: [name],
    keywords,
    factionKeywords: ['DRUKHARI'],
    models: [model],
    startingStrength: 1,
    abilities: [],
    core: {},
    pts: 80,
    status: 'board',
    embarkedIn: null,
    weaponsFired: [],
    cantCharge: false,
    transport: null,
    wargear: [],
  } as unknown as UnitState;
}

function createDummyGame(): GameState {
  return {
    round: 1,
    turn: 0,
    active: 0,
    firstPlayer: 0,
    phase: 'shooting',
    battleSize: 'incursion',
    rng: 12345,
    players: [
      {
        id: 0,
        name: 'Drukhari Player',
        factionId: 'DRU',
        factionName: 'Drukhari',
        painTokens: 2,
        empoweredUnits: [],
        cp: 2,
        detachments: [{ name: 'Skysplinter Assault' }],
      } as any,
      {
        id: 1,
        name: 'Space Marines Player',
        factionId: 'SM',
        factionName: 'Space Marines',
        cp: 2,
        detachments: [],
      } as any,
    ],
    units: [],
    objectives: [],
    log: [],
  } as unknown as GameState;
}

describe('Drukhari Engine Rules (Faction Pack v1.2 & Power from Pain)', () => {
  it('identifies Drukhari army and faction correctly', () => {
    const s = createDummyGame();
    expect(isDrukhariArmy(s, 0)).toBe(true);
    expect(isDrukhariArmy(s, 1)).toBe(false);

    const archon = createDummyUnit('u1', 0, 'Archon', ['CHARACTER', 'INFANTRY']);
    expect(hasDrukhariFaction(archon)).toBe(true);
  });

  it('manages Pain token economy: gain, spend, and empower', () => {
    const s = createDummyGame();
    s.players[0].painTokens = 2;

    const kabalites = createDummyUnit('u1', 0, 'Kabalite Warriors', ['BATTLELINE', 'INFANTRY']);
    s.units = [kabalites];

    expect(isUnitEmpowered(s, kabalites)).toBe(false);

    // Empower unit
    const ok = empowerUnit(s, kabalites);
    expect(ok).toBe(true);
    expect(s.players[0].painTokens).toBe(1);
    expect(isUnitEmpowered(s, kabalites)).toBe(true);

    // Phase end clears empowered status
    drukhariPhaseEnd(s);
    expect(isUnitEmpowered(s, kabalites)).toBe(false);
  });

  it('Cronos Pain Engine refunds Pain token on 4+ (3+ for vehicle/monster)', () => {
    const s = createDummyGame();
    s.players[0].painTokens = 2;

    const cronos = createDummyUnit('cronos', 0, 'Cronos', ['MONSTER'], 0, 0);
    const raider = createDummyUnit('raider', 0, 'Raider', ['VEHICLE'], 4, 0);
    s.units = [cronos, raider];

    // Seeded spend should trigger refund attempt
    const success = spendPainToken(s, 0, 1, 'Empowering Raider', raider);
    expect(success).toBe(true);
  });

  it('gains Pain tokens from Command phase, destroyed enemy units, and failed Battle-shock', () => {
    const s = createDummyGame();
    s.players[0].painTokens = 1;

    // 1. Command phase
    drukhariCommandStart(s, 0);
    expect(s.players[0].painTokens).toBe(2);

    // 2. Enemy unit destroyed
    const enemy = createDummyUnit('e1', 1, 'Intercessors', ['INFANTRY']);
    drukhariUnitDestroyed(s, enemy);
    expect(s.players[0].painTokens).toBe(3);

    // 3. Enemy fails Battle-shock
    drukhariBattleShockFailed(s, enemy);
    expect(s.players[0].painTokens).toBe(4);
  });

  it('applies Empowered attack modifiers (Archon, Drazhar, Incubi, Lelith)', () => {
    const s = createDummyGame();
    s.players[0].painTokens = 10;
    const archon = createDummyUnit('u1', 0, 'Archon', ['CHARACTER', 'INFANTRY']);
    const enemy = createDummyUnit('e1', 1, 'Intercessors', ['INFANTRY']);
    s.units = [archon, enemy];

    // Not empowered: no special re-roll
    const atkNormal = drukhariAttackModifiers(s, archon, enemy, 10, 'ranged');
    expect(atkNormal.rerollHits).toBe(false);

    // Empower Archon
    empowerUnit(s, archon);
    const atkEmp = drukhariAttackModifiers(s, archon, enemy, 10, 'ranged');
    expect(atkEmp.rerollHits).toBe(true);
    expect(atkEmp.notes).toContain('Hatred Eternal (Pain): re-roll Hits');

    // Drazhar: +1 to Wound in Fight
    const drazhar = createDummyUnit('drazhar', 0, 'Drazhar', ['CHARACTER', 'INFANTRY']);
    empowerUnit(s, drazhar);
    const atkDrazhar = drukhariAttackModifiers(s, drazhar, enemy, 0, 'melee');
    expect(atkDrazhar.woundMod).toBe(1);

    // Lelith: Sustained Hits 2 in Fight
    const lelith = createDummyUnit('lelith', 0, 'Lelith Hesperax', ['CHARACTER', 'INFANTRY']);
    empowerUnit(s, lelith);
    const atkLelith = drukhariAttackModifiers(s, lelith, enemy, 0, 'melee');
    expect(atkLelith.sustained).toBe('2');
  });

  it('supports Reaper’s Wager detachment mechanics', () => {
    const s = createDummyGame();
    s.players[0].detachments = [{ name: 'Reaper’s Wager' } as any];
    s.players[0].drukhariWagerWinning = 'Drukhari';

    const kabalites = createDummyUnit('k1', 0, 'Kabalite Warriors', ['DRUKHARI', 'INFANTRY']);
    const enemy = createDummyUnit('e1', 1, 'Intercessors', ['INFANTRY']);
    s.units = [kabalites, enemy];

    // Drukhari winning -> re-roll Hit 1s
    const atkWinning = drukhariAttackModifiers(s, kabalites, enemy, 12, 'ranged');
    expect(atkWinning.rerollHits1).toBe(true);
    expect(atkWinning.rerollWounds1).toBe(false);

    // Now Harlequins winning (Drukhari losing) -> re-roll Hit 1s AND Wound 1s
    s.players[0].drukhariWagerWinning = 'Harlequins';
    const atkLosing = drukhariAttackModifiers(s, kabalites, enemy, 12, 'ranged');
    expect(atkLosing.rerollHits1).toBe(true);
    expect(atkLosing.rerollWounds1).toBe(true);
  });

  it('allows Wyches to charge after advance when Empowered (Acrobatic Gladiators)', () => {
    const s = createDummyGame();
    const wyches = createDummyUnit('w1', 0, 'Wyches', ['WYCH CULT', 'INFANTRY']);
    wyches.abilities = [{ name: 'Acrobatic Gladiators (Pain)', type: 'Datasheet', text: '' } as any];
    s.units = [wyches];

    // Not empowered: cannot charge after advance
    expect(canDo(s, wyches, 'chargeAfterAdvance')).toBe(false);

    // Empowered: can charge after advance!
    empowerUnit(s, wyches);
    expect(canDo(s, wyches, 'chargeAfterAdvance')).toBe(true);
  });

  it('Tools of Torment detachment reduces wound rolls vs Cronos/Talos when S > T', () => {
    const s = createDummyGame();
    s.players[0].detachments = [{ name: 'Tools of Torment' } as any];

    const talos = createDummyUnit('talos', 0, 'Talos', ['CRONOS', 'TALOS', 'MONSTER'], 0, 0, 7, 7, 7);
    const enemy = createDummyUnit('e1', 1, 'Dreadnought', ['VEHICLE']);
    s.units = [talos, enemy];

    // Enemy attacks with S10 vs Talos T7 (S > T) -> -1 to Wound
    const def = drukhariDefenseModifiers(s, enemy, talos, 'ranged', { S: 10 } as any);
    expect(def.woundMod).toBe(-1);
    expect(def.notes).toContain('Darkest Artifice: −1 to Wound');

    // Enemy attacks with S4 vs Talos T7 (S <= T) -> no wound reduction
    const def2 = drukhariDefenseModifiers(s, enemy, talos, 'ranged', { S: 4 } as any);
    expect(def2.woundMod).toBe(0);
  });
});
