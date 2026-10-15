// Genestealer Cults: Cult Ambush, Resurgence Points, Cult Icon, and Detachment mechanics.
import { alive, boardUnits, log, other } from './state';
import { dist, ptGap } from './geometry';
import { rollExpr } from './dice';
import type { GameState, PlayerId, Pt, UnitState, WeaponProfileData } from './types';

export function hasAnyKw(u: UnitState, kw: string): boolean {
  const target = kw.toUpperCase();
  return (u.keywords ?? []).some((k) => k.toUpperCase() === target) ||
         (u.factionKeywords ?? []).some((k) => k.toUpperCase() === target);
}

export function isCultUnit(u: UnitState): boolean {
  return hasAnyKw(u, 'GENESTEALER CULTS');
}

export function isCultArmy(s: GameState, p: PlayerId): boolean {
  return s.players[p]?.factionId === 'GC' || (s.players[p]?.detachments ?? []).some((d) => [
    'Host of Ascension', 'Xenocreed Congregation', 'Biosanctic Broodsurge',
    'Outlander Claw', 'Brood Brother Auxilia', 'Final Day', 'Heroes of the Uprising',
    'Purestrain Broodswarm', 'Xenocult Masses'
  ].includes(d.name));
}

/** Resurgence points cost to return a destroyed unit to Cult Ambush. */
export function cultAmbushCost(u: UnitState): number {
  const name = u.sources[0] ?? u.name;
  const count = u.startingStrength;

  if (name.includes('Aberrant')) return count >= 10 ? 8 : 4;
  if (name.includes('Acolyte Hybrid') || name.includes('Hybrid Metamorph')) return count >= 10 ? 4 : 2;
  if (name.includes('Atalan Jackal')) return count >= 10 ? 6 : 2;
  if (name.includes('Neophyte Hybrid')) return count >= 20 ? 6 : 3;
  if (name.includes('Purestrain Genestealer')) return count >= 10 ? 6 : 2;

  return Math.max(1, Math.round(count / 3));
}

/** Initialize Resurgence points at start of battle. */
export function cultBattleStart(s: GameState): void {
  for (let p = 0 as PlayerId; p < 2; p++) {
    const pl = s.players[p];
    if (isCultArmy(s, p)) {
      if (pl.resurgencePoints === undefined) {
        // Incursion: 6, Strike Force: 10, Onslaught: 14
        const maxPts = s.objectives.length <= 4 ? 6 : s.objectives.length <= 5 ? 10 : 14;
        pl.resurgencePoints = maxPts;
        pl.cultAmbushMarkers = [];
        log(s, `${pl.name} starts with ${maxPts} Resurgence points (Cult Ambush)`, 'info', p);
      }
    }
  }
}

/** When a Genestealer Cults unit is destroyed. */
export function cultAmbushUnitDestroyed(s: GameState, u: UnitState): void {
  if (!isCultUnit(u) || hasAnyKw(u, 'CHARACTER') || !hasAnyKw(u, 'CULT AMBUSH')) return;

  const p = u.owner;
  const pl = s.players[p];
  const cost = cultAmbushCost(u);

  if ((pl.resurgencePoints ?? 0) >= cost) {
    pl.resurgencePoints = (pl.resurgencePoints ?? 0) - cost;
    log(s, `${u.name} destroyed: spent ${cost} Resurgence points (${pl.resurgencePoints} left) -> returned to Cult Ambush`, 'info', p);

    // Revive unit into Strategic Reserves / Cult Ambush
    u.status = 'reserves';
    for (const m of u.models) {
      m.dead = false;
      m.wounds = m.profile.W;
    }

    // Place Cult Ambush marker >9" from all enemies
    const enemies = boardUnits(s, other(p));
    const findMarkerSpot = (): Pt => {
      for (const obj of s.objectives) {
        if (!enemies.some((e) => alive(e).some((m) => dist(m, obj) <= 9 + 1e-6))) {
          return { x: obj.x, y: obj.y };
        }
      }
      return { x: 22, y: 30 };
    };

    const spot = findMarkerSpot();
    pl.cultAmbushMarkers = [...(pl.cultAmbushMarkers ?? []), spot];
    log(s, `Placed Cult Ambush marker at (${spot.x.toFixed(0)}, ${spot.y.toFixed(0)})`, 'info', p);

    // Xenocult Masses detachment: place 1 extra marker within 6"
    const isMasses = (pl.detachments ?? []).some((d) => d.name === 'Xenocult Masses');
    if (isMasses) {
      const extraSpot = { x: Math.max(2, Math.min(42, spot.x + 3)), y: Math.max(2, Math.min(58, spot.y + 3)) };
      pl.cultAmbushMarkers.push(extraSpot);
      log(s, `Hordes of the Faithful: placed extra Cult Ambush marker at (${extraSpot.x.toFixed(0)}, ${extraSpot.y.toFixed(0)})`, 'info', p);
    }
  }
}

