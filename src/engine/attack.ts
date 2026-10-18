// Making Attacks (04) + Attack Sequence (05), resolved stage by stage so the UI can show every roll.
import { weaponFx } from './weaponFx';
import { combatMods, runPoolFinishers, type CombinedMods } from './combatMods';
import { assaultWeapons, emit, rescueDie, targetBlock } from './events';
import { RULES } from './config';
import { d6, exprAverage, rollExpr, rollN } from './dice';
import { baseDist, clamp, coherencyProblems, gap, reachOf } from './geometry';
import { alive, boardUnits, canUseStratagem, emitReact, unitDistance, engagedEnemies, hasKw, isEngaged, log, pushFx, modelEngagedWith, onBoard, other, spendStratagem, unitById, wantsCR } from './state';
import type { AttackReport, AttackSession, Die, GameState, ModelState, Pool, UnitState, WeaponData, WeaponProfileData } from './types';
import { condApplies, getAbility, hasAbility, isMelee } from './weapons';
import { onUnitDestroyed } from './missions';
import { hasCover, modelVisible, unitVisibleTo } from './visibility';

/** A free "re-roll one hit, wound or damage roll" still unused (set by activations.ts): takes it and returns true. */
let freeDamageHook: ((s: GameState) => boolean) | null = null;
export const setFreeDamageHook = (h: (s: GameState) => boolean) => { freeDamageHook = h; };
import { addToExpr, applyAttackEffects, applyLateEffects, canDo, fxKey, grants, incomingFor, isRiled, modelDefence, offenceFor, targetHasCover, unitFlags, unitGrants, untargetableAt, useNegate, weaponRangeFor } from '../rules-engine/effects';

export type ShootMode = 'normal' | 'assault' | 'closeQuarters' | 'indirect' | 'snap';

export interface ShootOptions {
  mode: ShootMode;
  useCloseQuarters?: boolean; // non-M/V models: fire close-quarters weapons instead of other guns
  profile?: Record<string, number>; // weapon name -> chosen profile index
  skipWeapons?: string[];
  models?: string[]; // only these models (destroyed models that shoot before being removed)
}

// ---------- helpers ----------

export function targetToughness(u: UnitState, s?: GameState): number {
  const a = alive(u);
  const body = a.filter((m) => m.isBodyguard);
  const pool = body.length ? body : a;
  if (u.abilities.some((x) => x.name === 'Kill Team')) {
    const counts = new Map<number, number>();
    for (const m of pool) counts.set(m.profile.T, (counts.get(m.profile.T) ?? 0) + 1);
    const majority = Math.max(...counts.values());
    return Math.max(...[...counts].filter(([, n]) => n === majority).map(([t]) => t)) + (s ? unitFlags(s, u).toughness : 0);
  }
  return Math.max(...pool.map((m) => m.profile.T)) + (s ? unitFlags(s, u).toughness : 0);
}

export function woundNeed(S: number, T: number): number {
  if (S >= T * 2) return 2;
  if (S > T) return 3;
  if (S === T) return 4;
  if (S * 2 <= T) return 6;
  return 5;
}

const riled = isRiled;
export const effectiveInSv = (s: GameState, u: UnitState, m: ModelState, ranged = true, psychic = false, attacker?: UnitState) => {
  const best = Math.min(m.profile.InSv ?? 7, riled(s, u) ? 5 : 7, modelDefence(s, u, m, ranged ? 'ranged' : 'melee', psychic, attacker).inv ?? 7);
  return best >= 7 ? null : best;
};

/** Oath of Moment: re-roll hits (+1 to wound for codex armies) against the Oath target. */
function applyOath(s: GameState, A: UnitState, T: UnitState, pool: Pool) {
  const P = s.players[A.owner];
  if (P.oathTarget !== T.id || !A.abilities.some((a) => a.name === 'Oath of Moment')) return;
  pool.rerollAllHits = true;
  pool.hitNote = [pool.hitNote, 'Oath: re-roll hit'].filter(Boolean).join(' · ');
  if (P.oathWoundBonus) {
    pool.woundMod = clamp(pool.woundMod + 1, -RULES.modifierCaps.woundRoll, RULES.modifierCaps.woundRoll);
    pool.woundNote += ' · Oath +1';
  }
}

const isMV = (m: ModelState) => m.keywords.includes('MONSTER') || m.keywords.includes('VEHICLE');
const buffSum = (u: UnitState, plus: string, minus: string) => u.buffs.filter((b) => b.kind === plus).length - u.buffs.filter((b) => b.kind === minus).length;
const has = (u: UnitState, kind: string) => u.buffs.some((b) => b.kind === kind);

interface Mods { skillDelta: number; skillNotes: string[]; hit: number; hitNotes: string[] }

function finishPoolMods(p: WeaponProfileData, mods: Mods, psychic: boolean) {
  let skillDelta = mods.skillDelta;
  let hit = mods.hit;
  if (psychic) { skillDelta = Math.min(0, skillDelta); hit = Math.max(0, hit); } // ignore detrimental modifiers
  const skill = p.skill === null ? null : clamp(p.skill + skillDelta, RULES.modifierCaps.bestSkill, RULES.modifierCaps.worstSkill);
  return { skill, hit: clamp(hit, -RULES.modifierCaps.hitRoll, RULES.modifierCaps.hitRoll) };
}

function newPool(key: string, w: WeaponData, p: WeaponProfileData, target: UnitState): Pool {
  const tk = target.keywords;
  const sus = getAbility(p, 'sustained-hits', tk);
  const anti = p.abilities.length ? (getAbility(p, 'anti', tk)?.on ?? 7) : 7;
  return {
    key, weapon: w.name, profile: p, models: 0, instances: [], attacks: 0, attackNote: '',
    skill: p.skill, skillNote: '', hitMod: 0, hitNote: '', hitOn6Only: false, autoHit: hasAbility(p, 'torrent', tk), noHitReroll: false,
    woundNeed: 4, woundMod: 0, woundNote: '', critWoundOn: Math.min(6, anti),
    sustained: sus ? (sus.value ?? '1') : null,
    lethal: hasAbility(p, 'lethal-hits', tk), devastating: hasAbility(p, 'devastating-wounds', tk), twinLinked: hasAbility(p, 'twin-linked', tk),
    precision: hasAbility(p, 'precision', tk), psychic: hasAbility(p, 'psychic'), ap: p.AP, damage: p.D, hazardous: 0,
    hits: [], wounds: [], autoWounds: 0, saves: [], saveTargets: [], mortalFromDev: [], damageLines: [], killed: 0, done: false,
  };
}

function applyUnitBuffs(pool: Pool, u: UnitState) {
  if (u.buffs.some((b) => b.kind === 'lethal')) pool.lethal = true;
  if (u.buffs.some((b) => b.kind === 'devastating')) pool.devastating = true;
  if (u.buffs.some((b) => b.kind === 'sustained1') && !pool.sustained) pool.sustained = '1';
  const ap = u.buffs.filter((b) => b.kind === 'ap+1').length;
  if (ap) pool.ap = pool.ap - ap;
}

/** "Ignore any or all modifiers to BS/WS and the Hit roll": drop the bad ones once everything is folded in. */
function finishIgnore(pool: Pool, all = false) {
  // Unbowed Conviction: ignore every modifier to its rolls (saving throws excepted)
  if (all) { pool.ignoreHitMods = true; pool.ignoreWoundMods = true; pool.woundMod = Math.max(0, pool.woundMod); }
  if (!pool.ignoreHitMods) return;
  pool.hitMod = Math.max(0, pool.hitMod);
  if (pool.skill !== null && pool.profile.skill !== null) pool.skill = Math.min(pool.skill, pool.profile.skill);
}

// ---------- building pools ----------

export interface BuildResult { pools: Pool[]; notes: string[]; error?: string }

export function shootingModes(s: GameState, u: UnitState): ShootMode[] {
  if (!onBoard(u) || u.selectedToShoot || unitFlags(s, u).cannotShoot || (u.move === 'fallback' && !canDo(s, u, 'shootAfterFallBack') && !hasKw(u, 'TITANIC'))) return [];
  const weps = alive(u).flatMap((m) => m.weapons.flatMap((w) => w.profiles)).filter((p) => !isMelee(p));
  if (!weps.length) return [];
  const engaged = isEngaged(s, u);
  const modes: ShootMode[] = [];
  if (engaged) {
    if (u.move !== 'advance' && (weps.some((p) => hasAbility(p, 'close-quarters')) || alive(u).some(isMV))) modes.push('closeQuarters');
    return modes;
  }
  if (u.move === 'advance' && !canDo(s, u, 'shootAfterAdvance')) {
    if (riled(s, u) || weps.some((p) => hasAbility(p, 'assault')) || unitGrants(s, u, 'assault', 'ranged') || assaultWeapons(s, u)) modes.push('assault');
    return modes;
  }
  modes.push('normal');
  if (weps.some((p) => hasAbility(p, 'indirect-fire'))) modes.push('indirect');
  return modes;
}

/**
 * Firing Deck X (24.14): when the transport shoots, up to X ranged weapons of the models embarked within it shoot
 * too, from the transport (one weapon per model, the strongest first). They come in as extra shooters standing
 * where the transport's hull is.
 */
function firingDeck(s: GameState, A: UnitState, opt: ShootOptions): ModelState[] {
  const X = A.core.firingDeck;
  const hull = alive(A)[0];
  if (!X || !hull || opt.mode === 'closeQuarters') return [];
  const strength = (w: WeaponData) => { const p = w.profiles[0]; return (exprAverage(String(p.A)) || 1) * (p.S ?? 3) * (exprAverage(String(p.D)) || 1); };
  const picks = s.units.filter((u) => u.status === 'embarked' && u.embarkedIn === A.id).flatMap((u) => alive(u))
    .map((m) => ({ m, w: m.weapons.filter((w) => !isMelee(w.profiles[0]) && !A.weaponsFired.includes(w.name)).sort((a, b) => strength(b) - strength(a))[0] }))
    .filter((x): x is { m: ModelState; w: WeaponData } => !!x.w)
    .sort((a, b) => strength(b.w) - strength(a.w))
    .slice(0, X);
  return picks.map(({ m, w }) => ({ ...m, x: hull.x, y: hull.y, r: hull.r, weapons: [w] }));
}

