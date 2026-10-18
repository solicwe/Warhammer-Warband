// Chaos Daemons: The Shadow of Chaos, Daemonic Manifestation, Daemonic Terror,
// Warp Rifts (Daemonic Incursion), detachment rules and abilities.
import { alive, boardUnits, log, other } from '../engine/state';
import { dist, pointInPoly, ptGap } from '../engine/geometry';
import { zonePoly } from '../engine/missions';
import { rollExpr } from '../engine/dice';
import type { GameState, PlayerId, Pt, UnitState, WeaponProfileData } from '../engine/types';

export const GREATER_DAEMONS = [
  'Bloodthirster',
  'Great Unclean One',
  'Kairos Fateweaver',
  'Keeper of Secrets',
  'Keeper Of Secrets',
  'Lord of Change',
  'Rotigus',
  'Shalaxi Helbane',
  'Skarbrand',
];

export function hasAnyKw(u: UnitState, kw: string): boolean {
  const target = kw.toUpperCase();
  return (u.keywords ?? []).some((k) => k.toUpperCase() === target) ||
         (u.factionKeywords ?? []).some((k) => k.toUpperCase() === target);
}

export function isDaemonUnit(u: UnitState): boolean {
  return hasAnyKw(u, 'LEGIONES DAEMONICA');
}

export function isDaemonsArmy(s: GameState, p: PlayerId): boolean {
  return s.players[p]?.factionId === 'CD' || (s.players[p]?.detachments ?? []).some((d) => [
    'Daemonic Incursion', 'Legion of Excess', 'Scintillating Legion', 'Blood Legion',
    'Plague Legion', 'Shadow Legion', 'Cavalcade of Chaos', 'Lords of the Warp', 'Warptide'
  ].includes(d.name));
}

export function godOf(u: UnitState): 'Khorne' | 'Tzeentch' | 'Nurgle' | 'Slaanesh' | undefined {
  if (hasAnyKw(u, 'KHORNE')) return 'Khorne';
  if (hasAnyKw(u, 'TZEENTCH')) return 'Tzeentch';
  if (hasAnyKw(u, 'NURGLE')) return 'Nurgle';
  if (hasAnyKw(u, 'SLAANESH')) return 'Slaanesh';
  return undefined;
}

/** Check if an area or unit is within a player's Shadow of Chaos. */
export function isUnderShadowOfChaos(s: GameState, daemonPlayer: PlayerId, target: Pt | UnitState): boolean {
  const p = daemonPlayer;
  if (!isDaemonsArmy(s, p)) return false;
  const ownZone = zonePoly(s, p);
  const oppZone = zonePoly(s, other(p));

  const pt: Pt = 'x' in target && 'y' in target
    ? { x: target.x, y: target.y }
    : (target.models.find((m) => !m.dead) ?? target.models[0] ?? { x: 0, y: 0 });

  // 1. Own deployment zone is always within Shadow of Chaos
  if (pointInPoly(pt, ownZone)) return true;

  // 2. Corrupted objectives (Corrupt Realspace, Blood Tainted): 6" aura around corrupted objectives
  for (const obj of s.objectives) {
    if ((obj.corrupted === p || (s.players[p].corruptedObjectives ?? []).includes(obj.id)) && dist(pt, obj) <= 6 + 1e-6) {
      return true;
    }
  }

  // 3. Plague Legion detachment: Melancholic Miasma (within 9" of any friendly Nurgle daemon)
  const isPlagueLegion = (s.players[p].detachments ?? []).some((d) => d.name === 'Plague Legion');
  if (isPlagueLegion) {
    const nearNurgle = boardUnits(s, p).some((u) => hasAnyKw(u, 'NURGLE') && alive(u).some((m) => dist(pt, m) <= 9 + 1e-6));
    if (nearNurgle) return true;
  }

  // 4. No Man's Land: controlled by having at least half of the objectives there
  const nmlObjs = s.objectives.filter((o) => !pointInPoly(o, ownZone) && !pointInPoly(o, oppZone));
  const controlsNml = nmlObjs.length > 0 && nmlObjs.filter((o) => o.controller === p).length * 2 >= nmlObjs.length;
  if (controlsNml && !pointInPoly(pt, ownZone) && !pointInPoly(pt, oppZone)) return true;

  // 5. Opponent's deployment zone: controlled by having at least half of the objectives there
  const oppObjs = s.objectives.filter((o) => pointInPoly(o, oppZone));
  const controlsOpp = oppObjs.length > 0 && oppObjs.filter((o) => o.controller === p).length * 2 >= oppObjs.length;
  if (controlsOpp && pointInPoly(pt, oppZone)) return true;

  return false;
}