/** Check if enemy models end any move within 8" of Cult Ambush markers (and remove them). */
export function cultAmbushCheckEnemyMoved(s: GameState, mover: UnitState): void {
  const opp = other(mover.owner);
  const pl = s.players[opp];
  if (!pl?.cultAmbushMarkers?.length) return;

  const remaining: Pt[] = [];
  for (const marker of pl.cultAmbushMarkers) {
    const steppedOn = alive(mover).some((m) => dist(m, marker) <= 8 + 1e-6);
    if (steppedOn) {
      log(s, `${mover.name} moved within 8" of a Cult Ambush marker -> marker removed!`, 'info', opp);
    } else {
      remaining.push(marker);
    }
  }
  pl.cultAmbushMarkers = remaining;
}

/** End of opponent's Movement phase: units arrive from Cult Ambush at markers. */
export function cultAmbushArrival(s: GameState): void {
  const cultPlayer = other(s.active);
  if (!isCultArmy(s, cultPlayer)) return;

  const pl = s.players[cultPlayer];
  const markers = pl.cultAmbushMarkers ?? [];
  if (!markers.length) return;

  const waitingUnits = s.units.filter((u) => u.owner === cultPlayer && u.status === 'reserves' && isCultUnit(u));
  if (!waitingUnits.length) return;

  const marker = markers[0];
  const unit = waitingUnits[0];

  unit.status = 'board';
  unit.setUpTurn = s.turn;
  for (let i = 0; i < unit.models.length; i++) {
    const angle = (i * 2 * Math.PI) / Math.max(1, unit.models.length);
    const r = i === 0 ? 0 : 1.5;
    unit.models[i].x = marker.x + Math.cos(angle) * r;
    unit.models[i].y = marker.y + Math.sin(angle) * r;
    unit.models[i].dead = false;
    unit.models[i].wounds = unit.models[i].profile.W;
  }

  log(s, `${unit.name} emerges from Cult Ambush at (${marker.x.toFixed(0)}, ${marker.y.toFixed(0)})!`, 'info', cultPlayer);
  pl.cultAmbushMarkers = markers.slice(1);
}

/** Cult Icon recovery at start of Command phase. */
export function cultIconCommandPhase(s: GameState, p: PlayerId): void {
  if (!isCultArmy(s, p)) return;

  for (const u of boardUnits(s, p)) {
    if (!u.abilities.some((a) => a.name === 'Cult Icon') && !hasAnyKw(u, 'CULT ICON')) continue;

    const dead = u.models.filter((m) => m.dead);
    if (!dead.length) continue;

    // If on controlled objective, restore D3; otherwise 1
    const onOwnObjective = s.objectives.some((o) => o.controller === p && alive(u).some((m) => ptGap(m, o) <= 3 + 1e-6));
    const roll = onOwnObjective ? rollExpr(s, 'D3').total : 1;
    const revived = dead.slice(0, roll);
    for (const m of revived) {
      m.dead = false;
      m.wounds = m.profile.W;
    }
    log(s, `Cult Icon: returned ${revived.length} model(s) to ${u.name}`, 'info', p);
  }
}