export function buildShootPools(s: GameState, attackerId: string, targetId: string, opt: ShootOptions): BuildResult {
  const A = unitById(s, attackerId);
  const T = unitById(s, targetId);
  const notes: string[] = [];
  const pools = new Map<string, Pool>();
  const tModels = alive(T);
  // All Is Rot: enemy units engaged only with that Plague Legions unit can still be shot
  const tEngaged = engagedEnemies(s, T).some((f) => !unitFlags(s, f).allIsRot);
  const engagedWithTarget = engagedEnemies(s, A).some((e) => e.id === T.id);
  const tIsMV = tModels.some(isMV);
  const aFlags = unitFlags(s, A);
  const canShootIntoEngagement = aFlags.shootIntoEngagement > 0
    && unitDistance(A, T) <= aFlags.shootIntoEngagement + 1e-6
    && engagedEnemies(s, T).some((f) => f.owner === A.owner);
  if (opt.mode !== 'closeQuarters' && tEngaged && !tIsMV && !canShootIntoEngagement) return { pools: [], notes, error: 'The target is engaged and cannot be shot (unless MONSTER / VEHICLE)' };
  if (opt.mode === 'closeQuarters' && !engagedWithTarget && !alive(A).some(isMV)) return { pools: [], notes, error: 'Close-quarters can only target a unit it is engaged with' };
  const T_T = targetToughness(T, s);
  const isOwnShootingPhase = s.phase === 'shooting' && A.owner === s.active;
  if (aFlags.cannotShoot) return { pools: [], notes, error: 'This unit is not eligible to shoot this phase' };
  // Heresy Undone: after Advancing / Falling Back it may only shoot auspex scanned units
  if (aFlags.onlyTargetMarked && (A.move === 'advance' || A.move === 'fallback') && !(T.timed ?? []).some((t) => t.mark === aFlags.onlyTargetMarked && t.by === A.owner)) return { pools: [], notes, error: 'After Advancing / Falling Back it can only shoot a unit marked by the auspex scan' };

  // Advancing with [ASSAULT] weapons does not need Thrill Seekers, so no restriction then
  const thrill = targetBlock(s, A, T, 'shoot', opt.mode === 'assault');
  if (thrill) return { pools: [], notes, error: thrill };

  // Seal of Shrouding / Blazing Icon / Linebreaker Onslaught: enemy units cannot snap-shoot this unit
  if (opt.mode === 'snap' && unitFlags(s, T).noSnapTarget) return { pools: [], notes, error: 'This unit cannot be targeted by snap shooting' };
  const shooters = opt.models ? A.models.filter((m) => opt.models!.includes(m.id)) : [...alive(A), ...firingDeck(s, A, opt)];
  // sight and cover depend on the model, not the weapon: worked out once per model
  const sees = new Map<ModelState, boolean>();
  const seesT = (m: ModelState) => { let v = sees.get(m); if (v === undefined) { v = tModels.some((t) => modelVisible(s, m, T, t, aFlags.ignoreLoneOperative)); sees.set(m, v); } return v; };
  // a weapon's target must be visible to its unit and in range of the weapon: the model that sees it and the model in
  // range can be different ones (04.02 FAQ), so a squad half inside a ruin shoots with every model in range
  let unitSeen: boolean | undefined;
  const unitSees = () => (unitSeen ??= shooters.some(seesT));
  const covered = new Map<ModelState, boolean>();
  const coverOf = (m: ModelState) => { let v = covered.get(m); if (v === undefined) { v = hasCover(s, m, T); covered.set(m, v); } return v; };
  for (const m of shooters) {
    const ranged = m.weapons.filter((w) => !isMelee(w.profiles[0]) && !(opt.skipWeapons ?? []).includes(w.name) && (!!opt.models || !A.weaponsFired.includes(w.name)));
    const cqOnly = ranged.filter((w) => hasAbility(w.profiles[0], 'close-quarters'));
    const others = ranged.filter((w) => !hasAbility(w.profiles[0], 'close-quarters'));
    let chosen = ranged;
    if (!isMV(m)) {
      // a model shoots either its [CLOSE-QUARTERS] (pistol) weapons or its others, never both (24.07): once one kind
      // has fired at a target, only that kind can fire at another
      const all = m.weapons.filter((w) => !isMelee(w.profiles[0]));
      const firedCq = !opt.models && all.some((w) => hasAbility(w.profiles[0], 'close-quarters') && A.weaponsFired.includes(w.name));
      const firedOther = !opt.models && all.some((w) => !hasAbility(w.profiles[0], 'close-quarters') && A.weaponsFired.includes(w.name));
      if (opt.mode === 'closeQuarters') chosen = firedOther ? [] : cqOnly;
      else if (firedOther) chosen = others;
      else if (firedCq) chosen = cqOnly;
      // pistols only when chosen, or when the model carries no other gun (skipping its guns never fires its pistols instead)
      else chosen = opt.useCloseQuarters || !all.some((w) => !hasAbility(w.profiles[0], 'close-quarters')) ? cqOnly : others;
    }
    const damagedHit = A.core.damaged !== undefined && m.wounds <= A.core.damaged;
    for (const w of chosen) {
      // Hunter (army rule): a profile marked "Hunter: MONSTER/VEHICLE" only shoots at those; the weapon's other profile then
      const hunts = (q: WeaponProfileData) => { const h = getAbility(q, 'hunter'); return !h || condApplies(h.cond, T.keywords); };
      let pi = Math.min(opt.profile?.[w.name] ?? 0, w.profiles.length - 1);
      if (!hunts(w.profiles[pi])) pi = w.profiles.findIndex(hunts);
      if (pi < 0) continue;
      if ((opt.mode === 'assault' || A.move === 'advance') && !canDo(s, A, 'shootAfterAdvance') && !riled(s, A) && !hasAbility(w.profiles[pi], 'assault')) {
        const assaultIdx = w.profiles.findIndex((q) => hasAbility(q, 'assault') && hunts(q));
        if (assaultIdx >= 0) pi = assaultIdx;
      }
      const p = w.profiles[pi];
      if (hasAbility(p, 'one-shot') && A.oneShotUsed.includes(w.name)) continue;
      const baseRange = typeof p.range === 'number' ? p.range : 0;
      const range = (aFlags.rangeMinus ? Math.max(Math.min(baseRange, 12), baseRange - aFlags.rangeMinus) : baseRange) + (baseRange > 0 ? aFlags.rangeBonus + weaponRangeFor(s, A, m, T, w, p) : 0);
      const d = Math.min(...tModels.map((t) => baseDist(m, t)));
      const fx = offenceFor(s, A, m, T, w, p, 'ranged', d);
      const psy = hasAbility(p, 'psychic') || grants(fx, [], 'psychic');
      const inc = incomingFor(s, A, m, T, 'ranged').filter((i) => !i.psychic || psy);
      const cm = combatMods({ s, A, T, m, psychic: psy, mode: 'ranged', d, p, weapon: w.name });
      if ((opt.mode === 'assault' || A.move === 'advance') && !canDo(s, A, 'shootAfterAdvance') && !riled(s, A) && !hasAbility(p, 'assault') && !grants(fx, inc, 'assault') && !assaultWeapons(s, A) && !cm.assault) continue;
      const maxRange = opt.mode === 'snap' ? Math.min(range, RULES.snapShooting.range) : range;
      if (d > maxRange + 1e-6) continue;
      if (untargetableAt(s, T, d)) continue;
      if (d > unitFlags(s, T).targetableWithin + 1e-6) continue; // In the Shadow of Great Wings
      if (T.core.loneOperative && T.sources.length === 1 && d > T.core.loneOperative && !aFlags.ignoreLoneOperative) continue;
      if (opt.mode === 'closeQuarters' && !isMV(m) && !engagedWithTarget) continue;
      if (hasAbility(p, 'blast') && tEngaged) continue;
      const indirect = opt.mode === 'indirect' && hasAbility(p, 'indirect-fire');
      if (!indirect && !unitSees()) continue;
      if (indirect && T.core.loneOperative && T.sources.length === 1 && d > T.core.loneOperative) continue;

      const mods: Mods = { skillDelta: -cm.skillBonus, skillNotes: [...cm.skillNotes], hit: cm.hitMod, hitNotes: [...cm.hitNotes] };
      const ignoresCover = cm.ignoresCover || hasAbility(p, 'ignores-cover', T.keywords) || A.buffs.some((b) => b.kind === 'ignoresCover') || grants(fx, inc, 'ignores cover') || inc.some((i) => i.noCover);
      const cover = indirect || aFlags.givesCover || (!ignoresCover && (coverOf(m) || targetHasCover(s, T, d)));
      if (cover) { mods.skillDelta += 1; mods.skillNotes.push('Cover −1 BS'); }
      if (m.keywords.includes('TOWERING') && d <= RULES.plungingFire.toweringRange && !T.keywords.includes('AIRCRAFT')) { mods.skillDelta -= 1; mods.skillNotes.push('Plunging Fire +1 BS'); }
      const heavy = hasAbility(p, 'heavy') || grants(fx, inc, 'heavy') || cm.heavy;
      if (heavy && isOwnShootingPhase && !isEngaged(s, A) && A.setUpTurn !== s.turn && A.maxMoved <= RULES.heavyMaxMove + 1e-6) { mods.hit += 1; mods.hitNotes.push('Heavy +1'); }
      if (tIsMV && tEngaged && !(hasAbility(p, 'close-quarters') && engagedWithTarget)) { mods.hit -= 1; mods.hitNotes.push('Engaged MONSTER/VEHICLE target −1'); }
      if (opt.mode === 'closeQuarters' && isMV(m) && !aFlags.noBigGunsPenalty && !(hasAbility(p, 'close-quarters') && engagedWithTarget)) { mods.hit -= 1; mods.hitNotes.push('Big guns in combat −1'); }
      if (damagedHit) { mods.hit -= 1; mods.hitNotes.push('Damaged −1'); }
      const bh = buffSum(A, 'hit+1', 'hit-1');
      if (bh) { mods.hit += bh; mods.hitNotes.push(`Buff ${bh > 0 ? '+' : ''}${bh}`); }
      for (const a of fx) {
        if (a.e.skill) { mods.skillDelta -= a.e.skill; mods.skillNotes.push(`${a.label} +${a.e.skill} BS`); }
      }
      const psychic = hasAbility(p, 'psychic');
      const fm = finishPoolMods(p, mods, psychic);
      const half = d <= range / 2 + 1e-6;
      const key = [m.source, w.name, p.name, cover, half, fm.skill, fm.hit, fxKey(fx, inc)].join('|');
      let pool = pools.get(key);
      if (!pool) {
        pool = newPool(key, w, p, T);
        pool.skill = fm.skill;
        pool.skillNote = mods.skillNotes.join(' · ');
        pool.hitMod = fm.hit;
        pool.hitNote = mods.hitNotes.join(' · ') + (psychic ? ' (Psychic: ignores negative modifiers)' : '');
        if (opt.mode === 'snap') { pool.hitOn6Only = true; pool.noHitReroll = true; pool.autoHit = false; pool.snap = true; pool.hitNote = 'Snap Shooting: hits only on a 6 (not Critical, no re-rolls)'; }
        if (indirect) {
          pool.noHitReroll = true;
          const spotted = A.move === 'stationary' && s.units.some((f) => f.owner === A.owner && onBoard(f) && alive(f).some((fm2) => tModels.some((t) => modelVisible(s, fm2, T, t))));
          pool.hitOn6Only = !spotted;
          if (spotted) pool.minHitUnmodified = RULES.indirectFire.spottedStationaryHitOn;
          pool.hitNote += spotted ? ' · Indirect (stationary and spotted): 1-3 fail' : ' · Indirect: hits only on a 6';
        }
        const melta = getAbility(p, 'melta', T.keywords);
        if (melta && half) pool.damage = `${p.D}+${melta.value ?? 0}`.replace(/^(\d+)\+(\d+)$/, (_, a, b) => String(+a + +b));
        let strength = (p.S ?? 1) + cm.strengthBonus;
        pool.woundNeed = woundNeed(strength, T_T);
        applyCombatMods(pool, cm);
        const wm = clamp(buffSum(A, 'wound+1', 'wound-1') + cm.woundMod, -RULES.modifierCaps.woundRoll, RULES.modifierCaps.woundRoll);
        pool.woundMod = wm;
        pool.woundNote = [`S${strength} vs T${T_T}`, ...(wm ? [`Buff ${wm > 0 ? '+' : ''}${wm}`] : []), ...cm.otherNotes].join(' · ');
        if (psy) pool.psychic = true;
        applyUnitBuffs(pool, A);
        applyOath(s, A, T, pool);
        runPoolFinishers({ s, A, T, m, psychic: psy, mode: 'ranged', d, p, weapon: w.name }, pool);
        applyAttackEffects(s, A, T, pool, fx, inc, 'ranged', d, T_T, woundNeed);
        finishIgnore(pool, unitFlags(s, A).ignoreMods || cm.ignoreMods);
        pools.set(key, pool);
      }
      pool.models += 1;
      const extras: string[] = [];
      let flat = 0;
      const rf = getAbility(p, 'rapid-fire', T.keywords);
      // Close-range Dakka: a granted [RAPID FIRE 1] on a weapon that has it already adds 1 to its value
      const rfPlus = grants(fx, inc, 'rapid fire +1') ? 1 : 0;
      if (rf && (half || fx.some((a) => a.e.rapidFireFullRange))) extras.push(rfPlus ? `${rf.value ?? '1'}+1` : rf.value ?? '1');
      else if (half && (grants(fx, inc, 'rapid fire 1') || rfPlus)) extras.push('1');
      const blast = getAbility(p, 'blast', T.keywords);
      if (blast) flat += parseInt(blast.value ?? '1', 10) * Math.floor(tModels.length / 5);
      else if (grants(fx, inc, 'blast 1')) flat += Math.floor(tModels.length / 5);
      if (hasAbility(p, 'rapid-fire')) {
        for (const a of fx) if (a.e.rapidFireAttacks) flat += a.e.rapidFireAttacks;
      }
      flat += cm.attacksBonus;
      pool.instances.push({ A: p.A, extras, flat });
      if (hasAbility(p, 'hazardous') || pool.hazardousAll) pool.hazardous += 1;
    }
  }
  const list = [...pools.values()];
  for (const pl of list) pl.attackNote = attackNote(pl);
  if (!list.length) notes.push('No weapon in range with the target visible');
  return { pools: list, notes };
}

