// What the bot knows about a matchup: rough damage numbers, who wants to be in melee, objectives and threats.
// Planning estimates only — the real attacks always go through attack.ts.
import { woundNeed } from '../engine/attack';
import { exprAverage } from '../engine/dice';
import { isRiled } from '../rules-engine/effects';
import { bodyTouchesPoly, circleTouchesPoly, polyCentroid } from '../engine/geometry';
import { levelOfControl, objectiveTerrain } from '../engine/game';
import { alive, boardUnits, other } from '../engine/state';
import { isMelee } from '../engine/weapons';
import { botOff } from './botWeights';
import type { GameState, ObjectiveState, PlayerId, UnitState, WeaponProfileData } from '../engine/types';

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
  return alive(u).some((m) => bodyTouchesPoly(m, 0, t.poly));
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

/** How much a successful charge into `e` is worth to `u` (its damage minus what it takes back, plus tying up its guns). */
export function chargeValue(s: GameState, u: UnitState, e: UnitState): number {
  return meleeKills(u, e) * perModel(e) - meleeKills(e, u) * perModel(u) * 0.5 + (s.players[u.owner].oathTarget === e.id ? 8 : 0) + lockValue(s, e);
}

const punchCache = new WeakMap<GameState, Map<string, number>>();
/** Points of damage a unit does in a turn to the enemy's best units (its gun or its fists, whichever is better). */
export function unitPunch(s: GameState, u: UnitState): number {
  const key = `${s.turn}|${s.phase}|${u.id}|${alive(u).length}`;
  let c = punchCache.get(s);
  if (!c) { c = new Map(); punchCache.set(s, c); }
  const hit = c.get(key);
  if (hit !== undefined) return hit;
  const foes = [...boardUnits(s, other(u.owner))].sort((a, b) => unitValue(b) - unitValue(a)).slice(0, 4);
  let v = 0;
  if (foes.length) {
    const shot = foes.reduce((a, t) => a + Math.min(alive(t).length, rangedKills(u, t)) * perModel(t), 0) / foes.length;
    const fist = foes.reduce((a, t) => a + Math.min(alive(t).length, meleeKills(u, t)) * perModel(t), 0) / foes.length;
    v = Math.max(shot, fist * 0.8);
  }
  c.set(key, v);
  return v;
}

const shotCache = new WeakMap<GameState, Map<string, number>>();
/** Points of damage a unit's guns do in a turn to the enemy's best units (no fists). */
export function gunPunch(s: GameState, u: UnitState): number {
  const key = `${s.turn}|${s.phase}|${u.id}|${alive(u).length}`;
  let c = shotCache.get(s);
  if (!c) { c = new Map(); shotCache.set(s, c); }
  const hit = c.get(key);
  if (hit !== undefined) return hit;
  const foes = [...boardUnits(s, other(u.owner))].sort((a, b) => unitValue(b) - unitValue(a)).slice(0, 4);
  const v = foes.length ? foes.reduce((a, t) => a + Math.min(alive(t).length, rangedKills(u, t)) * perModel(t), 0) / foes.length : 0;
  c.set(key, v);
  return v;
}

/**
 * Tying an enemy gun line up in melee (trading): engaged, it can't shoot next turn unless it falls back, and then it
 * can't shoot either. Worth part of its guns' damage — a cheap unit thrown in front of them buys that much.
 * Monsters and vehicles still shoot in melee, and fighters want the fight anyway.
 */
export function lockValue(s: GameState, e: UnitState): number {
  if (botOff('lock') || isBrawler(s, e) || alive(e).some((m) => m.keywords.includes('MONSTER') || m.keywords.includes('VEHICLE'))) return 0;
  return gunPunch(s, e) * 0.4;
}

/** Taking models off an objective they hold: worth a lot when it flips to us (or to nobody). */
function flipValue(s: GameState, p: PlayerId, t: UnitState, kills: number): number {
  const per = t.battleShocked ? 0 : alive(t)[0]?.profile.OC ?? 0;
  if (!per) return 0;
  let v = 0;
  for (const o of s.objectives) {
    if (!onObjective(s, t, o)) continue;
    const [a, b] = levelOfControl(s, o);
    const ours = p === 0 ? a : b, theirs = p === 0 ? b : a;
    if (theirs <= ours) continue;
    const need = Math.ceil((theirs - ours) / per); // models to kill so it is no longer theirs
    const chance = Math.min(1, kills / Math.max(1, need));
    v += chance * (ours > 0 ? 30 : 18);
  }
  return v;
}

/** What one shooting attack at `t` is worth: points killed, plus finishing a unit, objectives and threats. */
export function shotValue(s: GameState, u: UnitState, t: UnitState, ev: number, gap: number): number {
  const left = alive(t).length;
  const kills = Math.min(ev, left);
  let v = kills * perModel(t);
  if (ev >= left * 0.9) v += unitValue(t) * 0.35; // finishing a unit denies its actions and scores
  if (s.players[u.owner].oathTarget === t.id) v *= 1.15;
  const onObj = s.objectives.some((o) => onObjective(s, t, o));
  if (onObj) v *= 1.25;
  if (isBrawler(s, t) && gap < 14) v *= 1.2; // threatens us next turn
  if (!botOff('targets')) {
    // what it would do to us next turn: each model killed takes its share of that away
    v += unitPunch(s, t) * (kills / Math.max(1, left)) * 0.5;
    // models off an objective they hold, and a unit doing an action for its secondary
    if (onObj) v += flipValue(s, u.owner, t, kills);
    if (s.pendingActions?.some((a) => a.unitId === t.id)) v += 24 * Math.min(1, ev / Math.max(1, left));
  }
  // secondary cards that pay for destroying this unit: their VP (about 16 points of damage each) times the chance
  const pKill = Math.min(1, ev / Math.max(1, left)) ** 1.5;
  if (pKill > 0.05) {
    for (const id of s.players[u.owner].secActive ?? []) {
      const vp = killCardVp(id, t, onObj);
      if (vp) v += vp * 16 * pKill;
    }
  }
  return v;
}

/** VP a secondary card gives for destroying this unit (0: the card does not care about it). */
function killCardVp(id: string, t: UnitState, onObj: boolean): number {
  switch (id) {
    case 'no-prisoners': return 2;
    case 'overwhelming-force': return onObj ? 3 : 0;
    case 'a-grievous-blow': return t.startingStrength >= 13 ? 5 : 0;
    case 'assassination': return alive(t).some((m) => m.isCharacter) ? 5 : 0;
    case 'bring-it-down': return alive(t).some((m) => m.profile.W >= 10) ? 5 : 0;
    default: return 0;
  }
}

export const riledUp = (s: GameState, u: UnitState) => isRiled(s, u);
