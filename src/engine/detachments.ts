// Detachment rules the engine applies itself. The rules live in data/detachment-rules.json (keyed by detachment
// name), so adding or correcting one is a data change: effects on attacks, defence, eligibility, rolls and OC,
// plus "choose one each Command phase" rules such as Combat Doctrines.
import detData from '../../data/detachment-rules.json';
import { clamp } from './geometry';
import { alive, boardUnits, engagedEnemies, hasKw, log, withinTerrain } from './state';
import { unitInRange } from './missions';
import { RULES } from './config';
import type { DetChoiceState, GameState, ModelState, PlayerId, Pool, UnitState, WeaponProfileData } from './types';

export type Eligibility = 'shootAfterAdvance' | 'shootAfterFallBack' | 'chargeAfterAdvance' | 'chargeAfterFallBack';

export interface DetEffect {
  units?: string[];
  attack?: 'melee' | 'ranged';
  if?: string[];
  hit?: number;
  wound?: number;
  ap?: number;
  strength?: number;
  attacks?: number;
  reroll?: 'hits1' | 'hits' | 'wounds1' | 'wounds';
  abilities?: string[];
  defend?: { woundMinusIfStronger?: boolean; coverUnless12?: boolean; inv?: number; rangedOnly?: boolean; enemyStrengthMinus?: number };
  eligible?: Eligibility[];
  rerollAdvance?: boolean;
  rerollCharge?: boolean;
  advanceSix?: boolean;
  advanceBonus?: number;
  chargeBonus?: number;
  move?: number;
  oc?: number;
  shockedOc?: number;
  advanceSelfMortals?: string;
}
export interface DetChoiceOption { id: string; name: string; text: string; effects: DetEffect[] }
export interface DetChoice {
  name: string;
  when: 'command' | 'round' | 'battle';
  uses: 'eachOnce' | 'limit' | 'free';
  limit?: number;
  pick?: number;
  options: DetChoiceOption[];
}
export interface DetRule { auto: 'full' | 'partial' | 'manual'; effects?: DetEffect[]; choice?: DetChoice; manual?: string }

export const DET_RULES = (detData as unknown as { rules: Record<string, DetRule> }).rules;

const detState = (s: GameState, p: PlayerId) => (s.players[p].det ??= {});

// ---------- which effects apply ----------

function playerEffects(s: GameState, p: PlayerId): DetEffect[] {
  const P = s.players[p];
  const out: DetEffect[] = [];
  for (const d of P.detachments ?? []) {
    const r = DET_RULES[d.name];
    if (!r) continue;
    out.push(...(r.effects ?? []));
    if (r.choice) {
      const st = P.det?.[d.name];
      for (const id of st?.active ?? []) out.push(...(r.choice.options.find((o) => o.id === id)?.effects ?? []));
    }
  }
  return out;
}

const unitMatches = (u: UnitState, e: DetEffect) => (e.units ?? []).every((req) => req.split('|').some((alt) =>
  alt.startsWith('name:') ? u.sources.includes(alt.slice(5)) : u.keywords.includes(alt) || u.factionKeywords.includes(alt)));

export const unitEffects = (s: GameState, u: UnitState) => playerEffects(s, u.owner).filter((e) => unitMatches(u, e));

interface Ctx { s: GameState; A: UnitState; T?: UnitState; p?: WeaponProfileData; weapon?: string; d?: number }

const isMVUnit = (u: UnitState) => hasKw(u, 'MONSTER') || hasKw(u, 'VEHICLE');
const onObjective = (s: GameState, u: UnitState) => s.objectives.some((o) => unitInRange(s, u, o));

