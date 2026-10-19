// Chaos Daemons army rule The Shadow of Chaos (Daemonic Manifestation, Daemonic Terror), Warp Rifts (Daemonic Incursion),
// Fates in Flux tokens (Scintillating Legion), Melancholic Miasma (Plague Legion), Blood Tainted (Blood Legion) and
// Corrupt Realspace. Datasheet abilities, the other detachment rules and stratagems are data.
import { alive, boardUnits, hasKw, log, other } from '../engine/state';
import { dist, pointInPoly } from '../engine/geometry';
import { zonePoly } from '../engine/missions';
import { d6, rollExpr } from '../engine/dice';
import { applyMortalWounds } from '../engine/attack';
import type { GameState, PlayerId, Pt, UnitState } from '../engine/types';
import type { RollContext, RollStage } from '../engine/events';

export const GREATER_DAEMONS = ['Bloodthirster', 'Great Unclean One', 'Kairos Fateweaver', 'Keeper of Secrets', 'Keeper Of Secrets', 'Lord of Change', 'Rotigus', 'Shalaxi Helbane', 'Skarbrand'];

export const isDaemonUnit = (u: UnitState) => u.factionKeywords.includes('LEGIONES DAEMONICA');
export const isDaemonsArmy = (s: GameState, p: PlayerId) => !!s.players[p]?.armyRules?.some((r) => r.name === 'The Shadow of Chaos');
const hasDet = (s: GameState, p: PlayerId, name: string) => (s.players[p].detachments ?? []).some((d) => d.name === name);

export function godOf(u: UnitState): 'KHORNE' | 'TZEENTCH' | 'NURGLE' | 'SLAANESH' | undefined {
  return (['KHORNE', 'TZEENTCH', 'NURGLE', 'SLAANESH'] as const).find((g) => hasKw(u, g));
}

/** Is this point / unit (any of its models) within the player's Shadow of Chaos? */
export function isUnderShadowOfChaos(s: GameState, p: PlayerId, target: Pt | UnitState): boolean {
  if (!isDaemonsArmy(s, p)) return false;
  const pts: Pt[] = 'models' in target ? alive(target) : [target];
  if (!pts.length) return false;
  const own = zonePoly(s, p), opp = zonePoly(s, other(p));
  const nml = (q: Pt) => !pointInPoly(q, own) && !pointInPoly(q, opp);
  const half = (inZone: (o: Pt) => boolean) => { const os = s.objectives.filter(inZone); return os.length > 0 && os.filter((o) => o.controller === p).length * 2 >= os.length; };
  const nmlOk = half(nml), oppOk = half((o) => pointInPoly(o, opp));
  const plague = hasDet(s, p, 'Plague Legion') && 'models' in target && target.owner !== p;
  const own6 = (names: string[]) => boardUnits(s, p).filter((u) => u.abilities.some((a) => names.includes(a.name))).flatMap(alive);
  // The Dark Master (Be'lakor) / Shadow of Khorne (Skull Altar): the area within 6"
  const areas = own6(['The Dark Master (Aura)', 'Shadow of Khorne (Aura)']);
  // Greater Daemon of <God> (Aura): friendly units of that god within 6"
  const god = 'models' in target && target.owner === p ? godOf(target) : undefined;
  const greater = god ? own6([`Greater Daemon of ${god[0]}${god.slice(1).toLowerCase()} (Aura)`]) : [];
  return pts.some((q) => pointInPoly(q, own)
    || areas.some((m) => dist(q, m) - m.r <= 6 + 1e-6) || greater.some((m) => dist(q, m) - m.r <= 6 + 1e-6)
    // Corrupt Realspace: 6" around a Corrupted objective marker still under your control
    || s.objectives.some((o) => o.corrupted === p && o.controller === p && dist(q, o) <= 6 + 1e-6)
    || (nmlOk && nml(q)) || (oppOk && pointInPoly(q, opp))
    // Melancholic Miasma: enemy units within 9" of LEGIONES DAEMONICA NURGLE units
    || (plague && boardUnits(s, p).some((u) => isDaemonUnit(u) && hasKw(u, 'NURGLE') && alive(u).some((m) => dist(q, m) - m.r <= 9 + 1e-6))));
}

