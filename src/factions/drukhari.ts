// Drukhari army rules: Power from Pain (Pain Tokens & Empowered Abilities) and Detachments.
// Legal for matched play from 26th August 2026 (Faction Pack v1.2).

import { d6 } from '../engine/dice';
import { alive, boardUnits, hasKw, log, onBoard, other, unitDistance } from '../engine/state';
import type { GameState, PlayerId, UnitState, WeaponProfileData } from '../engine/types';

export interface DrukhariAttackBonus {
  hitMod: number;
  woundMod: number;
  apBonus: number;
  attacksBonus: number;
  rerollHits1: boolean;
  rerollWounds1: boolean;
  rerollHits: boolean;
  rerollWounds: boolean;
  critHitOn?: number;
  critWoundOn?: number;
  lethal: boolean;
  sustained: string | null;
  ignoresCover: boolean;
  precision: boolean;
  notes: string[];
}

export interface DrukhariDefenseBonus {
  hitMod: number;
  woundMod: number;
  inv?: number;
  fnp?: number;
  notes: string[];
}

export function isDrukhariArmy(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (!P) return false;
  return (
    P.factionId === 'DRU'
    || P.factionName?.toLowerCase().includes('drukhari')
    || s.units.some((u) => u.owner === p && (u.factionKeywords?.includes('DRUKHARI') || u.keywords?.includes('DRUKHARI')))
  );
}

export function hasDrukhariFaction(u: UnitState): boolean {
  return u.factionKeywords?.includes('DRUKHARI') || u.keywords?.includes('DRUKHARI');
}

/** Check if a unit is currently Empowered by Power from Pain this phase. */
export function isUnitEmpowered(s: GameState, u: UnitState): boolean {
  const empList = s.players[u.owner]?.empoweredUnits;
  if (!empList) return false;
  if (empList.includes(u.id)) return true;
  // If attached, check if attached leader or bodyguard is in empowered list
  if (u.sources.length > 1) {
    const allies = s.units.filter((x) => x.owner === u.owner && empList.includes(x.id));
    if (allies.some((a) => a.sources.some((src) => u.sources.includes(src)))) {
      return true;
    }
  }
  return false;
}

/** Add Pain tokens to player's pool. */
export function gainPainToken(s: GameState, p: PlayerId, count = 1, reason?: string) {
  if (!isDrukhariArmy(s, p)) return;
  s.players[p].painTokens = (s.players[p].painTokens ?? 0) + count;
  log(s, `[Power from Pain] ${s.players[p].name} gained ${count} Pain token${count > 1 ? 's' : ''}${reason ? ` (${reason})` : ''} (Pool: ${s.players[p].painTokens})`, 'info', p);
}

/** Spend Pain tokens from player's pool. Automatically triggers Cronos Pain Engine refund aura. */
export function spendPainToken(s: GameState, p: PlayerId, count = 1, reason?: string, empoweringUnit?: UnitState): boolean {
  if (!isDrukhariArmy(s, p)) return false;
  const current = s.players[p].painTokens ?? 0;
  if (current < count) return false;

  s.players[p].painTokens = current - count;
  log(s, `[Power from Pain] ${s.players[p].name} spent ${count} Pain token${count > 1 ? 's' : ''}${reason ? ` (${reason})` : ''} (Remaining: ${s.players[p].painTokens})`, 'info', p);

  // Cronos: Pain Engine (Aura)
  // Each time you spend 1 Pain token to Empower a friendly unit within 9" of this unit, roll D6:
  // on 4+ (3+ if monster or vehicle), gain 1 Pain token!
  if (empoweringUnit) {
    const cronosList = boardUnits(s, p).filter((u) => u.name.includes('Cronos') || u.keywords.includes('CRONOS'));
    for (const c of cronosList) {
      if (unitDistance(c, empoweringUnit) <= 9 + 1e-6) {
        const isMV = hasKw(empoweringUnit, 'MONSTER') || hasKw(empoweringUnit, 'VEHICLE');
        const roll = d6(s);
        const threshold = isMV ? 3 : 4;
        if (roll >= threshold) {
          s.players[p].painTokens = (s.players[p].painTokens ?? 0) + 1;
          log(s, `[Pain Engine (Aura)] Cronos refunded 1 Pain token on roll of ${roll}! (Pool: ${s.players[p].painTokens})`, 'info', p);
        }
        break; // Max 1 refund attempt per spend
      }
    }
  }

  return true;
}