/** Check if within 6" of a friendly Greater Daemon (optionally matching a Chaos God). */
export function isNearGreaterDaemon(s: GameState, daemonPlayer: PlayerId, target: Pt | UnitState, godKw?: string): boolean {
  const pt: Pt = 'x' in target && 'y' in target
    ? { x: target.x, y: target.y }
    : (target.models.find((m) => !m.dead) ?? target.models[0] ?? { x: 0, y: 0 });

  return boardUnits(s, daemonPlayer).some((u) => {
    if (!GREATER_DAEMONS.some((gd) => u.sources.includes(gd) || u.name.includes(gd))) return false;
    if (godKw && !hasAnyKw(u, godKw)) return false;
    return alive(u).some((m) => dist(pt, m) <= 6 + 1e-6);
  });
}

/** Modifier to Battle-shock test due to Daemonic Manifestation / Daemonic Terror. */
export function daemonBattleShockMod(s: GameState, u: UnitState): number {
  if (isDaemonUnit(u)) {
    // Daemonic Manifestation: +1 to Battle-shock if in Shadow of Chaos
    if (isUnderShadowOfChaos(s, u.owner, u)) return 1;
    return 0;
  }

  // Enemy unit: Daemonic Terror (-1 to Battle-shock if in Shadow of Chaos or within 6" of Greater Daemon)
  const opp = other(u.owner);
  if (isDaemonsArmy(s, opp)) {
    if (isUnderShadowOfChaos(s, opp, u) || isNearGreaterDaemon(s, opp, u)) {
      return -1;
    }
  }
  return 0;
}

/** Triggers after a Battle-shock test result is resolved. */
export function daemonsOnBattleShockResult(s: GameState, u: UnitState, passed: boolean): void {
  // 1. Daemonic Manifestation (Friendly Daemons in Shadow of Chaos)
  if (isDaemonUnit(u)) {
    if (passed && isUnderShadowOfChaos(s, u.owner, u)) {
      const roll = rollExpr(s, 'D3').total;
      if (hasAnyKw(u, 'BATTLELINE')) {
        const dead = u.models.filter((m) => m.dead);
        const revived = dead.slice(0, roll);
        for (const m of revived) {
          m.dead = false;
          m.wounds = m.profile.W;
        }
        if (revived.length) {
          log(s, `${u.name}: ${revived.length} model(s) returned to unit (Daemonic Manifestation)`, 'info', u.owner);
        }
      } else {
        const wounded = alive(u).find((m) => m.wounds < m.profile.W);
        if (wounded) {
          const healed = Math.min(wounded.profile.W - wounded.wounds, roll);
          wounded.wounds += healed;
          log(s, `${u.name}: ${wounded.name} healed ${healed} wound(s) (Daemonic Manifestation)`, 'info', u.owner);
        }
      }
    }
    return;
  }

  // 2. Daemonic Terror (Enemy unit failed in Shadow of Chaos or near Greater Daemon)
  if (!passed) {
    const opp = other(u.owner);
    if (isDaemonsArmy(s, opp)) {
      if (isUnderShadowOfChaos(s, opp, u) || isNearGreaterDaemon(s, opp, u)) {
        const mortals = rollExpr(s, 'D3').total;
        let left = mortals;
        for (const m of alive(u)) {
          if (left <= 0) break;
          const take = Math.min(m.wounds, left);
          m.wounds -= take;
          left -= take;
          if (m.wounds <= 0) m.dead = true;
        }
        log(s, `${u.name} suffers ${mortals} mortal wound(s) from Daemonic Terror!`, 'info', u.owner);
      }
    }
  }
}

/** Minimum horizontal Deep Strike arrival distance for a Daemons unit. */
export function daemonsDeepStrikeDist(s: GameState, u: UnitState, pt: Pt): number {
  if (!isDaemonUnit(u)) return 9;
  const isDaemonicIncursion = (s.players[u.owner].detachments ?? []).some((d) => d.name === 'Daemonic Incursion');
  if (isDaemonicIncursion) {
    const god = godOf(u);
    if (isUnderShadowOfChaos(s, u.owner, pt) || (god && isNearGreaterDaemon(s, u.owner, pt, god))) {
      return 6;
    }
  }
  return 9;
}