function cond(c: string, x: Ctx): boolean {
  const { s, A, T } = x;
  switch (c) {
    case 'charged': return A.chargedTurn === s.turn;
    case 'stationary': return A.move === 'stationary';
    case 'within12': return (x.d ?? Infinity) <= 12 + 1e-6;
    case 'targetMV': return !!T && isMVUnit(T);
    case 'targetNotMV': return !!T && !isMVUnit(T);
    case 'targetCharMV': return !!T && (isMVUnit(T) || hasKw(T, 'CHARACTER'));
    case 'targetOath': return !!T && s.players[A.owner].oathTarget === T.id;
    case 'belowStarting': return alive(A).length < A.startingStrength;
    case 'belowHalf': return alive(A).length * 2 < A.startingStrength;
    case 'battleShocked': return A.battleShocked;
    case 'notBattleShocked': return !A.battleShocked;
    case 'inTerrain': return alive(A).some((m) => withinTerrain(s, m));
    case 'onObjective': return onObjective(s, A);
    case 'targetOnObjective': return !!T && onObjective(s, T);
    case 'objectiveEitherWay': return onObjective(s, A) || (!!T && onObjective(s, T));
    case 'riled': return A.abilities.some((a) => a.name === 'Waaagh!') && s.players[A.owner].riledUntilTurn >= s.turn;
    case 'setUpThisTurn': return A.setUpTurn === s.turn;
    case 'chargedOrArrived': return A.chargedTurn === s.turn || A.move === 'ingress' || A.setUpTurn === s.turn;
    case 'disembarkedThisTurn': return A.disembarkedTurn === s.turn;
    case 'heavyWeapon': return !!x.p && x.p.abilities.some((a) => a === 'heavy' || a.startsWith('heavy'));
    case 'plasmaWeapon': return /plasma/i.test(`${x.weapon ?? ''} ${x.p?.name ?? ''}`);
    case 'outnumberOrGangUp': return !!T && (alive(A).length > alive(T).length
      || boardUnits(s, A.owner).some((f) => f.id !== A.id && f.factionKeywords.includes('ADEPTUS ASTARTES') && engagedEnemies(s, f).some((e) => e.id === T.id)));
    default: return false;
  }
}

const holds = (e: DetEffect, x: Ctx) => (e.if ?? []).every((c) => cond(c, x));

// ---------- attacks ----------

/** Weapon abilities a detachment gives this attack (checked before the pool is built: assault, heavy, ignores cover). */
export function detGrants(s: GameState, A: UnitState, kind: 'melee' | 'ranged', ability: string, x: Omit<Ctx, 's' | 'A'> = {}): boolean {
  return unitEffects(s, A).some((e) => (!e.attack || e.attack === kind) && e.abilities?.includes(ability) && holds(e, { s, A, ...x }));
}

/** The target's detachment makes ranged attacks from more than 12" count it as in cover. */
export function detCover(s: GameState, T: UnitState, d: number): boolean {
  return d > 12 + 1e-6 && unitEffects(s, T).some((e) => e.defend?.coverUnless12 && holds(e, { s, A: T }));
}

/** Invulnerable save a detachment gives the target ("5+ InSv against ranged attacks"). */
export function detInv(s: GameState, T: UnitState, ranged: boolean): number | null {
  let best: number | null = null;
  for (const e of unitEffects(s, T)) {
    const inv = e.defend?.inv;
    if (!inv || (e.defend?.rangedOnly && !ranged) || !holds(e, { s, A: T })) continue;
    if (best === null || inv < best) best = inv;
  }
  return best;
}