/** Empower a unit until the end of the phase. */
export function empowerUnit(s: GameState, u: UnitState): boolean {
  if (isUnitEmpowered(s, u)) return true;
  if (!spendPainToken(s, u.owner, 1, `Empowering ${u.name}`, u)) return false;

  if (!s.players[u.owner].empoweredUnits) {
    s.players[u.owner].empoweredUnits = [];
  }
  s.players[u.owner].empoweredUnits!.push(u.id);
  log(s, `[Empowered Through Pain] ${u.name} is Empowered until end of phase`, 'info', u.owner);
  return true;
}

/** Start of battle: setup initial Pain tokens based on battle size and detachment. */
export function drukhariBattleStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!isDrukhariArmy(s, p)) continue;
    const bSize = s.players[p]?.battleSize ?? 'incursion';
    const baseTokens = bSize === 'strike' || bSize === 'strikeForce' ? 3 : bSize === 'onslaught' ? 4 : 2;
    const dets = s.players[p].detachments ?? [];
    let bonus = 0;
    // Realspace Raiders: Alliance of Agony starting bonus
    if (dets.some((d) => d.name === 'Realspace Raiders')) {
      bonus += 1;
    }
    s.players[p].painTokens = baseTokens + bonus;
    log(s, `[Power from Pain] ${s.players[p].name} starting Pain token pool: ${s.players[p].painTokens}`, 'info', p);

    // Reaper’s Wager: Drukhari start winning the wager
    if (dets.some((d) => d.name === 'Reaper’s Wager')) {
      s.players[p].drukhariWagerWinning = 'Drukhari';
    }
  }
}

/** Start of Command phase: gain 1 Pain token and resolve Haemonculus Fleshcraft. */
export function drukhariCommandStart(s: GameState, p: PlayerId) {
  if (!isDrukhariArmy(s, p)) return;
  gainPainToken(s, p, 1, 'Command phase');

  // Haemonculus: Fleshcraft (Pain)
  // In your Command phase, you can spend 1 Pain token to Empower this unit.
  // Each time you do, return up to D3+1 destroyed Bodyguard models (Wracks) or heal lost wounds!
  const haemons = boardUnits(s, p).filter((u) => u.name.includes('Haemonculus'));
  for (const h of haemons) {
    const leaderModel = alive(h).find((m) => m.isCharacter);
    const damaged = alive(h).find((m) => m.wounds < (m.profile?.W ?? 1));
    const missingModels = h.startingStrength - alive(h).length;

    if ((damaged || missingModels > 0) && (s.players[p].painTokens ?? 0) >= 1) {
      if (spendPainToken(s, p, 1, `Fleshcraft for ${h.name}`, h)) {
        if (damaged) {
          const maxW = damaged.profile?.W ?? 1;
          const healed = Math.min(Math.ceil(d6(s) / 2), maxW - damaged.wounds);
          damaged.wounds += healed;
          log(s, `[Fleshcraft (Pain)] ${h.name} restored ${healed} lost wounds (${damaged.wounds}/${maxW}W)`, 'info', p);
        } else if (missingModels > 0) {
          const toReturn = Math.min(missingModels, Math.ceil(d6(s) / 2) + 1);
          // Revive dead models
          const deadModels = h.models.filter((m) => m.dead).slice(0, toReturn);
          for (const dm of deadModels) {
            dm.dead = false;
            dm.wounds = dm.profile?.W ?? 1;
          }
          log(s, `[Fleshcraft (Pain)] ${h.name} returned ${deadModels.length} destroyed models to the unit`, 'info', p);
        }
      }
    }
  }
}

/** Called at phase end to expire Empowered effects. */
export function drukhariPhaseEnd(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (s.players[p]?.empoweredUnits?.length) {
      s.players[p].empoweredUnits = [];
    }
  }
}

