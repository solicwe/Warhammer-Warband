// Deathstrike (Astra Militarum, and Brood Brothers): the Deathstrike Target marker and the plasma warhead.
import { applyMortalWounds, expectedDamage, targetToughness, woundNeed } from '../engine/attack';
import { rollExpr, rollN } from '../engine/dice';
import { alive, boardUnits, log, other, playsItself, pushFx } from '../engine/state';
import { setUpAway, shootNow } from '../engine/game';
import type { GameState, PlayerId, Pt, UnitState } from '../engine/types';

const MISSILE = 'Deathstrike missile';
const R = 6;
export const centre = (u: UnitState): Pt => { const ms = alive(u); return { x: ms.reduce((a, m) => a + m.x, 0) / ms.length, y: ms.reduce((a, m) => a + m.y, 0) / ms.length }; };
export const withinMarker = (u: UnitState, c: Pt) => alive(u).some((m) => Math.hypot(m.x - c.x, m.y - c.y) - m.r <= R + 1e-6);

export const hasDeathstrikeMissile = (u: UnitState) =>
  u.abilities.some((a) => /deathstrike missile/i.test(a.name)) &&
  alive(u).some((m) => m.weapons.some((w) => /deathstrike missile/i.test(w.name))) &&
  !u.oneShotUsed.some((w) => /deathstrike missile/i.test(w));

/** Points worth under a 6" blast at c: enemy value caught (weighted by heavy armour and blast bonus) minus own value caught. */
export function deathstrikeWorth(s: GameState, p: PlayerId, c: Pt): number {
  let score = 0;
  for (const u of s.units) {
    if (u.status !== 'board' || !alive(u).length || !withinMarker(u, c)) continue;
    const msCaught = alive(u).filter((m) => Math.hypot(m.x - c.x, m.y - c.y) - m.r <= R + 1e-6).length;
    if (!msCaught) continue;
    const baseValue = (u.pts * msCaught) / Math.max(1, u.startingStrength);
    if (u.owner === p) {
      // Friendly fire penalty
      score -= baseValue * 2.5;
    } else {
      const t = targetToughness(u, s);
      const isHeavy = t >= 9 || u.keywords.includes('VEHICLE') || u.keywords.includes('MONSTER');
      const heavyBonus = isHeavy ? 1.35 : 1.0;
      const blastBonus = Math.floor(alive(u).length / 5) * 6;
      score += baseValue * heavyBonus + blastBonus;
    }
  }
  return score;
}

/** The best spot for the marker: evaluating single unit centres and multi-unit cluster centroids. */
export function bestDeathstrikeSpot(s: GameState, p: PlayerId, excludeSpots?: Pt[]): Pt | null {
  let best: { c: Pt; v: number } | null = null;
  const foes = boardUnits(s, other(p));
  const testSpots: Pt[] = foes.map(centre);

  // Evaluate centroids between pairs of enemy units within 11" to hit clusters
  for (let i = 0; i < foes.length; i++) {
    const ci = testSpots[i];
    for (let j = i + 1; j < foes.length; j++) {
      const cj = testSpots[j];
      const d = Math.hypot(ci.x - cj.x, ci.y - cj.y);
      if (d <= 11) {
        testSpots.push({ x: (ci.x + cj.x) / 2, y: (ci.y + cj.y) / 2 });
      }
    }
  }

  for (const c of testSpots) {
    let v = deathstrikeWorth(s, p, c);
    // De-prioritize spots that already have a friendly Deathstrike marker targeting them
    if (excludeSpots && excludeSpots.some((ex) => Math.hypot(ex.x - c.x, ex.y - c.y) < 5)) {
      v *= 0.1;
    }
    if (v > 0 && (!best || v > best.v)) best = { c, v };
  }
  return best?.c ?? null;
}

export function canFireDeathstrike(s: GameState, u: UnitState): boolean {
  if (s.phase !== 'shooting' || u.owner !== s.active) return false;
  if (!hasDeathstrikeMissile(u) || !u.dsMarker) return false;
  const isStationary = u.move === 'stationary' || !u.move || u.lastStationaryTurn === s.turn;
  const usedDesignateThisPhase = (u.used ?? {})['dsDesignated'] === `${s.turn}:${s.phase}`;
  return isStationary && !usedDesignateThisPhase;
}

export function canDesignateDeathstrike(s: GameState, u: UnitState): boolean {
  if ((s.phase !== 'command' && s.phase !== 'movement' && s.phase !== 'shooting') || u.owner !== s.active) return false;
  if (!hasDeathstrikeMissile(u)) return false;
  const usedDesignateThisPhase = (u.used ?? {})['dsDesignated'] === `${s.turn}:${s.phase}`;
  return !usedDesignateThisPhase;
}

