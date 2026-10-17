import { describe, it, expect, beforeEach } from 'vitest';
import { autoSelectFtgg, canBeGuided, canBeObserver, ftggAttackModifiers, hasMarkerlight, isTauArmy, pairFtgg } from './tau';
import { buildShootPools } from './attack';
import type { GameState, ModelState, PlayerState, UnitState, WeaponData } from './types';

function createDummyModel(id: string, name: string, keywords: string[] = [], gear: string[] = [], x = 10, y = 10): ModelState {
  return {
    id,
    name,
    source: name,
    wounds: 3,
    dead: false,
    keywords,
    gear,
    x,
    y,
    profile: { name, M: 10, T: 4, Sv: 3, W: 3, Ld: 7, OC: 1, base: '32mm', InSv: null } as any,
    weapons: [
      {
        name: 'Pulse Rifle',
        profiles: [
          {
            name: 'Pulse Rifle',
            range: 30,
            A: '1',
            skill: 4,
            S: 5,
            AP: 0,
            D: '1',
            abilities: [],
          },
        ],
      },
    ],
    r: 1.2,
    isCharacter: false,
    isBodyguard: false,
  } as unknown as ModelState;
}

function createDummyUnit(id: string, name: string, owner: 0 | 1, kw: string[], abilities: string[] = [], gear: string[] = [], x = 10, y = 10): UnitState {
  const model = createDummyModel(`${id}-m1`, name, kw, gear, x, y);
  return {
    id,
    owner,
    name,
    sources: [name],
    keywords: kw,
    factionKeywords: ['T’AU EMPIRE'],
    models: [model],
    startingStrength: 1,
    abilities: abilities.map((n) => ({ name: n, type: 'Datasheet', text: '' })),
    core: {},
    pts: 100,
    status: 'board',
    embarkedIn: null,
    weaponsFired: [],
    oneShotUsed: [],
    buffs: [],
    selectedToShoot: false,
    shotTurn: -1,
    maxMoved: 0,
  } as unknown as UnitState;
}

function createMockGameState(): GameState {
  return {
    version: 3,
    rng: 42,
    round: 1,
    turn: 0,
    firstPlayer: 0,
    active: 0,
    phase: 'shooting',
    deployTurn: 0,
    attackerPlayer: 0,
    window: null,
    attack: null,
    fight: null,
    shockTests: [],
    destroyedByTurn: [],
    markers: [],
    modelDeaths: [],
    pendingActions: [],
    turnStart: null,
    controlAtTurnStart: [],
    log: [],
    winner: null,
    terrain: [],
    objectives: [],
    deploymentId: 'dawn_of_war',
    players: [
      {
        name: 'Tau Commander',
        factionId: 'TAU',
        factionName: "T'au Empire",
        cp: 2,
        vp: 0,
        secondaries: [],
        reserves: [],
        detachments: [{ id: '1', name: 'Mont’ka', dp: 1, forceDisposition: '', rules: [], enhancements: [], stratagems: [] }],
        armyRules: [{ name: 'For the Greater Good', text: '' }],
        miracleDice: [],
        oathTarget: null,
        oathWoundBonus: false,
        stratLimits: {},
        mission: {} as any,
        sec: {} as any,
        disposition: '',
        primaryId: '',
      },
      {
        name: 'Enemy Opponent',
        factionId: 'SM',
        factionName: 'Space Marines',
        cp: 2,
        vp: 0,
        secondaries: [],
        reserves: [],
        detachments: [],
        armyRules: [],
        miracleDice: [],
        oathTarget: null,
        oathWoundBonus: false,
        stratLimits: {},
        mission: {} as any,
        sec: {} as any,
        disposition: '',
        primaryId: '',
      },
    ] as unknown as [PlayerState, PlayerState],
    units: [],
    ftggPairs: [],
  };
}