/** Fold the attacker's and the target's detachment effects into a freshly built pool. Returns labels for the UI. */
export function applyDetachment(s: GameState, A: UnitState, T: UnitState, pool: Pool, kind: 'melee' | 'ranged', d: number, toughness: number, woundNeedFn: (S: number, T: number) => number): string[] {
  const notes: string[] = [];
  const x: Ctx = { s, A, T, p: pool.profile, weapon: pool.weapon, d };
  let strength = pool.profile.S ?? 1;
  for (const e of unitEffects(s, A)) {
    if (e.attack && e.attack !== kind) continue;
    if (!holds(e, x)) continue;
    if (e.hit && !pool.autoHit) { pool.hitMod = clamp(pool.hitMod + e.hit, -RULES.modifierCaps.hitRoll, RULES.modifierCaps.hitRoll); notes.push(`+${e.hit} hit`); }
    if (e.wound) { pool.woundMod = clamp(pool.woundMod + e.wound, -RULES.modifierCaps.woundRoll, RULES.modifierCaps.woundRoll); notes.push(`+${e.wound} wound`); }
    if (e.ap) { pool.ap -= e.ap; notes.push(`+${e.ap} AP`); }
    if (e.strength) { strength += e.strength; notes.push(`+${e.strength} S`); }
    if (e.attacks) { pool.attackBonus = (pool.attackBonus ?? 0) + e.attacks; notes.push(`+${e.attacks} A`); }
    if (e.reroll === 'hits') { pool.rerollAllHits = true; notes.push('re-roll hit'); }
    if (e.reroll === 'hits1') { pool.rerollHits1 = true; notes.push('re-roll hit 1'); }
    if (e.reroll === 'wounds') { pool.rerollAllWounds = true; notes.push('re-roll wound'); }
    if (e.reroll === 'wounds1') { pool.rerollWounds1 = true; notes.push('re-roll wound 1'); }
    for (const ab of e.abilities ?? []) {
      if (ab === 'sustained hits 1' && !pool.sustained) { pool.sustained = '1'; notes.push('Sustained Hits 1'); }
      if (ab === 'lethal hits' && !pool.lethal) { pool.lethal = true; notes.push('Lethal Hits'); }
      if (ab === 'devastating wounds' && !pool.devastating) { pool.devastating = true; notes.push('Devastating Wounds'); }
      if (ab === 'precision' && !pool.precision) { pool.precision = true; notes.push('Precision'); }
    }
  }
  // the target's side
  for (const e of unitEffects(s, T)) {
    const def = e.defend;
    if (!def || (def.rangedOnly && kind !== 'ranged') || !holds(e, { s, A: T })) continue;
    if (def.enemyStrengthMinus) { strength -= def.enemyStrengthMinus; notes.push(`เป้า: S −${def.enemyStrengthMinus}`); }
  }
  if (strength !== (pool.profile.S ?? 1)) pool.woundNeed = woundNeedFn(Math.max(1, strength), toughness);
  for (const e of unitEffects(s, T)) {
    const def = e.defend;
    if (!def?.woundMinusIfStronger || !holds(e, { s, A: T })) continue;
    if (strength > toughness) { pool.woundMod = clamp(pool.woundMod - 1, -RULES.modifierCaps.woundRoll, RULES.modifierCaps.woundRoll); notes.push('เป้า: −1 wound (S > T)'); }
    break;
  }
  if (notes.length) pool.woundNote = [pool.woundNote, `Detachment: ${notes.join(', ')}`].filter(Boolean).join(' · ');
  return notes;
}

// ---------- eligibility, rolls, OC, movement ----------

export function detEligible(s: GameState, u: UnitState, what: Eligibility): boolean {
  return unitEffects(s, u).some((e) => e.eligible?.includes(what) && holds(e, { s, A: u }));
}

export function detRolls(s: GameState, u: UnitState) {
  const es = unitEffects(s, u).filter((e) => holds(e, { s, A: u }));
  return {
    rerollAdvance: es.some((e) => e.rerollAdvance),
    rerollCharge: es.some((e) => e.rerollCharge),
    advanceSix: es.some((e) => e.advanceSix),
    advanceBonus: es.reduce((a, e) => a + (e.advanceBonus ?? 0), 0),
    chargeBonus: es.reduce((a, e) => a + (e.chargeBonus ?? 0), 0),
    advanceSelfMortals: es.find((e) => e.advanceSelfMortals)?.advanceSelfMortals,
  };
}

export const detMove = (s: GameState, u: UnitState) => unitEffects(s, u).reduce((a, e) => a + (holds(e, { s, A: u }) ? e.move ?? 0 : 0), 0);

