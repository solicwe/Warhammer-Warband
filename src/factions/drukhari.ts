// Drukhari army rule Power from Pain, and the detachment rules that keep state (Faction Pack v1.2).
//
// Pain tokens: 1 at the start of your Command phase, 1 each time an enemy unit is destroyed, 1 each time an enemy
// unit fails a Battle-shock test. Each Pain ability says when you can spend 1 token to Empower its unit until the end
// of the phase: those are `act` buttons in data/abilities/DRU.json (condition `painReady`, action `dru: "empower"`)
// and the abilities' effects check `painEmpowered`.
import { d6 } from '../engine/dice';
import { alive, boardUnits, hasKw, log, other, unitDistance } from '../engine/state';
import type { CombatMods } from '../engine/combatMods';
import type { GameState, PlayerId, UnitState } from '../engine/types';

export function isDrukhariArmy(s: GameState, p: PlayerId): boolean {
  return !!s.players[p]?.armyRules?.some((r) => r.name === 'Power from Pain');
}

export const hasDrukhariFaction = (u: UnitState) => u.factionKeywords?.includes('DRUKHARI') || u.keywords?.includes('DRUKHARI');
const hasDet = (s: GameState, p: PlayerId, n: string) => !!s.players[p].detachments?.some((d) => d.name === n);
const hasEnh = (u: UnitState, n: string) => !!u.enhancements?.some((e) => e.name === n);

/** Empowered this phase (Dark Vitality: always). An attached unit is one unit here, so its leader and bodyguard share it. */
export function isUnitEmpowered(s: GameState, u: UnitState): boolean {
  return hasEnh(u, 'Dark Vitality') || !!s.players[u.owner]?.empoweredUnits?.includes(u.id);
}

export function gainPainToken(s: GameState, p: PlayerId, count = 1, reason?: string) {
  if (!isDrukhariArmy(s, p) || count <= 0) return;
  s.players[p].painTokens = (s.players[p].painTokens ?? 0) + count;
  log(s, `Power from Pain: ${s.players[p].name} gains ${count} Pain token${count > 1 ? 's' : ''}${reason ? ` (${reason})` : ''} — ${s.players[p].painTokens} in the pool`, 'info', p);
}

export function spendPainToken(s: GameState, p: PlayerId, count = 1, reason?: string): boolean {
  const have = s.players[p].painTokens ?? 0;
  if (have < count) return false;
  s.players[p].painTokens = have - count;
  log(s, `Power from Pain: ${s.players[p].name} spends ${count} Pain token${count > 1 ? 's' : ''}${reason ? ` (${reason})` : ''} — ${s.players[p].painTokens} left`, 'info', p);
  return true;
}

/** Spend 1 Pain token to Empower a unit until the end of the phase; Pain Engine (Cronos within 9"): 5+ gets it back. */
export function empowerUnit(s: GameState, u: UnitState): boolean {
  if (isUnitEmpowered(s, u)) return true;
  if (!spendPainToken(s, u.owner, 1, `Empowering ${u.name}`)) return false;
  (s.players[u.owner].empoweredUnits ??= []).push(u.id);
  const cronos = boardUnits(s, u.owner).find((c) => c.abilities.some((a) => a.name === 'Pain Engine (Aura)') && unitDistance(c, u) <= 9 + 1e-6);
  if (cronos) {
    const plus = alive(cronos).some((m) => !m.weapons.some((w) => /spirit vortex/i.test(w.name))) ? 1 : 0;
    const r = d6(s);
    if (r + plus >= 5) gainPainToken(s, u.owner, 1, `Pain Engine rolled ${r}${plus ? '+1' : ''}`);
  }
  return true;
}

/** Reaper's Wager: this unit's side is losing the wager. */
export const losingWager = (s: GameState, u: UnitState) => hasDet(s, u.owner, "Reaper’s Wager") && (s.players[u.owner].drukhariWagerWinning ?? 'Drukhari') !== (hasKw(u, 'HARLEQUINS') ? 'Harlequins' : 'Drukhari');

export const painReady = (s: GameState, u: UnitState) => !isUnitEmpowered(s, u) && (s.players[u.owner].painTokens ?? 0) >= 1;

// ---------- battle start, Command phase, phase end ----------