/** Called when an enemy unit is destroyed. Gains Pain token and updates Reaper's Wager. */
export function drukhariUnitDestroyed(s: GameState, destroyedUnit: UnitState, killerUnit?: UnitState) {
  const opponent = other(destroyedUnit.owner);
  if (isDrukhariArmy(s, opponent)) {
    gainPainToken(s, opponent, 1, `${destroyedUnit.name} destroyed`);

    // Reaper's Wager update:
    const dets = s.players[opponent].detachments ?? [];
    if (dets.some((d) => d.name === 'Reaper’s Wager') && killerUnit && killerUnit.owner === opponent) {
      const isHarlequin = hasKw(killerUnit, 'HARLEQUINS') || killerUnit.keywords.includes('HARLEQUINS');
      const winning = isHarlequin ? 'Harlequins' : 'Drukhari';
      s.players[opponent].drukhariWagerWinning = winning;
      log(s, `[Callous Competition] ${winning} are now winning the wager!`, 'info', opponent);
    }
  }
}

/** Called when an enemy unit fails a Battle-shock test. Gains Pain token. */
export function drukhariBattleShockFailed(s: GameState, shockedUnit: UnitState) {
  const opponent = other(shockedUnit.owner);
  if (isDrukhariArmy(s, opponent)) {
    gainPainToken(s, opponent, 1, `${shockedUnit.name} failed Battle-shock`);
  }
}

