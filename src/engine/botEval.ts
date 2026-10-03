// What the bot knows about a matchup: rough damage numbers, who wants to be in melee, objectives and threats.
// Planning estimates only — the real attacks always go through attack.ts.
import { woundNeed } from './attack';
import { primaryById, secondaryById } from './config';
import { exprAverage } from './dice';
import { isRiled } from './effects';
import { circleTouchesPoly, polyCentroid } from './geometry';
import { levelOfControl, objectiveTerrain } from './game';
import { alive, boardUnits, other } from './state';
import { isMelee } from './weapons';
import type { GameState, ObjectiveState, PlayerId, UnitState, WeaponProfileData } from './types';

export const centre = (u: UnitState) => polyCentroid(alive(u));

/** Points value of what is left of a unit. */
export const unitValue = (u: UnitState) => (u.pts * alive(u).length) / Math.max(1, u.startingStrength);
export const perModel = (u: UnitState) => u.pts / Math.max(1, u.startingStrength);

/** Average models killed by one profile against a target (no modifiers; for planning only). */
export function roughKills(p: WeaponProfileData, target: UnitState): number {
  const m = alive(target)[0];
  if (!m) return 0;
  const a = exprAverage(p.A);
  const hit = p.skill === null ? 1 : Math.max(1, 7 - p.skill) / 6;
  const wound = (7 - woundNeed(p.S ?? 3, m.profile.T)) / 6;
  const sv = Math.min(m.profile.Sv - p.AP, m.profile.InSv ?? 7);
  const fail = Math.min(1, Math.max(1 / 6, (sv - 1) / 6));
  const dmg = Math.min(exprAverage(p.D), m.profile.W);
  return (a * hit * wound * fail * dmg) / m.profile.W;
}

export function bestProfiles(u: UnitState, melee: boolean): WeaponProfileData[] {
  return alive(u).flatMap((m) => {
    const ps = m.weapons.flatMap((w) => w.profiles).filter((p) => isMelee(p) === melee);
    if (!ps.length) return [];
    if (melee) return [ps.sort((a, b) => exprAverage(b.A) * exprAverage(b.D) - exprAverage(a.A) * exprAverage(a.D))[0]]; // one melee weapon per model
    return ps.filter((p, i) => ps.findIndex((q) => q.name.split(' – ')[0] === p.name.split(' – ')[0]) === i); // one profile per ranged weapon
  });
}

export const meleeKills = (u: UnitState, t: UnitState) => bestProfiles(u, true).reduce((a, p) => a + roughKills(p, t), 0);
export const rangedKills = (u: UnitState, t: UnitState) => bestProfiles(u, false).reduce((a, p) => a + roughKills(p, t), 0);
export const maxRange = (u: UnitState) => Math.max(0, ...bestProfiles(u, false).map((p) => (typeof p.range === 'number' ? p.range : 0)));
export const moveOf = (u: UnitState) => alive(u)[0]?.profile.M ?? 0;

/** Does this unit want to be in melee rather than shooting? */
export function isBrawler(s: GameState, u: UnitState): boolean {
  const foes = boardUnits(s, other(u.owner));
  if (!foes.length) return false;
  const sample = [...foes].sort((a, b) => unitValue(b) - unitValue(a)).slice(0, 4);
  const mel = sample.reduce((a, t) => a + meleeKills(u, t) * perModel(t), 0);
  const rng = sample.reduce((a, t) => a + rangedKills(u, t) * perModel(t), 0);
  return mel > rng * 1.15;
}

/** Probability that 2D6 >= n. */
export function p2d6(n: number): number {
  const need = Math.ceil(n - 1e-6);
  if (need <= 2) return 1;
  if (need > 12) return 0;
  let c = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= need) c++;
  return c / 36;
}

export const onObjective = (s: GameState, u: UnitState, o: ObjectiveState) => {
  const t = objectiveTerrain(s, o);
  return alive(u).some((m) => circleTouchesPoly(m, m.r, t.poly));
};
export const objPoint = (s: GameState, o: ObjectiveState) => polyCentroid(objectiveTerrain(s, o).poly);
export const oc = (u: UnitState) => (u.battleShocked ? 0 : alive(u).reduce((a, m) => a + (m.profile.OC ?? 0), 0));

/** Objectives the bot wants: not held by us with spare OC. */
export function objectiveNeeds(s: GameState, p: PlayerId) {
  return s.objectives.map((o) => {
    const [a, b] = levelOfControl(s, o);
    const ours = p === 0 ? a : b, theirs = p === 0 ? b : a;
    return { o, ours, theirs, need: ours <= theirs ? theirs - ours + 1 : 0 };
  });
}

/** How much a successful charge into `e` is worth to `u` (its damage minus what it takes back). */
export function chargeValue(s: GameState, u: UnitState, e: UnitState): number {
  return meleeKills(u, e) * perModel(e) - meleeKills(e, u) * perModel(u) * 0.5 + (s.players[u.owner].oathTarget === e.id ? 8 : 0);
}