export function meleeWeapons(m: ModelState): WeaponData[] {
  return m.weapons.filter((w) => isMelee(w.profiles[0]));
}

function scoreMelee(p: WeaponProfileData, T: number) {
  const a = exprAverage(p.A);
  const hit = (7 - (p.skill ?? 4)) / 6;
  const wound = (7 - woundNeed(p.S ?? 1, T)) / 6;
  return a * hit * wound * (1 + -p.AP * 0.25) * exprAverage(p.D);
}

export function buildFightPools(s: GameState, attackerId: string, targetId: string, opt: { weapon?: string; epicChallengeModel?: string; models?: string[] } = {}): BuildResult {
  const A = unitById(s, attackerId);
  const T = unitById(s, targetId);
  const T_T = targetToughness(T, s);
  const pools = new Map<string, Pool>();
  const only = A.fightOnly && A.fightOnly.key === `${s.turn}:${s.phase}` ? A.fightOnly.models : undefined;
  const fighters = opt.models ? A.models.filter((m) => opt.models!.includes(m.id)) : only ? alive(A).filter((m) => only.includes(m.id)) : alive(A);
  // Angel's Sacrifice: models in Engagement Range of the taunting unit must attack it
  const taunters = unitFlags(s, T).taunt ? [] : engagedEnemies(s, A).filter((e) => unitFlags(s, e).taunt);
  const glamour = unitFlags(s, T).glamour;
  const reach3 = unitFlags(s, A).fightReach3 && engagedEnemies(s, A).some((e) => e.id === T.id);
  const sens = targetBlock(s, A, T, 'fight');
  if (sens) return { pools: [], notes: [], error: sens };
  for (const m of fighters) {
    if (!modelEngagedWith(m, T) && !(reach3 && alive(T).some((t) => baseDist(m, t) <= 3 + 1e-6))) continue;
    if (taunters.some((e) => modelEngagedWith(m, e))) continue;
    if (glamour && engagedEnemies(s, A).some((e) => e.id !== T.id && e.factionKeywords.includes('SCINTILLATING LEGIONS') && modelEngagedWith(m, e))) continue;
    const d = Math.min(...alive(T).map((t) => baseDist(m, t)));
    const melee = meleeWeapons(m);
    const extra = melee.filter((w) => hasAbility(w.profiles[0], 'extra-attacks'));
    const normal = melee.filter((w) => !hasAbility(w.profiles[0], 'extra-attacks'));
    let main = normal.find((w) => w.name === opt.weapon);
    if (!main) main = [...normal].sort((a, b) => scoreMelee(b.profiles[0], T_T) - scoreMelee(a.profiles[0], T_T))[0];
    const use = [...(main ? [main] : []), ...extra];
    if (!use.length) use.push({ name: 'Close combat weapon', profiles: [{ name: 'Close combat weapon', range: 'Melee', A: '1', skill: 4, S: m.profile.T, AP: 0, D: '1', abilities: [] }] });
    const damagedHit = A.core.damaged !== undefined && m.wounds <= A.core.damaged;
    for (const w of use) {
      const p = w.profiles[0];
      const fx = offenceFor(s, A, m, T, w, p, 'melee', d);
      const psy = hasAbility(p, 'psychic') || grants(fx, [], 'psychic');
      const inc = incomingFor(s, A, m, T, 'melee').filter((i) => !i.psychic || psy);
      const cm = combatMods({ s, A, T, m, psychic: psy, mode: 'melee', d: 0, p, weapon: w.name });
      const mods: Mods = { skillDelta: -cm.skillBonus, skillNotes: [...cm.skillNotes], hit: cm.hitMod, hitNotes: [...cm.hitNotes] };
      if (damagedHit) { mods.hit -= 1; mods.hitNotes.push('Damaged −1'); }
      // Shield of Honour: this model is engaged with that unit but attacks another one
      const shamed = engagedEnemies(s, A).some((e) => e.id !== T.id && unitFlags(s, e).shieldOfHonour && modelEngagedWith(m, e));
      if (shamed) { mods.hit -= 1; mods.hitNotes.push('Shield of Honour −1'); }
      const bh = buffSum(A, 'hit+1', 'hit-1');
      if (bh) { mods.hit += bh; mods.hitNotes.push(`Buff ${bh > 0 ? '+' : ''}${bh}`); }
      for (const a of fx) {
        if (a.e.skill) { mods.skillDelta -= a.e.skill; mods.skillNotes.push(`${a.label} +${a.e.skill} WS`); }
      }
      const fm = finishPoolMods(p, mods, hasAbility(p, 'psychic'));
      const precision = opt.epicChallengeModel === m.id || cm.precision;
      const key = [m.source, w.name, fm.skill, fm.hit, precision, shamed, fxKey(fx, inc)].join('|');
      let pool = pools.get(key);
      if (!pool) {
        pool = newPool(key, w, p, T);
        pool.skill = fm.skill; pool.hitMod = fm.hit; pool.hitNote = mods.hitNotes.join(' · ');
        if (precision) pool.precision = true;
        let strength = (p.S ?? 1) + cm.strengthBonus;
        pool.woundNeed = woundNeed(strength, T_T);
        let wm = buffSum(A, 'wound+1', 'wound-1') + cm.woundMod;
        const notes = [`S${strength} vs T${T_T}`];
        if (hasAbility(p, 'lance', T.keywords) && A.chargedTurn === s.turn) { wm += 1; notes.push('Lance +1'); }
        if (shamed) { wm -= 1; notes.push('Shield of Honour −1'); }
        notes.push(...cm.otherNotes);
        pool.woundMod = clamp(wm, -RULES.modifierCaps.woundRoll, RULES.modifierCaps.woundRoll);
        pool.woundNote = notes.join(' · ');
        applyCombatMods(pool, cm);
        if (psy) pool.psychic = true;
        applyUnitBuffs(pool, A);
        applyOath(s, A, T, pool);
        runPoolFinishers({ s, A, T, m, psychic: psy, mode: 'melee', d: 0, p, weapon: w.name }, pool);
        applyAttackEffects(s, A, T, pool, fx, inc, 'melee', d, T_T, woundNeed);
        finishIgnore(pool, unitFlags(s, A).ignoreMods);
        pools.set(key, pool);
      }
      pool.models += 1;
      const cleave = getAbility(p, 'cleave', T.keywords);
      const cleaveN = (cleave ? parseInt(cleave.value ?? '1', 10) : grants(fx, inc, 'cleave 1') || grants(fx, inc, 'cleave +1') ? 1 : 0) + (cleave && grants(fx, inc, 'cleave +1') ? 1 : 0); // Into the Fray; Mow 'Em Down: +1
      pool.instances.push({ A: p.A, extras: [], flat: cleaveN * Math.floor(alive(T).length / 5) + cm.attacksBonus });
      if (hasAbility(p, 'hazardous') || pool.hazardousAll) pool.hazardous += 1;
    }
  }
  const list = [...pools.values()];
  for (const pl of list) pl.attackNote = attackNote(pl);
  return { pools: list, notes: list.length ? [] : ['No model is engaged with the target'] };
}

