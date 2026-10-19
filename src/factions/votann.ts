// Leagues of Votann army rule: Prioritised Efficiency & Detachment Rules.
//
// Army Rule mechanics:
// - Yield Points (YP) pool per Votann player:
//   - At the start of the battle: units have Hostile Acquisition (0 YP).
//   - At the end of each player's Command phase:
//     - Gain 1 YP if controlling 1+ objective markers within own deployment zone.
//     - From round 2 onwards, gain 1 additional YP for each of:
//       • Control 1+ objective markers not within own deployment zone.
//       • Control 2+ objective markers not within own deployment zone.
//       • Control more objective markers than opponent.
//     - In own turn, YP gained before evaluating ability stance.
//   - Active stance (evaluated at end of own Command phase):
//     - < 7 YP: Hostile Acquisition
//     - >= 7 YP: Fortify Takeover
//     (Exception: Mercenary Oathband does not auto-switch; can spend 3 YP to switch).
//
// Hostile Acquisition / Fortify Takeover themselves are data (data/detachment-rules.json, conditions hostile /
// fortify), like the detachment rules, abilities and stratagems.

import { alive, boardUnits, log, other, pushFx, unitById } from '../engine/state';
import type { GameState, PlayerId, UnitState } from '../engine/types';
import { zonePoly } from '../engine/missions';
import { pointInPoly, ptGap } from '../engine/geometry';

export function isVotannArmy(s: GameState, p: PlayerId): boolean {
  return !!s.players[p]?.armyRules?.some((r) => r.name === 'Prioritised Efficiency');
}

export function hasVotannFaction(u: UnitState): boolean {
  return u.factionKeywords?.includes('LEAGUES OF VOTANN') || u.keywords?.includes('LEAGUES OF VOTANN');
}

export function getYieldPoints(s: GameState, p: PlayerId): number {
  return s.players[p]?.yieldPoints ?? 0;
}

/** Gain one or more Yield Points (YP) into the player's pool. */
export function gainYieldPoints(s: GameState, p: PlayerId, amount = 1, reason = 'Prioritised Efficiency'): number {
  if (amount <= 0 || !isVotannArmy(s, p)) return 0;
  s.players[p].yieldPoints = (s.players[p].yieldPoints ?? 0) + amount;
  const P = s.players[p];
  P.ypTurn = P.ypTurn?.turn === s.turn ? { ...P.ypTurn, gained: P.ypTurn.gained + amount } : { turn: s.turn, gained: amount, spent: 0 };
  log(s, `[YP] Prioritised Efficiency: ${s.players[p].name} gained ${amount} YP (${reason}) — Total: ${s.players[p].yieldPoints} YP`, 'info', p);
  pushFx(s, { kind: 'skill', unitId: '', owner: p, at: { x: 22, y: 15 }, name: 'Yield Points', who: `+${amount} YP (${s.players[p].yieldPoints} total)`, style: 'tech', epic: false });
  return amount;
}

/** Spend Yield Points if player has enough. Returns true on success, false if insufficient. */
export function spendYieldPoints(s: GameState, p: PlayerId, amount: number, reason = 'Yield Points'): boolean {
  if (!isVotannArmy(s, p) || amount < 0) return false;
  const current = s.players[p].yieldPoints ?? 0;
  if (current < amount) return false;
  s.players[p].yieldPoints = current - amount;
  const P = s.players[p];
  P.ypTurn = P.ypTurn?.turn === s.turn ? { ...P.ypTurn, spent: P.ypTurn.spent + amount } : { turn: s.turn, gained: 0, spent: amount };
  log(s, `[YP] Prioritised Efficiency: ${s.players[p].name} spent ${amount} YP (${reason}) — Remaining: ${s.players[p].yieldPoints} YP`, 'info', p);
  return true;
}

/** Called at start of battle: initial stance is Hostile Acquisition. */
export function votannBattleStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (isVotannArmy(s, p)) {
      s.players[p].yieldPoints = 0;
      s.players[p].votannAbility = 'Hostile Acquisition';
      log(s, `[Prioritised Efficiency] Leagues of Votann active ability: Hostile Acquisition (0 YP)`, 'info', p);
    }
  }
}

