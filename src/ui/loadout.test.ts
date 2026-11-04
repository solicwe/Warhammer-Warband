import { describe, expect, it } from 'vitest';
import type { ModelState, UnitState, WeaponData } from '../engine/types';
import { unitAttachedSummary, unitDisplayName, unitKitSignature, unitSubDetails, unitWeaponsSummary } from './loadout';

const makeModel = (id: string, source: string, weapons: string[], isCharacter = false): ModelState => ({
  id,
  source,
  name: source,
  isCharacter,
  isBodyguard: false,
  keywords: [],
  weapons: weapons.map((w) => ({ name: w, profiles: [{ name: w, range: w.includes('fist') ? 'Melee' : 24, A: 1, skill: 3, S: 4, AP: 0, D: 1, abilities: [] }] } as unknown as WeaponData)),
  dead: false,
  x: 0,
  y: 0,
  r: 1,
  wounds: 3,
  profile: { M: 6, T: 4, Sv: 3, W: 3, Ld: 6, OC: 1, name: source, base: { w: 32, h: 32 } } as any,
});

const makeUnit = (name: string, models: ModelState[], enhancements: string[] = []): UnitState => ({
  id: 'u1',
  sources: [...new Set(models.map((m) => m.source))],
  owner: 0,
  name,
  models,
  startingStrength: models.length,
  pts: 100,
  status: 'pending',
  embarkedIn: null,
  transport: null,
  weaponsFired: [],
  cantCharge: false,
  scoutDone: false,
  battleShocked: false,
  isWarlordUnit: false,
  enhancements: enhancements.map((e) => ({ name: e, text: '', model: '' })),
  move: null,
  advanceRoll: null,
  maxMoved: 0,
  setUpTurn: 0,
  shotTurn: -10,
  selectedToShoot: false,
  declaredCharge: false,
  chargeRoll: null,
  chargedTurn: 0,
  chargeTargets: [],
  fought: false,
  foughtFirstUntilTurn: 0,
  stratagemPhase: null,
  oneShotUsed: [],
  buffs: [],
  abilities: [],
  core: {},
  keywords: [],
  factionKeywords: [],
});

describe('unitWeaponsSummary', () => {
  it('summarizes weapons for single-model vehicle and filters generic Close combat weapon', () => {
    const helbruteMelta = makeUnit('Helbrute', [
      makeModel('m1', 'Helbrute', ['Multi-melta', 'Missile launcher', 'Close combat weapon']),
    ]);
    expect(unitWeaponsSummary(helbruteMelta)).toBe('Multi-melta + Missile launcher');

    const helbruteLas = makeUnit('Helbrute', [
      makeModel('m2', 'Helbrute', ['Twin lascannon', 'Missile launcher', 'Close combat weapon']),
    ]);
    expect(unitWeaponsSummary(helbruteLas)).toBe('Twin lascannon + Missile launcher');
  });

  it('keeps Close combat weapon if it is the only weapon', () => {
    const cultists = makeUnit('Chaos Cultists', [
      makeModel('m1', 'Chaos Cultists', ['Close combat weapon']),
    ]);
    expect(unitWeaponsSummary(cultists)).toBe('Close combat weapon');
  });

  it('summarizes squad with uniform weapons without repeating count when all models carry the same', () => {
    const spawn = makeUnit('Chaos Spawn', [
      makeModel('s1', 'Chaos Spawn', ['Hideous mutations']),
      makeModel('s2', 'Chaos Spawn', ['Hideous mutations']),
    ]);
    expect(unitWeaponsSummary(spawn)).toBe('Hideous mutations');
  });

  it('summarizes mixed squad weapons with counts for special weapons', () => {
    const rubrics = makeUnit('Rubric Marines', [
      makeModel('r1', 'Rubric Marines', ['Inferno boltgun', 'Close combat weapon']),
      makeModel('r2', 'Rubric Marines', ['Inferno boltgun', 'Close combat weapon']),
      makeModel('r3', 'Rubric Marines', ['Inferno boltgun', 'Close combat weapon']),
      makeModel('r4', 'Rubric Marines', ['Inferno boltgun', 'Close combat weapon']),
      makeModel('r5', 'Rubric Marines', ['Soulreaper cannon', 'Close combat weapon']),
    ]);
    expect(unitWeaponsSummary(rubrics)).toBe('4× Inferno boltgun + Soulreaper cannon');
  });
});