/** Within 6" of one of the player's Greater Daemons (sharing this god keyword when given). */
export function isNearGreaterDaemon(s: GameState, p: PlayerId, target: Pt | UnitState, god?: string): boolean {
  const pts: Pt[] = 'models' in target ? alive(target) : [target];
  return boardUnits(s, p).some((u) => GREATER_DAEMONS.some((g) => u.sources.includes(g) || u.name.includes(g)) && (!god || hasKw(u, god))
    && alive(u).some((m) => pts.some((q) => dist(q, m) - m.r <= 6 + 1e-6)));
}

/** Daemonic Manifestation (+1) / Daemonic Terror (-1) on a Battle-shock test. */
export function daemonBattleShockMod(s: GameState, u: UnitState): number {
  if (isDaemonUnit(u)) return isUnderShadowOfChaos(s, u.owner, u) ? 1 : 0;
  const opp = other(u.owner);
  return isDaemonsArmy(s, opp) && (isUnderShadowOfChaos(s, opp, u) || isNearGreaterDaemon(s, opp, u)) ? -1 : 0;
}

/** After a Battle-shock test: Daemonic Manifestation heals / returns models, Daemonic Terror inflicts D3 mortal wounds. */
export function daemonsOnBattleShockResult(s: GameState, u: UnitState, passed: boolean): void {
  if (isDaemonUnit(u)) {
    if (!passed || !isUnderShadowOfChaos(s, u.owner, u)) return;
    const n = rollExpr(s, 'D3').total;
    if (hasKw(u, 'BATTLELINE')) {
      const back = u.models.filter((m) => m.dead && !m.isCharacter).slice(0, n);
      for (const m of back) { m.dead = false; m.wounds = m.profile.W; }
      if (back.length) log(s, `Daemonic Manifestation: ${back.length} model${back.length > 1 ? 's return' : ' returns'} to ${u.name}`, 'info', u.owner);
    } else {
      const m = alive(u).find((x) => x.wounds < x.profile.W);
      if (m) { const h = Math.min(m.profile.W - m.wounds, n); m.wounds += h; log(s, `Daemonic Manifestation: ${u.name} heals ${h} wound${h > 1 ? 's' : ''}`, 'info', u.owner); }
    }
    return;
  }
  const opp = other(u.owner);
  if (!passed && isDaemonsArmy(s, opp) && (isUnderShadowOfChaos(s, opp, u) || isNearGreaterDaemon(s, opp, u))) {
    applyMortalWounds(s, u, rollExpr(s, 'D3').total, 'Daemonic Terror');
  }
}

/** Warp Rifts (Daemonic Incursion): Deep Strike more than 6" away instead of 8" in the Shadow or near a matching Greater Daemon. */
export function daemonsDeepStrikeDist(s: GameState, u: UnitState, pt: Pt): number {
  if (!isDaemonUnit(u) || !hasDet(s, u.owner, 'Daemonic Incursion')) return 9;
  const god = godOf(u);
  return isUnderShadowOfChaos(s, u.owner, pt) || (god && isNearGreaterDaemon(s, u.owner, pt, god)) ? 6 : 9;
}

/** Fates in Flux: three tokens at the start of the battle. */
export function daemonsBattleStart(s: GameState): void {
  for (const p of [0, 1] as PlayerId[]) {
    const P = s.players[p];
    if (hasDet(s, p, 'Scintillating Legion') && P.fluxTokens === undefined) {
      P.fluxTokens = 3;
      if (s.players[other(p)].fluxTokens === undefined) s.players[other(p)].fluxTokens = 0;
      log(s, `Fates in Flux: ${P.name} starts with 3 Flux tokens`, 'info', p);
    }
  }
}

/** Spend a Flux token: it goes to the opponent. */
export function spendFluxToken(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (!P.fluxTokens) return false;
  P.fluxTokens--;
  s.players[other(p)].fluxTokens = (s.players[other(p)].fluxTokens ?? 0) + 1;
  log(s, `${P.name} spends a Flux token to re-roll (${P.fluxTokens} left)`, 'info', p);
  return true;
}