/** What one shooting attack at `t` is worth: points killed, plus finishing a unit, objectives and threats. */
export function shotValue(s: GameState, u: UnitState, t: UnitState, ev: number, gap: number): number {
  const left = alive(t).length;
  const kills = Math.min(ev, left);
  let v = kills * perModel(t);
  if (ev >= left * 0.9) v += unitValue(t) * 0.35; // finishing a unit denies its actions and scores
  const vp = killVp(s, u.owner, t);
  if (vp) v += vp * 8 * (ev >= left * 0.9 ? 1 : 0.5 * (ev / left) ** 2); // ~8 points of damage per VP
  if (s.players[u.owner].oathTarget === t.id) v *= 1.15;
  if (s.objectives.some((o) => onObjective(s, t, o))) v *= 1.25;
  if (isBrawler(s, t) && gap < 14) v *= 1.2; // threatens us next turn
  return v;
}

export const riledUp = (s: GameState, u: UnitState) => isRiled(s, u);

/** How much each objective is worth to `p` under its primary mission (VP a turn for holding it, mean ~1 over the board). */
export function objectiveWorth(s: GameState, p: PlayerId): number[] {
  const prim = primaryById(s.players[p].primaryId);
  const raw = s.objectives.map((o) => {
    const own = o.type === 'home' && o.owner === p, enemy = o.type === 'home' && o.owner === other(p);
    let v = 0;
    for (const r of prim?.scoring ?? []) {
      const vp = r.vp || 3;
      const late = r.when === 'endOfBattle' ? 0.5 : 1;
      switch (r.condition) {
        case 'perObjectiveControlled': v += vp; break;
        case 'perObjectiveControlledExclHome': case 'perNewObjectiveThisTurnExclHome': case 'newObjectiveThisTurnExclHome':
        case 'perNonHomeIfHomeControlled': if (!own) v += vp; break;
        case 'controlCentral': if (o.type === 'central') v += vp * late; break;
        case 'controlEnemyHome': if (enemy) v += vp * late; break;
        case 'controlAnyExclHome': if (!own) v += vp * 0.4; break;
        case 'controlAnyExclHomes': if (o.type !== 'home') v += vp * 0.4; break;
        case 'controlCentralAndExpansion': if (o.type === 'central' || o.type === 'expansion') v += vp * 0.5; break;
        case 'controlMoreThanOpponent': case 'control2Plus': case 'control3Plus': case 'control4Plus': v += vp * 0.4; break;
      }
    }
    return v;
  });
  const mean = raw.reduce((a, b) => a + b, 0) / Math.max(1, raw.length);
  return raw.map((v) => (mean > 0 ? 0.4 + 0.6 * (v / mean) : 1));
}

const KILL_CARDS = new Set(['no-prisoners', 'overwhelming-force', 'a-grievous-blow', 'assassination', 'bring-it-down']);

/** VP that destroying `t` now would bring `p`: kill clauses of its primary (on its own turn) and kill secondaries in hand. */
export function killVp(s: GameState, p: PlayerId, t: UnitState): number {
  let vp = 0;
  if (s.active === p) {
    const prim = primaryById(s.players[p].primaryId);
    const killed = s.destroyedByTurn.filter((d) => d.turn === s.turn && d.owner === other(p)).length;
    const snap = s.turnStart && s.turnStart.turn === s.turn ? s.turnStart : null;
    for (const r of prim?.scoring ?? []) {
      switch (r.condition) {
        case 'enemyUnitDestroyedThisTurn': if (!killed) vp += r.vp; break;
        case 'perEnemyDestroyedThisTurn': vp += r.vp; break;
        case 'moreKillsThanLossesLastTurn': vp += r.vp * 0.4; break;
        case 'killNearObjective': case 'killStartedInRangeOfObjective': if (snap?.inRangeObj.includes(t.id)) vp += r.vp * 0.7; break;
        case 'killStartedInRangeOfCentral': if (snap?.inRangeCentral.includes(t.id)) vp += r.vp * 0.7; break;
        case 'killStartedInTerrain': if ((snap?.inTerrain[t.id] ?? []).length) vp += r.vp * 0.7; break;
      }
    }
  }
  const P = s.players[p];
  if (P.secMode !== 'none') {
    for (const id of P.secActive) {
      if (!KILL_CARDS.has(id)) continue;
      const def = secondaryById(id);
      const hit = id === 'no-prisoners' ? true
        : id === 'overwhelming-force' ? s.objectives.some((o) => onObjective(s, t, o))
        : id === 'a-grievous-blow' ? t.startingStrength >= 13
        : id === 'assassination' ? alive(t).some((m) => m.isCharacter)
        : alive(t).some((m) => m.profile.W >= 10);
      if (hit) vp += Math.max(2, ...def.auto.filter((r) => r.mode !== 'fixed').map((r) => r.vp)) * 0.8;
    }
  }
  return vp;
}