export function designateDeathstrikeTarget(s: GameState, u: UnitState, c: Pt) {
  const mk = u.dsMarker;
  u.dsMarker = { x: c.x, y: c.y };
  (u.used ??= {})['dsDesignated'] = `${s.turn}:${s.phase}`;
  pushFx(s, { kind: 'skill', unitId: u.id, owner: u.owner, at: c, name: 'Deathstrike Target', who: u.name, style: 'tech', epic: false });
  log(s, `Deathstrike Missile: ${u.name} ${mk ? 'adjusts' : 'designates'} target marker at (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`, 'info', u.owner);
}

/** Plasma warhead: every unit within 6" of the marker is attacked (2D6 attacks + Blast, BS 2+, S16 AP-4 D1). */
export function fireDeathstrikeWarhead(s: GameState, u: UnitState, customPoint?: Pt) {
  const c = customPoint ?? u.dsMarker;
  if (!c) return;
  u.oneShotUsed.push(MISSILE);
  u.dsMarker = undefined;
  u.shotTurn = s.turn;
  (u as any).hasFiredThisTurn = true;
  pushFx(s, { kind: 'skill', unitId: u.id, owner: u.owner, at: c, name: 'Plasma Warhead', who: u.name, style: 'tech', epic: true });
  log(s, `Plasma Warhead Detonation: ${u.name} launches warhead at target coordinates (${c.x.toFixed(1)}, ${c.y.toFixed(1)})!`, 'info', u.owner);

  const targets = s.units.filter((x) => x.status === 'board' && alive(x).length && withinMarker(x, c));
  pushFx(s, {
    kind: 'explosion',
    at: c,
    range: 6,
    radius: 6,
    hits: targets.length,
    title: `PLASMA WARHEAD · 6" · ${targets.length} unit${targets.length === 1 ? '' : 's'} hit`,
  });

  for (const T of targets) {
    // 2D6 attacks + Blast (+1 attack per 5 models in target unit)
    const n = rollExpr(s, '2D6').total + Math.floor(alive(T).length / 5);
    const hits = rollN(s, n).filter((v) => v >= 2).length;
    const wounds = rollN(s, hits).filter((v) => v >= woundNeed(16, targetToughness(T, s))).length;
    const m = alive(T)[0];
    const need = Math.min(m.profile.Sv + 4, m.profile.InSv ?? 7);
    const unsaved = need > 6 ? wounds : rollN(s, wounds).filter((v) => v < need).length;
    const lost = unsaved ? applyMortalWounds(s, T, unsaved, 'Plasma Warhead') : 0;
    log(s, `Plasma Warhead: ${T.name} takes ${n} attacks (${hits} hits, ${wounds} wounds) → ${unsaved} unsaved, ${lost} model${lost === 1 ? '' : 's'} destroyed`, 'info', u.owner);
  }
}

export function deathstrikeShooting(s: GameState, p: PlayerId) {
  if (s.decides && s.decides.includes(p) && !(s.bots ?? []).includes(p)) return;
  const missiles = boardUnits(s, p).filter(hasDeathstrikeMissile);
  for (const u of missiles) {
    const isStationary = u.move === 'stationary' || !u.move || u.lastStationaryTurn === s.turn;
    if (!isStationary) continue;

    const hadMarkerAtStart = Boolean(u.dsMarker);
    const initialMk = u.dsMarker;
    let mk: Pt | undefined = initialMk;
    let enemiesInBlast = initialMk ? s.units.some((x) => x.owner !== p && x.status === 'board' && alive(x).length && withinMarker(x, initialMk)) : false;

    if (hadMarkerAtStart) {
      if (!enemiesInBlast) {
        // Earlier missile destroyed the target under this marker, retarget to next available cluster
        const otherMarkers = missiles.filter((x) => x.id !== u.id && x.dsMarker).map((x) => x.dsMarker!);
        const nextSpot = bestDeathstrikeSpot(s, p, otherMarkers);
        if (nextSpot) {
          designateDeathstrikeTarget(s, u, nextSpot);
          mk = nextSpot;
          enemiesInBlast = true;
        }
      }
      if (mk && (enemiesInBlast || deathstrikeWorth(s, p, mk) > 0)) {
        fireDeathstrikeWarhead(s, u, mk);
      }
    } else {
      // First time placing marker: designate target now, ready to fire on subsequent turns
      const otherMarkers = missiles.filter((x) => x.id !== u.id && x.dsMarker).map((x) => x.dsMarker!);
      const spot = bestDeathstrikeSpot(s, p, otherMarkers);
      if (spot) {
        designateDeathstrikeTarget(s, u, spot);
      }
    }
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
