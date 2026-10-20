// Astra Militarum transports that act at the end of the opponent's Movement phase: Mount Up! (Stormlord: one INFANTRY
// unit wholly within 6" gets in) and Airborne Insertion (Valkyrie: the units inside can get out). Used by themselves,
// for the bot and the player alike: a unit near the enemy and off the objectives gets in, passengers get out when
// enemies are close enough to fight or the battle is past its midpoint.
import { baseDist } from '../engine/geometry';
import { alive, boardUnits, hasKw, isEngaged, log, other, unitDistance } from '../engine/state';
import { canEmbarkIn, disembarkUnit, embarkUnit, embarkedIn, placeNear, shootNow, validateDisembark } from '../engine/game';
import { buildShootPools, expectedDamage } from '../engine/attack';
import { runActions } from '../rules-engine/activations';
import type { GameState, PlayerId, UnitState } from '../engine/types';

const has = (u: UnitState, name: string) => u.abilities.some((a) => a.name === name);
const nearObjective = (s: GameState, u: UnitState) => s.objectives.some((o) => alive(u).some((m) => Math.hypot(m.x - o.x, m.y - o.y) <= 3 + m.r));
const foeWithin = (s: GameState, u: UnitState, r: number) => boardUnits(s, other(u.owner)).some((e) => unitDistance(u, e) <= r);

export function amOppMovementEnd(s: GameState, p: PlayerId) {
  counterstrategist(s, p);
  for (const t of boardUnits(s, p)) {
    if (has(t, 'Mount Up!') && !embarkedIn(s, t).length && !isEngaged(s, t)) {
      const u = boardUnits(s, p).find((x) => x.id !== t.id && hasKw(x, 'INFANTRY') && !hasKw(x, 'ARTILLERY') && !isEngaged(s, x)
        && alive(x).every((m) => alive(t).some((n) => baseDist(m, n) <= 6 + 1e-6)) && !canEmbarkIn(s, x, t)
        && !nearObjective(s, x) && (foeWithin(s, x, 9) || alive(x).length * 2 <= x.startingStrength));
      if (u && !embarkUnit(s, u, t, false, true)) log(s, `Mount Up!: ${u.name} embarks within ${t.name}`, 'info', p);
    }
    if (has(t, 'Airborne Insertion') && (foeWithin(s, t, 15) || s.round >= 3)) {
      const goal = [...s.objectives].sort((a, b) => Math.hypot(a.x - alive(t)[0].x, a.y - alive(t)[0].y) - Math.hypot(b.x - alive(t)[0].x, b.y - alive(t)[0].y))[0] ?? null;
      for (const u of embarkedIn(s, t)) {
        const pos = placeNear(s, u, t, 3, goal, (q) => validateDisembark(s, u, t, q).ok);
        if (pos && disembarkUnit(s, u, t, pos).ok) log(s, `Airborne Insertion: ${u.name} disembarks from ${t.name}`, 'info', p);
      }
    }
  }
}

/** Counterstrategist (Yarrick): a REGIMENT unit within 6" snap-shoots (hits on 6s only) an enemy unit that ended a
 *  move or arrived within 8" of him, the one it hurts most; when no snap shot is worth it, a unit that cannot shoot them surges. */
function counterstrategist(s: GameState, p: PlayerId) {
  for (const y of boardUnits(s, p).filter((x) => has(x, 'Counterstrategist'))) {
    const foes = boardUnits(s, other(p)).filter((e) => unitDistance(y, e) <= 8 + 1e-6 && (e.move !== 'stationary' || e.setUpTurn === s.turn));
    let best: { u: UnitState; e: UnitState; v: number } | null = null;
    for (const u of boardUnits(s, p).filter((x) => x.keywords.includes('REGIMENT') && unitDistance(x, y) <= 6 + 1e-6 && !isEngaged(s, x))) for (const e of foes) {
      const r = buildShootPools(s, u.id, e.id, { mode: 'snap' });
      const v = r.error ? 0 : r.pools.reduce((a, q) => a + expectedDamage(s, q, e).models, 0);
      if (v > (best?.v ?? 0)) best = { u, e, v };
    }
    if (best && best.v >= 0.3) { shootNow(s, best.u, best.e, 'Counterstrategist', 'snap'); continue; }
    // nothing worth a snap shot: a unit that can't shoot them surges D6" at the closest enemy instead
    const surger = boardUnits(s, p).find((x) => x.keywords.includes('REGIMENT') && unitDistance(x, y) <= 6 + 1e-6 && !isEngaged(s, x) && !x.extraMove
      && foes.some((e) => unitDistance(x, e) <= 9) && foes.every((e) => !!buildShootPools(s, x.id, e.id, { mode: 'snap' }).error));
    if (surger) runActions(s, 'Counterstrategist', surger, [{ on: 'self', surge: 'D6' }], null);
  }
}

/** "This unit can shoot with its X now" (Servo-sentry): at the enemy unit those weapons hurt most. */
export function shootWith(s: GameState, u: UnitState, weapon: string, label: string) {
  const w = weapon.toLowerCase();
  const skip = [...new Set(alive(u).flatMap((m) => m.weapons.map((x) => x.name)))].filter((n) => !n.toLowerCase().includes(w));
  let best: { e: UnitState; v: number } | null = null;
  for (const e of boardUnits(s, other(u.owner))) {
    const r = buildShootPools(s, u.id, e.id, { mode: 'normal', skipWeapons: skip });
    const v = r.error ? 0 : r.pools.reduce((a, q) => a + expectedDamage(s, q, e).models, 0) * (e.pts / Math.max(1, e.startingStrength));
    if (v > (best?.v ?? 0)) best = { e, v };
  }
  if (best) shootNow(s, u, best.e, label, 'normal', skip);
}

/** SECURE POSITIONS: one unit inside gets out (wholly within the transport's set-up distance), towards the closest objective. */
export function disembarkOne(s: GameState, t: UnitState, label: string) {
  const u = embarkedIn(s, t)[0];
  if (!u || !alive(t).length) return;
  const at = alive(t)[0];
  const goal = [...s.objectives].sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))[0] ?? null;
  const pos = placeNear(s, u, t, 6, goal, (q) => validateDisembark(s, u, t, q).ok);
  if (!pos || !disembarkUnit(s, u, t, pos).ok) return;
  u.cantCharge = true;
  log(s, `${label}: ${u.name} disembarks from ${t.name}`, 'info', t.owner);
}

/** VENGEANCE FLARE: a friendly unit of these keywords within 6" of `u` shoots `enemy` now. */
export function shootFrom(s: GameState, u: UnitState, enemy: UnitState, kws: string, label: string) {
  const ks = kws.split('|');
  const x = boardUnits(s, u.owner).find((f) => f.id !== u.id && ks.some((k) => f.keywords.includes(k)) && unitDistance(f, u) <= 6 + 1e-6 && !isEngaged(s, f));
  if (x) shootNow(s, x, enemy, label);
}