/** The notes of an attack that changed its odds, by the stage they act at (the base numbers are left out). */
function attackChips(pools: Pool[]): AttackReport['chips'] {
  const out: AttackReport['chips'] = [];
  const plain = /^(\d+ models × A|S\d+ vs T|Attacks rolled|re-roll .*→|Command Re-roll .*→)/;
  let rapid = 0;
  const add = (stage: AttackReport['chips'][number]['stage'], text: string) => {
    const label = text.trim();
    if (!label || plain.test(label)) return;
    const rf = /^Rapid Fire ×(\d+)$/.exec(label);
    if (rf) { rapid += +rf[1]; return; } // one chip for the whole attack, however many weapon groups fired
    const short = label.length > 26 ? label.slice(0, 25) + '…' : label;
    if (!out.some((c) => c.label === short)) out.push({ stage, label: short });
  };
  for (const p of pools) {
    for (const part of p.attackNote.split(' · ')) add('attacks', part);
    for (const part of `${p.skillNote} · ${p.hitNote}`.split(' · ')) add('hit', part);
    if (p.rerollAllHits && !/re-roll hit/i.test(p.hitNote)) add('hit', 'Re-roll hits');
    else if (p.rerollHits1) add('hit', 'Re-roll hit 1s');
    if (p.sustained) add('hit', `Sustained Hits ${p.sustained}`);
    if (p.lethal) add('hit', 'Lethal Hits');
    if (p.critHitOn && p.critHitOn < 6) add('hit', `Critical hits on ${p.critHitOn}+`);
    if (p.autoHit && !p.hitOn6Only) add('hit', 'Torrent: hits automatically');
    for (const part of p.woundNote.split(' · ')) add('wound', part);
    if (p.twinLinked) add('wound', 'Twin-linked');
    if (p.rerollAllWounds) add('wound', 'Re-roll wounds');
    else if (p.rerollWounds12) add('wound', 'Re-roll wound 1s and 2s');
    else if (p.rerollWounds1) add('wound', 'Re-roll wound 1s');
    if (p.critWoundOn < 6) add('wound', `Critical wounds on ${p.critWoundOn}+`);
    if (p.devastating) add('save', 'Devastating Wounds');
    if (p.precision) add('save', 'Precision');
  }
  if (rapid) out.unshift({ stage: 'attacks', label: `Rapid Fire ×${rapid}` });
  return out.slice(0, 8);
}

function attackNote(p: Pool): string {
  const extra = p.instances.reduce((a, i) => a + i.flat, 0);
  const rf = p.instances.filter((i) => i.extras.length).length;
  return `${p.models} models × A${p.profile.A}${rf ? ` · Rapid Fire ×${rf}` : ''}${extra ? ` · +${extra} (Blast/Cleave)` : ''}`;
}

// ---------- expected value for previews ----------

export function expectedDamage(s: GameState, pool: Pool, target: UnitState): { attacks: number; hits: number; wounds: number; unsaved: number; models: number } {
  const attacks = pool.instances.reduce((a, i) => a + exprAverage(i.A) + i.extras.reduce((b, e) => b + exprAverage(e), 0) + i.flat + (pool.attackBonus ?? 0), 0);
  const pHit0 = pool.autoHit ? 1 : pool.hitOn6Only ? 1 / 6 : Math.max(1, Math.min(5, 7 - ((pool.skill ?? 7) - pool.hitMod))) / 6;
  // re-rolls: a failed (or a 1) hit is rolled again, which also brings more 6s
  const hitAgain = pool.autoHit ? 0 : pool.rerollAllHits ? 1 - pHit0 : pool.rerollHits1 ? 1 / 6 : 0;
  const pHit = pHit0 + hitAgain * pHit0;
  const pCrit = pool.autoHit ? 0 : (1 / 6) * (1 + hitAgain);
  const sus = pool.sustained ? exprAverage(pool.sustained) : 0;
  const hits = attacks * (pHit + pCrit * sus);
  const pW0 = Math.max(1, Math.min(5, 7 - (pool.woundNeed - pool.woundMod))) / 6;
  const pW = pW0 + (pool.rerollAllWounds ? 1 - pW0 : pool.rerollWounds12 ? Math.min(2 / 6, 1 - pW0) : pool.rerollWounds1 ? 1 / 6 : 0) * pW0;
  const lethal = pool.lethal ? attacks * pCrit : 0;
  const wounds = (hits - lethal) * pW + lethal;
  const m = alive(target)[0];
  const sv = m.profile.Sv - pool.ap;
  const best = Math.min(sv, effectiveInSv(s, target, m) ?? 7);
  const pFail = Math.min(1, Math.max(1 / 6, (best - 1) / 6));
  const unsaved = wounds * pFail;
  const dmg = Math.min(exprAverage(pool.damage), m.profile.W);
  return { attacks, hits, wounds, unsaved, models: (unsaved * dmg) / m.profile.W };
}

// ---------- running the session ----------

export function startAttack(s: GameState, kind: AttackSession['kind'], attackerId: string, targetId: string, pools: Pool[], opts: { free?: boolean } = {}) {
  const A = unitById(s, attackerId);
  for (const p of pools) {
    let total = 0;
    const parts: string[] = [];
    p.attackRolls = [];
    for (const i of p.instances) {
      const a = rollExpr(s, i.A);
      const ex = i.extras.map((e) => rollExpr(s, e).total);
      total += a.total + ex.reduce((x, y) => x + y, 0) + i.flat + (p.attackBonus ?? 0);
      if (a.dice.length) { parts.push(`${i.A}=${a.total}`); p.attackRolls.push({ expr: i.A, total: a.total }); }
    }
    p.attacks = total;
    if (parts.length) p.attackNote += ` · Attacks rolled: ${parts.join(', ')}`;
    if (!p.attackRolls.length) delete p.attackRolls;
    if (hasAbility(p.profile, 'one-shot') && !A.oneShotUsed.includes(p.weapon)) A.oneShotUsed.push(p.weapon);
    if (kind === 'shoot' && !opts.free && !A.weaponsFired.includes(p.weapon)) A.weaponsFired.push(p.weapon);
  }
  const T = unitById(s, targetId);
  s.attack = {
    kind, attackerId, targetId, pools, idx: 0, stage: pools.length ? 'hit' : 'done', hazardousRolls: [], summary: [],
    aliveBefore: alive(T).map((m) => m.id), woundsBefore: alive(T).reduce((a, m) => a + m.wounds, 0),
    attackerBuffsAtStart: A.buffs.map((b) => b.kind), free: opts.free,
    timedAtStart: { a: A.timed?.length ?? 0, t: T.timed?.length ?? 0 },
  };
  // Nightforged Battery: ranged weapons re-roll a low number of attacks for free
  // … or against a unit marked by Overwhelming Generosity
  if (kind === 'shoot' && (unitFlags(s, A).rerollAttackRolls || (T.timed ?? []).some((t) => t.e.incoming?.rerollAttacks && t.by === A.owner && A.factionKeywords.includes('DEATH GUARD')))) {
    for (const p of s.attack.pools) for (const r of p.attackRolls ?? []) {
      if (r.rerolled || r.total >= exprAverage(r.expr)) continue;
      const again = rollExpr(s, r.expr).total;
      p.attacks += again - r.total;
      p.attackNote += ` · re-roll ${r.expr}: ${r.total}→${again}`;
      r.total = again; r.rerolled = true;
    }
  }
  // a low random number of attacks: the bot (or a player who turned it on) re-rolls the worst one
  const low = s.attack.pools.map((p, i) => ({ i, gap: attackRerollGap(p) })).filter((x) => x.gap >= 1).sort((a, b) => b.gap - a.gap)[0];
  if (low && wantsCR(s, A.owner, 'attacks', A)) rerollAttackCount(s, low.i);
  emit(s, 'targetChosen', { attackerId: s.attack.attackerId, targetId: s.attack.targetId });
  for (const h of startHooks) h(s, s.attack);
  if (s.campaign) {
    resolveAll(s);
  }
}

/** How far below its average the worst random number of attacks of a pool is (0: nothing to re-roll). */
export function attackRerollGap(p: Pool): number {
  if (p.hits.length || !p.attackRolls) return 0;
  return Math.max(0, ...p.attackRolls.filter((r) => !r.rerolled).map((r) => exprAverage(r.expr) - r.total));
}

/** Command Re-roll: roll the worst random number of attacks of pool `idx` again (before its hit rolls). */
export function rerollAttackCount(s: GameState, idx: number): string | null {
  const at = s.attack!;
  const p = at.pools[idx];
  const A = unitById(s, at.attackerId);
  const why = canUseStratagem(s, A.owner, 'command-reroll', A);
  if (why) return why;
  const r = [...(p.attackRolls ?? [])].filter((x) => !x.rerolled).sort((a, b) => (a.total - exprAverage(a.expr)) - (b.total - exprAverage(b.expr)))[0];
  if (!r || p.hits.length) return 'No Attacks roll to re-roll';
  spendStratagem(s, A.owner, 'command-reroll', A);
  const again = rollExpr(s, r.expr).total;
  p.attacks += again - r.total;
  p.attackNote += ` · Command Re-roll ${r.expr}: ${r.total}→${again}`;
  log(s, `Command Re-roll Attacks ${p.weapon}: ${r.total}→${again}`, 'roll', A.owner);
  r.total = again;
  r.rerolled = true;
  return null;
}

/** Change one die of the current stage to a value ("change that roll to an unmodified 6", Miracle/Fate substitution). */
export function forceDie(s: GameState, stage: 'hit' | 'wound' | 'save', index: number, v: number) {
  const at = s.attack!;
  const p = at.pools[at.idx];
  if (stage === 'hit') { const d = p.hits[index]; p.hits[index] = { v, o: evalHit(p, v), rerolled: true, orig: d.v }; }
  else if (stage === 'wound') { const d = p.wounds[index]; p.wounds[index] = { v, o: evalWound(p, v), rerolled: true, orig: d.v }; }
  else if (stage === 'save') { const d = p.saves[index]; p.saves[index] = { v, o: 'pass', rerolled: true, orig: d.v }; }
}

export function evalHit(p: Pool, v: number): Die['o'] {
  if (v === 1) return 'miss';
  if (v >= (p.snap ? 6 : p.critHitOn ?? 6)) return p.snap ? (v === 6 ? 'hit' : 'miss') : 'crit';
  if (p.hitOn6Only) return 'miss';
  if (p.minHitUnmodified && v < p.minHitUnmodified) return 'miss';
  return v + p.hitMod >= (p.skill ?? 7) ? 'hit' : 'miss';
}

export function evalWound(p: Pool, v: number): Die['o'] {
  if (v === 1) return 'fail';
  if (v === 6 || v >= p.critWoundOn) return 'critWound';
  return v + p.woundMod >= p.woundNeed ? 'wound' : 'fail';
}

