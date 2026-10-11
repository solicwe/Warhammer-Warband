// Dark Pacts (Heretic Astartes army rule): each time a unit with the ability is selected to shoot or fight it can make
// a Dark Pact — a Leadership test first (failed: D3 mortal wounds), then its weapons gain [LETHAL HITS] or
// [SUSTAINED HITS 1] until the end of the phase. Rules that care whether a unit "made a Dark Pact" read the
// `darkPact` mark it leaves for the phase (`if: ["marked:darkPact"]`).
import { applyMortalWounds, expectedDamage, buildShootPools, buildFightPools, shootingModes } from './attack';
import { rollExpr, rollN } from './dice';
import { activeRules, addTimed, rollMods } from './effects';
import { bestLd } from './game';
import { alive, boardUnits, engagedEnemies, hasKw, log, other, phaseKey, pushFx, unitDistance } from './state';
import type { GameState, PlayerId, UnitState } from './types';

export type PactPick = 'lethal hits' | 'sustained hits 1';

/** The unit can make a Dark Pact now: it has the ability, its army has the rule, and it has not made one this phase. */
export function canMakePact(s: GameState, u: UnitState): boolean {
  if (!u.abilities.some((a) => a.name === 'Dark Pacts')) return false;
  if (!s.players[u.owner].armyRules.some((r) => r.name === 'Dark Pacts')) return false;
  if (activeRules(s, u.owner).includes('Renegade Warband')) return false; // Slaves to None: no Dark Pacts
  return (u.used ?? {}).darkPact !== phaseKey(s);
}

export const madePact = (s: GameState, u: UnitState) => (u.used ?? {}).darkPact === phaseKey(s) && (u.timed ?? []).some((t) => t.mark === 'darkPact');

/** Make the Dark Pact: the Leadership test (re-rolled when a rule allows), mortal wounds on a fail, then the weapons' ability. */
export function makeDarkPact(s: GameState, u: UnitState, pick: PactPick): { passed: boolean; total: number } {
  (u.used ??= {}).darkPact = phaseKey(s);
  // Debt to the Soul Forge: a DAEMON VEHICLE invokes its contract (always, here): the test is 1 harder, its attacks get better
  const contract = activeRules(s, u.owner).includes('Soulforged Warpack') && hasKw(u, 'DAEMON') && hasKw(u, 'VEHICLE');
  const addendum = contract && boardUnits(s, u.owner).some((f) => f.enhancements.some((e) => e.name === 'Tempting Addendum') && unitDistance(u, f) <= 3);
  const ld = bestLd(u, s) + (contract ? 1 : 0);
  let r = rollN(s, 2);
  if (r[0] + r[1] < ld && rollMods(s, u).rerollPactLd) {
    log(s, `${u.name}: Dark Pact Leadership test [${r.join('+')}] re-rolled`, 'roll', u.owner);
    r = rollN(s, 2);
  }
  const total = r[0] + r[1];
  const passed = total >= ld;
  const both = rollMods(s, u).pactBoth;
  const gained = both ? 'Lethal Hits and Sustained Hits 1' : pick === 'lethal hits' ? 'Lethal Hits' : 'Sustained Hits 1';
  pushFx(s, { kind: 'roll', owner: u.owner, title: `Dark Pact · ${u.name}`, dice: r, result: `${total} vs ${ld}+ → ${passed ? 'passed' : 'failed: D3 mortal wounds'} · ${gained}`, good: passed });
  log(s, `${u.name} makes a Dark Pact (${gained}): Leadership [${r.join('+')}] = ${total} vs ${ld}+ → ${passed ? 'passed' : 'failed'}`, 'roll', u.owner);
  if (!passed) applyMortalWounds(s, u, rollExpr(s, 'D3').total + (addendum ? 1 : 0), 'Dark Pact');
  if (!alive(u).length) return { passed, total };
  addTimed(s, u, { e: { abilities: both ? ['lethal hits', 'sustained hits 1'] : [pick] }, label: 'Dark Pact', until: 'phase', by: u.owner, mark: 'darkPact' });
  // "made a Dark Pact and did not fail the test": Marks of Chaos and the Pactbound Zealots enhancements read these marks
  if (passed) addTimed(s, u, { e: {}, label: 'Dark Pact', until: 'phase', by: u.owner, mark: 'pactOk' });
  if (passed) for (const k of both ? ['lethal hits', 'sustained hits 1'] : [pick]) addTimed(s, u, { e: {}, label: 'Dark Pact', until: 'phase', by: u.owner, mark: k === 'lethal hits' ? 'pactOk:lethal' : 'pactOk:sustained' });
  if (contract) {
    for (const e of [{ attack: 'ranged' as const, wound: 1 }, { attack: 'melee' as const, attacks: 2 }, ...(addendum ? [{ reroll: 'hits' as const }] : [])]) addTimed(s, u, { e, label: 'Debt to the Soul Forge', until: 'phase', by: u.owner, mark: 'contract' });
    log(s, `${u.name} invokes its contract: +1 to wound (ranged), +2 A (melee)${addendum ? ', re-roll hits (Tempting Addendum)' : ''}`, 'info', u.owner);
  }
  const enh = (n: string) => u.enhancements.find((e) => e.name === n);
  // Eye of Tzeentch: a passed test of 8+ gives 1CP
  if (passed && total >= 8 && enh('Eye of Tzeentch')) { s.players[u.owner].cp += 1; log(s, `Eye of Tzeentch: Dark Pact passed on ${total} → +1CP`, 'cp', u.owner); }
  // Talisman of Burning Blood: +D3 A and S on the bearer's melee weapons instead of +1
  const tal = passed ? enh('Talisman of Burning Blood') : undefined;
  if (tal) {
    const x = rollExpr(s, 'D3').total;
    const ids = u.models.filter((m) => m.id === tal.model || m.name === tal.model).map((m) => m.id);
    if (x > 1) addTimed(s, u, { e: { attack: 'melee', attacks: x - 1, strength: x - 1 }, label: 'Talisman of Burning Blood', until: 'phase', by: u.owner, models: ids.length ? ids : undefined });
    log(s, `Talisman of Burning Blood: +${x} A and S this phase`, 'info', u.owner);
  }
  // Dark Destiny (Abaddon): a passed test of 7+ gives 1CP
  if (passed && total >= 7 && u.abilities.some((a) => a.name === 'Dark Destiny')) {
    s.players[u.owner].cp += 1;
    log(s, `Dark Destiny: ${u.name} passed its Dark Pact test on ${total} → +1CP`, 'cp', u.owner);
  }
  return { passed, total };
}