/** Alliance of Agony (Realspace Raiders): 2 Pain tokens per character / unit pair; Reaper's Wager: Drukhari start winning. */
export function drukhariBattleStart(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) {
    if (!isDrukhariArmy(s, p)) continue;
    s.players[p].painTokens ??= 0;
    if (hasDet(s, p, 'Realspace Raiders')) {
      const mine = s.units.filter((u) => u.owner === p);
      const has = (k: string) => mine.some((u) => u.models.some((m) => m.keywords.includes(k) || m.source === k) || u.sources.includes(k));
      const pairs = [['ARCHON', 'Kabalite Warriors'], ['SUCCUBUS', 'Wyches'], ['HAEMONCULUS', 'Wracks']].filter(([c, b]) => has(c) && has(b)).length;
      gainPainToken(s, p, pairs * 2, 'Alliance of Agony');
    }
    if (hasDet(s, p, "Reaper’s Wager")) s.players[p].drukhariWagerWinning = 'Drukhari';
  }
}

/** Murderous Agenda (Kabalite Cartel): the Contract and its unit, picked at the start of the first battle round. */
export function pickContract(s: GameState, p: PlayerId) {
  const P = s.players[p];
  if (!hasDet(s, p, 'Kabalite Cartel') || P.contract) return;
  const foes = s.units.filter((u) => u.owner === other(p) && u.status !== 'destroyed' && alive(u).length);
  const best = (f: (u: UnitState) => boolean) => foes.filter(f).sort((a, b) => b.pts - a.pts)[0];
  const ch = best((u) => hasKw(u, 'CHARACTER'));
  const mv = best((u) => hasKw(u, 'MONSTER') || hasKw(u, 'VEHICLE'));
  const inf = best((u) => (hasKw(u, 'INFANTRY') || hasKw(u, 'MOUNTED')) && alive(u).some((m) => !m.isCharacter));
  const pick = mv && (!ch || mv.pts > ch.pts) ? { kind: 'strength' as const, u: mv } : ch ? { kind: 'trophy' as const, u: ch } : inf ? { kind: 'fear' as const, u: inf } : mv ? { kind: 'strength' as const, u: mv } : null;
  if (!pick) return;
  P.contract = { kind: pick.kind, unitId: pick.u.id };
  const name = { trophy: 'Trophy Hunters', fear: 'Sow Fear and Terror', strength: 'Show of Strength' }[pick.kind];
  log(s, `Murderous Agenda: ${name} — the Contract unit is ${pick.u.name}`, 'info', p);
}

export function drukhariCommandStart(s: GameState, p: PlayerId) {
  if (!isDrukhariArmy(s, p)) return;
  gainPainToken(s, p, 1, 'Command phase');
  const P = s.players[p];
  const c = P.contract;
  if (c && !c.done) {
    const u = s.units.find((x) => x.id === c.unitId);
    const done = !u || u.status === 'destroyed' || !alive(u).length || (c.kind === 'fear' && !alive(u).some((m) => !m.isCharacter));
    if (done) { c.done = true; log(s, 'Murderous Agenda: the Contract is completed', 'info', p); gainPainToken(s, p, 3, 'Contract completed'); }
  }
}

export function drukhariPhaseEnd(s: GameState) {
  for (const p of [0, 1] as PlayerId[]) if (s.players[p]?.empoweredUnits?.length) s.players[p].empoweredUnits = [];
}

/** An enemy unit destroyed: 1 Pain token (Torture Device: 1 more); Reaper's Wager changes hands. A friendly unit
 *  destroyed near a Master Repugnomancer: 4+ for a token. */
export function drukhariUnitDestroyed(s: GameState, dead: UnitState, killer?: UnitState) {
  const p = other(dead.owner);
  if (isDrukhariArmy(s, p)) {
    gainPainToken(s, p, 1, `${dead.name} destroyed`);
    if (killer?.owner === p && killer.abilities.some((a) => a.name === 'Torture Device')) gainPainToken(s, p, 1, 'Torture Device');
    if (killer?.owner === p && hasEnh(killer, 'Spiteful Raider') && s.phase === 'fight' && s.objectives.some((o) => dead.models.some((m) => Math.hypot(m.x - o.x, m.y - o.y) - m.r <= 3 + 1e-6))) gainPainToken(s, p, 1, 'Spiteful Raider');
    if (killer?.owner === p && hasDet(s, p, "Reaper’s Wager")) {
      const side = hasKw(killer, 'HARLEQUINS') ? 'Harlequins' : hasDrukhariFaction(killer) ? 'Drukhari' : null;
      if (side && s.players[p].drukhariWagerWinning !== side) { s.players[p].drukhariWagerWinning = side; log(s, `Callous Competition: ${side} units are winning the wager`, 'info', p); }
    }
  }
  repugnomancer(s, dead);
}

export function drukhariBattleShockFailed(s: GameState, u: UnitState) {
  if (isDrukhariArmy(s, other(u.owner))) gainPainToken(s, other(u.owner), 1, `${u.name} failed a Battle-shock test`);
  repugnomancer(s, u);
}