/** Initialize Daemons players at start of battle. */
export function daemonsBattleStart(s: GameState): void {
  for (let p = 0 as PlayerId; p < 2; p++) {
    const pl = s.players[p];
    const isScintillating = (pl.detachments ?? []).some((d) => d.name === 'Scintillating Legion');
    if (isScintillating && pl.fluxTokens === undefined) {
      pl.fluxTokens = 3;
      log(s, `${pl.name} starts with 3 Flux tokens (Fates in Flux)`, 'info', p);
    }
  }
}

/** Spends 1 Flux token for Tzeentch Scintillating Legion (gives 1 to opponent). */
export function spendFluxToken(s: GameState, p: PlayerId): boolean {
  const pl = s.players[p];
  if (pl.fluxTokens && pl.fluxTokens > 0) {
    pl.fluxTokens--;
    const opp = other(p);
    s.players[opp].fluxTokens = (s.players[opp].fluxTokens ?? 0) + 1;
    log(s, `${pl.name} spends 1 Flux token (transferred to opponent)`, 'info', p);
    return true;
  }
  return false;
}

/** At start of each Command phase for Daemons. */
export function daemonsCommandStart(s: GameState): void {
  for (let p = 0 as PlayerId; p < 2; p++) {
    const isPlagueLegion = (s.players[p].detachments ?? []).some((d) => d.name === 'Plague Legion');
    if (isPlagueLegion) {
      // Melancholic Miasma: select one enemy unit in Shadow of Chaos to take a Battle-shock test
      const opp = other(p);
      const enemyUnitsInShadow = boardUnits(s, opp).filter((u) => isUnderShadowOfChaos(s, p, u) && !u.battleShocked);
      if (enemyUnitsInShadow.length > 0) {
        const target = enemyUnitsInShadow[0];
        log(s, `Melancholic Miasma: ${target.name} must take a Battle-shock test`, 'info', opp);
        // the Daemonic Terror modifier is added when the test is resolved (game.ts), not here as well
        s.shockTests.push({ unitId: target.id, mod: 0, passed: null, result: null });
      }
    }
  }
}

/** End of phase reset for Daemons. */
export function daemonsPhaseEnd(s: GameState): void {
  for (let p = 0 as PlayerId; p < 2; p++) {
    s.players[p].seductiveGambitUnits = [];
  }
}

export interface DaemonsAttackBonus {
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
  notes: string[];
}

export interface DaemonsDefenseBonus {
  hitMod: number;
  woundMod: number;
  apWorsen: number;
  notes: string[];
}

/** Attack modifiers for Chaos Daemons units and detachments. */
export function daemonsAttackModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  distance: number,
  mode: 'ranged' | 'melee',
  profile?: WeaponProfileData,
  weaponName?: string,
): DaemonsAttackBonus {
  const out: DaemonsAttackBonus = {
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
    notes: [],
  };

  if (!isDaemonUnit(A)) return out;

  const det = (s.players[A.owner].detachments ?? [])[0]?.name;

  // 1. Greater Daemon auras: Greater Daemon of Khorne/Tzeentch/Nurgle/Slaanesh (Aura)
  const isNearGd = (gdName: string) => boardUnits(s, A.owner).some((u) => (u.sources.includes(gdName) || u.name.includes(gdName)) && alive(u).some((m) => alive(A).some((am) => ptGap(m, am) <= 6 + 1e-6)));
  if (hasAnyKw(A, 'KHORNE') && isNearGd('Bloodthirster')) {
    out.rerollHits1 = true;
    out.notes.push('Greater Daemon of Khorne: re-roll Hit 1s');
  }
  if (hasAnyKw(A, 'TZEENTCH') && isNearGd('Lord of Change')) {
    out.rerollHits1 = true;
    out.notes.push('Greater Daemon of Tzeentch: re-roll Hit 1s');
  }
  if (hasAnyKw(A, 'NURGLE') && isNearGd('Great Unclean One')) {
    out.rerollHits1 = true;
    out.notes.push('Greater Daemon of Nurgle: re-roll Hit 1s');
  }
  if (hasAnyKw(A, 'SLAANESH') && isNearGd('Keeper of Secrets')) {
    out.rerollHits1 = true;
    out.notes.push('Greater Daemon of Slaanesh: re-roll Hit 1s');
  }

  // 2. Shalaxi Helbane: Lord of the Tormentors (+1 to hit against Characters/Monsters/Vehicles)
  if ((A.sources.includes('Shalaxi Helbane') || A.name.includes('Shalaxi Helbane')) && (hasAnyKw(T, 'CHARACTER') || hasAnyKw(T, 'MONSTER') || hasAnyKw(T, 'VEHICLE'))) {
    out.hitMod += 1;
    out.notes.push('Lord of the Tormentors: +1 to hit');
  }

  // 3. Bloodthirster: Lord of Decapitations (Melee [DEVASTATING WOUNDS])
  if ((A.sources.includes('Bloodthirster') || A.name.includes('Bloodthirster')) && mode === 'melee') {
    out.devastating = true;
    out.notes.push('Lord of Decapitations: [DEVASTATING WOUNDS]');
  }

  // 4. Detachment rules:
  // Legion of Excess: Seductive Gambit
  if (det === 'Legion of Excess' && mode === 'melee' && hasAnyKw(A, 'SLAANESH') && A.chargedTurn === s.turn) {
    out.sustained = '1';
    out.notes.push('Seductive Gambit: [SUSTAINED HITS 1]');
  }

  // Scintillating Legion: in Shadow of Chaos ranged weapons improve AP by 1
  if (det === 'Scintillating Legion' && mode === 'ranged' && hasAnyKw(A, 'TZEENTCH')) {
    if (isUnderShadowOfChaos(s, A.owner, A)) {
      out.apBonus += 1;
      out.notes.push('Scintillating Legion: +1 AP in Shadow of Chaos');
    }
  }

  return out;
}