describe('unitAttachedSummary', () => {
  it('returns null for solo unit', () => {
    const solo = makeUnit('Ahriman', [makeModel('a1', 'Ahriman', ['Black Staff of Ahriman'], true)]);
    expect(unitAttachedSummary(solo)).toBeNull();
  });

  it('returns attached bodyguard description when leader is attached to a squad', () => {
    const attached = makeUnit('Sorcerer in Terminator Armour + Scarab Occult Terminators', [
      makeModel('s1', 'Sorcerer in Terminator Armour', ['Force weapon'], true),
      makeModel('t1', 'Scarab Occult Terminators', ['Inferno combi-bolter']),
      makeModel('t2', 'Scarab Occult Terminators', ['Inferno combi-bolter']),
      makeModel('t3', 'Scarab Occult Terminators', ['Inferno combi-bolter']),
    ]);
    expect(unitAttachedSummary(attached)).toBe('+ 3× Scarab Occult Terminators');
  });
});

describe('unitSubDetails', () => {
  it('combines enhancements, attached bodyguards, and weapons into details', () => {
    const u = makeUnit(
      'Sorcerer in Terminator Armour + Scarab Occult Terminators',
      [
        makeModel('s1', 'Sorcerer in Terminator Armour', ['Force weapon', 'Inferno combi-bolter'], true),
        makeModel('t1', 'Scarab Occult Terminators', ['Inferno combi-bolter']),
        makeModel('t2', 'Scarab Occult Terminators', ['Inferno combi-bolter']),
      ],
      ['Athenaean Scrolls']
    );

    const sub = unitSubDetails(u);
    expect(sub.enh).toBe('Athenaean Scrolls');
    expect(sub.attached).toBe('+ 2× Scarab Occult Terminators');
    expect(sub.weapons).toBe('Inferno combi-bolter + Force weapon');
    expect(sub.text).toContain('Athenaean Scrolls');
    expect(sub.text).toContain('+ 2× Scarab Occult Terminators');
  });

  it('handles units with weapons only', () => {
    const helbrute = makeUnit('Helbrute', [
      makeModel('h1', 'Helbrute', ['Twin lascannon', 'Missile launcher', 'Close combat weapon']),
    ]);
    const sub = unitSubDetails(helbrute);
    expect(sub.enh).toBeNull();
    expect(sub.attached).toBeNull();
    expect(sub.weapons).toBe('Twin lascannon + Missile launcher');
    expect(sub.text).toBe('Twin lascannon + Missile launcher');
  });
});

describe('unitKitSignature', () => {
  it('produces different signatures for units with different weapons', () => {
    const h1 = makeUnit('Helbrute', [makeModel('m1', 'Helbrute', ['Multi-melta', 'Helbrute fist'])]);
    const h2 = makeUnit('Helbrute', [makeModel('m2', 'Helbrute', ['Twin lascannon', 'Missile launcher'])]);
    expect(unitKitSignature(h1)).not.toBe(unitKitSignature(h2));
  });

  it('produces identical signatures for units with identical weapons', () => {
    const h1 = makeUnit('Helbrute', [makeModel('m1', 'Helbrute', ['Multi-melta', 'Helbrute fist'])]);
    const h2 = makeUnit('Helbrute', [makeModel('m2', 'Helbrute', ['Multi-melta', 'Helbrute fist'])]);
    expect(unitKitSignature(h1)).toBe(unitKitSignature(h2));
  });

  it('produces different signatures when enhancements differ', () => {
    const s1 = makeUnit('Sorcerer', [makeModel('m1', 'Sorcerer', ['Force weapon'])], ['Athenaean Scrolls']);
    const s2 = makeUnit('Sorcerer', [makeModel('m2', 'Sorcerer', ['Force weapon'])], []);
    expect(unitKitSignature(s1)).not.toBe(unitKitSignature(s2));
  });
});

describe('unitDisplayName', () => {
  it('cleans up attached name', () => {
    expect(unitDisplayName(makeUnit('Sorcerer in Terminator Armour + Scarab Occult Terminators', []))).toBe('Sorcerer in Terminator Armour');
    expect(unitDisplayName(makeUnit('Helbrute', []))).toBe('Helbrute');
  });
});