/** Called at the end of each player's Command phase. */
export function votannCommandEnd(s: GameState, commandPlayer: PlayerId) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!isVotannArmy(s, p)) continue;
    let gained = 0;
    const z = zonePoly(s, p);

    // 1 YP if you control 1+ objective markers within your deployment zone
    const inDz = s.objectives.filter((o) => o.controller === p && pointInPoly(o, z)).length;
    if (inDz >= 1) gained += 1;

    // From round 2 onwards:
    if (s.round >= 2) {
      const notInDz = s.objectives.filter((o) => o.controller === p && !pointInPoly(o, z)).length;
      if (notInDz >= 1) gained += 1;
      if (notInDz >= 2) gained += 1;

      const myTotal = s.objectives.filter((o) => o.controller === p).length;
      const enemyTotal = s.objectives.filter((o) => o.controller === other(p)).length;
      if (myTotal > enemyTotal) gained += 1;
    }

    // Detachment: Hearthfyre Arsenal (Optimal Application)
    const isHearthfyre = (s.players[p].detachments ?? []).some((d) => d.name.toLowerCase().includes('hearthfyre'));
    if (isHearthfyre && p === commandPlayer) {
      const optObjs = s.objectives.filter((o) => o.controller === p && !pointInPoly(o, z) && boardUnits(s, p).some((u) => alive(u).some((m) => (m.keywords.includes('IRON-MASTER') || m.keywords.includes('MEMNYR STRATEGIST') || u.name.includes('Iron-master') || u.name.includes('Memnyr Strategist')) && ptGap(m, o) <= 3 + 1e-6)));
      const optGained = Math.min(2, optObjs.length);
      if (optGained > 0) gained += optGained;
    }

    if (gained > 0) {
      gainYieldPoints(s, p, gained, 'End of Command phase');
    }

    // Ability stance update (only in own turn)
    if (p === commandPlayer) {
      const isMerc = (s.players[p].detachments ?? []).some((d) => d.name.toLowerCase().includes('mercenary oathband'));
      if (isMerc) {
        // Ruthless Reinvestment: 3YP to switch; Fortify Takeover while the army holds at least half the objectives
        const mine = s.objectives.filter((o) => o.controller === p).length;
        const want = mine * 2 >= s.objectives.length && mine > 0 ? 'Fortify Takeover' : 'Hostile Acquisition';
        if (want !== (s.players[p].votannAbility ?? 'Hostile Acquisition') && spendYieldPoints(s, p, 3, 'Ruthless Reinvestment')) {
          s.players[p].votannAbility = want;
          log(s, `Ruthless Reinvestment: Leagues of Votann units switch to ${want}`, 'info', p);
        }
      } else {
        const currentYp = s.players[p].yieldPoints ?? 0;
        const newStance = currentYp >= 7 ? 'Fortify Takeover' : 'Hostile Acquisition';
        const oldStance = s.players[p].votannAbility ?? 'Hostile Acquisition';
        s.players[p].votannAbility = newStance;
        if (newStance !== oldStance) {
          log(s, `[Prioritised Efficiency] Leagues of Votann units switched to ${newStance} (${currentYp} YP)`, 'info', p);
          pushFx(s, { kind: 'skill', unitId: '', owner: p, at: { x: 22, y: 15 }, name: newStance, who: `Active Stance: ${newStance}`, style: newStance === 'Fortify Takeover' ? 'shield' : 'fury', epic: false });
        }
      }
    }
  }
}

/** Called when a unit is destroyed. Handles Martial Leverage & Mercenary Prospector. */
export function votannUnitDestroyed(s: GameState, destroyedUnit: UnitState, killerId?: string) {
  const opp = other(destroyedUnit.owner);
  if (!isVotannArmy(s, opp)) return;

  // Needgaârd Oathband: Martial Leverage (+1 YP when an enemy unit is destroyed)
  const isNeedgaard = (s.players[opp].detachments ?? []).some((d) => d.name.toLowerCase().includes('needga'));
  if (isNeedgaard) {
    gainYieldPoints(s, opp, 1, 'Martial Leverage');
  }

  // Mercenary Prospector enhancement: killer gains 2 YP
  if (killerId) {
    const killer = unitById(s, killerId);
    if (killer && killer.owner === opp && killer.enhancements.some((e) => e.name.toLowerCase().includes('mercenary prospector'))) {
      gainYieldPoints(s, opp, 2, 'Mercenary Prospector');
    }
  }
}

/** Ûthar the Destined: Ancestral Fortune - spend 1 YP to turn a roll into unmodified 6. */
export function tryUtharAncestralFortune(
  s: GameState,
  u: UnitState,
  rollType: 'hit' | 'wound' | 'save',
  context?: { need?: number; isCharacter?: boolean },
): number | null {
  const hasUthar = u.name.includes('Ûthar') || alive(u).some((m) => m.name.includes('Ûthar'));
  if (!hasUthar) return null;
  if ((s.players[u.owner].yieldPoints ?? 0) < 1) return null;
  if (u.oncePerTurnUsed?.includes('ancestral-fortune')) return null;

  const need = context?.need ?? 4;
  // Bot decision threshold: use on difficult or crucial rolls (e.g. need 4+ on save, or need 5+ on hit/wound)
  const shouldSpend = (rollType === 'save' && need >= 4) || ((rollType === 'hit' || rollType === 'wound') && need >= 5);
  if (!shouldSpend) return null;

  spendYieldPoints(s, u.owner, 1, 'Ancestral Fortune');
  u.oncePerTurnUsed = [...(u.oncePerTurnUsed ?? []), 'ancestral-fortune'];
  log(s, `[Ancestral Fortune] Ûthar the Destined spent 1 YP to change ${rollType} roll to unmodified 6!`, 'roll', u.owner);
  return 6;
}

/** End of a turn: Dead Reckoning (no YP spent this turn: +1YP) and Metaphysical Brokerage (end of your turn: top the
 *  YP gained this turn up to 3). */
export function votannTurnEnd(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!isVotannArmy(s, p)) continue;
    const t = s.players[p].ypTurn?.turn === s.turn ? s.players[p].ypTurn! : { turn: s.turn, gained: 0, spent: 0 };
    const has = (name: string) => boardUnits(s, p).some((u) => u.enhancements?.some((e) => e.name === name));
    if (has('Dead Reckoning') && t.spent === 0) gainYieldPoints(s, p, 1, 'Dead Reckoning');
    if (s.active === p && has('Metaphysical Brokerage') && t.gained < 3) gainYieldPoints(s, p, 3 - t.gained, 'Metaphysical Brokerage');
  }
}