/** Defense modifiers for Chaos Daemons units and targets. */
export function daemonsDefenseModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  mode: 'ranged' | 'melee',
  profile?: WeaponProfileData,
): DaemonsDefenseBonus {
  const out: DaemonsDefenseBonus = {
    hitMod: 0,
    woundMod: 0,
    apWorsen: 0,
    notes: [],
  };

  // 1. Shadow Legion Nurgle: if S > T, -1 to wound
  const det = (s.players[T.owner].detachments ?? [])[0]?.name;
  if (det === 'Shadow Legion' && hasAnyKw(T, 'NURGLE')) {
    const minT = Math.min(...alive(T).map((m) => m.profile.T));
    const sVal = profile?.S ?? 4;
    if (sVal > minT) {
      out.woundMod -= 1;
      out.notes.push('Gloam Rot: -1 to wound');
    }
  }

  // 2. Be'lakor: Shadow Form (enemy attacks from >18" cannot target this model)
  if ((T.sources.includes("Be'lakor") || T.name.includes("Be'lakor") || T.name.includes("Be’lakor")) && mode === 'ranged') {
    const aModel = A.models.find((m) => !m.dead) ?? A.models[0];
    const tModel = T.models.find((m) => !m.dead) ?? T.models[0];
    if (aModel && tModel) {
      const d = dist(aModel, tModel);
      if (d > 18) {
        out.hitMod -= 1;
        out.notes.push("Shadow Form: -1 to hit beyond 18\"");
      }
    }
  }

  return out;
}

/** Triggered when an enemy unit is destroyed by Daemons. */
export function daemonsUnitDestroyed(s: GameState, victim: UnitState, killer?: UnitState): void {
  if (!killer || !isDaemonUnit(killer)) return;

  const det = (s.players[killer.owner].detachments ?? [])[0]?.name;

  // Blood Legion: Blood Tainted
  // If enemy unit was on an objective, that objective becomes Corrupted and stays controlled by Daemons
  if (det === 'Blood Legion' && hasAnyKw(killer, 'KHORNE')) {
    const vModels = victim.models.length ? victim.models : [];
    for (const obj of s.objectives) {
      if (vModels.some((m) => dist(m, obj) <= 3 + 1e-6 || ptGap(m, obj) <= 3 + 1e-6)) {
        obj.controller = killer.owner;
        obj.corrupted = killer.owner;
        obj.secured = killer.owner;
        s.players[killer.owner].corruptedObjectives = [
          ...new Set([...(s.players[killer.owner].corruptedObjectives ?? []), obj.id])
        ];
        log(s, `${obj.id} is now Blood Tainted (Corrupted under Khorne's control)`, 'info', killer.owner);
      }
    }
  }
}