describe('T’au Empire Army Rule: For the Greater Good', () => {
  let s: GameState;
  let stealthSuits: UnitState;
  let fireWarriors: UnitState;
  let enemyIntercessors: UnitState;

  beforeEach(() => {
    s = createMockGameState();
    stealthSuits = createDummyUnit('u-stealth', 'Stealth Battlesuits', 0, ['INFANTRY', 'BATTLESUIT', 'MARKERLIGHT'], ['For the Greater Good', 'Forward Observers'], [], 10, 15);
    fireWarriors = createDummyUnit('u-firewarriors', 'Strike Team', 0, ['INFANTRY'], ['For the Greater Good'], [], 10, 10);
    enemyIntercessors = createDummyUnit('u-enemy', 'Intercessor Squad', 1, ['INFANTRY'], [], [], 25, 10);
    enemyIntercessors.factionKeywords = ['ADEPTUS ASTARTES'];
    s.units = [stealthSuits, fireWarriors, enemyIntercessors];
  });

  it('detects T’au army and Markerlight keyword correctly', () => {
    expect(isTauArmy(s, 0)).toBe(true);
    expect(isTauArmy(s, 1)).toBe(false);
    expect(hasMarkerlight(stealthSuits)).toBe(true);
    expect(hasMarkerlight(fireWarriors)).toBe(false);
  });

  it('determines observer and guided eligibility', () => {
    expect(canBeObserver(s, stealthSuits)).toBe(true);
    expect(canBeGuided(s, fireWarriors)).toBe(true);

    // Battle-shocked unit cannot be observer
    stealthSuits.battleShocked = true;
    expect(canBeObserver(s, stealthSuits)).toBe(false);
    stealthSuits.battleShocked = false;

    // Unit that already shot cannot be normal observer
    stealthSuits.selectedToShoot = true;
    expect(canBeObserver(s, stealthSuits)).toBe(false);
  });

  it('pairs Observer, Guided, and Spotted units correctly', () => {
    const success = pairFtgg(s, fireWarriors.id, stealthSuits.id, enemyIntercessors.id);
    expect(success).toBe(true);
    expect(s.ftggPairs?.length).toBe(1);

    const pair = s.ftggPairs![0];
    expect(pair.guidedId).toBe(fireWarriors.id);
    expect(pair.observerId).toBe(stealthSuits.id);
    expect(pair.spottedId).toBe(enemyIntercessors.id);
  });

  it('gives +1 BS, Ignores Cover, and re-roll 1s when targeting Spotted unit', () => {
    pairFtgg(s, fireWarriors.id, stealthSuits.id, enemyIntercessors.id);

    const mods = ftggAttackModifiers(s, fireWarriors, enemyIntercessors, 15);
    expect(mods.isGuided).toBe(true);
    expect(mods.isSpotted).toBe(true);
    expect(mods.skillDelta).toBe(-1); // +1 BS (improves from 4+ to 3+)
    expect(mods.ignoresCover).toBe(true); // Observer has MARKERLIGHT
    expect(mods.rerollHits1).toBe(true); // Stealth Battlesuits have Forward Observers
    expect(mods.rerollWounds1).toBe(true); // Stealth Battlesuits have Forward Observers
    expect(mods.lethal).toBe(true); // Mont'ka active round 1
  });

  it('applies -1 BS when Guided unit targets a non-spotted unit', () => {
    const otherEnemy = createDummyUnit('u-enemy-2', 'Infiltrators', 1, ['INFANTRY']);
    s.units.push(otherEnemy);

    pairFtgg(s, fireWarriors.id, stealthSuits.id, enemyIntercessors.id);

    // Firing at otherEnemy (not their Spotted unit)
    const mods = ftggAttackModifiers(s, fireWarriors, otherEnemy, 15);
    expect(mods.isGuided).toBe(true);
    expect(mods.isSpotted).toBe(false);
    expect(mods.skillDelta).toBe(1); // -1 BS (worsens from 4+ to 5+)
  });

  it('auto-selects best observer in buildShootPools if available', () => {
    // Clear ftggPairs: should auto-pair stealth suits as observer
    s.ftggPairs = [];
    const res = buildShootPools(s, fireWarriors.id, enemyIntercessors.id, { mode: 'normal' });
    expect(res.error).toBeUndefined();
    expect(res.pools.length).toBeGreaterThan(0);

    const p = res.pools[0];
    // Base BS is 4+, with FTGG +1 BS it becomes 3+
    expect(p.skill).toBe(3);
    expect(p.skillNote).toContain('For the Greater Good +1 BS');
    expect(p.rerollHits1).toBe(true);
    expect(p.rerollWounds1).toBe(true);
  });

  it('Retaliation Cadre applies +1 S within 12" and +1 AP within 8"', () => {
    s.players[0].detachments = [{ id: 'rc', name: 'Retaliation Cadre', dp: 1, forceDisposition: '', rules: [], enhancements: [], stratagems: [] }];
    const crisisSuit = createDummyUnit('u-crisis', 'Crisis Sunforge Battlesuits', 0, ['BATTLESUIT', 'INFANTRY'], ['For the Greater Good']);
    s.units.push(crisisSuit);

    // Distance 10" (within 12", but outside 8")
    const mods10 = ftggAttackModifiers(s, crisisSuit, enemyIntercessors, 10);
    expect(mods10.strengthBonus).toBe(1);
    expect(mods10.apBonus).toBe(0);

    // Distance 6" (within 8")
    const mods6 = ftggAttackModifiers(s, crisisSuit, enemyIntercessors, 6);
    expect(mods6.strengthBonus).toBe(1);
    expect(mods6.apBonus).toBe(1);
  });

  it('Kroot Hunting Pack adds +1 hit below starting and +1 wound below half', () => {
    s.players[0].detachments = [{ id: 'khp', name: 'Kroot Hunting Pack', dp: 1, forceDisposition: '', rules: [], enhancements: [], stratagems: [] }];
    const krootCarnivores = createDummyUnit('u-kroot', 'Kroot Carnivores', 0, ['INFANTRY', 'KROOT'], ['Fieldcraft']);
    s.units.push(krootCarnivores);

    enemyIntercessors.startingStrength = 5;
    // Set 4 models alive (below starting strength)
    enemyIntercessors.models = [
      createDummyModel('e1', 'Intercessor'),
      createDummyModel('e2', 'Intercessor'),
      createDummyModel('e3', 'Intercessor'),
      createDummyModel('e4', 'Intercessor'),
    ];

    const modsBelowStarting = ftggAttackModifiers(s, krootCarnivores, enemyIntercessors, 12);
    expect(modsBelowStarting.hitMod).toBe(1);
    expect(modsBelowStarting.woundMod).toBe(0);

    // Set 2 models alive (below half strength)
    enemyIntercessors.models = [
      createDummyModel('e1', 'Intercessor'),
      createDummyModel('e2', 'Intercessor'),
    ];
    const modsBelowHalf = ftggAttackModifiers(s, krootCarnivores, enemyIntercessors, 12);
    expect(modsBelowHalf.hitMod).toBe(1);
    expect(modsBelowHalf.woundMod).toBe(1);
  });

  it("Ta'unar Supremacy Armour: builds with 30 wounds, 790 pts, and Coordinated Strike re-rolls 1s when Guided", async () => {
    const { buildUnits } = await import('./army');
    const fs = await import('fs');
    const tau = JSON.parse(fs.readFileSync('public/data/factions/TAU.json', 'utf8'));
    const list = {
      name: 'Tau Test',
      factionId: 'TAU',
      battleSize: 'strike',
      detachments: [],
      units: [{ uid: 'tn-1', datasheet: "Ta'unar Supremacy Armour", models: 1, pts: 790 }],
    };
    const units = buildUnits(list, tau, 0);
    expect(units.length).toBe(1);
    const taunar = units[0];
    expect(taunar.models[0].wounds).toBe(30);
    expect(taunar.pts).toBe(790);
    expect(taunar.keywords).toContain('TITANIC');
    expect(taunar.keywords).toContain('TOWERING');

    // Test Coordinated Strike
    const plainObserver = createDummyUnit('u-plain-obs', 'Strike Team', 0, ['INFANTRY'], ['For the Greater Good']);
    s.units.push(plainObserver, taunar);
    pairFtgg(s, taunar.id, plainObserver.id, enemyIntercessors.id);

    const mods = ftggAttackModifiers(s, taunar, enemyIntercessors, 24);
    expect(mods.isGuided).toBe(true);
    expect(mods.isSpotted).toBe(true);
    expect(mods.rerollHits1).toBe(true);
  });
});

