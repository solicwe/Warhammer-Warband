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
  drukhariAttackMods,
  pickContract,
} from './drukhari';
import type { GameState, UnitState, ModelState } from '../engine/types';

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
        armyRules: [{ name: 'Power from Pain', text: '' }],
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

  it('Pain Engine: a Cronos within 9\" rolls to refund a token spent on Empowering', () => {
    const s = createDummyGame();
    s.players[0].painTokens = 1;
    const cronos = createDummyUnit('cronos', 0, 'Cronos', ['MONSTER'], 0, 0);
    cronos.abilities = [{ name: 'Pain Engine (Aura)', type: 'Datasheet', text: '' } as any];
    const raider = createDummyUnit('raider', 0, 'Raider', ['VEHICLE'], 4, 0);
    s.units = [cronos, raider];
    expect(empowerUnit(s, raider)).toBe(true);
    expect([0, 1]).toContain(s.players[0].painTokens);
    expect(spendPainToken(s, 0, 5)).toBe(false);
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

  it('supports Reaper’s Wager detachment mechanics', () => {
    const s = createDummyGame();
    s.players[0].detachments = [{ name: 'Reaper’s Wager' } as any];
    s.players[0].drukhariWagerWinning = 'Drukhari';

    const kabalites = createDummyUnit('k1', 0, 'Kabalite Warriors', ['DRUKHARI', 'INFANTRY']);
    const enemy = createDummyUnit('e1', 1, 'Intercessors', ['INFANTRY']);
    s.units = [kabalites, enemy];

    // Drukhari winning -> re-roll Hit 1s
    const atkWinning = drukhariAttackMods(s, kabalites, enemy)!;
    expect(atkWinning.rerollHits1).toBe(true);
    expect(atkWinning.rerollWounds1).toBeFalsy();

    // Now Harlequins winning (Drukhari losing) -> re-roll Hit 1s AND Wound 1s
    s.players[0].drukhariWagerWinning = 'Harlequins';
    const atkLosing = drukhariAttackMods(s, kabalites, enemy)!;
    expect(atkLosing.rerollHits1).toBe(true);
    expect(atkLosing.rerollWounds1).toBe(true);
  });

  it('Murderous Agenda: the Contract unit, its ability and 3 Pain tokens once it is destroyed', () => {
    const s = createDummyGame();
    s.players[0].detachments = [{ name: 'Kabalite Cartel' } as any];
    const kab = createDummyUnit('k1', 0, 'Kabalite Warriors', ['KABAL', 'INFANTRY']);
    const lord = createDummyUnit('c1', 1, 'Captain', ['CHARACTER', 'INFANTRY']);
    s.units = [kab, lord];
    pickContract(s, 0);
    expect(s.players[0].contract).toEqual({ kind: 'trophy', unitId: 'c1' });
    expect(drukhariAttackMods(s, kab, lord)!.precision).toBe(true);
    lord.status = 'destroyed';
    lord.models[0].dead = true;
    s.players[0].painTokens = 0;
    drukhariCommandStart(s, 0);
    expect(s.players[0].painTokens).toBe(4);
    expect(s.players[0].contract?.done).toBe(true);
  });
});
