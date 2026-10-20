// Necrons army rule Reanimation Protocols (Faction Pack) and the abilities that change it. Datasheet abilities,
// detachment rules and stratagems are data (data/abilities/NEC.json, data/detachment-rules.json, data/stratagems/NEC.json).
import { alive, boardUnits, hasKw, log } from '../engine/state';
import { dist } from '../engine/geometry';
import { rollExpr } from '../engine/dice';
import type { GameState, PlayerId, UnitState } from '../engine/types';

export function isNecronArmy(s: GameState, p: PlayerId): boolean {
  return !!s.players[p]?.armyRules?.some((r) => r.name === 'Reanimation Protocols');
}

const has = (u: UnitState, name: string) => u.abilities.some((a) => a.name === name);
const within = (a: UnitState, b: UnitState, r: number) => alive(a).some((m) => alive(b).some((n) => dist(m, n) - m.r - n.r <= r + 1e-6));

/** Heals `n` wounds the Reanimation Protocols way: wounded models first, then a destroyed model returns with 1 wound
 *  and the next wounds go to it. Returns the wounds healed. */
export function reanimateWounds(u: UnitState, n: number): number {
  let left = n;
  while (left > 0) {
    const hurt = alive(u).find((m) => m.wounds < m.profile.W);
    if (hurt) { hurt.wounds++; left--; continue; }
    const dead = u.models.find((m) => m.dead && !m.isCharacter) ?? u.models.find((m) => m.dead);
    if (!dead) break;
    dead.dead = false;
    dead.wounds = 1;
    left--;
  }
  return n - left;
}

/** The unit's Reanimation Protocols activate: D3 wounds (D6 when it resurrects), with Their Number is Legion,
 *  Nanoscarab Reanimation Beam and Nanoscarab Projector. */
export function activateReanimation(s: GameState, u: UnitState, die: 'D3' | 'D6' = 'D3', label = 'Reanimation Protocols'): number {
  if (!alive(u).length) return 0;
  let n = rollExpr(s, die).total;
  // Their Number is Legion: re-roll a low result
  if (has(u, 'Their Number is Legion') && n <= (die === 'D3' ? 1 : 3)) n = rollExpr(s, die).total;
  if (u.enhancements?.some((e) => e.name === 'Recursive Reanimation')) n += 1;
  const friends = boardUnits(s, u.owner).filter((f) => f.id !== u.id);
  if (friends.some((f) => has(f, 'Nanoscarab Reanimation Beam (Aura)') && within(f, u, 3))) n += rollExpr(s, 'D3').total;
  const projector = friends.find((f) => has(f, 'Nanoscarab Projector') && within(f, u, 3) && f.used?.nanoscarab !== `${s.round}`);
  if (projector) { (projector.used ??= {}).nanoscarab = `${s.round}`; n += 1; }
  const before = alive(u).length;
  const healed = reanimateWounds(u, n);
  if (healed) log(s, `${label}: ${u.name} reanimates ${healed} wound${healed > 1 ? 's' : ''}${alive(u).length > before ? ` (${alive(u).length - before} model${alive(u).length - before > 1 ? 's return' : ' returns'})` : ''}`, 'info', u.owner);
  return healed;
}

/** End of your Command phase: every unit with Reanimation Protocols on the battlefield activates them. */
export function necCommandEnd(s: GameState, p: PlayerId) {
  if (!isNecronArmy(s, p)) return;
  for (const u of boardUnits(s, p)) if (has(u, 'Reanimation Protocols')) activateReanimation(s, u);
}

/** Resurrection Orb: once per turn for the army, the unit's Reanimation Protocols activate with D6. */
export function resurrect(s: GameState, u: UnitState): boolean {
  const P = s.players[u.owner];
  if (P.resurrectTurn === s.turn) { log(s, 'Resurrection Orb: a unit already resurrected this turn', 'info', u.owner); return false; }
  P.resurrectTurn = s.turn;
  activateReanimation(s, u, 'D6', 'Resurrection Orb');
  return true;
}

/** Repair Barge (Ghost Ark): once per turn, after an enemy unit's attacks, a NECRON WARRIORS unit within 3" that lost
 *  wounds activates its Reanimation Protocols (each unit once per turn). */
export function repairBarge(s: GameState, T: UnitState) {
  if (!hasKw(T, 'NECRON WARRIORS') || T.used?.repairBarge === `${s.turn}` || !alive(T).length) return;
  if (alive(T).length === T.models.filter((m) => !m.isCharacter).length && alive(T).every((m) => m.wounds >= m.profile.W)) return;
  const ark = boardUnits(s, T.owner).find((a) => has(a, 'Repair Barge') && a.used?.repairBargeArk !== `${s.turn}` && within(a, T, 3));
  if (!ark) return;
  (ark.used ??= {}).repairBargeArk = `${s.turn}`;
  (T.used ??= {}).repairBarge = `${s.turn}`;
  activateReanimation(s, T, 'D3', 'Repair Barge');
}
