// Necrons: Reanimation Protocols, Detachment mechanics, and Command protocols.
import { alive, boardUnits, hasKw, log, other } from '../engine/state';
import { dist, ptGap } from '../engine/geometry';
import { rollExpr } from '../engine/dice';
import type { GameState, PlayerId, UnitState, WeaponProfileData } from '../engine/types';

export function hasAnyKw(u: UnitState, kw: string): boolean {
  const target = kw.toUpperCase();
  return (u.keywords ?? []).some((k) => k.toUpperCase() === target) ||
         (u.factionKeywords ?? []).some((k) => k.toUpperCase() === target);
}

export function isNecronUnit(u: UnitState): boolean {
  return hasAnyKw(u, 'NECRONS');
}

export function isNecronArmy(s: GameState, p: PlayerId): boolean {
  return s.players[p]?.factionId === 'NEC' || (s.players[p]?.detachments ?? []).some((d) => [
    'Awakened Dynasty', 'Annihilation Legion', 'Canoptek Court', 'Obeisance Phalanx',
    'Hypercrypt Legion', 'Starshatter Arsenal', 'Cryptek Conclave', 'Cursed Legion',
    'Pantheon of Woe', 'Hand of the Dynasty', 'Skyshroud Spearhead', "The Phaeron's Armoury"
  ].includes(d.name));
}

/** Activate Reanimation Protocols for a specific unit. */
export function activateReanimation(s: GameState, u: UnitState, extraBonus = 0): number {
  if (!isNecronUnit(u) || !alive(u).length) return 0;

  const isWarriors = (u.sources?.[0] ?? u.name).toLowerCase().includes('warrior');
  // Necron Warriors: D3+3 (or D3 if not near an objective in 10e index, or straight D3+3 on their datasheet: D6 / D3+3)
  const baseExpr = isWarriors ? 'D3+1' : 'D3';
  let totalWounds = rollExpr(s, baseExpr).total + extraBonus;

  // Canoptek Reanimator nearby adds +D3 reanimated wounds
  const nearReanimator = boardUnits(s, u.owner).some(
    (otherU) => otherU.id !== u.id && hasAnyKw(otherU, 'CANOPTEK REANIMATOR') && alive(otherU).some((m) => alive(u).some((um) => dist(m, um) <= 3 + 1e-6))
  );
  if (nearReanimator) {
    totalWounds += rollExpr(s, 'D3').total;
  }

  let pool = totalWounds;
  let woundsHealed = 0;
  let modelsRevived = 0;

  // 1. Heal any damaged living models first
  for (const m of alive(u)) {
    if (pool <= 0) break;
    const maxW = m.profile.W;
    const missing = maxW - m.wounds;
    if (missing > 0) {
      const heal = Math.min(pool, missing);
      m.wounds += heal;
      pool -= heal;
      woundsHealed += heal;
    }
  }

  // 2. Return destroyed models
  const deadModels = u.models.filter((m) => m.dead);
  for (const m of deadModels) {
    if (pool <= 0) break;
    const cost = m.profile.W;
    if (pool >= cost) {
      m.dead = false;
      m.wounds = cost;
      pool -= cost;
      modelsRevived++;
    } else {
      // If pool is less than W, in 10th edition remainder is discarded
      break;
    }
  }

  if (woundsHealed > 0 || modelsRevived > 0) {
    const parts: string[] = [];
    if (woundsHealed > 0) parts.push(`healed ${woundsHealed} wound(s)`);
    if (modelsRevived > 0) parts.push(`returned ${modelsRevived} model(s)`);
    log(s, `Reanimation Protocols: ${u.name} ${parts.join(', ')}`, 'info', u.owner);
  }

  return woundsHealed + modelsRevived;
}

/** At the start of Necrons player's Command phase. */
export function necCommandStart(s: GameState, p: PlayerId): void {
  if (!isNecronArmy(s, p)) return;

  for (const u of boardUnits(s, p)) {
    if (isNecronUnit(u)) {
      activateReanimation(s, u);
    }
  }
}

/** Initialize Necrons battle state (e.g. Worthy Foes). */
export function necBattleStart(s: GameState): void {
  for (let p = 0 as PlayerId; p < 2; p++) {
    if (isNecronArmy(s, p)) {
      const isObeisance = (s.players[p]?.detachments ?? []).some((d) => d.name === 'Obeisance Phalanx');
      if (isObeisance && !s.players[p].worthyFoeUnitId) {
        const enemies = boardUnits(s, other(p));
        // Pick enemy Character or highest pts unit as Worthy Foe
        const target = enemies.find((e) => hasAnyKw(e, 'CHARACTER')) ?? enemies[0];
        if (target) {
          s.players[p].worthyFoeUnitId = target.id;
          log(s, `Worthy Foes: ${s.players[p].name} designates ${target.name} as their Worthy Foe!`, 'info', p);
        }
      }
    }
  }
}

export interface NecAttackBonus {
  hitMod: number;
  woundMod: number;
  apBonus: number;
  attacksBonus: number;
  rerollHits1: boolean;
  rerollWounds1: boolean;
  rerollHits: boolean;
  rerollWounds: boolean;
  lethal: boolean;
  sustained: string | null;
  devastating: boolean;
  critHitThreshold: number;
  assault: boolean;
  notes: string[];
}