/** Objective Control of one model, with detachment bonuses (battle-shocked units normally count 0). */
export function modelOc(s: GameState, u: UnitState, m: ModelState): number {
  const es = unitEffects(s, u).filter((e) => holds(e, { s, A: u }));
  if (u.battleShocked) return es.reduce((a, e) => Math.max(a, e.shockedOc ?? 0), 0);
  return (m.profile.OC ?? 0) + es.reduce((a, e) => a + (e.oc ?? 0), 0);
}

// ---------- "choose one" rules ----------

export interface DetChoiceNow { rule: string; choice: DetChoice; state: DetChoiceState; open: boolean; options: { o: DetChoiceOption; why: string | null }[] }

/** Choice rules of player p, whether one can be picked right now and why an option is unavailable. */
export function detChoices(s: GameState, p: PlayerId): DetChoiceNow[] {
  const out: DetChoiceNow[] = [];
  for (const d of s.players[p].detachments ?? []) {
    const ch = DET_RULES[d.name]?.choice;
    if (!ch) continue;
    const st: DetChoiceState = s.players[p].det?.[d.name] ?? { active: [], used: [], count: 0 };
    const inCommand = s.phase === 'command' && s.active === p;
    let open = inCommand;
    if (ch.when === 'command') open = inCommand && st.pickedTurn !== s.turn && (ch.uses !== 'limit' || st.count < (ch.limit ?? 1));
    if (ch.when === 'round') open = inCommand && st.round !== s.round;
    if (ch.when === 'battle') open = inCommand && st.active.length < (ch.pick ?? 1) && st.count === 0;
    const options = ch.options.map((o) => ({
      o,
      why: (ch.uses === 'eachOnce' || ch.uses === 'limit') && st.used.includes(o.id) ? 'ใช้ไปแล้วในเกมนี้' : null,
    }));
    out.push({ rule: d.name, choice: ch, state: st, open, options });
  }
  return out;
}

export function pickDetChoice(s: GameState, p: PlayerId, rule: string, ids: string[]): string | null {
  const now = detChoices(s, p).find((c) => c.rule === rule);
  if (!now) return 'ไม่มีกฎนี้';
  if (!now.open) return 'เลือกตอนนี้ไม่ได้';
  const need = now.choice.pick ?? 1;
  if (ids.length !== need) return `ต้องเลือก ${need} อย่าง`;
  for (const id of ids) {
    const o = now.options.find((x) => x.o.id === id);
    if (!o) return 'ไม่มีตัวเลือกนี้';
    if (o.why) return o.why;
  }
  const st = (detState(s, p)[rule] ??= { active: [], used: [], count: 0 });
  st.active = [...ids];
  st.used = [...new Set([...st.used, ...ids])];
  st.count += 1;
  st.pickedTurn = s.turn;
  st.round = s.round;
  const names = ids.map((id) => now.choice.options.find((o) => o.id === id)!.name).join(' + ');
  log(s, `📜 ${now.choice.name}: ${names}`, 'info', p);
  return null;
}

/** Expire choices at the start of the owner's Command phase ("until the start of your next Command phase")
 *  and per-battle-round ones when a new round starts. */
export function detOnCommandStart(s: GameState, p: PlayerId, newRound: boolean) {
  for (const pl of [0, 1] as PlayerId[]) {
    for (const d of s.players[pl].detachments ?? []) {
      const ch = DET_RULES[d.name]?.choice;
      const st = s.players[pl].det?.[d.name];
      if (!ch || !st) continue;
      if (ch.when === 'command' && pl === p) st.active = [];
      if (ch.when === 'round' && newRound) st.active = [];
    }
  }
}

/** One-line summary of how much of each detachment rule the app applies, for the screen. */
export function detSummary(s: GameState, p: PlayerId): { name: string; auto: DetRule['auto'] | 'none'; manual?: string; active: string[] }[] {
  return (s.players[p].detachments ?? []).map((d) => {
    const r = DET_RULES[d.name];
    const st = s.players[p].det?.[d.name];
    const active = r?.choice ? (st?.active ?? []).map((id) => r.choice!.options.find((o) => o.id === id)?.name ?? id) : [];
    return { name: d.name, auto: r?.auto ?? 'none', manual: r?.manual, active };
  });
}