/** Lethal Hits against targets it wounds on 5+ (a critical hit skips that hard roll), Sustained Hits otherwise. */
export function bestPick(s: GameState, u: UnitState, kind: 'shoot' | 'fight'): PactPick {
  const foes = kind === 'fight' ? engagedEnemies(s, u) : [...boardUnits(s, other(u.owner))].sort((a, b) => unitDistance(u, a) - unitDistance(u, b)).slice(0, 2);
  let weight = 0, need = 0;
  for (const e of foes) {
    const pools = kind === 'fight' ? buildFightPools(s, u.id, e.id).pools : buildShootPools(s, u.id, e.id, { mode: shootingModes(s, u)[0] ?? 'normal' }).pools;
    for (const p of pools) { const w = expectedDamage(s, p, e).unsaved + 0.01; weight += w; need += w * p.woundNeed; }
  }
  return weight && need / weight >= 4.5 ? 'lethal hits' : 'sustained hits 1';
}

/** Should the bot (or the app for a player on automatic) make the pact? Yes, unless failing would cost too much. */
export function wantsPact(s: GameState, u: UnitState): boolean {
  const ld = bestLd(u, s);
  const fail = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(ld) ? [0, 0, 1, 3, 6, 10, 15, 21, 26, 30, 33, 35][ld - 1] / 36 : 0;
  const woundsLeft = alive(u).reduce((a, m) => a + m.wounds, 0);
  // a lone character on its last wounds, or a likely failure for a unit of single-wound models, is not worth it
  return !(woundsLeft <= 3 && fail > 0.25) && !(fail > 0.5);
}

/** The automatic pact when a unit is selected to shoot or fight (bots, and players who leave their rules to the app). */
export function autoPact(s: GameState, u: UnitState, kind: 'shoot' | 'fight', decidesFor: (p: PlayerId) => boolean) {
  if (!canMakePact(s, u) || decidesFor(u.owner)) return;
  if (kind === 'fight' ? !engagedEnemies(s, u).length : !boardUnits(s, other(u.owner)).length) return;
  if (!wantsPact(s, u)) return;
  makeDarkPact(s, u, bestPick(s, u, kind));
}