/** Defensive stratagems can be used after targets are picked, so they are folded in when the dice are rolled. */
function applyDefense(s: GameState, p: Pool) {
  if (p.defApplied) return;
  p.defApplied = true;
  const T = unitById(s, s.attack!.targetId);
  const notes: string[] = [];
  // stratagem effects (either side) used after the attack was declared
  const at0 = s.attack!.timedAtStart;
  if (at0) {
    const A0 = unitById(s, s.attack!.attackerId);
    const late = { attacker: (A0.timed ?? []).slice(at0.a), target: (T.timed ?? []).slice(at0.t) };
    if (late.attacker.length || late.target.length) applyLateEffects(s, A0, T, p, late, s.attack!.kind === 'fight' ? 'melee' : 'ranged', targetToughness(T, s), woundNeed);
  }
  if (has(T, 'enemyHit-1') && !p.autoHit && !p.ignoreHitMods) { p.hitMod = clamp(p.hitMod - 1, -RULES.modifierCaps.hitRoll, RULES.modifierCaps.hitRoll); notes.push('−1 Hit'); }
  if (has(T, 'enemyWound-1') && !p.ignoreWoundMods) { p.woundMod = clamp(p.woundMod - 1, -RULES.modifierCaps.woundRoll, RULES.modifierCaps.woundRoll); p.woundNote += ' · Stratagem −1'; }
  if (has(T, 'enemyAp-1') && p.ap < 0) { p.ap += 1; notes.push('AP worsened by 1'); }
  if (notes.length) p.hitNote = [p.hitNote, `Defender's Stratagem: ${notes.join(', ')}`].filter(Boolean).join(' · ');
  // attacker stratagems used after the attack was declared (e.g. from the dice tray)
  const A = unitById(s, s.attack!.attackerId);
  const before = s.attack!.attackerBuffsAtStart ?? [];
  const late = A.buffs.map((b) => b.kind).filter((k) => !before.includes(k));
  const lateNotes: string[] = [];
  if (late.includes('hit+1') && !p.autoHit) { p.hitMod = clamp(p.hitMod + 1, -RULES.modifierCaps.hitRoll, RULES.modifierCaps.hitRoll); lateNotes.push('+1 Hit'); }
  if (late.includes('wound+1')) { p.woundMod = clamp(p.woundMod + 1, -RULES.modifierCaps.woundRoll, RULES.modifierCaps.woundRoll); p.woundNote += ' · Stratagem +1'; }
  if (late.includes('ap+1')) { p.ap -= 1; lateNotes.push('AP +1'); }
  if (late.includes('lethal')) { p.lethal = true; lateNotes.push('Lethal Hits'); }
  if (late.includes('sustained1') && !p.sustained) { p.sustained = '1'; lateNotes.push('Sustained 1'); }
  if (late.includes('devastating')) { p.devastating = true; lateNotes.push('Dev Wounds'); }
  if (lateNotes.length) p.hitNote = [p.hitNote, `Stratagem: ${lateNotes.join(', ')}`].filter(Boolean).join(' · ');
}

export function rollHits(s: GameState) {
  const at = s.attack!;
  const p = at.pools[at.idx];
  applyDefense(s, p);
  if (p.autoHit) {
    p.hits = Array.from({ length: p.attacks }, () => ({ v: 0, o: 'auto' as const }));
  } else {
    p.hits = rollN(s, p.attacks).map((v) => ({ v, o: evalHit(p, v) }));
    const A = unitById(s, at.attackerId);
    if (p.hits.some((h) => h.o === 'miss')) {
      const rescued = rescueDie(s, A, 'hit', { need: p.skill ?? 3, best: !!(p.lethal || p.sustained), damage: exprAverage(p.damage), isCharacter: A.models.some((m) => m.isCharacter) });
      if (rescued !== null) {
        const missIdx = p.hits.findIndex((h) => h.o === 'miss');
        if (missIdx >= 0) p.hits[missIdx] = { v: rescued.v, o: evalHit(p, rescued.v), rerolled: true, orig: p.hits[missIdx].v };
      }
    }
    const all = p.rerollAllHits || A.buffs.some((b) => b.kind === 'rerollHits');
    const ones = p.rerollHits1 || A.buffs.some((b) => b.kind === 'rerollHits1');
    if (!p.noHitReroll && (all || ones)) offerReroll(s, p, 'hit', all ? 'all' : 'ones');
  }
  at.stage = 'wound';
}

/** The army-rule modifiers that change the pool itself: AP, re-rolls, weapon abilities, critical thresholds. */
function applyCombatMods(pool: Pool, cm: CombinedMods) {
  if (cm.apBonus) pool.ap -= cm.apBonus;
  if (cm.apWorsen) pool.ap = Math.min(0, pool.ap + cm.apWorsen);
  if (cm.rerollHits1) pool.rerollHits1 = true;
  if (cm.rerollWounds1) pool.rerollWounds1 = true;
  if (cm.rerollHits) pool.rerollAllHits = true;
  if (cm.rerollWounds) pool.rerollAllWounds = true;
  if (cm.lethal) pool.lethal = true;
  if (cm.devastating) pool.devastating = true;
  if (cm.critHitOn < (pool.critHitOn ?? 6)) pool.critHitOn = cm.critHitOn;
  if (cm.sustained && !pool.sustained) pool.sustained = cm.sustained;
  if (cm.critWoundOn && (!pool.critWoundOn || cm.critWoundOn < pool.critWoundOn)) pool.critWoundOn = cm.critWoundOn;
  if (cm.damageBonus) pool.damage = addToExpr(pool.damage, cm.damageBonus);
}

/** Dice an ability lets the attacker re-roll at this stage (01.05.02: a die is only ever re-rolled once). */
export function rerollable(p: Pool, d: Die): boolean {
  const r = p.reroll;
  return !!r && !d.rerolled && d.o !== 'auto' && (r.which === 'all' || d.v === 1 || (r.which === 'onesTwos' && d.v === 2));
}

/**
 * "You can re-roll the Hit roll": every failure is picked to begin with and re-rolled at once — unless the game
 * is set to let the attacker choose the dice (`pickRerolls`), e.g. to fish for a critical.
 */
function offerReroll(s: GameState, p: Pool, stage: 'hit' | 'wound', which: 'all' | 'ones' | 'onesTwos') {
  const dice = stage === 'hit' ? p.hits : p.wounds;
  p.reroll = { stage, which, picks: [] };
  const failed = (d: Die) => (stage === 'hit' ? d.o === 'miss' : d.o === 'fail');
  p.reroll.picks = dice.map((d, i) => (rerollable(p, d) && failed(d) ? i : -1)).filter((i) => i >= 0);
  // [LETHAL HITS] / [SUSTAINED HITS]: a plain hit is re-rolled too when fishing for a critical is worth more — a small
  // gun against a tank wounds on 6s, so a Lethal Hit (an automatic wound) beats keeping the hit
  if (stage === 'hit' && which === 'all') {
    const pw = Math.max(1, Math.min(5, 7 - (p.woundNeed - p.woundMod))) / 6;
    const sus = p.sustained ? (Number(/\d+/.exec(String(p.sustained))?.[0]) || 1.5) : 0;
    const critV = (p.lethal ? 1 : pw) + sus * pw;
    const critP = (7 - Math.min(6, p.critHitOn ?? 6)) / 6;
    const hitP = Math.max(0, Math.min(5, 7 - ((p.skill ?? 7) - p.hitMod))) / 6;
    const normP = Math.max(0, hitP - critP);
    if ((p.lethal || sus) && critP * critV + normP * pw > pw + 1e-9) {
      dice.forEach((d, i) => { if (d.o === 'hit' && rerollable(p, d) && !p.reroll!.picks.includes(i)) p.reroll!.picks.push(i); });
      p.reroll.picks.sort((a, b) => a - b);
    }
  }
  if (!dice.some((d) => rerollable(p, d))) p.reroll = undefined;
  else if (!s.pickRerolls) resolveReroll(s);
}

/** Pick / unpick one die for the pending ability re-roll. */
export function toggleRerollPick(s: GameState, i: number) {
  const p = s.attack?.pools[s.attack.idx];
  const r = p?.reroll;
  if (!p || !r) return;
  const d = (r.stage === 'hit' ? p.hits : p.wounds)[i];
  if (!d || !rerollable(p, d)) return;
  r.picks = r.picks.includes(i) ? r.picks.filter((x) => x !== i) : [...r.picks, i].sort((a, b) => a - b);
}

/** Re-roll the picked dice of the pending ability re-roll. */
export function resolveReroll(s: GameState) {
  const p = s.attack?.pools[s.attack.idx];
  const r = p?.reroll;
  if (!p || !r) return;
  for (const i of r.picks) {
    if (r.stage === 'hit') p.hits[i] = reroll(s, p.hits[i], (v) => evalHit(p, v));
    else p.wounds[i] = reroll(s, p.wounds[i], (v) => evalWound(p, v));
  }
  p.reroll = undefined;
}

function reroll(s: GameState, d: Die, ev: (v: number) => Die['o']): Die {
  const v = d6(s);
  return { v, o: ev(v), rerolled: true, orig: d.v };
}

export function hitsForWounding(p: Pool, s: GameState) {
  let auto = 0;
  let rolls = 0;
  for (const d of p.hits) {
    if (d.o === 'miss') continue;
    if (d.o === 'crit' && p.lethal) auto += 1; else rolls += 1;
    if (d.o === 'crit' && p.sustained) rolls += rollExpr(s, p.sustained).total;
  }
  return { auto, rolls };
}