/** Master Repugnomancer (Aura): a friendly DRUKHARI unit within 9" fails a Battle-shock test or is destroyed: 4+ for a token. */
function repugnomancer(s: GameState, u: UnitState) {
  if (!isDrukhariArmy(s, u.owner) || !hasDrukhariFaction(u)) return;
  const h = boardUnits(s, u.owner).find((x) => hasEnh(x, 'Master Repugnomancer') && (x.id === u.id || x.models.some((m) => !m.dead && u.models.some((n) => Math.hypot(m.x - n.x, m.y - n.y) - m.r - n.r <= 9))));
  if (!h) return;
  const r = d6(s);
  if (r >= 4) gainPainToken(s, u.owner, 1, `Master Repugnomancer rolled ${r}`);
}

// ---------- attacks ----------

/** Callous Competition (Reaper's Wager) and the Kabalite Cartel Contract abilities. */
export function drukhariAttackMods(s: GameState, A: UnitState, T: UnitState): CombatMods | null {
  const P = s.players[A.owner];
  const out: CombatMods = { notes: [] };
  if (hasDet(s, A.owner, "Reaper’s Wager") && (hasDrukhariFaction(A) || hasKw(A, 'HARLEQUINS'))) {
    const side = hasKw(A, 'HARLEQUINS') ? 'Harlequins' : 'Drukhari';
    out.rerollHits1 = true;
    if ((P.drukhariWagerWinning ?? 'Drukhari') !== side) { out.rerollWounds1 = true; out.notes!.push('Losing the wager: re-roll Hit and Wound rolls of 1'); } else out.notes!.push('Winning the wager: re-roll Hit rolls of 1');
  }
  const c = P.contract;
  if (c && !c.done && (hasKw(A, 'KABAL') || hasKw(A, 'BLADES FOR HIRE'))) {
    if (c.kind === 'trophy' && T.id === c.unitId) { out.precision = true; out.notes!.push('Trophy Hunters: [PRECISION]'); }
    if (c.kind === 'fear' && (hasKw(T, 'INFANTRY') || hasKw(T, 'MOUNTED'))) { out.sustained = '1'; out.notes!.push('Sow Fear and Terror: [SUSTAINED HITS 1]'); }
    if (c.kind === 'strength' && (hasKw(T, 'MONSTER') || hasKw(T, 'VEHICLE'))) { out.lethal = true; out.notes!.push('Show of Strength: [LETHAL HITS]'); }
  }
  return out.notes!.length ? out : null;
}

// ---------- Combat Drugs (Spectacle of Spite) ----------

/** A drug selected (not rolled) can't be selected again this battle. */
export function drugBlocked(s: GameState, p: PlayerId, rule: string, id: string, random: boolean): string | null {
  if (rule !== 'Spectacle of Spite' || random) return null;
  return s.players[p].drugsSelected?.includes(id) ? 'Already selected this battle' : null;
}

export function drugPicked(s: GameState, p: PlayerId, rule: string, ids: string[], randomly: boolean) {
  if (rule !== 'Spectacle of Spite' || randomly) return;
  s.players[p].drugsSelected = [...(s.players[p].drugsSelected ?? []), ...ids];
}

// ---------- Pain actions ----------

/** `dru` actions: "empower" (spend 1 token on the unit), "spend" / "gain" (1 token), "wager" (Conductor of Torment), "spendCp" (Labyrinthine Cunning). */
export function drukhariAction(s: GameState, what: string, u: UnitState, label: string) {
  if (what === 'empower') empowerUnit(s, u);
  if (what === 'gain') gainPainToken(s, u.owner, 1, label);
  if (what === 'spend') spendPainToken(s, u.owner, 1, label);
  if (what === 'newContract') { const P = s.players[u.owner]; P.contract = undefined; pickContract(s, u.owner); }
  if (what === 'spendCp' && spendPainToken(s, u.owner, 1, label)) { s.players[u.owner].cp += 1; log(s, `${label}: +1CP`, 'cp', u.owner); }
  if (what === 'wager') {
    const P = s.players[u.owner];
    if ((P.drukhariWagerWinning ?? 'Drukhari') === 'Drukhari') {
      if (spendPainToken(s, u.owner, 1, label)) P.drukhariWagerWinning = 'Harlequins';
    } else { gainPainToken(s, u.owner, 1, label); P.drukhariWagerWinning = 'Drukhari'; }
    log(s, `${label}: ${P.drukhariWagerWinning} units are winning the wager`, 'info', u.owner);
  }
}
