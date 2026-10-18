import { describe, it, expect } from 'vitest';
import {
  isAdmechArmy,
  hasAdmechFaction,
  isAdmechBattleline,
  nearAdmechBattleline,
  unitActiveImperatives,
  setAdmechImperative,
  admechRoundStart,
  admechCommandStart,
  admechAttackModifiers,
  admechDefenseModifiers,
} from './admech';
import type { GameState, UnitState, ModelState } from '../engine/types';

function createDummyUnit(
  id: string,
  owner: 0 | 1,
  name: string,
  keywords: string[],
  x: number = 0,
  y: number = 0,
  wounds: number = 4,
  maxWounds: number = 4
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
    profile: { M: 6, T: 4, Sv: 3, W: maxWounds, Ld: 7, OC: 1, base: '32mm' } as any,
  };

  return {
    id,
    owner,
    name,
    sources: [name],
    keywords,
    factionKeywords: ['ADEPTUS MECHANICUS'],
    models: [model],
    startingStrength: 1,
    abilities: [],
    core: {},
    pts: 100,
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
    phase: 'command',
    rng: 12345,
    players: [
      {
        id: 0,
        name: 'Player 1',
        factionId: 'AdM',
        factionName: 'Adeptus Mechanicus',
        admechImperative: 'Protector Imperative',
        cp: 2,
        detachments: [{ name: 'Eradication Cohort' }],
      } as any,
      {
        id: 1,
        name: 'Player 2',
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

describe('Adeptus Mechanicus Engine Rules (11th Edition Faction Pack 1.4)', () => {
  it('detects AdMech army and battleline status correctly', () => {
    const s = createDummyGame();
    expect(isAdmechArmy(s, 0)).toBe(true);
    expect(isAdmechArmy(s, 1)).toBe(false);

    const rangers = createDummyUnit('u1', 0, 'Skitarii Rangers', ['SKITARII', 'BATTLELINE', 'INFANTRY'], 0, 0);
    const ruststalkers = createDummyUnit('u2', 0, 'Sicarian Ruststalkers', ['SKITARII', 'INFANTRY'], 4, 0);
    const farUnit = createDummyUnit('u3', 0, 'Sicarian Ruststalkers', ['SKITARII', 'INFANTRY'], 20, 0);

    s.units = [rangers, ruststalkers, farUnit];

    expect(isAdmechBattleline(rangers)).toBe(true);
    expect(isAdmechBattleline(ruststalkers)).toBe(false);

    // ruststalkers is within 4" of rangers (Battleline) -> nearAdmechBattleline is true
    expect(nearAdmechBattleline(s, ruststalkers)).toBe(true);
    // farUnit is 20" away -> nearAdmechBattleline is false
    expect(nearAdmechBattleline(s, farUnit)).toBe(false);
  });

  it('Belisarius Cawl acts as Battleline and grants aura', () => {
    const s = createDummyGame();
    const cawl = createDummyUnit('cawl', 0, 'Belisarius Cawl', ['CHARACTER', 'MONSTER', 'MOBILE'], 10, 10);
    s.units = [cawl];

    expect(isAdmechBattleline(cawl)).toBe(true);
  });

  it('Protector Imperative grants +1 BS, [HEAVY], and melee defence -1 to hit if near Battleline', () => {
    const s = createDummyGame();
    s.players[0].admechImperative = 'Protector Imperative';

    const rangers = createDummyUnit('u1', 0, 'Skitarii Rangers', ['SKITARII', 'BATTLELINE'], 0, 0);
    const enemy = createDummyUnit('e1', 1, 'Intercessors', ['INFANTRY'], 12, 0);
    s.units = [rangers, enemy];

    // Ranged attack under Protector
    const atk = admechAttackModifiers(s, rangers, enemy, 12, 'ranged');
    expect(atk.bsBonus).toBe(1);
    expect(atk.heavy).toBe(true);
    expect(atk.notes).toContain('Protector: +1 BS');

    // Melee defence under Protector (unit is Battleline)
    const def = admechDefenseModifiers(s, enemy, rangers, 'melee');
    expect(def.hitMod).toBe(-1);
    expect(def.notes).toContain('Protector (Battleline): −1 to be hit');
  });

  it('Conqueror Imperative grants +1 WS, [ASSAULT], and +1 AP if near Battleline', () => {
    const s = createDummyGame();
    s.players[0].admechImperative = 'Conqueror Imperative';

    const rangers = createDummyUnit('u1', 0, 'Skitarii Rangers', ['SKITARII', 'BATTLELINE'], 0, 0);
    const enemy = createDummyUnit('e1', 1, 'Intercessors', ['INFANTRY'], 5, 0);
    s.units = [rangers, enemy];

    // Ranged attack under Conqueror
    const rangedAtk = admechAttackModifiers(s, rangers, enemy, 5, 'ranged');
    expect(rangedAtk.assault).toBe(true);
    expect(rangedAtk.apBonus).toBe(1);

    // Melee attack under Conqueror
    const meleeAtk = admechAttackModifiers(s, rangers, enemy, 1, 'melee');
    expect(meleeAtk.wsBonus).toBe(1);
    expect(meleeAtk.apBonus).toBe(1);
  });

  it('handles Cawl Invocation of Machine Vengeance and Self-repair', () => {
    const s = createDummyGame();
    const cawl = createDummyUnit('cawl', 0, 'Belisarius Cawl', ['CHARACTER', 'MONSTER', 'MOBILE'], 5, 5, 6, 10);
    const enemy = createDummyUnit('e1', 1, 'Land Raider', ['VEHICLE'], 20, 20);
    s.units = [cawl, enemy];

    admechCommandStart(s, 0);

    // Self-repair should heal Cawl
    expect(cawl.models[0].wounds).toBeGreaterThan(6);
    // Machine Vengeance should target enemy
    expect(s.players[0].machineVengeanceTarget).toBe('e1');

    // Attacking target gets re-roll hits
    const rangers = createDummyUnit('u1', 0, 'Skitarii Rangers', ['SKITARII', 'BATTLELINE'], 0, 0);
    const atk = admechAttackModifiers(s, rangers, enemy, 10, 'ranged');
    expect(atk.rerollHits).toBe(true);
  });

  it('supports dual imperatives for units with Omnicogitator or The Fires of Mars', () => {
    const s = createDummyGame();
    s.players[0].admechImperative = 'Protector Imperative';

    const thulia = createDummyUnit('thulia', 0, 'Thulia Ghuld', ['CHARACTER', 'INFANTRY'], 0, 0);
    thulia.timed = [{ id: 't1', label: 'The Fires of Mars', duration: 1, expires: 'turnEnd', by: 0 } as any];

    const active = unitActiveImperatives(s, thulia);
    expect(active.has('Protector Imperative')).toBe(true);
    expect(active.has('Conqueror Imperative')).toBe(true);
  });

  it('Hastarii Exterminators and Fusiliers datasheet rules apply correctly', () => {
    const s = createDummyGame();
    const hastariiEx = createDummyUnit('h1', 0, 'Hastarii Exterminators', ['INFANTRY'], 0, 0);
    const hastariiFu = createDummyUnit('h2', 0, 'Hastarii Fusiliers', ['INFANTRY'], 0, 0);
    const enemyInfantry = createDummyUnit('e1', 1, 'Intercessors', ['INFANTRY'], 10, 0);
    const enemyVehicle = createDummyUnit('e2', 1, 'Predator', ['VEHICLE'], 10, 0);

    s.units = [hastariiEx, hastariiFu, enemyInfantry, enemyVehicle];

    // Eradication caster vs non-Monster/Vehicle gets [SUSTAINED HITS 1]
    const atk1 = admechAttackModifiers(s, hastariiEx, enemyInfantry, 10, 'ranged', undefined, 'eradication caster');
    expect(atk1.sustained).toBe('1');

    // Eradication caster vs Vehicle does NOT get sustained hits 1
    const atk2 = admechAttackModifiers(s, hastariiEx, enemyVehicle, 10, 'ranged', undefined, 'eradication caster');
    expect(atk2.sustained).toBeNull();

    // Neutron fusil vs Vehicle gets [IGNORES COVER]
    const atk3 = admechAttackModifiers(s, hastariiFu, enemyVehicle, 10, 'ranged', undefined, 'neutron fusil');
    expect(atk3.ignoresCover).toBe(true);
  });
});
