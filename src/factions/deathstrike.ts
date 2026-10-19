// Deathstrike (Astra Militarum, and Brood Brothers): the Deathstrike Target marker and the plasma warhead.
import { applyMortalWounds, expectedDamage, targetToughness, woundNeed } from '../engine/attack';
import { rollExpr, rollN } from '../engine/dice';
import { alive, boardUnits, log, other, playsItself, pushFx } from '../engine/state';
import { setUpAway, shootNow } from '../engine/game';
import type { GameState, PlayerId, Pt, UnitState } from '../engine/types';

const MISSILE = 'Deathstrike missile';
const R = 6;
const centre = (u: UnitState): Pt => { const ms = alive(u); return { x: ms.reduce((a, m) => a + m.x, 0) / ms.length, y: ms.reduce((a, m) => a + m.y, 0) / ms.length }; };
const within = (u: UnitState, c: Pt) => alive(u).some((m) => Math.hypot(m.x - c.x, m.y - c.y) - m.r <= R + 1e-6);
const hasMissile = (u: UnitState) => u.abilities.some((a) => a.name === 'Deathstrike Missile') && alive(u).some((m) => m.weapons.some((w) => w.name === MISSILE)) && !u.oneShotUsed.includes(MISSILE);

/** Points worth under a 6" blast at c: enemy value caught minus own value caught. */
function worth(s: GameState, p: PlayerId, c: Pt): number {
  return s.units.filter((u) => u.status === 'board' && alive(u).length && within(u, c))
    .reduce((a, u) => a + (u.owner === p ? -1.5 : 1) * u.pts * alive(u).length / Math.max(1, u.startingStrength), 0);
}

/** The best spot for the marker: the centre of the enemy unit that is worth the most under the blast. */
function bestSpot(s: GameState, p: PlayerId): Pt | null {
  let best: { c: Pt; v: number } | null = null;
  for (const e of boardUnits(s, other(p))) { const c = centre(e); const v = worth(s, p, c); if (v > 0 && (!best || v > best.v)) best = { c, v }; }
  return best?.c ?? null;
}

/** Plasma warhead: every unit within 6" of the marker is attacked (2D6 attacks, Blast, BS 2+, S16 AP-4 D1). */
function fire(s: GameState, u: UnitState, c: Pt) {
  u.oneShotUsed.push(MISSILE);
  u.dsMarker = undefined;
  pushFx(s, { kind: 'skill', unitId: u.id, owner: u.owner, at: c, name: 'Plasma Warhead', who: u.name, style: 'tech', epic: true });
  for (const T of s.units.filter((x) => x.status === 'board' && alive(x).length && within(x, c))) {
    const n = rollExpr(s, '2D6').total + Math.floor(alive(T).length / 5);
    const hits = rollN(s, n).filter((v) => v >= 2).length;
    const wounds = rollN(s, hits).filter((v) => v >= woundNeed(16, targetToughness(T, s))).length;
    const m = alive(T)[0];
    const need = Math.min(m.profile.Sv + 4, m.profile.InSv ?? 7);
    const unsaved = need > 6 ? wounds : rollN(s, wounds).filter((v) => v < need).length;
    const lost = unsaved ? applyMortalWounds(s, T, unsaved, 'Plasma Warhead') : 0;
    log(s, `Plasma Warhead: ${T.name} takes ${n} attacks, ${unsaved} unsaved, ${lost} model${lost === 1 ? '' : 's'} destroyed`, 'info', u.owner);
  }
}

/** Start of its Shooting phase: fire on a marker placed in an earlier phase (only if it Remained Stationary), else designate / adjust the target. */
export function deathstrikeShooting(s: GameState, p: PlayerId) {
  for (const u of boardUnits(s, p).filter(hasMissile)) {
    const mk = u.dsMarker;
    if (mk && u.move === 'stationary' && worth(s, p, mk) > 0) { fire(s, u, mk); continue; }
    const c = bestSpot(s, p);
    if (!c) continue;
    u.dsMarker = { x: c.x, y: c.y };
    log(s, `Deathstrike Missile: ${u.name} ${mk ? 'adjusts' : 'designates'} its target`, 'info', p);
  }
}

/** Death Befitting An Officer: a destroyed Leman Russ Commander shoots once more on a 2+ before it is removed.
 *  Astra Militarum: in the opponent's Shooting phase, at the attacking unit only. Brood Brothers: any phase, any target. */
export function officerDeath(s: GameState, A: UnitState, T: UnitState) {
  const ab = T.abilities.find((a) => a.name === 'Death Befitting An Officer');
  if (!ab || T.status !== 'destroyed' || (T.used ??= {}).deathBefitting) return;
  const amVersion = /opponent/i.test(ab.text ?? '');
  if (amVersion && (s.phase !== 'shooting' || T.owner === s.active)) return;
  T.used.deathBefitting = 'yes';
  const die = rollN(s, 1)[0];
  log(s, `Death Befitting An Officer: ${T.name} rolls ${die}`, 'info', T.owner);
  if (die < 2) return;
  const m = T.models.find((x) => x.dead);
  if (!m) return;
  m.dead = false; m.wounds = m.profile.W; T.status = 'board';
  const foes = amVersion ? [A] : [A, ...boardUnits(s, other(T.owner)).filter((e) => e.id !== A.id).sort((a, b) => b.pts - a.pts)];
  const target = foes.find((e) => e.status === 'board' && alive(e).length);
  if (target) shootNow(s, T, target, 'Death Befitting An Officer');
  m.dead = true; m.wounds = 0; T.status = 'destroyed';
}

/** Sigil of Exigence: once per battle, when the bearer's unit is selected as the target of a ranged attack in the
 *  opponent's Shooting phase, it is set up again more than 8" from every enemy unit and the attack is called off
 *  (the opponent picks new targets for those weapons). Used when the attack would cost a quarter of the unit or more. */
export function sigilOfExigence(s: GameState, at: NonNullable<GameState['attack']>) {
  const T = s.units.find((x) => x.id === at.targetId), A = s.units.find((x) => x.id === at.attackerId);
  if (!T || !A || at.free || at.kind !== 'shoot' || s.phase !== 'shooting' || T.owner === s.active || !playsItself(s, T.owner)) return;
  if (!T.enhancements.some((e) => e.name === 'Sigil of Exigence') || (T.used ??= {}).sigil) return;
  const loss = at.pools.reduce((a, p) => a + expectedDamage(s, p, T).models, 0);
  if (loss < Math.max(1, alive(T).length / 4)) return;
  const back = alive(T).map((m) => ({ m, x: m.x, y: m.y }));
  if (!setUpAway(s, T, 8, centre(T))) { for (const b of back) { b.m.x = b.x; b.m.y = b.y; } return; }
  T.used.sigil = 'yes';
  const weapons = new Set(at.pools.map((p) => p.weapon));
  A.weaponsFired = A.weaponsFired.filter((w) => !weapons.has(w));
  A.selectedToShoot = false;
  at.pools = []; at.stage = 'done';
  log(s, `Sigil of Exigence: ${T.name} vanishes and reappears more than 8" from the enemy; ${A.name} must pick new targets`, 'info', T.owner);
}