export function rollWounds(s: GameState) {
  const at = s.attack!;
  const p = at.pools[at.idx];
  const hw = hitsForWounding(p, s);
  let { auto, rolls } = hw;
  // Grot Shields: a Gretchin unit within 3" takes each hit as 1 mortal wound and the attack ends there
  const Tg = unitById(s, at.targetId);
  const grots = (auto || rolls) && at.kind === 'shoot' && hasKw(Tg, 'INFANTRY') && !hasKw(Tg, 'GRETCHIN') && Tg.factionKeywords.includes('ORKS')
    ? boardUnits(s, Tg.owner).find((g) => g.id !== Tg.id && unitFlags(s, g).shieldsNear > 0 && unitDistance(g, Tg) <= unitFlags(s, g).shieldsNear + 1e-6) : undefined;
  if (grots) {
    const n = auto + rolls;
    log(s, `Grot Shields: ${grots.name} takes ${n} hit(s) meant for ${Tg.name} → ${n} mortal wounds`, 'info', Tg.owner);
    applyMortalWounds(s, grots, n, 'Grot Shields');
    auto = 0; rolls = 0;
  }
  // Shambling Wall: each attack is taken by the Poxwalkers nearby instead (Damage = Poxwalkers destroyed, no save)
  const wall = (auto || rolls) && at.kind === 'shoot' && unitFlags(s, Tg).poxWall
    ? boardUnits(s, Tg.owner).find((x) => x.sources.includes('Poxwalkers') && unitDistance(x, Tg) <= 3 + 1e-6 && alive(unitById(s, at.attackerId)).some((m) => unitVisibleTo(s, m, x))) : undefined;
  if (wall) {
    let n = 0;
    for (let i = 0; i < auto + rolls; i++) n += rollExpr(s, p.damage ?? p.profile.D).total;
    const dead = alive(wall).filter((m) => m.source === 'Poxwalkers').slice(0, n);
    for (const m of dead) killModel(s, wall, m);
    log(s, `Shambling Wall: ${auto + rolls} attack(s) on ${Tg.name} are taken by ${wall.name} → ${dead.length} Poxwalker(s) destroyed`, 'info', Tg.owner);
    auto = 0; rolls = 0;
  }
  // Mortal Thralls: no Wound roll; the DAMNED unit within 3" (visible to the attackers) takes the Damage as mortal wounds
  const T0 = unitById(s, at.targetId), A0 = unitById(s, at.attackerId);
  const thrall = rolls && unitFlags(s, T0).thralls
    ? boardUnits(s, T0.owner).find((d) => d.id !== T0.id && hasKw(d, 'DAMNED') && unitDistance(d, T0) <= 3 + 1e-6 && alive(A0).some((m) => unitVisibleTo(s, m, d))) : undefined;
  if (thrall) {
    let mw = 0;
    for (let i = 0; i < rolls; i++) mw += rollExpr(s, p.profile.D).total;
    log(s, `Mortal Thralls: ${rolls} attack(s) on ${T0.name} hit ${thrall.name} instead → ${mw} mortal wounds`, 'info', T0.owner);
    applyMortalWounds(s, thrall, mw, 'Mortal Thralls');
    rolls = 0;
  }
  p.autoWounds = auto;
  p.wounds = rollN(s, rolls).map((v) => ({ v, o: evalWound(p, v) }));
  const A = unitById(s, at.attackerId);
  if (p.wounds.some((w) => w.o === 'fail')) {
    const rescued = rescueDie(s, A, 'wound', { need: p.woundNeed, best: !!p.devastating, damage: exprAverage(p.damage), isCharacter: A.models.some((m) => m.isCharacter) });
    if (rescued !== null) {
      const failIdx = p.wounds.findIndex((w) => w.o === 'fail');
      if (failIdx >= 0) p.wounds[failIdx] = { v: rescued.v, o: evalWound(p, rescued.v), rerolled: true, orig: p.wounds[failIdx].v };
    }
  }
  const rrAll = p.twinLinked || p.rerollAllWounds || A.buffs.some((b) => b.kind === 'rerollWounds');
  const rr1 = p.rerollWounds1 || A.buffs.some((b) => b.kind === 'rerollWounds1');
  if (rrAll || rr1 || p.rerollWounds12) offerReroll(s, p, 'wound', rrAll ? 'all' : p.rerollWounds12 ? 'onesTwos' : 'ones');
  at.stage = 'save';
}

/** Command Re-roll on one die of the current stage. */
export function rerollOne(s: GameState, stage: 'hit' | 'wound' | 'save', index: number) {
  const at = s.attack!;
  const p = at.pools[at.idx];
  if (stage === 'hit') p.hits[index] = reroll(s, p.hits[index], (v) => evalHit(p, v));
  if (stage === 'wound') p.wounds[index] = reroll(s, p.wounds[index], (v) => evalWound(p, v));
  if (stage === 'save') {
    const d = p.saves[index];
    p.saves[index] = { v: d6(s), o: 'pass', rerolled: true, orig: d.v };
  }
}

// ----- saves & damage (05.03 / 05.04) -----

interface Group { char: boolean; models: ModelState[] }

export function allocationGroups(T: UnitState): Group[] {
  const a = alive(T);
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  for (const m of a) {
    if (m.isCharacter) { groups.push({ char: true, models: [m] }); continue; }
    const k = `${m.profile.W}|${m.profile.Sv}|${m.profile.InSv}`;
    if (!byKey.has(k)) { const g = { char: false, models: [] as ModelState[] }; byKey.set(k, g); groups.push(g); }
    byKey.get(k)!.models.push(m);
  }
  const wounded = (g: Group) => g.models.some((m) => m.wounds < m.profile.W);
  const rank = (g: Group) => (g.char ? 2 : 0) + (wounded(g) ? 0 : 1);
  return groups.sort((x, y) => rank(x) - rank(y) || x.models[0].profile.W - y.models[0].profile.W || y.models[0].profile.Sv - x.models[0].profile.Sv);
}