export interface NecDefenseBonus {
  hitMod: number;
  woundMod: number;
  apWorsen: number;
  fnp?: number;
  notes: string[];
}

/** Calculate Necrons attack bonuses. */
export function necAttackModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  distance: number,
  mode: 'ranged' | 'melee',
  profile?: WeaponProfileData,
  weaponName?: string,
): NecAttackBonus {
  const out: NecAttackBonus = {
    hitMod: 0,
    woundMod: 0,
    apBonus: 0,
    attacksBonus: 0,
    rerollHits1: false,
    rerollWounds1: false,
    rerollHits: false,
    rerollWounds: false,
    lethal: false,
    sustained: null,
    devastating: false,
    critHitThreshold: 6,
    assault: false,
    notes: [],
  };

  if (!isNecronUnit(A)) return out;

  const det = (s.players[A.owner].detachments ?? [])[0]?.name;

  // 1. Awakened Dynasty: Command Protocols (+1 to Hit while led by a Character)
  if (det === 'Awakened Dynasty') {
    const isLed = hasAnyKw(A, 'CHARACTER') || alive(A).some((m) => m.isCharacter || (m.keywords ?? []).includes('CHARACTER'));
    if (isLed) {
      out.hitMod += 1;
      out.notes.push('Command Protocols: +1 to Hit (led by Character)');
    }
  }

  // 2. Canoptek Court: Power Matrix (re-roll 1s to Hit, or all Hit rolls in controlled zone)
  if (det === 'Canoptek Court' && (hasAnyKw(A, 'CRYPTEK') || hasAnyKw(A, 'CANOPTEK'))) {
    const nearOwnObj = s.objectives.some(
      (o) => o.controller === A.owner && alive(A).some((m) => dist(m, o) <= 6 + (m.r ?? 0.63) + 1e-6)
    );
    if (nearOwnObj) {
      out.rerollHits = true;
      out.notes.push('Power Matrix: Re-roll all Hit rolls (in Matrix)');
    } else {
      out.rerollHits1 = true;
      out.notes.push('Power Matrix: Re-roll Hit rolls of 1');
    }
  }

  // 3. Obeisance Phalanx: Worthy Foes (+1 to Wound against designated unit)
  if (det === 'Obeisance Phalanx') {
    const worthyId = s.players[A.owner].worthyFoeUnitId;
    if (worthyId && T.id === worthyId && (hasAnyKw(A, 'OVERLORD') || hasAnyKw(A, 'LYCHGUARD') || hasAnyKw(A, 'TRIARCH'))) {
      out.woundMod += 1;
      out.notes.push('Worthy Foes: +1 to Wound');
    }
  }

  // 4. Starshatter Arsenal: Relentless Onslaught (Lethal Hits against units on objectives)
  if (det === 'Starshatter Arsenal' && hasAnyKw(A, 'VEHICLE')) {
    const targetOnObj = s.objectives.some((o) => alive(T).some((m) => ptGap(m, o) <= 3 + 1e-6));
    if (targetOnObj) {
      out.lethal = true;
      out.notes.push('Relentless Onslaught: [LETHAL HITS]');
    }
  }

  // 5. Cryptek Conclave: Critical hits on 5+
  if (det === 'Cryptek Conclave' && hasAnyKw(A, 'CRYPTEK')) {
    out.critHitThreshold = 5;
    out.notes.push('Technosorcerous Augmentations: Critical Hits on 5+');
  }

  // 6. Cursed Legion: +1 to Hit vs units below starting strength
  if (det === 'Cursed Legion' && (hasAnyKw(A, 'DESTROYER CULT') || hasAnyKw(A, 'FLAYED ONES'))) {
    if (alive(T).length < T.startingStrength) {
      out.hitMod += 1;
      out.notes.push('Cold Fervour: +1 to Hit (target below Starting Strength)');
    }
  }

  // 7. Hand of the Dynasty: Assault for Immortals & Necron Warriors
  if (det === 'Hand of the Dynasty' && mode === 'ranged' && (hasAnyKw(A, 'IMMORTALS') || hasAnyKw(A, 'NECRON WARRIORS'))) {
    out.assault = true;
    out.notes.push('Hypermotility Protocols: [ASSAULT]');
  }

  // 8. Skyshroud Spearhead: +1 to Hit for Tomb Blades on arrival turn
  if (det === 'Skyshroud Spearhead' && mode === 'ranged' && hasAnyKw(A, 'TOMB BLADES') && A.setUpTurn === s.turn) {
    out.hitMod += 1;
    out.notes.push('Transdimensional Deployment: +1 to Hit');
  }

  return out;
}

/** Calculate Necrons defense bonuses. */
export function necDefenseModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  mode: 'ranged' | 'melee',
  profile?: WeaponProfileData,
): NecDefenseBonus {
  const out: NecDefenseBonus = {
    hitMod: 0,
    woundMod: 0,
    apWorsen: 0,
    notes: [],
  };

  if (!isNecronUnit(T)) return out;

  const det = (s.players[T.owner].detachments ?? [])[0]?.name;

  // Pantheon of Woe: 4+ FNP against mortal wounds for C'tan
  if (det === 'Pantheon of Woe' && hasAnyKw(T, "C'TAN SHARD")) {
    out.fnp = 4;
    out.notes.push('Cosmic Distortion: 4+ FNP vs mortal wounds');
  }

  return out;
}