export interface CultAttackBonus {
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
  notes: string[];
}

export interface CultDefenseBonus {
  hitMod: number;
  woundMod: number;
  apWorsen: number;
  notes: string[];
}

/** Attack modifiers for Genestealer Cults. */
export function cultAttackModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  distance: number,
  mode: 'ranged' | 'melee',
  profile?: WeaponProfileData,
  weaponName?: string,
): CultAttackBonus {
  const out: CultAttackBonus = {
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
    notes: [],
  };

  if (!isCultUnit(A)) return out;

  const det = (s.players[A.owner].detachments ?? [])[0]?.name;

  // 1. Host of Ascension: A Perfect Ambush (arrived from Reserves/Cult Ambush this turn)
  if (det === 'Host of Ascension' && A.setUpTurn === s.turn) {
    if (mode === 'ranged') {
      out.sustained = '1';
      out.notes.push('A Perfect Ambush: [SUSTAINED HITS 1]');
    } else if (mode === 'melee') {
      out.critHitThreshold = 5;
      out.notes.push('A Perfect Ambush: Critical Hits on 5+');
    }
  }

  // 2. Biosanctic Broodsurge: Hypermorphic Fury
  if (det === 'Biosanctic Broodsurge') {
    if (mode === 'melee' && (hasAnyKw(A, 'ABERRANT') || hasAnyKw(A, 'GENESTEALER') || hasAnyKw(A, 'ABOMINANT'))) {
      out.attacksBonus += 1;
      out.notes.push('Hypermorphic Fury: +1 Attack');

      // Within 6" of Patriarch or Biophagus: +1 to Wound
      const nearLeader = boardUnits(s, A.owner).some((u) => (hasAnyKw(u, 'PATRIARCH') || hasAnyKw(u, 'BIOPHAGUS')) && alive(u).some((m) => alive(A).some((am) => dist(m, am) <= 6 + 1e-6)));
      if (nearLeader) {
        out.woundMod += 1;
        out.notes.push('Hypermorphic Fury: +1 to Wound (near Patriarch/Biophagus)');
      }
    }
  }

  // 3. Heroes of the Uprising: Killer Reputation
  if (det === 'Heroes of the Uprising' && mode === 'melee' && hasAnyKw(A, 'CHARACTER')) {
    out.attacksBonus += 1;
    out.notes.push('Killer Reputation: +1 Attack');
  }

  // 4. Outlander Claw: Rapid Takeover (Vehicle/Mounted re-roll wound 1s)
  if (det === 'Outlander Claw' && (hasAnyKw(A, 'VEHICLE') || hasAnyKw(A, 'MOUNTED'))) {
    out.rerollWounds1 = true;
    out.notes.push('Rapid Takeover: re-roll Wound 1s');
  }

  // 5. Xenocult Masses: Neophyte Hybrids +1 to hit on objectives
  if (det === 'Xenocult Masses' && A.name.includes('Neophyte Hybrid')) {
    const onObjective = s.objectives.some((o) => alive(A).some((m) => ptGap(m, o) <= 3 + 1e-6));
    if (onObjective) {
      out.hitMod += 1;
      out.notes.push('Hordes of the Faithful: +1 to Hit on objective');
    }
  }

  return out;
}

/** Defense modifiers for Genestealer Cults. */
export function cultDefenseModifiers(
  s: GameState,
  A: UnitState,
  T: UnitState,
  mode: 'ranged' | 'melee',
  profile?: WeaponProfileData,
): CultDefenseBonus {
  const out: CultDefenseBonus = {
    hitMod: 0,
    woundMod: 0,
    apWorsen: 0,
    notes: [],
  };

  // Purestrain Broodswarm: Stealth on Purestrain Genestealers
  if (T.name.includes('Purestrain Genestealer') && mode === 'ranged') {
    const det = (s.players[T.owner].detachments ?? [])[0]?.name;
    if (det === 'Purestrain Broodswarm') {
      out.hitMod -= 1;
      out.notes.push('Enemy Within: -1 to Hit (Stealth)');
    }
  }

  return out;
}