/** Calculate attack bonuses for a Drukhari unit A attacking T. */
export function drukhariAttackModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  distance: number,
  mode: 'ranged' | 'melee',
  profile?: WeaponProfileData,
  weaponName?: string,
): DrukhariAttackBonus {
  const out: DrukhariAttackBonus = {
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
    ignoresCover: false,
    precision: false,
    notes: [],
  };

  if (!isDrukhariArmy(s, A.owner) || !hasDrukhariFaction(A)) return out;

  const empowered = isUnitEmpowered(s, A);
  const dets = s.players[A.owner]?.detachments ?? [];

  // --- Base Power from Pain / Empowered Datasheet Rules ---
  if (empowered) {
    // Archon: Hatred Eternal (Pain) -> re-roll Hit rolls
    if (A.name.includes('Archon') || A.sources.some((s) => s.includes('Archon'))) {
      out.rerollHits = true;
      out.notes.push('Hatred Eternal (Pain): re-roll Hits');
    }

    // Lelith Hesperax / Wyches: Brides of Death (Pain)
    if (A.name.includes('Lelith') || A.sources.some((s) => s.includes('Lelith'))) {
      if (mode === 'melee') {
        out.sustained = '2';
        out.notes.push('Brides of Death (Pain): [SUSTAINED HITS 2]');
      }
    }

    // Drazhar: Master of Blades (Pain) -> +1 to Wound rolls in Fight
    if ((A.name.includes('Drazhar') || A.sources.some((s) => s.includes('Drazhar'))) && mode === 'melee') {
      out.woundMod += 1;
      out.notes.push('Master of Blades (Pain): +1 to Wound');
    }

    // Incubi: Decapitating Strikes (Pain) -> +1 to Wound rolls in Fight
    if (A.name.includes('Incubi') && mode === 'melee') {
      out.woundMod += 1;
      out.notes.push('Decapitating Strikes (Pain): +1 to Wound');
    }

    // Kabalite Warriors: Sadistic Raiders (Pain) -> re-roll Hit 1s, or re-roll all Hits vs objective
    if (A.name.includes('Kabalite Warriors')) {
      const nearObj = s.objectives.some((o) => T.models.some((m) => Math.hypot(m.x - o.x, m.y - o.y) <= 3 + 1e-6));
      if (nearObj) {
        out.rerollHits = true;
        out.notes.push('Sadistic Raiders (Pain): re-roll Hits (Objective)');
      } else {
        out.rerollHits1 = true;
        out.notes.push('Sadistic Raiders (Pain): re-roll Hit 1s');
      }
    }

    // Scourges: Winged Strike (Pain) -> re-roll Hit rolls of 1
    if (A.name.includes('Scourges') && mode === 'ranged') {
      out.rerollHits1 = true;
      out.notes.push('Winged Strike (Pain): re-roll Hit 1s');
    }

    // Hellions: Battlefield Butchery (Pain) -> +1 Attacks in Fight
    if (A.name.includes('Hellions') && mode === 'melee') {
      out.attacksBonus += 1;
      out.notes.push('Battlefield Butchery (Pain): +1 Attack');
    }

    // Hand of the Archon: Assassins’ Poisons (Pain) -> Critical Wounds on 5+
    if (A.name.includes('Hand of the Archon')) {
      out.critWoundOn = 5;
      out.notes.push('Assassins’ Poisons (Pain): Crit Wound 5+');
    }

    // General default Drukhari Empowered effect (re-roll Hit rolls of 1 or all Hits)
    if (!out.rerollHits && !out.rerollHits1) {
      out.rerollHits = true;
      out.notes.push('Empowered: re-roll Hits');
    }
  }

  // --- Detachments ---

  // 1. Reaper’s Wager: Callous Competition
  if (dets.some((d) => d.name === 'Reaper’s Wager')) {
    const isHarlequin = hasKw(A, 'HARLEQUINS') || A.keywords.includes('HARLEQUINS');
    const winningSide = s.players[A.owner]?.drukhariWagerWinning ?? 'Drukhari';
    const isWinning = (isHarlequin && winningSide === 'Harlequins') || (!isHarlequin && winningSide === 'Drukhari');

    if (isWinning) {
      out.rerollHits1 = true;
      out.notes.push('Winning Wager: re-roll Hit 1s');
    } else {
      out.rerollHits1 = true;
      out.rerollWounds1 = true;
      out.notes.push('Losing Wager: re-roll Hit 1s & Wound 1s');
    }
  }

  // 2. Exhibition of Slaughter: Exacting Cruelty
  // Friendly WYCH CULT units' melee attacks have [LETHAL HITS: non-MONSTER/VEHICLE]
  if (dets.some((d) => d.name === 'Exhibition of Slaughter') && mode === 'melee') {
    if (hasKw(A, 'WYCH CULT') || A.keywords.includes('WYCH CULT')) {
      if (!hasKw(T, 'MONSTER') && !hasKw(T, 'VEHICLE')) {
        out.lethal = true;
        out.notes.push('Exacting Cruelty: [LETHAL HITS]');
      }
    }
  }

  // 3. Kabalite Agonysts: Contracted Harvest
  // Friendly BLADES FOR HIRE / KABAL ranged attacks have [SUSTAINED HITS 1: non-MONSTER/VEHICLE]
  if (dets.some((d) => d.name === 'Kabalite Agonysts') && mode === 'ranged') {
    if (hasKw(A, 'KABAL') || hasKw(A, 'BLADES FOR HIRE') || A.keywords.includes('KABAL') || A.keywords.includes('BLADES FOR HIRE')) {
      if (!hasKw(T, 'MONSTER') && !hasKw(T, 'VEHICLE')) {
        out.sustained = '1';
        out.notes.push('Contracted Harvest: [SUSTAINED HITS 1]');
      }
    }
  }

  // 4. Skysplinter Assault: Vicious Raiders
  // Units that disembarked from a transport this turn gain [IGNORES COVER] and [SUSTAINED HITS 1] (ranged) / [LETHAL HITS] (melee)
  if (dets.some((d) => d.name === 'Skysplinter Assault')) {
    if (A.disembarkedTurn === s.turn) {
      if (mode === 'ranged') {
        out.ignoresCover = true;
        out.sustained = '1';
        out.notes.push('Skysplinter: [IGNORES COVER, SUSTAINED HITS 1]');
      } else {
        out.lethal = true;
        out.notes.push('Skysplinter: [LETHAL HITS]');
      }
    }
  }

  return out;
}

/** Calculate defensive modifiers when Drukhari unit T is targeted by A. */
export function drukhariDefenseModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  mode: 'ranged' | 'melee',
  profile?: WeaponProfileData,
): DrukhariDefenseBonus {
  const out: DrukhariDefenseBonus = {
    hitMod: 0,
    woundMod: 0,
    notes: [],
  };

  if (!isDrukhariArmy(s, T.owner) || !hasDrukhariFaction(T)) return out;

  const dets = s.players[T.owner]?.detachments ?? [];

  // Tools of Torment: Darkest Artifice
  // Attacks that target friendly CRONOS/TALOS units with S > T have -1 to wound rolls
  if (dets.some((d) => d.name === 'Tools of Torment')) {
    if (hasKw(T, 'CRONOS') || hasKw(T, 'TALOS') || T.keywords.includes('CRONOS') || T.keywords.includes('TALOS')) {
      const sVal = profile?.S ?? 4;
      const tVal = alive(T)[0]?.profile.T ?? 4;
      if (sVal > tVal) {
        out.woundMod -= 1;
        out.notes.push('Darkest Artifice: −1 to Wound');
      }
    }
  }

  return out;
}