/** Choose which model takes the next attack: a wounded one if any (05.04), otherwise one whose removal keeps the unit coherent. */
export function pickCasualty(u: UnitState, candidates: ModelState[]): ModelState | undefined {
  const a = candidates.filter((m) => !m.dead);
  const wounded = a.find((m) => m.wounds < m.profile.W);
  if (wounded || a.length <= 1) return wounded ?? a[0];
  const all = alive(u);
  const c = { x: all.reduce((x, m) => x + m.x, 0) / all.length, y: all.reduce((y, m) => y + m.y, 0) / all.length };
  let best = a[0];
  let bestScore = -Infinity;
  for (const m of a) {
    const rest = all.filter((x) => x !== m);
    const broken = coherencyProblems(rest, RULES.coherency.near, RULES.coherency.max, rest.map((x) => x.r)).length;
    const score = -broken * 1000 + Math.hypot(m.x - c.x, m.y - c.y);
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

function pickModel(g: Group, u: UnitState): ModelState | undefined {
  return pickCasualty(u, g.models);
}

type TransportHook = (s: GameState, u: UnitState, m: ModelState) => void;
let transportHook: TransportHook | null = null;
export const onTransportDestroyed = (fn: TransportHook) => { transportHook = fn; };

/** Abilities that react to attacks and deaths register here (activations.ts), keeping this module free of them. */
export interface AttackInfo { hits: number; hitWeapons: string[]; destroyed: boolean; woundsLost: number; modelsKilled: number; killedCharacter: boolean }
type AttackHook = (s: GameState, at: AttackSession, info: AttackInfo) => void;
type KillHook = (s: GameState, u: UnitState, m: ModelState, killerId?: string) => void;
type MortalHook = (s: GameState, u: UnitState, n: number) => void;
type StartHook = (s: GameState, at: AttackSession) => void;
const startHooks: StartHook[] = [];
const attackHooks: AttackHook[] = [];
const killHooks: KillHook[] = [];
const mortalHooks: MortalHook[] = [];
export const onAttackFinished = (fn: AttackHook) => { attackHooks.push(fn); };
export const onModelKilled = (fn: KillHook) => { killHooks.push(fn); };
export const onMortalWounds = (fn: MortalHook) => { mortalHooks.push(fn); };
export const onAttackStart = (fn: StartHook) => { startHooks.push(fn); };

export function killModel(s: GameState, u: UnitState, m: ModelState, killer?: string) {
  const dd = m.deadlyDemise ?? (u.core.deadlyDemise && (m.keywords.includes('VEHICLE') || m.keywords.includes('MONSTER') || u.models.length === 1) ? u.core.deadlyDemise : undefined);
  const ddOn = dd ? unitFlags(s, u).deadlyDemiseOn : 6; // worked out while the model still stands
  m.dead = true;
  m.wounds = 0;
  (s.modelDeaths ??= []).push({ turn: s.turn, owner: u.owner, character: m.isCharacter || m.keywords.includes('CHARACTER'), W: m.profile.W });
  if (u.transport && m.keywords.includes('TRANSPORT')) transportHook?.(s, u, m);
  // Vengeance for the Omnissiah: a friendly ASTRA MILITARUM VEHICLE destroyed within 12"
  if (m.keywords.includes('VEHICLE') && u.factionKeywords.includes('ASTRA MILITARUM')) {
    for (const f of boardUnits(s, u.owner)) {
      if (f.abilities.some((a) => a.name === 'Vengeance for the Omnissiah') && alive(f).some((fm) => gap(fm, m) <= 12 + 1e-6)) (f.triggered ??= []).push('avengeVehicle');
    }
  }
  // Servitors: the Cenobyte Servitors are destroyed with Chaplain Grimaldus
  if (/grimaldus/i.test(m.name) && u.abilities.some((a) => a.name === 'Servitors')) for (const x of alive(u).filter((n) => /servitor/i.test(n.name))) { x.dead = true; x.wounds = 0; }
  if (!alive(u).length) {
    u.status = 'destroyed';
    s.destroyedByTurn.push({ turn: s.turn, owner: u.owner, unitId: u.id, killerId: s.attack?.attackerId, phase: s.phase });
    onUnitDestroyed(s, u, s.attack?.attackerId);
    emit(s, 'unitDestroyed', { u, attackerId: s.attack?.attackerId });
    log(s, `${u.name} destroyed${killer ? ' by ' + killer : ''}`, 'kill');
    if (s.campaign) {
      const killerOwner = s.attack ? unitById(s, s.attack.attackerId).owner : other(u.owner);
      const vpEarned = Math.max(5, Math.round((u.pts ?? 50) / 10));
      s.players[killerOwner].vp += vpEarned;
      log(s, `${u.name} destroyed: +${vpEarned} VP to ${s.players[killerOwner].name}`, 'kill', killerOwner);
      const enemyAlive = s.units.filter((x) => x.owner === other(killerOwner) && x.status !== 'destroyed');
      if (!enemyAlive.length) {
        s.winner = killerOwner;
        s.phase = 'gameover';
        log(s, `All enemy units destroyed! ${s.players[killerOwner].name} wins!`, 'vp', killerOwner);
      }
    }
  }
  for (const h of killHooks) h(s, u, m, s.attack?.attackerId);
  if (dd) {
    // Vengeful Animus: no roll, it blows up anyway
    // Detonator (Deceptors): the opponent makes it explode without a roll
    const sure = emitReact(s, u.owner, 'deadlyDemise', { unitId: u.id, modelId: m.id }) || (!m.keywords.includes('TITANIC') && emitReact(s, other(u.owner), 'enemyDeadlyDemise', { unitId: u.id, modelId: m.id }));
    const r = sure ? 6 : d6(s);
    if (r >= ddOn) { // Warpfire Infusion: 5+ near a sorcerer
      log(s, `Deadly Demise (${dd}) from ${m.name}: ${sure ? 'it explodes' : 'rolled a 6!'}`, 'roll');
      // Machine Wrath: the wreck makes one last move before it blows
      emitReact(s, u.owner, 'deadlyDemiseSix', { unitId: u.id, modelId: m.id, six: true });
      const targets = s.units.filter((v) => v.id !== u.id && onBoard(v) && alive(v).some((n) => baseDist(n, m) <= RULES.deadlyDemiseRange));
      pushFx(s, { kind: 'explosion', at: { x: m.x, y: m.y }, range: RULES.deadlyDemiseRange, radius: RULES.deadlyDemiseRange + reachOf(m), hits: targets.length });
      for (const v of targets) {
        applyMortalWounds(s, v, rollExpr(s, dd).total, 'Deadly Demise');
        emit(s, 'deadlyDemiseHit', { u, v });
      }
    } else log(s, `Deadly Demise from ${m.name}: rolled ${r} (no explosion)`, 'roll');
  }
}

/** Lose wounds on one model with Feel No Pain. Returns wounds actually lost. */
function loseWounds(s: GameState, u: UnitState, m: ModelState, n: number, lines?: string[], kind: 'melee' | 'ranged' | 'mortal' = 'ranged', psychic = false): number {
  let lost = 0;
  const buffFnp = u.buffs.some((b) => b.kind === 'fnp4') ? 4 : u.buffs.some((b) => b.kind === 'fnp5') ? 5 : u.buffs.some((b) => b.kind === 'fnp6') ? 6 : undefined;
  const fxFnp = modelDefence(s, u, m, kind, psychic).fnp ?? undefined;
  const fnp = [u.core.fnp, buffFnp, fxFnp].filter((x): x is number => x !== undefined).reduce<number | undefined>((a, b) => (a === undefined ? b : Math.min(a, b)), undefined);
  const fnpRolls: number[] = [];
  for (let i = 0; i < n && !m.dead; i++) {
    if (fnp) { const r = d6(s); fnpRolls.push(r); if (r >= fnp) continue; }
    m.wounds -= 1;
    lost += 1;
    if (m.wounds <= 0) killModel(s, u, m);
  }
  if (lines && fnpRolls.length) lines.push(`Feel No Pain ${fnp}+: [${fnpRolls.join(' ')}]`);
  return lost;
}

export function applyMortalWounds(s: GameState, u: UnitState, n: number, source: string, maxModels?: number, preferChar?: boolean): number {
  if (n > 0 && alive(u).length) for (const h of mortalHooks) h(s, u, n);
  let killed = 0;
  let modelsHit = 0;
  let current: ModelState | undefined;
  const deadIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = alive(u);
    if (!a.length) break;
    if (!current || current.dead) {
      if (maxModels !== undefined && modelsHit >= maxModels) break;
      const nonChar = a.filter((m) => !m.isCharacter);
      const pool = preferChar && a.some((m) => m.isCharacter) ? a.filter((m) => m.isCharacter) : nonChar.length ? nonChar : a;
      current = pickCasualty(u, pool)!;
      modelsHit += 1;
    }
    loseWounds(s, u, current, 1, undefined, 'mortal');
    if (current.dead) {
      killed += 1;
      deadIds.push(current.id);
    }
  }
  const hitAt = alive(u)[0] ?? u.models.find((m) => m.dead);
  if (hitAt) pushFx(s, { kind: 'mortal', unitId: u.id, n, at: { x: hitAt.x, y: hitAt.y }, deadIds: deadIds.length ? deadIds : undefined });
  log(s, `${u.name} suffers ${n} mortal wounds (${source})${killed ? ` → ${killed} slain` : ''}`, 'roll', u.owner);
  return killed;
}

export function rollSavesAndDamage(s: GameState) {
  const at = s.attack!;
  const p = at.pools[at.idx];
  const devCrits = p.devastating ? p.wounds.filter((d) => d.o === 'critWound').length : 0;
  const normalCrits = !p.devastating ? p.wounds.filter((d) => d.o === 'critWound').length : 0;
  const normalWounds = p.wounds.filter((d) => d.o === 'wound').length + p.autoWounds;
  const normal = normalCrits + normalWounds;
  const rolls = rollN(s, normal);
  p.saves = rolls.map((v, idx) => ({ v, o: 'pass' as const, ...(idx < normalCrits ? { crit: true } : {}) }));
  at.stage = 'damage';
  p.mortalFromDev = Array.from({ length: devCrits }, () => 0);
}

export function applyDamage(s: GameState) {
  const at = s.attack!;
  const p = at.pools[at.idx];
  const T = unitById(s, at.targetId);
  const A = unitById(s, at.attackerId);
  const before = alive(T).length;
  const groups = allocationGroups(T);
  let precisionGroup: Group | undefined;
  if (p.precision || p.precisionOnCrit) precisionGroup = groups.find((g) => g.char && alive(A).some((am) => modelVisible(s, am, T, g.models[0]) || at.kind === 'fight'));
  // [PRECISION] only on critical hits: that many of the attacks may pick a CHARACTER
  let precise = p.precision ? Infinity : p.precisionOnCrit ? p.hits.filter((h) => h.o === 'crit').length : 0;
  const order = p.saves.map((d, i) => ({ d, i })).sort((x, y) => x.d.v - y.d.v);
  p.saveTargets = p.saves.map(() => '');
  for (const { d, i } of order) {
    let usePrecise = precise > 0 && !!precisionGroup && precisionGroup.models.some((m) => !m.dead);
    const prot = unitFlags(s, T).protectPrecision;
    if (usePrecise && prot && prot <= 6 && groups.some((x) => !x.char && x.models.some((m) => !m.dead))) {
      const roll = d6(s);
      if (roll >= prot) {
        usePrecise = false;
        log(s, `Selfless Bodyguard: rolled ${roll} → Precision allocated to Bodyguard instead`, 'info', T.owner);
      }
    }
    if (usePrecise) precise -= 1;
    const g = usePrecise ? precisionGroup : groups.find((x) => x.models.some((m) => !m.dead));
    if (!g) { d.o = 'saved'; p.saveTargets[i] = '—'; continue; }
    const m = pickModel(g, T)!;
    const kind = at.kind === 'fight' ? 'melee' : 'ranged';
    const psychic = !!p.psychic || hasAbility(p.profile, 'psychic');
    const md = modelDefence(s, T, m, kind, psychic, A);
    if (kind === 'melee') (at.allocated ??= {})[m.id] = (at.allocated[m.id] ?? 0) + 1;
    const sv = m.profile.Sv - (T.buffs.some((b) => b.kind === 'save+1') ? 1 : 0) - (md.saveBonusD1 && p.damage.trim() === '1' ? md.saveBonusD1 : 0) - (md.save ?? 0);
    const inv = effectiveInSv(s, T, m, at.kind !== 'fight', psychic, A);
    const effAp = p.ap - (d.crit && p.critWoundAp ? p.critWoundAp : 0);
    let ok = false;
    if (d.v !== 1) ok = (inv !== null && d.v >= inv) || d.v + effAp >= Math.max(RULES.modifierCaps.bestSave, sv);
    if (!ok && !d.rerolled) {
      const minSv = Math.min(inv ?? 99, Math.max(RULES.modifierCaps.bestSave, sv) - effAp);
      if (minSv <= 6) {
        const rescued = rescueDie(s, T, 'save', { need: minSv, damage: exprAverage(p.damage), isCharacter: m.isCharacter });
        if (rescued !== null) {
          d.v = rescued.v;
          ok = true;
          d.rerolled = true;
        }
      }
    }
    p.saveTargets[i] = `${m.name} (Sv${sv}+${inv ? ` / ${inv}++` : ''}, AP${effAp})`;
    d.o = ok ? 'saved' : 'fail';
    if (!ok) {
      let dr = rollExpr(s, p.damage);
      if (dr.dice.length && dr.total < exprAverage(p.damage)) {
        const rescued = rescueDie(s, A, 'damage');
        if (rescued !== null) {
          const flat = p.damage.includes('+') ? parseInt(p.damage.split('+')[1]) : 0;
          dr = { total: rescued.v + flat, dice: [rescued.v] };
          p.damageLines.push(`${rescued.rule}: Damage substituted with ${rescued.die} [${rescued.v}] = ${dr.total}`);
        }
      }
      if ((p.rerollDamage || (p.rerollDamageOne && dr.total < m.wounds)) && dr.dice.length && dr.total < exprAverage(p.damage)) {
        const again = rollExpr(s, p.damage); p.damageLines.push(`re-roll damage ${dr.total}→${again.total}`); dr = again; p.rerollDamageOne = false;
      } else if (dr.dice.length && dr.total < exprAverage(p.damage) && dr.total < m.wounds && freeDamageHook?.(s)) {
        // a free "hit, wound or damage" re-roll not used on the hit or wound dice goes on a low damage roll
        const again = rollExpr(s, p.damage); p.damageLines.push(`free Damage re-roll ${dr.total}→${again.total}`); dr = again;
      }
      // Command Re-roll on a low damage roll that would not kill the model anyway
      else if (dr.dice.length && dr.total < exprAverage(p.damage) && dr.total < m.wounds
        && (p.crDamage ? !canUseStratagem(s, A.owner, 'command-reroll', A) : wantsCR(s, A.owner, 'damage', A))) {
        spendStratagem(s, A.owner, 'command-reroll', A);
        const again = rollExpr(s, p.damage);
        p.damageLines.push(`Command Re-roll damage ${dr.total}→${again.total}`);
        dr = again;
        p.crDamage = false;
      }
      let dmg = dr.total;
      if (T.buffs.some((b) => b.kind === 'damage-1')) dmg = Math.max(1, dmg - 1);
      if (md.damage) dmg = Math.max(1, dmg + md.damage);
      if (md.halve) dmg = Math.ceil(dmg / 2);
      if (md.negate) { useNegate(s, T, m, md.negateKey); dmg = 0; p.damageLines.push(`${m.name}: damage reduced to 0 (once per phase)`); }
      const lost = dmg ? loseWounds(s, T, m, dmg, p.damageLines, kind, psychic) : 0;
      p.damageLines.push(`${m.name}: −${lost} W${dr.dice.length ? ` (D=${p.damage}→${dmg})` : ''}${m.dead ? ' (slain)' : ''}`);
    }
  }
  // Devastating Wounds: mortal wounds after normal damage, each critical wound damages at most one model.
  for (let k = 0; k < p.mortalFromDev.length; k++) {
    if (!alive(T).length) break;
    const dmg = rollExpr(s, p.damage).total;
    p.mortalFromDev[k] = dmg;
    applyMortalWounds(s, T, dmg, `Devastating Wounds (${p.weapon})`, 1, !!precisionGroup);
  }
  p.killed = before - alive(T).length;
  p.done = true;
  at.summary.push(`${p.weapon}: ${p.attacks} attacks → ${p.hits.filter((h) => h.o !== 'miss').length} hit → ${p.wounds.filter((w) => w.o !== 'fail').length + p.autoWounds} wound → ${p.killed} slain`);
  if (!alive(T).length) { at.stage = 'done'; return; }
  if (at.idx < at.pools.length - 1) { at.idx += 1; at.stage = 'hit'; } else at.stage = 'done';
}

/** Run every remaining stage instantly (fast mode). */
export function resolveAll(s: GameState) {
  while (s.attack && s.attack.stage !== 'done') stepAttack(s);
}

/** Bots decide on Command Re-rolls right after dice are rolled (registered by botStrats.ts). */
type DiceHook = (s: GameState, stage: 'hit' | 'wound' | 'save') => void;
let diceHook: DiceHook | null = null;
export const setDiceHook = (fn: DiceHook) => { diceHook = fn; };

export function stepAttack(s: GameState) {
  const at = s.attack!;
  const p = at.pools[at.idx];
  // a pending ability re-roll is made first (with the dice picked so far)
  if (p?.reroll) { const st = p.reroll.stage; resolveReroll(s); diceHook?.(s, st); return; }
  if (at.stage === 'hit') { rollHits(s); if (!at.pools[at.idx]?.reroll) diceHook?.(s, 'hit'); }
  else if (at.stage === 'wound') { rollWounds(s); if (!at.pools[at.idx]?.reroll) diceHook?.(s, 'wound'); }
  else if (at.stage === 'save') { rollSavesAndDamage(s); diceHook?.(s, 'save'); }
  else if (at.stage === 'damage') applyDamage(s);
}

/**
 * Hazard tests (11e: each roll of 1–2 fails). With the owner's say-so (a bot decides itself) one failed die is
 * re-rolled with a Command Re-roll. Logs the dice; the caller applies the mortal wounds.
 */
export function hazardTest(s: GameState, u: UnitState, n: number, label: string, worse = 0): { rolls: number[]; fails: number } {
  const rolls = rollN(s, n);
  const failed = (r: number) => r - worse <= RULES.hazard.failOn;
  let note = '';
  // an ability re-rolls the failed hazard dice for free
  if (unitFlags(s, u).rerollHazard && rolls.some(failed)) {
    const before = rolls.join(' ');
    for (let k = 0; k < rolls.length; k++) if (failed(rolls[k])) rolls[k] = d6(s);
    note = ` · re-roll [${before}]`;
  }
  const i = rolls.findIndex(failed);
  if (i >= 0 && wantsCR(s, u.owner, 'hazard', u)) {
    spendStratagem(s, u.owner, 'command-reroll', u);
    const again = d6(s);
    note = ` · Command Re-roll ${rolls[i]}→${again}`;
    rolls[i] = again;
  }
  log(s, `${label} ${u.name}: hazard [${rolls.join(' ')}]${worse > 0 ? ` −${worse}` : worse < 0 ? ` +${-worse}` : ''}${note}`, 'roll', u.owner);
  return { rolls, fails: rolls.filter(failed).length };
}

/** Close the session: hazardous rolls, flags, log. */
export function finishAttack(s: GameState) {
  const at = s.attack!;
  const A = unitById(s, at.attackerId);
  const T = unitById(s, at.targetId);
  // one hazard roll per Hazardous weapon used in the attack, however many models fired it
  const haz = at.pools.filter((p) => p.hazardous > 0).length;
  if (haz && alive(A).length) {
    // Rites of Thermal Appeasement: +1 to hazard rolls for its plasma weapons
    const plasma = A.abilities.some((a) => a.name === 'Rites of Thermal Appeasement') && at.pools.every((p) => !p.hazardous || /plasma/i.test(p.weapon));
    const { rolls, fails } = hazardTest(s, A, haz, 'Hazardous', plasma ? -1 : 0);
    at.hazardousRolls = rolls;
    if (fails) {
      const mv = alive(A).every(isMV);
      applyMortalWounds(s, A, fails * (mv ? RULES.hazard.mortalWoundsMonsterVehicle : RULES.hazard.mortalWounds), 'Hazardous');
    }
  }
  const killed = at.pools.reduce((a, p) => a + p.killed, 0);
  if (at.aliveBefore) {
    const dead = T.models.filter((m) => m.dead && at.aliveBefore!.includes(m.id));
    const dmg = Math.max(0, (at.woundsBefore ?? 0) - alive(T).reduce((a, m) => a + m.wounds, 0));
    const c = (ms: { x: number; y: number }[]) => ({ x: ms.reduce((a, m) => a + m.x, 0) / Math.max(1, ms.length), y: ms.reduce((a, m) => a + m.y, 0) / Math.max(1, ms.length) });
    const tm = alive(T).length ? alive(T) : dead;
    const names = at.pools.map((p) => `${p.weapon} ${p.profile.name}`).join(' ');
    const style = at.kind === 'fight' ? 'melee'
      : at.pools.some((p) => hasAbility(p.profile, 'torrent')) ? 'flame'
      : /plasma|las|melta|volkite|beam|lance|tesla|gauss|lascannon|conversion|pulse|ion/i.test(names) ? 'beam'
      : /cannon|missile|rocket|launcher|mortar|battle ?cannon|demolisher|krak|frag|artillery|bombard|kannon|zzap|shokk/i.test(names) ? 'blast'
      : 'bullet';
    const pt = (m: { x: number; y: number }) => ({ x: m.x, y: m.y });
    const before = T.models.filter((m) => at.aliveBefore!.includes(m.id));
    const pts = Math.round((T.pts * dead.length) / Math.max(1, T.startingStrength));
    const report: AttackReport = {
      attacker: A.name, target: T.name, weapons: [...new Set(at.pools.map((p) => p.weapon))],
      shots: at.pools.reduce((a, p) => a + p.attacks, 0),
      hits: at.pools.reduce((a, p) => a + p.hits.filter((h) => h.o !== 'miss').length, 0),
      crits: at.pools.reduce((a, p) => a + p.hits.filter((h) => h.o === 'crit').length, 0),
      wounds: at.pools.reduce((a, p) => a + p.wounds.filter((w) => w.o === 'wound' || w.o === 'critWound').length + p.autoWounds, 0),
      unsaved: at.pools.reduce((a, p) => a + p.saves.filter((d) => d.o === 'fail').length + p.mortalFromDev.length, 0),
      mortals: at.pools.reduce((a, p) => a + p.mortalFromDev.reduce((x, y) => x + y, 0), 0),
      dmg, before: at.aliveBefore.length, killed: dead.length, destroyed: !alive(T).length, pts, chips: attackChips(at.pools),
    };
    const st = (s.stats ??= { kills: [] });
    if (dead.length) st.kills.push({ round: s.round, turn: s.turn, by: A.owner, attackerId: A.id, targetId: T.id, models: dead.length, pts, destroyed: !alive(T).length });
    pushFx(s, {
      kind: 'attack', attackKind: at.kind, attackerId: A.id, targetId: T.id, owner: A.owner, from: c(alive(A).length ? alive(A) : A.models), to: c(tm), dmg, killed: dead.length, dead: dead.map(pt), deadIds: dead.map((m) => m.id),
      style, shooters: (alive(A).length ? alive(A) : A.models).slice(0, 12).map(pt), victims: before.slice(0, 12).map(pt),
      shots: at.pools.reduce((a, p) => a + p.attacks, 0), hits: at.pools.reduce((a, p) => a + p.hits.filter((h) => h.o !== 'miss').length, 0),
      volleys: at.pools.filter((p) => p.attacks > 0).slice(0, 6).map((p) => ({ fx: weaponFx(p.weapon, p.profile, at.kind === 'fight'), shots: p.attacks, hits: p.hits.filter((h) => h.o !== 'miss').length, models: p.models })),
      report,
    });
  }
  const verb = at.kind === 'fight' ? 'fights' : at.kind === 'overwatch' ? 'fires Overwatch at' : 'shoots';
  log(s, `${A.name} ${verb} ${T.name}: ${killed} models destroyed`, 'info', A.owner);
  if (!at.free) {
    if (at.kind !== 'fight') A.shotTurn = s.turn;
    if (at.kind === 'shoot' && !unfiredWeaponNames(A).length) A.selectedToShoot = true;
    if (at.kind === 'fight') A.fought = true;
  }
  s.attack = null;
  if (!at.free) {
    const L = s.lastAct?.kind === 'attack' && s.lastAct.unitId === A.id && s.lastAct.turn === s.turn && s.lastAct.phase === s.phase ? s.lastAct
      : (s.lastAct = { unitId: A.id, owner: A.owner, kind: 'attack', turn: s.turn, phase: s.phase, targets: [], lost: [], halved: [] });
    if (!L.targets.includes(T.id)) L.targets.push(T.id);
    if (killed && !L.lost.includes(T.id)) L.lost.push(T.id);
    if (killed && alive(T).length && alive(T).length * 2 < T.startingStrength && (at.aliveBefore?.length ?? 0) * 2 >= T.startingStrength) L.halved.push(T.id);
    if (T.models.length === 1 && alive(T).length && alive(T)[0].wounds * 2 < alive(T)[0].profile.W && (at.woundsBefore ?? 0) * 2 >= alive(T)[0].profile.W) L.halved.push(T.id);
  }
  const info: AttackInfo = {
    hits: at.pools.reduce((a, p) => a + p.hits.filter((h) => h.o !== 'miss').length, 0),
    hitWeapons: [...new Set(at.pools.filter((p) => p.hits.some((h) => h.o !== 'miss')).map((p) => p.weapon))],
    destroyed: !alive(T).length,
    woundsLost: Math.max(0, (at.woundsBefore ?? 0) - alive(T).reduce((a, m) => a + m.wounds, 0)),
    modelsKilled: killed,
    killedCharacter: T.models.some((m) => m.dead && (at.aliveBefore ?? []).includes(m.id) && (m.isCharacter || m.keywords.includes('CHARACTER'))),
  };
  for (const h of attackHooks) h(s, at, info);
}

export function canShootTarget(s: GameState, a: UnitState, t: UnitState): boolean {
  return onBoard(t) && t.owner !== a.owner && alive(a).some((m) => unitVisibleTo(s, m, t));
}

export const opponentOf = (s: GameState, u: UnitState) => other(u.owner);

/** Names of all ranged weapons still carried by living models. */
export function rangedWeaponNames(u: UnitState): string[] {
  return [...new Set(alive(u).flatMap((m) => m.weapons.filter((w) => !isMelee(w.profiles[0])).map((w) => w.name)))];
}

/** Ranged weapons the unit can still fire this phase: not fired yet, and of the kind its models chose (a model that
 *  fired its pistols can't fire its other guns, and the other way round; MONSTER / VEHICLE models fire both). */
export function unfiredWeaponNames(u: UnitState): string[] {
  const out = new Set<string>();
  for (const m of alive(u)) {
    const all = m.weapons.filter((w) => !isMelee(w.profiles[0]));
    const cq = (w: WeaponData) => hasAbility(w.profiles[0], 'close-quarters');
    const firedCq = all.some((w) => cq(w) && u.weaponsFired.includes(w.name));
    const firedOther = all.some((w) => !cq(w) && u.weaponsFired.includes(w.name));
    for (const w of all) {
      if (u.weaponsFired.includes(w.name)) continue;
      if (!isMV(m) && ((firedOther && cq(w)) || (firedCq && !cq(w)))) continue;
      out.add(w.name);
    }
  }
  return [...out];
}

/** Split fire: the player is done with this unit even if some weapons were not used. */
export function endUnitShooting(u: UnitState) {
  u.selectedToShoot = true;
}