/** A Flux token re-rolls a failed roll: the Scintillating Legion player for LEGIONES DAEMONICA TZEENTCH units
 *  (Advance, Hit, Wound, Damage, save); the opponent for any of their units (Advance, Hit, Wound, save).
 *  Hit / Wound / Advance once per phase; saves against 2+ Damage or for a CHARACTER. */
export function tryFlux(s: GameState, u: UnitState, stage: RollStage, x?: RollContext): number | null {
  const P = s.players[u.owner];
  if (!P.fluxTokens || stage === 'charge' || stage === 'shock') return null;
  const mine = hasDet(s, u.owner, 'Scintillating Legion');
  if (mine ? !(isDaemonUnit(u) && hasKw(u, 'TZEENTCH')) : stage === 'damage') return null;
  if (stage === 'save' && (x?.damage ?? 1) < 2 && !x?.isCharacter) return null;
  const key = `${s.turn}:${s.phase}:${stage}`;
  if (stage !== 'save' && P.fluxUsed === key) return null;
  P.fluxUsed = key;
  spendFluxToken(s, u.owner);
  return d6(s);
}

/** Start of each Command phase: Fates in Flux (+1 token when the opponent holds any) and Melancholic Miasma
 *  (one enemy unit in the Shadow of Chaos takes a Battle-shock test). */
export function daemonsCommandStart(s: GameState): void {
  for (const p of [0, 1] as PlayerId[]) {
    if (hasDet(s, p, 'Scintillating Legion') && s.active === p && (s.players[other(p)].fluxTokens ?? 0) > 0) {
      // Inescapable Eye: one more
      const n = 1 + (boardUnits(s, p).some((u) => u.enhancements?.some((e) => e.name === 'Inescapable Eye')) ? 1 : 0);
      s.players[p].fluxTokens = (s.players[p].fluxTokens ?? 0) + n;
      log(s, `Fates in Flux: ${s.players[p].name} gains ${n} Flux token${n > 1 ? 's' : ''}`, 'info', p);
    }
    if (!hasDet(s, p, 'Plague Legion')) continue;
    const t = boardUnits(s, other(p)).filter((u) => isUnderShadowOfChaos(s, p, u) && !u.battleShocked && !s.shockTests.some((x) => x.unitId === u.id))
      .sort((a, b) => b.pts - a.pts)[0];
    if (!t) continue;
    log(s, `Melancholic Miasma: ${t.name} must take a Battle-shock test`, 'info', p);
    s.shockTests.push({ unitId: t.id, mod: 0, passed: null, result: null });
  }
}

/** Blood Tainted: a LEGIONES DAEMONICA KHORNE unit destroys an enemy unit within range of an objective marker it also
 *  holds: that objective stays yours until the opponent's Level of Control is greater. */
export function daemonsUnitDestroyed(s: GameState, victim: UnitState, killer?: UnitState): void {
  if (!killer || !isDaemonUnit(killer) || !hasKw(killer, 'KHORNE') || !hasDet(s, killer.owner, 'Blood Legion')) return;
  const inRange = (u: UnitState, o: Pt) => u.models.some((m) => dist(m, o) - m.r <= 3 + 1e-6);
  for (const o of s.objectives) {
    if (!inRange(victim, o) || !alive(killer).some((m) => dist(m, o) - m.r <= 3 + 1e-6)) continue;
    o.secured = killer.owner;
    log(s, `Blood Tainted: objective ${o.id} stays under ${s.players[killer.owner].name}'s control`, 'info', killer.owner);
  }
}

/** Corrupt Realspace: the objective marker the unit is on becomes Corrupted (held, and 6" of Shadow of Chaos around it). */
export function corruptRealspace(s: GameState, u: UnitState) {
  const o = s.objectives.find((x) => x.controller === u.owner && alive(u).some((m) => dist(m, x) - m.r <= 3 + 1e-6));
  if (!o) return;
  o.corrupted = u.owner;
  o.secured = u.owner;
  log(s, `Corrupt Realspace: objective ${o.id} is Corrupted`, 'info', u.owner);
}
